import type Database from "better-sqlite3";
import { CollectorId, Env, RunStatus, nowIso } from "./types";

// ---------- raw layer (invariant I3) ----------

export function insertRaw(
  env: Env,
  collector: string,
  httpStatus: number,
  requestUrl: string,
  payload: string | null
): void {
  env.DB.prepare(
    `INSERT INTO raw_spotify (collector, fetched_at, http_status, request_url, payload)
     VALUES (?, ?, ?, ?, ?)`
  ).run(collector, nowIso(), httpStatus, requestUrl, payload);
}

// ---------- events (invariant I2) ----------

export interface EventRow {
  id: string;
  ts_utc: string;
  type: string;
  source: string;
  duration_s: number | null;
  title: string;
  subtitle: string;
  payload: string;
}

/**
 * INSERT OR IGNORE inside a transaction. Returns the number actually inserted
 * (better-sqlite3: changes is 0 for every row skipped by the dedup).
 */
export function insertEvents(env: Env, rows: EventRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO events
       (id, ts_utc, ts_local, tz, type, source, duration_s, lat, lon, title, subtitle, payload, ingested_at)
     VALUES (?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
  );
  const ingested = nowIso();
  let inserted = 0;
  const tx = env.DB.transaction((items: EventRow[]) => {
    for (const r of items) {
      const info = stmt.run(r.id, r.ts_utc, r.type, r.source, r.duration_s, r.title, r.subtitle, r.payload, ingested);
      inserted += info.changes;
    }
  });
  tx(rows);
  return inserted;
}

// ---------- state ----------

export function getState(env: Env, key: string): string | null {
  const row = env.DB.prepare(`SELECT value FROM poller_state WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setState(env: Env, key: string, value: string): void {
  env.DB.prepare(
    `INSERT INTO poller_state (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, value, nowIso());
}

// ---------- run log (invariant I1) ----------

export function startRun(env: Env, collector: CollectorId, trigger: "cron" | "manual"): number {
  const r = env.DB.prepare(
    `INSERT INTO poller_runs (collector, trigger_kind, started_at) VALUES (?, ?, ?)`
  ).run(collector, trigger, nowIso());
  return Number(r.lastInsertRowid);
}

export function finishRun(
  env: Env,
  runId: number,
  status: RunStatus,
  fetched: number,
  inserted: number,
  error: string | null
): void {
  env.DB.prepare(
    `UPDATE poller_runs
     SET finished_at = ?, status = ?, items_fetched = ?, items_inserted = ?, error = ?
     WHERE id = ?`
  ).run(nowIso(), status, fetched, inserted, error, runId);
}

// ---------- gaps ----------

export function insertGap(env: Env, collector: string, fromUtc: string, toUtc: string, note: string): void {
  env.DB.prepare(
    `INSERT INTO gaps (collector, from_utc, to_utc, detected_at, note) VALUES (?, ?, ?, ?, ?)`
  ).run(collector, fromUtc, toUtc, nowIso(), note);
}

// ---------- reads for /health and /stats ----------

export function healthSnapshot(env: Env) {
  const lastPlayed = getState(env, "played.last_success_at");
  const lastLiked = getState(env, "liked.last_success_at");
  const counts = env.DB.prepare(`SELECT type, COUNT(*) AS n FROM events GROUP BY type`).all() as {
    type: string;
    n: number;
  }[];
  return {
    collector_played_last_success: lastPlayed,
    collector_liked_last_success: lastLiked,
    events_by_type: Object.fromEntries(counts.map((r) => [r.type, r.n])),
  };
}

// ---------- paginated browsing for the debug UI ----------

export interface EventFilter {
  type?: string; // 'listen' | 'like' | ...
  q?: string; // LIKE search on title/subtitle
  from?: string; // ISO8601, inclusive bound on ts_utc
  to?: string;
  order?: "asc" | "desc"; // on ts_utc, desc by default
  limit: number;
  offset: number;
}

export function listEvents(env: Env, f: EventFilter) {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.type) {
    where.push("type = ?");
    params.push(f.type);
  }
  if (f.q) {
    where.push("(title LIKE ? OR subtitle LIKE ?)");
    params.push(`%${f.q}%`, `%${f.q}%`);
  }
  if (f.from) {
    where.push("ts_utc >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("ts_utc <= ?");
    params.push(f.to);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const orderSql = f.order === "asc" ? "ASC" : "DESC";

  const total = (
    env.DB.prepare(`SELECT COUNT(*) AS n FROM events ${whereSql}`).get(...params) as { n: number }
  ).n;
  const items = env.DB.prepare(
    `SELECT id, ts_utc, ts_local, tz, type, source, duration_s, title, subtitle, payload, ingested_at
     FROM events ${whereSql}
     ORDER BY ts_utc ${orderSql}
     LIMIT ? OFFSET ?`
  ).all(...params, f.limit, f.offset);

  return { total, limit: f.limit, offset: f.offset, items };
}

export function listRuns(env: Env, limit: number, offset: number) {
  const total = (env.DB.prepare(`SELECT COUNT(*) AS n FROM poller_runs`).get() as { n: number }).n;
  const items = env.DB.prepare(
    `SELECT id, collector, trigger_kind, started_at, finished_at, status,
            items_fetched, items_inserted, error
     FROM poller_runs ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
  return { total, limit, offset, items };
}

export function listGaps(env: Env, limit: number, offset: number) {
  const total = (env.DB.prepare(`SELECT COUNT(*) AS n FROM gaps`).get() as { n: number }).n;
  const items = env.DB.prepare(
    `SELECT * FROM gaps ORDER BY detected_at DESC LIMIT ? OFFSET ?`
  ).all(limit, offset);
  return { total, limit, offset, items };
}

export function statsSnapshot(env: Env) {
  const runs = env.DB.prepare(
    `SELECT collector, trigger_kind, started_at, finished_at, status,
            items_fetched, items_inserted, error
     FROM poller_runs ORDER BY started_at DESC LIMIT 20`
  ).all();
  const gaps = env.DB.prepare(`SELECT * FROM gaps ORDER BY detected_at DESC LIMIT 50`).all();
  const rawCount = env.DB.prepare(`SELECT COUNT(*) AS n FROM raw_spotify`).get() as { n: number };
  const eventCount = env.DB.prepare(`SELECT COUNT(*) AS n FROM events`).get() as { n: number };
  return {
    raw_rows: rawCount.n,
    event_rows: eventCount.n,
    gaps,
    last_20_runs: runs,
  };
}
