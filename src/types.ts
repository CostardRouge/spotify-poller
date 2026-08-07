import Database from "better-sqlite3";

export interface Env {
  DB: Database.Database;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  /**
   * Fallback when no account has been connected through the UI (/auth/login).
   * The token obtained through the UI is stored in poller_state and takes
   * precedence over the env variable.
   */
  SPOTIFY_REFRESH_TOKEN?: string;
  /** Must match EXACTLY a Redirect URI declared in the Spotify app. */
  SPOTIFY_REDIRECT_URI?: string;
  WATCHDOG_URL?: string; // mandatory in real use — see §9, even more so when self-hosted
  ADMIN_TOKEN: string;
}

export type RunStatus = "ok" | "partial" | "error";

export interface CollectorResult {
  status: RunStatus;
  fetched: number;
  inserted: number;
  note?: string;
}

/** Refresh token failure: the only case where collection is dead for good (§8). */
export class AuthError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "AuthError";
  }
}

/** Transient error (429, 5xx, network): the next run catches up. */
export class TransientError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "TransientError";
  }
}

/**
 * Spotify 429: transient, but carries the cooldown announced by Retry-After.
 * Any request during an active ban counts against the app and may extend it —
 * the cooldown is persisted in poller_state so that subsequent runs (timer or
 * manual) abstain while it lasts.
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
 * Loads the required variables from process.env (populated by dotenv).
 * Fails early and clearly if a secret is missing — better than silently
 * degraded behaviour on the first network call.
 */
export function loadEnvFromProcess(db: Database.Database): Env {
  const need = (k: string): string => {
    const v = process.env[k];
    if (!v) throw new Error(`missing environment variable: ${k}`);
    return v;
  };
  return {
    DB: db,
    SPOTIFY_CLIENT_ID: need("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: need("SPOTIFY_CLIENT_SECRET"),
    // Optional since the connection UI exists: the token may come from poller_state.
    SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
    SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
    WATCHDOG_URL: process.env.WATCHDOG_URL,
    ADMIN_TOKEN: need("ADMIN_TOKEN"),
  };
}
