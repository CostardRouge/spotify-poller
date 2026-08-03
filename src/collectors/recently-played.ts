import { getAccessToken } from "../auth";
import { EventRow, getState, insertEvents, insertGap, insertRaw, setState } from "../db";
import { CollectorResult, Env, TransientError, nowIso } from "../types";

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
 * Spec §5 — décision délibérée : PAS de paramètre `after`.
 * On refetch les 50 derniers à chaque passage ; INSERT OR IGNORE trie.
 * `A.last_played_at` ne sert qu'à la détection de trous, jamais à la requête.
 */
export async function collectRecentlyPlayed(env: Env): Promise<CollectorResult> {
  const token = await getAccessToken(env);

  let res: Response;
  try {
    res = await fetch(URL_RP, { headers: { Authorization: `Bearer ${token}` } });
  } catch (e) {
    insertRaw(env, "recently_played", 0, URL_RP, null);
    throw new TransientError(`network: ${String(e)}`);
  }

  if (res.status === 401) {
    const retryToken = await getAccessToken(env);
    res = await fetch(URL_RP, { headers: { Authorization: `Bearer ${retryToken}` } });
  }

  const bodyText = await res.text();
  insertRaw(env, "recently_played", res.status, URL_RP, bodyText);

  if (res.status === 429) {
    const retryAfter = res.headers.get("Retry-After") ?? "?";
    return { status: "partial", fetched: 0, inserted: 0, note: `429, Retry-After=${retryAfter}s` };
  }
  if (res.status >= 500) {
    return { status: "partial", fetched: 0, inserted: 0, note: `spotify ${res.status}` };
  }
  if (!res.ok) {
    throw new TransientError(`unexpected ${res.status}: ${bodyText.slice(0, 200)}`);
  }

  const items: RpItem[] = (JSON.parse(bodyText).items ?? []) as RpItem[];
  if (items.length === 0) {
    setState(env, "A.last_success_at", nowIso());
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

  const inserted = insertEvents(env, rows);

  const playedAts = items.map((i) => i.played_at).sort();
  const oldest = playedAts[0];
  const newest = playedAts[playedAts.length - 1];
  const last = getState(env, "A.last_played_at");

  if (last && Date.parse(oldest) > Date.parse(last) + GAP_TOLERANCE_MS && inserted === items.length) {
    insertGap(env, "A", last, oldest, "buffer entièrement renouvelé entre deux passages");
  }

  if (!last || Date.parse(newest) > Date.parse(last)) {
    setState(env, "A.last_played_at", newest);
  }
  setState(env, "A.last_success_at", nowIso());

  return { status: "ok", fetched: items.length, inserted };
}
