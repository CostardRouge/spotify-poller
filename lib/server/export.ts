/**
 * Event export/import in NDJSON (one JSON object per line).
 *
 * Why NDJSON rather than the .db file: this format contains NO secret (the
 * Spotify refresh token lives in `accounts`, which is never exported), so it
 * can travel over HTTP, land in a cloud folder or feed a website without
 * turning into a credential leak. The full binary dump stays a local-only
 * artefact — see backup.ts.
 *
 * Streamed in bounded batches: an export must not build months of history into
 * a single string in memory. See iterateEventsNdjson for why it is batches and
 * not one long cursor.
 */
import { createInterface } from "node:readline";
import { EVENT_COLUMNS, buildEventWhere, EventFilter } from "./db";
import { Env, nowIso } from "./types";

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

/**
 * Lazily yields NDJSON, oldest first by default — one string per batch of
 * EXPORT_BATCH events.
 *
 * KEYSET pagination rather than `stmt.iterate()`, for a reason that is not
 * cosmetic: better-sqlite3 marks the connection busy for as long as a cursor is
 * open, and every WRITE on it then throws "This database connection is busy
 * executing a query". The connection here is the process-wide singleton
 * (runtime.ts), so a lazily-consumed cursor would make the collectors, the run
 * log and every admin POST fail for the whole duration of an export. Each batch
 * below is a complete, closed query — between two of them the connection is
 * free and the event loop gets a turn.
 *
 * `(ts_utc, id)` and not `ts_utc` alone: the tiebreaker is what makes the
 * cursor total, so events sharing a timestamp are neither skipped nor emitted
 * twice. `id` is unique per account (events' primary key is (account_id, id)).
 */
const EXPORT_BATCH = 500;

export function* iterateEventsNdjson(env: Env, accountId: string, f: EventFilter): Generator<string> {
  const { sql, params, order } = buildEventWhere(accountId, f);
  const cmp = order === "ASC" ? ">" : "<";
  const head = env.DB.prepare(
    `SELECT ${EVENT_COLUMNS} FROM events ${sql} ORDER BY ts_utc ${order}, id ${order} LIMIT ?`
  );
  const after = env.DB.prepare(
    `SELECT ${EVENT_COLUMNS} FROM events ${sql} AND (ts_utc, id) ${cmp} (?, ?)
     ORDER BY ts_utc ${order}, id ${order} LIMIT ?`
  );

  let cursor: { ts: string; id: string } | null = null;
  for (;;) {
    const rows = (
      cursor === null
        ? head.all(...params, EXPORT_BATCH)
        : after.all(...params, cursor.ts, cursor.id, EXPORT_BATCH)
    ) as ExportedEvent[];
    if (rows.length === 0) return;

    yield rows.map((r) => JSON.stringify(r) + "\n").join("");

    // A short batch means the table is exhausted — one query saved per export.
    if (rows.length < EXPORT_BATCH) return;
    const last = rows[rows.length - 1];
    cursor = { ts: last.ts_utc, id: last.id };
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
