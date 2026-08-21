import { getAccessToken } from "../spotify/auth";
import { ArtistRow, artistIdsToEnrich, setState, upsertArtists } from "../db";
import { spotifyGet } from "../spotify/api";
import { Account, CollectorResult, Env, TransientError, nowIso } from "../types";

/**
 * Enrichment collector: fills the `artists` cache so the listening statistics
 * can answer "what KIND of music, and when".
 *
 * Why it has to exist: Spotify attaches genres to the ARTIST object. A play
 * (`/v1/me/player/recently-played`) carries the track, the album and the artist
 * ids — never a genre. So no amount of collected history answers a question
 * about genre; the artist side has to be fetched separately, once per artist.
 *
 * Unlike the other three collectors this one writes NO events. It cannot lose
 * history, and it is not on the critical path: it never pings the watchdog, and
 * a run that fails costs nothing but a stale genre breakdown.
 *
 * `GET /v1/artists` is public catalogue data — it needs a valid token but no
 * user scope, so enabling this never forces a reconnection.
 */

// Spotify's own cap on the ids parameter.
const CHUNK = 50;
/**
 * Per-run budget, in the spirit of the liked backfill: one run must not
 * monopolise the app-wide rate limit that 'played' — the collector that
 * actually guards the history — depends on. 20 × 50 = 1000 artists per run, so
 * a first-time library of a few thousand artists is covered within days, and
 * the steady state (a handful of new artists a day) in a single run.
 */
const MAX_REQUESTS_PER_RUN = 20;

interface SpotifyArtist {
  id?: string;
  name?: string;
  genres?: string[];
  popularity?: number;
  followers?: { total?: number };
}

export async function collectArtists(env: Env, account: Account): Promise<CollectorResult> {
  // One extra id beyond the budget: its presence is how we know a backlog
  // remains, without a second counting query over the whole history.
  const budget = CHUNK * MAX_REQUESTS_PER_RUN;
  const pending = artistIdsToEnrich(env, account.id, budget + 1);
  const more = pending.length > budget;
  const ids = pending.slice(0, budget);

  if (ids.length === 0) {
    setState(env, account.id, "artists.last_success_at", nowIso());
    setState(env, account.id, "artists.backlog", "0");
    return { status: "ok", fetched: 0, inserted: 0, note: "cache up to date" };
  }

  let token = await getAccessToken(env, account);
  let written = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const url = `https://api.spotify.com/v1/artists?ids=${batch.join(",")}`;

    // spotifyGet handles network/5xx (bounded retry), 429 (persisted cooldown +
    // throw) and writes raw_spotify on every attempt (I3).
    let r = await spotifyGet(env, account.id, "artists", url, token);
    if (r.status === 401) {
      token = await getAccessToken(env, account);
      r = await spotifyGet(env, account.id, "artists", url, token);
    }
    if (r.status >= 500) {
      // Partial, not error: what was written stays, the next run continues.
      setState(env, account.id, "artists.backlog", "1");
      return { status: "partial", fetched: i, inserted: written, note: `spotify ${r.status}` };
    }
    if (r.status < 200 || r.status >= 300) {
      throw new TransientError(`unexpected ${r.status}: ${r.bodyText.slice(0, 200)}`);
    }

    const returned = (JSON.parse(r.bodyText).artists ?? []) as (SpotifyArtist | null)[];
    const byId = new Map<string, SpotifyArtist>();
    for (const a of returned) if (a?.id) byId.set(a.id, a);

    // Every id asked for gets a row, including the ones Spotify answered `null`
    // for (a deleted or region-locked artist). Without that placeholder the id
    // stays "not fetched yet" forever and every future run re-requests it —
    // a backlog that can never drain. `name` NULL is what marks the case.
    const rows: ArtistRow[] = batch.map((id) => {
      const a = byId.get(id);
      return {
        id,
        name: a?.name ?? null,
        genres: a?.genres ?? [],
        popularity: a?.popularity ?? null,
        followers: a?.followers?.total ?? null,
      };
    });
    written += upsertArtists(env, rows);
  }

  setState(env, account.id, "artists.last_success_at", nowIso());
  setState(env, account.id, "artists.backlog", more ? "1" : "0");

  return {
    status: more ? "partial" : "ok",
    fetched: ids.length,
    inserted: written,
    note: more ? "more artists pending, continues next run" : undefined,
  };
}
