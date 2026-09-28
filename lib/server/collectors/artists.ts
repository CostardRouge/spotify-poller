import { getAccessToken } from "../spotify/auth";
import { artistIdsToEnrich, setState, upsertArtists } from "../db";
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
 * `GET /v1/artists/{id}` is public catalogue data — it needs a valid token but
 * no user scope, so enabling this never forces a reconnection.
 *
 * ONE REQUEST PER ARTIST, and that is not a choice: the bulk "Get Several
 * Artists" endpoint (`GET /v1/artists?ids=`, 50 ids a call) was removed for
 * Development Mode apps in Spotify's February 2026 Web API change (existing apps
 * migrated on 2026-03-09). From then on every run of the old code failed on its
 * first request and wrote nothing. The single-artist endpoint survives and
 * still carries `genres`; `popularity` and `followers` were stripped by the same
 * change, so those columns now stay NULL for anything fetched after it.
 */

/**
 * Per-run budget, in the spirit of the liked backfill: one run must not
 * monopolise the app-wide rate limit that 'played' — the collector that
 * actually guards the history — depends on. 100 lookups paced at PACE_MS take
 * about a minute; the scheduler reruns hourly while a backlog remains, so a
 * first-time library of a few thousand artists drains in a day or two and the
 * steady state (a handful of new artists a day) fits in a single run.
 */
const MAX_REQUESTS_PER_RUN = 100;
/**
 * Pause between two lookups: ~75 requests per 30 s rolling window at most.
 * Spotify does not publish the Development Mode limit; this is a conservative
 * guess, and a 429 still ends the run with its cooldown persisted (api.ts).
 */
const PACE_MS = 400;

interface SpotifyArtist {
  id?: string;
  name?: string;
  genres?: string[];
  popularity?: number;
  followers?: { total?: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function collectArtists(env: Env, account: Account): Promise<CollectorResult> {
  // One extra id beyond the budget: its presence is how we know a backlog
  // remains, without a second counting query over the whole history.
  const budget = MAX_REQUESTS_PER_RUN;
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

  for (let i = 0; i < ids.length; i++) {
    if (i > 0) await sleep(PACE_MS);
    const id = ids[i];
    const url = `https://api.spotify.com/v1/artists/${encodeURIComponent(id)}`;

    // spotifyGet handles network/5xx (bounded retry), 429 (persisted cooldown +
    // throw) and writes raw_spotify on every attempt (I3). Each artist is
    // written as soon as it is answered, so a 429 halfway through keeps what
    // the run already paid for.
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

    let a: SpotifyArtist | null = null;
    if (r.status === 404 || r.status === 400) {
      // A deleted or malformed id. It still gets a row (name NULL marks the
      // case): without that placeholder the id stays "not fetched yet" forever
      // and every future run re-requests it — a backlog that can never drain.
      a = null;
    } else if (r.status < 200 || r.status >= 300) {
      // 403 included: the endpoint refused outright, and every remaining
      // artist would get the same answer — stop instead of burning the window.
      throw new TransientError(`unexpected ${r.status}: ${r.bodyText.slice(0, 200)}`);
    } else {
      a = JSON.parse(r.bodyText) as SpotifyArtist;
    }

    written += upsertArtists(env, [
      {
        id,
        name: a?.name ?? null,
        genres: Array.isArray(a?.genres) ? a.genres : [],
        popularity: a?.popularity ?? null,
        followers: a?.followers?.total ?? null,
      },
    ]);
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
