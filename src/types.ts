import Database from "better-sqlite3";

export interface Env {
  DB: Database.Database;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  /**
   * Fallback si aucun compte n'a été connecté via l'UI (/auth/login).
   * Le token obtenu via l'UI est stocké dans poller_state et prime sur l'env.
   */
  SPOTIFY_REFRESH_TOKEN?: string;
  /** Doit correspondre EXACTEMENT à un Redirect URI déclaré dans l'app Spotify. */
  SPOTIFY_REDIRECT_URI?: string;
  WATCHDOG_URL?: string; // obligatoire en usage réel — voir §9, encore plus vrai en self-host
  ADMIN_TOKEN: string;
}

export type RunStatus = "ok" | "partial" | "error";

export interface CollectorResult {
  status: RunStatus;
  fetched: number;
  inserted: number;
  note?: string;
}

/** Échec du refresh token : le seul cas où la collecte est morte pour de bon (§8). */
export class AuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AuthError";
  }
}

/** Erreur transitoire (429, 5xx, réseau) : la prochaine exécution rattrape. */
export class TransientError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TransientError";
  }
}

/**
 * 429 Spotify : transitoire, mais porte le cooldown annoncé par Retry-After.
 * Toute requête pendant un ban actif compte contre l'app et peut le prolonger —
 * le cooldown est persisté dans poller_state pour que les exécutions suivantes
 * (timer ou manuelles) s'abstiennent tant qu'il court.
 */
export class RateLimitError extends TransientError {
  readonly retryAfterS: number;
  constructor(msg: string, retryAfterS: number) {
    super(msg);
    this.name = "RateLimitError";
    this.retryAfterS = retryAfterS;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Charge les variables requises depuis process.env (rempli par dotenv).
 * Échoue tôt et clairement si un secret manque — préférable à un
 * comportement dégradé silencieux au premier appel réseau.
 */
export function loadEnvFromProcess(db: Database.Database): Env {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`variable d'environnement manquante: ${k}`);
    return v;
  };
  return {
    DB: db,
    SPOTIFY_CLIENT_ID: need("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: need("SPOTIFY_CLIENT_SECRET"),
    // Optionnel depuis l'UI de connexion : le token peut venir de poller_state.
    SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
    SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
    WATCHDOG_URL: process.env.WATCHDOG_URL,
    ADMIN_TOKEN: need("ADMIN_TOKEN"),
  };
}
