#!/usr/bin/env node
/**
 * Event export/import in NDJSON (one JSON object per line).
 *
 * Why NDJSON rather than the .db file: this format contains NO secret (the
 * Spotify refresh token lives in `accounts`, which is never exported), so it
 * can travel over HTTP, land in a cloud folder or feed a website without
 * turning into a credential leak. The full binary dump stays a local-only
 * artefact — see backup.ts.
 *
 * Streamed via a generator: an export must not build months of history into a
 * single string in memory.
 *
 * CLI:
 *   node dist/export.js [--account <id>] [--type listen] [--from ISO] [--to ISO] > events.ndjson
 */
import "dotenv/config";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import {
  EVENT_COLUMNS,
  buildEventWhere,
  getActiveAccountId,
  EventFilter,
} from "./db";
import { Env, loadEnvFromProcess, nowIso } from "./types";

const BATCH = 500;

export interface ExportedEvent {
  account_id: string;
  id: string;
  ts_utc: string;
  ts_local: string | null;
  tz: string | null;
  type: string;
  source: string;
  duration_s: number | null;
  lat: number | null;
  lon: number | null;
  title: string | null;
  subtitle: string | null;
  payload: string;
  ingested_at: string;
}

/** Lazily yields one NDJSON line per event, oldest first by default. */
export function* iterateEventsNdjson(env: Env, accountId: string, f: EventFilter): Generator<string> {
  const { sql, params, order } = buildEventWhere(accountId, f);
  const stmt = env.DB.prepare(`SELECT ${EVENT_COLUMNS} FROM events ${sql} ORDER BY ts_utc ${order}`);
  for (const row of stmt.iterate(...params) as Iterable<ExportedEvent>) {
    yield JSON.stringify(row) + "\n";
  }
}

export function countEvents(env: Env, accountId: string, f: EventFilter): number {
  const { sql, params } = buildEventWhere(accountId, f);
  return (env.DB.prepare(`SELECT COUNT(*) AS n FROM events ${sql}`).get(...params) as { n: number }).n;
}

/**
 * Restores events from an NDJSON stream. Unlike the collector path
 * (insertEvents), this preserves every column — a restore that silently
 * dropped ts_local or the coordinates would not be a restore.
 *
 * INSERT OR IGNORE, so importing the same file twice is a no-op and importing
 * into a partially-filled database only tops it up.
 *
 * By default each row goes back to the account it was exported from;
 * `forceAccountId` overrides that when grafting history onto another account.
 */
export async function importEvents(
  env: Env,
  lines: AsyncIterable<string>,
  forceAccountId?: string
): Promise<{ read: number; inserted: number; skipped: number }> {
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO events
       (account_id, id, ts_utc, ts_local, tz, type, source, duration_s, lat, lon,
        title, subtitle, payload, ingested_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const flush = env.DB.transaction((rows: ExportedEvent[]) => {
    let n = 0;
    for (const r of rows) {
      n += stmt.run(
        forceAccountId ?? r.account_id ?? "",
        r.id,
        r.ts_utc,
        r.ts_local ?? null,
        r.tz ?? null,
        r.type,
        r.source,
        r.duration_s ?? null,
        r.lat ?? null,
        r.lon ?? null,
        r.title ?? null,
        r.subtitle ?? null,
        r.payload,
        r.ingested_at ?? nowIso()
      ).changes;
    }
    return n;
  });

  let read = 0;
  let inserted = 0;
  let batch: ExportedEvent[] = [];

  for await (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    read++;
    batch.push(JSON.parse(trimmed) as ExportedEvent);
    if (batch.length >= BATCH) {
      inserted += flush(batch);
      batch = [];
    }
  }
  if (batch.length) inserted += flush(batch);

  return { read, inserted, skipped: read - inserted };
}

/** Reads NDJSON from a readable stream, line by line. */
export function ndjsonLines(input: NodeJS.ReadableStream): AsyncIterable<string> {
  return createInterface({ input, crlfDelay: Infinity });
}

// ---------- CLI ----------

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1] ?? "";
  }
  return out;
}

export function openDb(): Database.Database {
  const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
  db.pragma("journal_mode = WAL");
  return db;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const db = openDb();
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

if (require.main === module) {
  main().catch((e) => {
    console.error("export failed:", e);
    process.exit(1);
  });
}
