import Database from "better-sqlite3";

/**
 * Reserved account scope for rows that belong to the application rather than
 * to a Spotify account.
 *
 * Two distinct uses:
 *  - poller_state: the 429 cooldown lives here. Spotify computes its rate
 *    limit per app (client_id), not per user — scoping it per account would
 *    let a account switch ignore a ban in progress and extend it.
 *  - the other tables: rows collected before the multi-account migration, and
 *    runs that failed before any account could be resolved.
 */
export const GLOBAL_SCOPE = "";

export type AuthMode = "token" | "proxy";

export interface Env {
  DB: Database.Database;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  /**
   * Fallback when no account has ever been connected through the UI
   * (/auth/login). On first use it is resolved against /v1/me and adopted into
   * the accounts table, so it only ever bootstraps a single account.
   */
  SPOTIFY_REFRESH_TOKEN?: string;
  /** Must match EXACTLY a Redirect URI declared in the Spotify app. */
  SPOTIFY_REDIRECT_URI?: string;
  /**
   * Heartbeat URL pinged on every successful 'played' run — healthchecks.io, or an
   * Uptime Kuma "Push" monitor for a fully self-hosted setup. This is the ONLY
   * thing that detects silence: ntfy cannot alert about a host that is off,
   * because a dead poller sends nothing.
   */
  WATCHDOG_URL?: string;
  /** Empty string is legal in proxy mode — see AUTH_MODE. */
  ADMIN_TOKEN: string;
  /**
   * 'token' (default): every admin route requires ADMIN_TOKEN.
   * 'proxy': the reverse proxy (Cloudflare Access, Traefik…) is the
   * authenticator. Pair it with PROXY_AUTH_HEADER so a request reaching the
   * origin directly — bypassing the proxy — is still rejected.
   */
  AUTH_MODE: AuthMode;
  /** e.g. 'Cf-Access-Authenticated-User-Email'. Must be present and non-empty. */
  PROXY_AUTH_HEADER?: string;
  /** Full ntfy topic URL, e.g. https://ntfy.example.org/spotify-poller */
  NTFY_URL?: string;
  /** Optional ntfy access token (Bearer) for a protected topic. */
  NTFY_TOKEN?: string;
  /** Hours between two identical notifications — anti-spam, see notify.ts. */
  NTFY_THROTTLE_HOURS: number;
  BACKUP_DIR: string;
  BACKUP_KEEP: number;
  /** Daily backup driven by the in-container scheduler. */
  BACKUP_ENABLED: boolean;
  /**
   * IANA name (e.g. "Europe/Paris") the debug UI converts ts_utc to for
   * display. Display-only: every timestamp is still stored and queried in
   * UTC (ts_utc), nothing here touches the DB. Defaults to "UTC".
   */
  TIMEZONE: string;
  /**
   * Opt-in playback collector (GET /me/player). OFF by default: it is a bonus
   * on top of 'played', it needs an extra scope, and it only works under the
   * in-process scheduler. Carried on Env rather than read from process.env
   * because it decides which scopes a connected account is REQUIRED to hold.
   */
  PLAYBACK_ENABLED: boolean;
}

/** A connected Spotify account. `id` is the Spotify user id — stable, never reused. */
export interface Account {
  id: string;
  display_name: string | null;
  refresh_token: string;
  scope: string | null;
  connected_at: string;
  last_seen_at: string | null;
  status: "ok" | "revoked";
}

/** Account view safe to serve over HTTP — no refresh token. */
export type PublicAccount = Omit<Account, "refresh_token">;

export type RunStatus = "ok" | "partial" | "error";

/**
 * Collector identifiers. Explicit code names rather than 'A'/'B': they show up
 * in the URL (`POST /run?collector=played`), in the CLI, in the UI buttons and
 * in every DB row — one vocabulary end to end, nothing to memorise.
 *  - 'played'   → recently-played (every 30 min, the critical one)
 *  - 'liked'    → liked tracks (daily, plus the initial backfill)
 *  - 'playback' → current playback state (opt-in, PLAYBACK_ENABLED=1)
 */
export type CollectorId = "played" | "liked" | "playback";

export const COLLECTOR_IDS: readonly CollectorId[] = ["played", "liked", "playback"];

/** Legacy ids, still accepted so a systemd unit installed before the rename keeps working. */
const COLLECTOR_ALIASES: Record<string, CollectorId> = {
  a: "played",
  b: "liked",
  recently_played: "played",
  liked_tracks: "liked",
};

/** Returns the canonical id, or null if the input names no known collector. */
export function parseCollectorId(raw: string | null | undefined): CollectorId | null {
  if (!raw) return null;
  const k = raw.trim().toLowerCase();
  if ((COLLECTOR_IDS as readonly string[]).includes(k)) return k as CollectorId;
  return COLLECTOR_ALIASES[k] ?? null;
}

export interface CollectorResult {
  status: RunStatus;
  fetched: number;
  inserted: number;
  note?: string;
  /** Set when this run detected a hole in the history — worth notifying about. */
  gap?: { from: string; to: string } | null;
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

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`invalid ${key}: ${raw}`);
  return Math.floor(n);
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
  const rawMode = process.env.AUTH_MODE ?? "token";
  if (rawMode !== "token" && rawMode !== "proxy") {
    throw new Error(`invalid AUTH_MODE: ${rawMode} (expected 'token' or 'proxy')`);
  }

  const timezone = process.env.TIMEZONE ?? "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
  } catch {
    throw new Error(`invalid TIMEZONE: "${timezone}" is not a known IANA timezone name`);
  }

  return {
    DB: db,
    SPOTIFY_CLIENT_ID: need("SPOTIFY_CLIENT_ID"),
    SPOTIFY_CLIENT_SECRET: need("SPOTIFY_CLIENT_SECRET"),
    // Optional since the connection UI exists: the token may come from the
    // accounts table.
    SPOTIFY_REFRESH_TOKEN: process.env.SPOTIFY_REFRESH_TOKEN,
    SPOTIFY_REDIRECT_URI: process.env.SPOTIFY_REDIRECT_URI,
    WATCHDOG_URL: process.env.WATCHDOG_URL,
    // In proxy mode the token becomes optional: the proxy authenticates. It is
    // still honoured when set, which keeps curl working locally.
    ADMIN_TOKEN: rawMode === "proxy" ? (process.env.ADMIN_TOKEN ?? "") : need("ADMIN_TOKEN"),
    AUTH_MODE: rawMode,
    PROXY_AUTH_HEADER: process.env.PROXY_AUTH_HEADER,
    NTFY_URL: process.env.NTFY_URL,
    NTFY_TOKEN: process.env.NTFY_TOKEN,
    NTFY_THROTTLE_HOURS: intFromEnv("NTFY_THROTTLE_HOURS", 6),
    BACKUP_DIR: process.env.BACKUP_DIR ?? "/backups",
    BACKUP_KEEP: intFromEnv("BACKUP_KEEP", 14),
    BACKUP_ENABLED: process.env.BACKUP_ENABLED === "1",
    TIMEZONE: timezone,
    PLAYBACK_ENABLED: process.env.PLAYBACK_ENABLED === "1",
  };
}
