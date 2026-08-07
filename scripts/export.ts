#!/usr/bin/env node
/**
 * Streams the active account's events as NDJSON to stdout.
 *
 * Usage:
 *   node_modules/.bin/tsx scripts/export.ts [--account <id>] [--type listen] [--from ISO] [--to ISO] > events.ndjson
 */
import "dotenv/config";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { getActiveAccountId, EventFilter } from "../lib/server/db";
import { iterateEventsNdjson } from "../lib/server/export";
import { loadEnvFromProcess } from "../lib/server/types";

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
  db.pragma("journal_mode = WAL");
  const env = loadEnvFromProcess(db);

  const accountId = args.account ?? getActiveAccountId(env);
  if (accountId === null) {
    console.error("no active account — connect one through the UI first, or pass --account <id>");
    process.exit(2);
  }

  const filter: EventFilter = {
    type: args.type || undefined,
    q: args.q || undefined,
    from: args.from || undefined,
    to: args.to || undefined,
    order: args.order === "desc" ? "desc" : "asc", // chronological by default: an archive reads forwards
  };

  // Readable.from handles backpressure — a plain write loop would not.
  await new Promise<void>((resolve, reject) => {
    Readable.from(iterateEventsNdjson(env, accountId, filter))
      .on("error", reject)
      .pipe(process.stdout)
      .on("error", reject)
      .on("finish", resolve);
  });
  db.close();
}

main().catch((e) => {
  console.error("export failed:", e);
  process.exit(1);
});
