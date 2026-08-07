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

/** Forgets a key entirely — used by the disconnect flow (db.disconnectAccount). */
export function deleteState(env: Env, accountId: string, key: string): void {
  env.DB.prepare(`DELETE FROM poller_state WHERE account_id = ? AND key = ?`).run(accountId, key);
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
 * Forgets an account's CONNECTION — its row, its token, and the active pointer
 * if it led here. resolveActiveAccount then falls back to another account on
 * its own, so the pointer only needs clearing, not reassigning.
 *
 * Kept on purpose: everything collected (events, runs, gaps, playback) and the
 * collector cursors. Those plays happened, and reconnecting the same Spotify id
 * resumes exactly where it stopped instead of replaying the whole liked
 * backfill.
 *
 * The legacy `auth.refresh_token` key goes too. adoptLegacyRows() normally
 * drops it already, but leaving a stale copy behind would let
 * resolveActiveAccount silently re-bootstrap the account we were just asked to
 * forget. SPOTIFY_REFRESH_TOKEN cannot be unset from here — it is reported to
 * the caller rather than quietly ignored.
 */
export function disconnectAccount(env: Env, id: string): { removed: boolean; remaining: number } {
  const tx = env.DB.transaction(() => {
    const info = env.DB.prepare(`DELETE FROM accounts WHERE id = ?`).run(id);
    if (getActiveAccountId(env) === id) deleteState(env, GLOBAL_SCOPE, KEY_ACTIVE);
    deleteState(env, GLOBAL_SCOPE, "auth.refresh_token");
    return info.changes > 0;
  });
  const removed = tx();
  return { removed, remaining: countAccounts(env) };
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

/**
 * Writes an already-finished run in one INSERT.
 *
 * The playback ticker fires every ~15 s; a start/finish pair per tick would put
 * ~5760 rows a day in the Runs tab and drown the two collectors that matter.
 * It logs an hourly SUMMARY (and every error) through this instead.
 */
export function logRun(
  env: Env,
  accountId: string,
  collector: CollectorId,
  trigger: "cron" | "manual",
  startedAt: string,
  status: RunStatus,
  fetched: number,
  inserted: number,
  error: string | null
): void {
  env.DB.prepare(
    `INSERT INTO poller_runs
       (account_id, collector, trigger_kind, started_at, finished_at, status, items_fetched, items_inserted, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(accountId, collector, trigger, startedAt, nowIso(), status, fetched, inserted, error);
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

// ---------- playback (opt-in collector) ----------

export interface PlaybackSampleRow {
  observed_at: string;
  spotify_ts: number | null;
  item_id: string | null;
  item_type: string | null;
  progress_ms: number | null;
  duration_ms: number | null;
  is_playing: number;
  device_id: string | null;
  device_name: string | null;
  device_type: string | null;
  volume_percent: number | null;
  is_private_session: number | null;
  shuffle_state: number | null;
  repeat_state: string | null;
  context_uri: string | null;
}

export interface PlaybackSessionRow {
  id: string;
  item_id: string;
  item_type: string;
  title: string | null;
  subtitle: string | null;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  first_progress_ms: number | null;
  max_progress_ms: number | null;
  last_progress_ms: number | null;
  listened_ms: number;
  completion_ratio: number | null;
  skipped: number | null;
  close_reason: string | null;
  sample_count: number;
  pause_count: number;
  paused_ms: number;
  device_id: string | null;
  device_name: string | null;
  device_type: string | null;
  volume_min: number | null;
  volume_max: number | null;
  volume_last: number | null;
  shuffle_state: number | null;
  repeat_state: string | null;
  context_uri: string | null;
  is_private_session: number | null;
  last_is_playing: number;
  event_id: string | null;
  closed: number;
  updated_at: string;
}

export function insertPlaybackSample(env: Env, accountId: string, s: PlaybackSampleRow): void {
  env.DB.prepare(
    `INSERT INTO playback_samples
       (account_id, observed_at, spotify_ts, item_id, item_type, progress_ms, duration_ms, is_playing,
        device_id, device_name, device_type, volume_percent, is_private_session,
        shuffle_state, repeat_state, context_uri)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    accountId, s.observed_at, s.spotify_ts, s.item_id, s.item_type, s.progress_ms, s.duration_ms, s.is_playing,
    s.device_id, s.device_name, s.device_type, s.volume_percent, s.is_private_session,
    s.shuffle_state, s.repeat_state, s.context_uri
  );
}

/** Last transition written — the baseline the "has anything changed?" test compares against. */
export function getLastPlaybackSample(env: Env, accountId: string): PlaybackSampleRow | null {
  return (env.DB.prepare(
    `SELECT * FROM playback_samples WHERE account_id = ? ORDER BY id DESC LIMIT 1`
  ).get(accountId) as PlaybackSampleRow | undefined) ?? null;
}

/**
 * The in-progress listen. Kept in the table rather than in process memory so a
 * container restart resumes where it left off — same reasoning as the liked
 * backfill offset. At most one row per account can have closed = 0.
 */
export function getOpenPlaybackSession(env: Env, accountId: string): PlaybackSessionRow | null {
  return (env.DB.prepare(
    `SELECT * FROM playback_sessions WHERE account_id = ? AND closed = 0 LIMIT 1`
  ).get(accountId) as PlaybackSessionRow | undefined) ?? null;
}

export function insertPlaybackSession(env: Env, accountId: string, s: PlaybackSessionRow): void {
  env.DB.prepare(
    `INSERT OR IGNORE INTO playback_sessions
       (account_id, id, item_id, item_type, title, subtitle, started_at, ended_at, duration_ms,
        first_progress_ms, max_progress_ms, last_progress_ms, listened_ms, completion_ratio,
        skipped, close_reason, sample_count, pause_count, paused_ms,
        device_id, device_name, device_type, volume_min, volume_max, volume_last,
        shuffle_state, repeat_state, context_uri, is_private_session, last_is_playing,
        event_id, closed, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    accountId, s.id, s.item_id, s.item_type, s.title, s.subtitle, s.started_at, s.ended_at, s.duration_ms,
    s.first_progress_ms, s.max_progress_ms, s.last_progress_ms, s.listened_ms, s.completion_ratio,
    s.skipped, s.close_reason, s.sample_count, s.pause_count, s.paused_ms,
    s.device_id, s.device_name, s.device_type, s.volume_min, s.volume_max, s.volume_last,
    s.shuffle_state, s.repeat_state, s.context_uri, s.is_private_session, s.last_is_playing,
    s.event_id, s.closed, s.updated_at
  );
}

/** Refreshes the aggregates of the open session — runs on every tick, so no INSERT. */
export function updatePlaybackSession(env: Env, accountId: string, s: PlaybackSessionRow): void {
  env.DB.prepare(
    `UPDATE playback_sessions SET
       max_progress_ms = ?, last_progress_ms = ?, listened_ms = ?, completion_ratio = ?,
       sample_count = ?, pause_count = ?, paused_ms = ?,
       device_id = ?, device_name = ?, device_type = ?,
       volume_min = ?, volume_max = ?, volume_last = ?,
       shuffle_state = ?, repeat_state = ?, context_uri = ?, is_private_session = ?,
       last_is_playing = ?, updated_at = ?
     WHERE account_id = ? AND id = ?`
  ).run(
    s.max_progress_ms, s.last_progress_ms, s.listened_ms, s.completion_ratio,
    s.sample_count, s.pause_count, s.paused_ms,
    s.device_id, s.device_name, s.device_type,
    s.volume_min, s.volume_max, s.volume_last,
    s.shuffle_state, s.repeat_state, s.context_uri, s.is_private_session,
    s.last_is_playing, s.updated_at, accountId, s.id
  );
}

export function closePlaybackSession(
  env: Env,
  accountId: string,
  id: string,
  endedAt: string,
  reason: string,
  skipped: number
): void {
  env.DB.prepare(
    `UPDATE playback_sessions
     SET ended_at = ?, close_reason = ?, skipped = ?, closed = 1, updated_at = ?
     WHERE account_id = ? AND id = ?`
  ).run(endedAt, reason, skipped, nowIso(), accountId, id);
}

/**
 * Best-effort link from a finished listen to the events row 'played' wrote for
 * it. Runs after a 'played' collection, because that is when the events appear.
 *
 * Matches on track id inside a WIDE time window on purpose: it is still an open
 * question whether Spotify's played_at is the start or the end of the track
 * (docs/findings.md), and this must not depend on the answer. An event already
 * claimed by another session is skipped, and finding nothing is a normal
 * outcome — event_id simply stays NULL.
 */
export function linkPlaybackSessions(env: Env, accountId: string, lookbackHours = 48): number {
  const since = new Date(Date.now() - lookbackHours * 3_600_000).toISOString();
  const pending = env.DB.prepare(
    `SELECT id, item_id, started_at, ended_at, duration_ms
     FROM playback_sessions
     WHERE account_id = ? AND closed = 1 AND event_id IS NULL AND started_at >= ?`
  ).all(accountId, since) as {
    id: string; item_id: string; started_at: string; ended_at: string | null; duration_ms: number | null;
  }[];

  const find = env.DB.prepare(
    `SELECT e.id FROM events e
     WHERE e.account_id = ? AND e.type = 'listen'
       AND json_extract(e.payload, '$.track_id') = ?
       AND e.ts_utc >= ? AND e.ts_utc <= ?
       AND NOT EXISTS (
         SELECT 1 FROM playback_sessions p WHERE p.account_id = e.account_id AND p.event_id = e.id
       )
     ORDER BY abs(julianday(e.ts_utc) - julianday(?)) ASC
     LIMIT 1`
  );
  const link = env.DB.prepare(`UPDATE playback_sessions SET event_id = ? WHERE account_id = ? AND id = ?`);

  let linked = 0;
  const tx = env.DB.transaction(() => {
    for (const s of pending) {
      // played_at may sit at either end of the track: widen by its duration.
      const margin = (s.duration_ms ?? 0) + 5 * 60 * 1000;
      const lo = new Date(Date.parse(s.started_at) - margin).toISOString();
      const hi = new Date(Date.parse(s.ended_at ?? s.started_at) + margin).toISOString();
      const hit = find.get(accountId, s.item_id, lo, hi, s.started_at) as { id: string } | undefined;
      if (hit) {
        link.run(hit.id, accountId, s.id);
        linked++;
      }
    }
  });
  tx();
  return linked;
}

/**
 * Retention on the transition log only — sessions are the value, they are kept.
 * Not scoped to an account: retention is a disk-space policy, and a
 * disconnected account's samples should age out too.
 */
export function purgePlaybackSamples(env: Env, retentionDays: number): number {
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  return env.DB.prepare(`DELETE FROM playback_samples WHERE observed_at < ?`).run(cutoff).changes;
}

export function listPlaybackSessions(
  env: Env,
  accountId: string,
  f: { from?: string; to?: string; limit: number; offset: number }
) {
  const where = ["account_id = ?"];
  const params: unknown[] = [accountId];
  if (f.from) {
    where.push("started_at >= ?");
    params.push(f.from);
  }
  if (f.to) {
    where.push("started_at <= ?");
    params.push(f.to);
  }
  const whereSql = `WHERE ${where.join(" AND ")}`;
  const total = (
    env.DB.prepare(`SELECT COUNT(*) AS n FROM playback_sessions ${whereSql}`).get(...params) as { n: number }
  ).n;
  const items = env.DB.prepare(
    `SELECT * FROM playback_sessions ${whereSql} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).all(...params, f.limit, f.offset);
  return { total, limit: f.limit, offset: f.offset, items };
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
    // Gated on the flag so an install that never enabled playback (and may
    // therefore not have run migration 0006 yet) never touches the new tables.
    playback: env.PLAYBACK_ENABLED
      ? {
          enabled: true,
          last_success: getState(env, accountId, "playback.last_success_at"),
          now_playing: getOpenPlaybackSession(env, accountId),
        }
      : { enabled: false, last_success: null, now_playing: null },
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
