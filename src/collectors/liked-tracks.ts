import { getAccessToken } from "../auth";
import { EventRow, getState, insertEvents, setState } from "../db";
import { spotifyGet } from "../spotify-api";
import { CollectorResult, Env, TransientError, nowIso } from "../types";

const PAGE_SIZE = 50;
// No subrequest limit when self-hosted, but we keep a per-run budget so a
// single run does not monopolize the Spotify rate limit.
const MAX_PAGES_PER_RUN = 30;

interface LikedItem {
  added_at: string;
  track: {
    id: string;
    uri: string;
    name: string;
    duration_ms: number;
    artists: { id: string; name: string }[];
    album?: { id?: string; name?: string };
  };
}

function toRow(it: LikedItem): EventRow {
  return {
    id: `spotify:like:${it.track.id}:${it.added_at}`,
    ts_utc: it.added_at,
    type: "like",
    source: "spotify",
    duration_s: null,
    title: it.track.name,
    subtitle: it.track.artists.map((a) => a.name).join(", "),
    payload: JSON.stringify({
      track_id: it.track.id,
      uri: it.track.uri,
      album: it.track.album?.name ?? null,
      album_id: it.track.album?.id ?? null,
      artist_ids: it.track.artists.map((a) => a.id),
      duration_ms: it.track.duration_ms,
    }),
  };
}

async function fetchPage(env: Env, token: string, offset: number): Promise<LikedItem[]> {
  const url = `https://api.spotify.com/v1/me/tracks?limit=${PAGE_SIZE}&offset=${offset}`;
  // spotifyGet handles network/5xx (bounded retry), 429 (persisted cooldown +
  // throw) and writes raw_spotify on every attempt (I3).
  const r = await spotifyGet(env, "liked_tracks", url, token);
  if (r.status < 200 || r.status >= 300) throw new TransientError(`spotify ${r.status}`);

  return (JSON.parse(r.bodyText).items ?? []) as LikedItem[];
}

/**
 * Spec §6: offset-based backfill (first install), then incremental mode.
 * An unlike removes nothing — the event did happen (intended behaviour).
 */
export async function collectLikedTracks(env: Env): Promise<CollectorResult> {
  const token = await getAccessToken(env);
  const backfillDone = getState(env, "B.backfill_done") === "1";

  let fetched = 0;
  let inserted = 0;

  if (!backfillDone) {
    let offset = Number(getState(env, "B.backfill_offset") ?? "0");
    let maxAddedAt = getState(env, "B.last_added_at") ?? "";

    for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
      const items = await fetchPage(env, token, offset);
      fetched += items.length;
      inserted += insertEvents(env, items.map(toRow));

      for (const it of items) if (it.added_at > maxAddedAt) maxAddedAt = it.added_at;

      offset += items.length;
      if (items.length < PAGE_SIZE) {
        setState(env, "B.backfill_done", "1");
        setState(env, "B.last_added_at", maxAddedAt);
        setState(env, "B.last_success_at", nowIso());
        return { status: "ok", fetched, inserted, note: "backfill complete" };
      }
    }
    setState(env, "B.backfill_offset", String(offset));
    if (maxAddedAt) setState(env, "B.last_added_at", maxAddedAt);
    setState(env, "B.last_success_at", nowIso());
    return { status: "partial", fetched, inserted, note: `backfill in progress, offset=${offset}` };
  }

  const lastAddedAt = getState(env, "B.last_added_at") ?? "";
  let maxAddedAt = lastAddedAt;

  for (let page = 0; page < MAX_PAGES_PER_RUN; page++) {
    const items = await fetchPage(env, token, page * PAGE_SIZE);
    if (items.length === 0) break;

    const fresh = items.filter((it) => it.added_at > lastAddedAt);
    fetched += fresh.length;
    inserted += insertEvents(env, fresh.map(toRow));
    for (const it of fresh) if (it.added_at > maxAddedAt) maxAddedAt = it.added_at;

    if (fresh.length < items.length || items.length < PAGE_SIZE) break;
  }

  if (maxAddedAt > lastAddedAt) setState(env, "B.last_added_at", maxAddedAt);
  setState(env, "B.last_success_at", nowIso());
  return { status: "ok", fetched, inserted };
}
