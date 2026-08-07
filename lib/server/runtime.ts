/**
 * Singleton SQLite connection + Env, shared by every route handler, server
 * component and CLI script that runs inside the Next.js process.
 *
 * Cached on `globalThis` rather than a plain module-level variable: Next's dev
 * server hot-reloads route modules on every edit, which would otherwise
 * reopen the database (and its WAL lock) on every request during `next dev`.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { Env, loadEnvFromProcess } from "./types";

declare global {
  var __spotifyPollerEnv: Env | undefined;
}

export function getEnv(): Env {
  if (!globalThis.__spotifyPollerEnv) {
    const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    globalThis.__spotifyPollerEnv = loadEnvFromProcess(db);
  }
  return globalThis.__spotifyPollerEnv;
}
