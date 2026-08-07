#!/usr/bin/env node
/**
 * Restores events from an NDJSON export produced by export.ts.
 *
 * Idempotent (INSERT OR IGNORE): re-importing the same file inserts nothing,
 * importing into a partially-filled database only tops it up. This is what
 * makes the export an actual safety net rather than a write-only archive.
 *
 * Usage:
 *   node dist/import.js < events.ndjson
 *   node dist/import.js --account <spotify-user-id> < events.ndjson
 *
 * Without --account each row returns to the account it was exported from.
 * Note that only `events` is restored: raw_spotify, poller_runs and gaps live
 * in the full .db backup (backup.ts), not in the NDJSON export.
 */
import "dotenv/config";
import { importEvents, ndjsonLines, openDb } from "./export";
import { loadEnvFromProcess } from "./types";

async function main(): Promise<void> {
  const idx = process.argv.indexOf("--account");
  const forceAccountId = idx === -1 ? undefined : process.argv[idx + 1];
  if (idx !== -1 && !forceAccountId) {
    console.error("--account requires a Spotify user id");
    process.exit(2);
  }

  const db = openDb();
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
