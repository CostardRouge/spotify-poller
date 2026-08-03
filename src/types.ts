import Database from "better-sqlite3";

export interface Env {
  DB: Database.Database;
  SPOTIFY_CLIENT_ID: string;
  SPOTIFY_CLIENT_SECRET: string;
  SPOTIFY_REFRESH_TOKEN: string;
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
    SPOTIFY_REFRESH_TOKEN: need("SPOTIFY_REFRESH_TOKEN"),
    WATCHDOG_URL: process.env.WATCHDOG_URL,
    ADMIN_TOKEN: need("ADMIN_TOKEN"),
  };
}
