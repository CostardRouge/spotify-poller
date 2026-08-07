import type Database from "better-sqlite3";
import { Account, CollectorId, Env, GLOBAL_SCOPE, PublicAccount, RunStatus, nowIso } from "./types";

/**
 * Every collected row is scoped to the Spotify account it came from
 * (`account_id`, migration 0005). Nothing here ever overwrites another
 * account's data: connecting a second account creates a new scope, it does not
 * replace the first one.
 *
 * GLOBAL_SCOPE ('') is reserved — see types.ts for what lives there.
 */

// ---------- raw layer (invariant I3) ----------

export function insertRaw(
  env: Env,
  accountId: string,
  collector: string,
  httpStatus: number,
  requestUrl: string,
  payload: string | null
): void {
  env.DB.prepare(
    `INSERT INTO raw_spotify (account_id, collector, fetched_at, http_status, request_url, payload)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(accountId, collector, nowIso(), httpStatus, requestUrl, payload);
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
 *
 * Dedup is per account: the primary key is (account_id, id), so two accounts
 * that liked the same track are two distinct events, while replaying the same
 * run twice still inserts nothing the second time.
 */
export function insertEvents(env: Env, accountId: string, rows: EventRow[]): number {
  if (rows.length === 0) return 0;
  const stmt = env.DB.prepare(
    `INSERT OR IGNORE INTO events
       (account_id, id, ts_utc, ts_local, tz, type, source, duration_s, lat, lon, title, subtitle, payload, ingested_at)
     VALUES (?, ?, ?, NULL, NULL, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)`
  );
  const ingested = nowIso();
  let inserted = 0;
  const tx = env.DB.transaction((items: EventRow[]) => {
    for (const r of items) {
      const info = stmt.run(
        accountId,
        r.id,
        r.ts_utc,
        r.type,
        r.source,
        r.duration_s,
        r.title,
        r.subtitle,
        r.payload,
        ingested
      );
      inserted += info.changes;
    }
  });
  tx(rows);
  return inserted;
}

// ---------- state ----------

export function getState(env: Env, accountId: string, key: string): string | null {
  const row = env.DB.prepare(`SELECT value FROM poller_state WHERE account_id = ? AND key = ?`).get(
    accountId,
    key
  ) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setState(env: Env, accountId: string, key: string, value: string): void {
  env.DB.prepare(
    `INSERT INTO poller_state (account_id, key, value, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(account_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(accountId, key, value, nowIso());
}

/** App-wide state (rate-limit cooldown, active account, adoption marker). */
export function getGlobalState(env: Env, key: string): string | null {
  return getState(env, GLOBAL_SCOPE, key);
}

export function setGlobalState(env: Env, key: string, value: string): void {
  setState(env, GLOBAL_SCOPE, key, value);
}

// ---------- accounts ----------

const KEY_ACTIVE = "accounts.active_id";

/**
 * Creates the account or refreshes its token — never touches the other rows.
 * This is what makes reconnecting a different Spotify account non-destructive.
 */
export function upsertAccount(
  env: Env,
  id: string,
  displayName: string | null,
  refreshToken: string,
  scope: string | null
): void {
  env.DB.prepare(
    `INSERT INTO accounts (id, display_name, refresh_token, scope, connected_at, last_seen_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'ok')
     ON CONFLICT(id) DO UPDATE SET
       display_name  = excluded.display_name,
       refresh_token = excluded.refresh_token,
       scope         = COALESCE(excluded.scope, accounts.scope),
       last_seen_at  = excluded.last_seen_at,
       status        = 'ok'`
  ).run(id, displayName, refreshToken, scope, nowIso(), nowIso());
}

/** Token rotation only — leaves connected_at and display_name alone. */
export function updateAccountToken(env: Env, id: string, refreshToken: string, scope: string | null): void {
  env.DB.prepare(
    `UPDATE accounts SET refresh_token = ?, scope = COALESCE(?, scope), last_seen_at = ? WHERE id = ?`
  ).run(refreshToken, scope, nowIso(), id);
}

export function setAccountStatus(env: Env, id: string, status: "ok" | "revoked"): void {
  env.DB.prepare(`UPDATE accounts SET status = ? WHERE id = ?`).run(status, id);
}

export function touchAccount(env: Env, id: string): void {
  env.DB.prepare(`UPDATE accounts SET last_seen_at = ? WHERE id = ?`).run(nowIso(), id);
}

export function getAccount(env: Env, id: string): Account | null {
  return (env.DB.prepare(`SELECT * FROM accounts WHERE id = ?`).get(id) as Account | undefined) ?? null;
}

/** Never exposes refresh tokens — this feeds the HTTP API and the UI. */
export function listAccounts(env: Env): PublicAccount[] {
  return env.DB.prepare(
    `SELECT id, display_name, scope, connected_at, last_seen_at, status
     FROM accounts ORDER BY connected_at ASC`
  ).all() as PublicAccount[];
}

export function countAccounts(env: Env): number {
  return (env.DB.prepare(`SELECT COUNT(*) AS n FROM accounts`).get() as { n: number }).n;
}

export function getActiveAccountId(env: Env): string | null {
  return getGlobalState(env, KEY_ACTIVE);
}

export function setActiveAccountId(env: Env, id: string): void {
  setGlobalState(env, KEY_ACTIVE, id);
}

/**
 * Attributes rows collected before the multi-account migration to the account
 * we have just identified, and moves its legacy state keys into its own scope.
 *
 * Single transaction, idempotent: GLOBAL_SCOPE keys that must stay global
 * (rate limit, active account, this very marker) are explicitly excluded.
 * Returns the number of rows adopted per table, for the log.
 */
export function adoptLegacyRows(env: Env, accountId: string): Record<string, number> {
  // Stay in the global scope: app-wide, not tied to whoever is collected.
  const KEEP_GLOBAL = [KEY_ACTIVE, "ratelimit.limited_until"];
  // Superseded by the accounts table. Deleted rather than moved: the refresh
  // token must live in exactly one place, or a later reader could pick up a
  // stale copy — and a duplicated secret is a secret you forget to rotate.
  const DROP = ["auth.refresh_token", "auth.scope", "auth.connected_at"];
  const ph = (a: string[]) => a.map(() => "?").join(", ");
  const adopted: Record<string, number> = {};

  const tx = env.DB.transaction(() => {
    for (const table of ["events", "raw_spotify", "poller_runs", "gaps"]) {
      const info = env.DB.prepare(`UPDATE ${table} SET account_id = ? WHERE account_id = ?`).run(
        accountId,
        GLOBAL_SCOPE
      );
      adopted[table] = info.changes;
    }

    const dropped = env.DB.prepare(
      `DELETE FROM poller_state WHERE account_id = ? AND key IN (${ph(DROP)})`
    ).run(GLOBAL_SCOPE, ...DROP);
    adopted.legacy_auth_keys_dropped = dropped.changes;

    // Only the collector cursors move; notification/backup bookkeeping is
    // app-wide and stays put.
    const moved = env.DB.prepare(
      `UPDATE OR REPLACE poller_state SET account_id = ?
       WHERE account_id = ? AND key NOT IN (${ph(KEEP_GLOBAL)})
         AND key NOT LIKE 'notify.%' AND key NOT LIKE 'backup.%'`
    ).run(accountId, GLOBAL_SCOPE, ...KEEP_GLOBAL);
    adopted.poller_state = moved.changes;
  });
  tx();
  return adopted;
}

// ---------- run log (invariant I1) ----------

export function startRun(
  env: Env,
  accountId: string,
  collector: CollectorId,
  trigger: "cron" | "manual"
): number {
  const r = env.DB.prepare(
    `INSERT INTO poller_runs (account_id, collector, trigger_kind, started_at) VALUES (?, ?, ?, ?)`
  ).run(accountId, collector, trigger, nowIso());
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

/** Status of the previous run of the same collector, for recovery detection. */
export function lastRunStatus(env: Env, accountId: string, collector: CollectorId): RunStatus | null {
  const row = env.DB.prepare(
    `SELECT status FROM poller_runs
     WHERE account_id = ? AND collector = ? AND finished_at IS NOT NULL
     ORDER BY id DESC LIMIT 1`
  ).get(accountId, collector) as { status: RunStatus | null } | undefined;
  return row?.status ?? null;
}

// ---------- gaps ----------

export function insertGap(
  env: Env,
  accountId: string,
  collector: CollectorId,
  fromUtc: string,
  toUtc: string,
  note: string
): void {
  env.DB.prepare(
    `INSERT INTO gaps (account_id, collector, from_utc, to_utc, detected_at, note)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(accountId, collector, fromUtc, toUtc, nowIso(), note);
}

// ---------- reads for /status and /stats ----------

export function healthSnapshot(env: Env, accountId: string) {
  const counts = env.DB.prepare(
    `SELECT type, COUNT(*) AS n FROM events WHERE account_id = ? GROUP BY type`
  ).all(accountId) as { type: string; n: number }[];
  return {
    collector_played_last_success: getState(env, accountId, "played.last_success_at"),
    collector_liked_last_success: getState(env, accountId, "liked.last_success_at"),
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
}

export interface PagedEventFilter extends EventFilter {
  limit: number;
  offset: number;
}

/**
 * Shared by the browsing API and the NDJSON export, so a filter can never mean
 * two different things depending on which one you ask.
 */
export function buildEventWhere(
  accountId: string,
  f: EventFilter
): { sql: string; params: unknown[]; order: "ASC" | "DESC" } {
  const where = ["account_id = ?"];
  const params: unknown[] = [accountId];
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
  return { sql: `WHERE ${where.join(" AND ")}`, params, order: f.order === "asc" ? "ASC" : "DESC" };
}

export const EVENT_COLUMNS =
  "account_id, id, ts_utc, ts_local, tz, type, source, duration_s, lat, lon, title, subtitle, payload, ingested_at";

export function listEvents(env: Env, accountId: string, f: PagedEventFilter) {
  const { sql, params, order } = buildEventWhere(accountId, f);

  const total = (env.DB.prepare(`SELECT COUNT(*) AS n FROM events ${sql}`).get(...params) as { n: number }).n;
  const items = env.DB.prepare(
    `SELECT ${EVENT_COLUMNS} FROM events ${sql} ORDER BY ts_utc ${order} LIMIT ? OFFSET ?`
  ).all(...params, f.limit, f.offset);

  return { account_id: accountId, total, limit: f.limit, offset: f.offset, items };
}

export function listRuns(env: Env, accountId: string, limit: number, offset: number) {
  const total = (
    env.DB.prepare(`SELECT COUNT(*) AS n FROM poller_runs WHERE account_id = ?`).get(accountId) as { n: number }
  ).n;
  const items = env.DB.prepare(
    `SELECT id, collector, trigger_kind, started_at, finished_at, status,
            items_fetched, items_inserted, error
     FROM poller_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(accountId, limit, offset);
  return { account_id: accountId, total, limit, offset, items };
}

export function listGaps(env: Env, accountId: string, limit: number, offset: number) {
  const total = (
    env.DB.prepare(`SELECT COUNT(*) AS n FROM gaps WHERE account_id = ?`).get(accountId) as { n: number }
  ).n;
  const items = env.DB.prepare(
    `SELECT id, collector, from_utc, to_utc, detected_at, note
     FROM gaps WHERE account_id = ? ORDER BY detected_at DESC LIMIT ? OFFSET ?`
  ).all(accountId, limit, offset);
  return { account_id: accountId, total, limit, offset, items };
}

export function statsSnapshot(env: Env, accountId: string) {
  const runs = env.DB.prepare(
    `SELECT collector, trigger_kind, started_at, finished_at, status,
            items_fetched, items_inserted, error
     FROM poller_runs WHERE account_id = ? ORDER BY started_at DESC LIMIT 20`
  ).all(accountId);
  const gaps = env.DB.prepare(
    `SELECT id, collector, from_utc, to_utc, detected_at, note
     FROM gaps WHERE account_id = ? ORDER BY detected_at DESC LIMIT 50`
  ).all(accountId);
  const rawCount = env.DB.prepare(`SELECT COUNT(*) AS n FROM raw_spotify WHERE account_id = ?`).get(
    accountId
  ) as { n: number };
  const eventCount = env.DB.prepare(`SELECT COUNT(*) AS n FROM events WHERE account_id = ?`).get(
    accountId
  ) as { n: number };
  return {
    account_id: accountId,
    raw_rows: rawCount.n,
    event_rows: eventCount.n,
    gaps,
    last_20_runs: runs,
  };
}

/** Row counts per account — cheap enough to serve on /status. */
export function eventCountsByAccount(env: Env): Record<string, number> {
  const rows = env.DB.prepare(`SELECT account_id, COUNT(*) AS n FROM events GROUP BY account_id`).all() as {
    account_id: string;
    n: number;
  }[];
  return Object.fromEntries(rows.map((r) => [r.account_id, r.n]));
}
