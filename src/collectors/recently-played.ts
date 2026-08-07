import { getAccessToken } from "../auth";
import { EventRow, getState, insertEvents, insertGap, setState } from "../db";
import { spotifyGet } from "../spotify-api";
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

  // spotifyGet gère réseau/5xx (retry borné), 429 (cooldown persisté + throw)
  // et écrit raw_spotify à chaque tentative (I3).
  let r = await spotifyGet(env, "recently_played", URL_RP, token);

  if (r.status === 401) {
    // 401 isolé : un seul rafraîchissement de token puis nouvel essai (§10).
    const retryToken = await getAccessToken(env);
    r = await spotifyGet(env, "recently_played", URL_RP, retryToken);
  }

  if (r.status >= 500) {
    return { status: "partial", fetched: 0, inserted: 0, note: `spotify ${r.status}` };
  }
  if (r.status < 200 || r.status >= 300) {
    throw new TransientError(`unexpected ${r.status}: ${r.bodyText.slice(0, 200)}`);
  }

  const items: RpItem[] = (JSON.parse(r.bodyText).items ?? []) as RpItem[];
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
