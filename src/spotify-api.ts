import { getGlobalState, insertRaw, setGlobalState } from "./db";
import { Env, RateLimitError, TransientError } from "./types";

/**
 * HTTP access to the Spotify API, following the conventions of the Spotify
 * Calendar project (lib/spotify.ts + lib/rateLimit.ts):
 *
 *  - BOUNDED back-off on network errors and 5xx: every call terminates in
 *    finite time, never an infinite retry;
 *  - 429: we NEVER retry within the same run (spec §10 — the next scheduled
 *    run is the recovery mechanism), and the cooldown announced by
 *    Retry-After is PERSISTED in poller_state. Querying during an active ban
 *    counts against the app and may extend the ban — subsequent runs check
 *    that cooldown before any call.
 *
 * Deliberate difference from the calendar: here the cooldown survives
 * restarts (poller_state, not process memory), because the poller is driven by
 * short repeated runs rather than a long-lived web server.
 *
 * The cooldown is stored in the GLOBAL scope, not per account: Spotify computes
 * its rate limit per app (client_id), so switching account must not be a way to
 * keep querying during a ban — that would only extend it.
 */

const MAX_RETRIES = 3; // network / 5xx — bounded
const RL_KEY = "ratelimit.limited_until"; // ISO8601 UTC

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Records a 429. Never shortens a cooldown already in progress. */
export function noteRateLimit(env: Env, retryAfterS: number): void {
  const until = Date.now() + Math.max(0, retryAfterS) * 1000;
  const current = getGlobalState(env, RL_KEY);
  if (!current || Date.parse(current) < until) {
    setGlobalState(env, RL_KEY, new Date(until).toISOString());
  }
}

/** Ongoing 429 cooldown, read from poller_state (survives restarts). */
export function getRateLimit(env: Env): { limited: boolean; until: string | null; retryAfterS: number } {
  const until = getGlobalState(env, RL_KEY);
  if (!until || Date.parse(until) <= Date.now()) {
    return { limited: false, until: null, retryAfterS: 0 };
  }
  return {
    limited: true,
    until,
    retryAfterS: Math.ceil((Date.parse(until) - Date.now()) / 1000),
  };
}

export interface SpotifyResponse {
  status: number;
  bodyText: string;
}

/**
 * Authenticated GET against the Spotify API. Every attempt — including failed
 * ones — writes its raw_spotify row BEFORE any parsing (invariant I3).
 * Throws RateLimitError on 429 (after persisting the cooldown) and
 * TransientError once the network/5xx retries are exhausted.
 * Other statuses (including 401) are returned to the caller.
 */
export async function spotifyGet(
  env: Env,
  accountId: string,
  collector: string,
  url: string,
  token: string,
  opts: { logRaw?: boolean } = {}
): Promise<SpotifyResponse> {
  // The playback collector polls every ~15 s; a raw row per response would be
  // thousands of JSON blobs a day for what is an opt-in bonus. It opts out here
  // and writes its own raw row on state CHANGES and on errors — see
  // collectors/playback.ts. Every other caller keeps the unconditional I3 write.
  const logRaw = opts.logRaw !== false;

  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      // A network failure is rare and worth keeping whatever the policy.
      insertRaw(env, accountId, collector, 0, url, null);
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new TransientError(`network: ${String(e)} (after ${attempt + 1} attempts)`);
    }

    const bodyText = await res.text();
    if (logRaw) insertRaw(env, accountId, collector, res.status, url, bodyText);

    if (res.status === 429) {
      const retryAfterS = Number(res.headers.get("Retry-After")) || 60;
      // A 429 is never dropped, even when the caller opted out of raw logging.
      if (!logRaw) insertRaw(env, accountId, collector, res.status, url, bodyText);
      noteRateLimit(env, retryAfterS);
      throw new RateLimitError(`429, Retry-After=${retryAfterS}s`, retryAfterS);
    }

    if (res.status >= 500 && attempt < MAX_RETRIES) {
      await sleep(500 * 2 ** attempt);
      continue;
    }

    return { status: res.status, bodyText };
  }
}
