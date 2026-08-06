import { getState, insertRaw, setState } from "./db";
import { Env, RateLimitError, TransientError } from "./types";

/**
 * Accès HTTP à l'API Spotify, conventions reprises du projet Spotify Calendar
 * (lib/spotify.ts + lib/rateLimit.ts) :
 *
 *  - back-off BORNÉ sur erreurs réseau et 5xx : chaque appel se termine en
 *    temps fini, jamais de retry infini ;
 *  - 429 : on ne réessaie JAMAIS dans la même exécution (spec §10 — le
 *    prochain passage planifié est le mécanisme de reprise), et le cooldown
 *    annoncé par Retry-After est PERSISTÉ dans poller_state. Requêter pendant
 *    un ban actif compte contre l'app et peut prolonger le ban — les
 *    exécutions suivantes vérifient ce cooldown avant tout appel.
 *
 * Différence assumée avec le calendar : ici le cooldown survit aux
 * redémarrages (poller_state, pas la mémoire du process), parce que le poller
 * est piloté par des passages courts et répétés, pas par un serveur web
 * longue durée.
 */

const MAX_RETRIES = 3; // réseau / 5xx — borné
const RL_KEY = "ratelimit.limited_until"; // ISO8601 UTC

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Enregistre un 429. Ne raccourcit jamais un cooldown déjà en cours. */
export function noteRateLimit(env: Env, retryAfterS: number): void {
  const until = Date.now() + Math.max(0, retryAfterS) * 1000;
  const current = getState(env, RL_KEY);
  if (!current || Date.parse(current) < until) {
    setState(env, RL_KEY, new Date(until).toISOString());
  }
}

/** Cooldown 429 en cours, lu depuis poller_state (survit aux redémarrages). */
export function getRateLimit(env: Env): { limited: boolean; until: string | null; retryAfterS: number } {
  const until = getState(env, RL_KEY);
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
 * GET authentifié contre l'API Spotify. Chaque tentative — y compris ratée —
 * écrit sa ligne raw_spotify AVANT tout parsing (invariant I3).
 * Lève RateLimitError sur 429 (après avoir persisté le cooldown) et
 * TransientError après épuisement des retries réseau/5xx.
 * Les autres statuts (dont 401) sont rendus à l'appelant.
 */
export async function spotifyGet(env: Env, collector: string, url: string, token: string): Promise<SpotifyResponse> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (e) {
      insertRaw(env, collector, 0, url, null);
      if (attempt < MAX_RETRIES) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      throw new TransientError(`network: ${String(e)} (après ${attempt + 1} tentatives)`);
    }

    const bodyText = await res.text();
    insertRaw(env, collector, res.status, url, bodyText);

    if (res.status === 429) {
      const retryAfterS = Number(res.headers.get("Retry-After")) || 60;
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
