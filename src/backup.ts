/**
 * Consistent SQLite backup, usable while the service is running.
 *
 * better-sqlite3's `.backup()` uses SQLite's online backup API: it copies a
 * coherent snapshot even in WAL mode, without stopping the poller and without
 * the torn-file risk of a plain `cp`.
 *
 * The destination MUST live outside the data volume — a backup sitting next to
 * the database it protects is not a backup. docker-compose.prod.yml bind-mounts
 * ./backups from the host onto BACKUP_DIR for exactly that reason.
 *
 * WARNING: the resulting .db file contains the Spotify refresh token in clear
 * text (accounts.refresh_token). Treat it like .env — never serve it over HTTP,
 * never commit it. For a secret-free dump, use the NDJSON export (export.ts).
 */
import "dotenv/config";
import { mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Env, loadEnvFromProcess } from "./types";

const PREFIX = "life-events-";
const SUFFIX = ".db";

export interface BackupResult {
  file: string;
  bytes: number;
  ms: number;
  pruned: string[];
}

/** `2026-08-07T14:39:02.123Z` -> `2026-08-07-1439` (filename-safe, sortable). */
function stamp(date: Date): string {
  const iso = date.toISOString();
  return `${iso.slice(0, 10)}-${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/**
 * Deletes the oldest backups beyond `keep`. Lexicographic order on the
 * timestamped name is chronological order, so no stat() needed to sort.
 */
function prune(dir: string, keep: number): string[] {
  if (keep <= 0) return [];
  const files = readdirSync(dir)
    .filter((f) => f.startsWith(PREFIX) && f.endsWith(SUFFIX))
    .sort();
  const doomed = files.slice(0, Math.max(0, files.length - keep));
  for (const f of doomed) unlinkSync(join(dir, f));
  return doomed;
}

/**
 * Writes a snapshot into `dir` (default env.BACKUP_DIR) and rotates older
 * ones. Throws on failure — the caller decides whether that warrants an alert.
 */
export async function runBackup(env: Env, dir = env.BACKUP_DIR): Promise<BackupResult> {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${PREFIX}${stamp(new Date())}${SUFFIX}`);
  const started = Date.now();

  await env.DB.backup(file);

  const ms = Date.now() - started;
  const bytes = statSync(file).size;
  // Rotation only after a successful write: a failed backup must never be the
  // reason an older, valid one disappears.
  const pruned = prune(dir, env.BACKUP_KEEP);
  return { file, bytes, ms, pruned };
}

// ---------- CLI: node dist/backup.js [dir] ----------

if (require.main === module) {
  const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
  db.pragma("journal_mode = WAL");
  const env = loadEnvFromProcess(db);

  runBackup(env, process.argv[2] || env.BACKUP_DIR)
    .then((r) => {
      const mb = (r.bytes / 1024 / 1024).toFixed(1);
      console.log(`backup written: ${r.file} (${mb} MB in ${r.ms} ms)`);
      if (r.pruned.length) console.log(`rotated out: ${r.pruned.join(", ")}`);
      console.log("REMINDER: this file contains the Spotify refresh token — treat it like .env.");
      db.close();
    })
    .catch((e) => {
      console.error("backup failed:", e);
      db.close();
      process.exit(1);
    });
}
