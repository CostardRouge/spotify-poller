#!/usr/bin/env node
/**
 * Restores events from an NDJSON export produced by scripts/export.ts.
 *
 * Idempotent (INSERT OR IGNORE): re-importing the same file inserts nothing,
 * importing into a partially-filled database only tops it up.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/import.ts < events.ndjson
 *   node_modules/.bin/tsx scripts/import.ts --account <spotify-user-id> < events.ndjson
 *
 * Without --account each row returns to the account it was exported from.
 * Note that only `events` is restored: raw_spotify, poller_runs and gaps live
 * in the full .db backup (scripts/backup.ts), not in the NDJSON export.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { importEvents, ndjsonLines } from "../lib/server/export";
import { loadEnvFromProcess } from "../lib/server/types";

async function main(): Promise<void> {
  const idx = process.argv.indexOf("--account");
  const forceAccountId = idx === -1 ? undefined : process.argv[idx + 1];
  if (idx !== -1 && !forceAccountId) {
    console.error("--account requires a Spotify user id");
    process.exit(2);
  }

  const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
  db.pragma("journal_mode = WAL");
  const env = loadEnvFromProcess(db);
  const result = await importEvents(env, ndjsonLines(process.stdin), forceAccountId);

  console.log(
    `imported: ${result.inserted} inserted, ${result.skipped} already present (${result.read} lines read)`
  );
  db.close();
}

main().catch((e) => {
  console.error("import failed:", e);
  process.exit(1);
});
