import { getAccessToken } from "../spotify/auth";
import { EventRow, getState, insertEvents, insertGap, linkPlaybackSessions, setState } from "../db";
import { spotifyGet } from "../spotify/api";
import { Account, CollectorResult, Env, TransientError, nowIso } from "../types";

const URL_RP = "https://api.spotify.com/v1/me/player/recently-played?limit=50";
const GAP_TOLERANCE_MS = 5 * 60 * 1000; // §5.4

interface RpItem {
  played_at: string;
  track: {
    id: string;
    uri: string;
    name: string;
    duration_ms: number;
    artists: { id: string; name: string }[];
    album?: { id?: string; name?: string };
  };
  context?: { type?: string; uri?: string } | null;
}

/**
 * Spec §5 — deliberate decision: NO `after` parameter.
 * We refetch the last 50 on every run; INSERT OR IGNORE sorts it out.
 * `played.last_played_at` is only used for gap detection, never for the request.
 *
 * Every read and write is scoped to `account`: cursors, raw rows, events and
 * gaps all belong to the account the run collected for.
 */
export async function collectRecentlyPlayed(env: Env, account: Account): Promise<CollectorResult> {
  const token = await getAccessToken(env, account);

  // spotifyGet handles network/5xx (bounded retry), 429 (persisted cooldown +
  // throw) and writes raw_spotify on every attempt (I3).
  let r = await spotifyGet(env, account.id, "played", URL_RP, token);

  if (r.status === 401) {
    // Isolated 401: a single token refresh, then one retry (§10).
    const retryToken = await getAccessToken(env, account);
    r = await spotifyGet(env, account.id, "played", URL_RP, retryToken);
  }

  if (r.status >= 500) {
    return { status: "partial", fetched: 0, inserted: 0, note: `spotify ${r.status}` };
  }
  if (r.status < 200 || r.status >= 300) {
    throw new TransientError(`unexpected ${r.status}: ${r.bodyText.slice(0, 200)}`);
  }

  const items: RpItem[] = (JSON.parse(r.bodyText).items ?? []) as RpItem[];
  if (items.length === 0) {
    setState(env, account.id, "played.last_success_at", nowIso());
    return { status: "ok", fetched: 0, inserted: 0, note: "empty buffer" };
  }

  const rows: EventRow[] = items.map((it) => ({
    id: `spotify:listen:${it.played_at}`,
    ts_utc: it.played_at,
    type: "listen",
    source: "spotify",
    duration_s: Math.round(it.track.duration_ms / 1000),
    title: it.track.name,
    subtitle: it.track.artists.map((a) => a.name).join(", "),
    payload: JSON.stringify({
      track_id: it.track.id,
      uri: it.track.uri,
      album: it.track.album?.name ?? null,
      album_id: it.track.album?.id ?? null,
      artist_ids: it.track.artists.map((a) => a.id),
      duration_ms: it.track.duration_ms,
      context: it.context ?? null,
    }),
  }));

  const inserted = insertEvents(env, account.id, rows);

  const playedAts = items.map((i) => i.played_at).sort();
  const oldest = playedAts[0];
  const newest = playedAts[playedAts.length - 1];
  const last = getState(env, account.id, "played.last_played_at");

  let gapDetected: { from: string; to: string } | null = null;
  if (last && Date.parse(oldest) > Date.parse(last) + GAP_TOLERANCE_MS && inserted === items.length) {
    insertGap(env, account.id, "played", last, oldest, "buffer fully renewed between two runs");
    gapDetected = { from: last, to: oldest };
  }

  if (!last || Date.parse(newest) > Date.parse(last)) {
    setState(env, account.id, "played.last_played_at", newest);
  }
  setState(env, account.id, "played.last_success_at", nowIso());

  // Now — and only now — the listen events these playback sessions belong to
  // exist. Best effort: an unmatched session simply keeps event_id NULL.
  if (env.PLAYBACK_ENABLED) linkPlaybackSessions(env, account.id);

  return {
    status: "ok",
    fetched: items.length,
    inserted,
    // Surfaced so run-core can alert: a gap is history lost for good, the API
    // will never hand those plays back.
    gap: gapDetected,
  };
}
