/**
 * Reads for the trace (`lib/trace.ts`): plays and declared gaps of the last
 * few local days, plus today's polls of the `played` collector.
 *
 * Local days, because "Tuesday" is the operator's Tuesday: each day's bounds
 * come from `utcFromLocal` in `TIMEZONE`, so a day that changes clock is 23 or
 * 25 hours long and still one strip. The queries stay on the indexed `ts_utc`
 * and `started_at` columns with plain UTC bounds; the bucketing happens in JS
 * over at most a week of rows (a few hundred), never per row in SQL.
 *
 * Every query is scoped to `account_id` (`docs/memory/data-model.md`).
 */
import type { Env } from "./types";
import { localParts, utcFromLocal } from "./localtime";
import { bucketDay, type TraceDay } from "../trace";

export interface DayBounds {
  date: string;
  startMs: number;
  endMs: number;
}

/** The local dates of the `days` days ending with the one that contains `nowMs`, oldest first. */
export function lastLocalDays(tz: string, nowMs: number, days: number, weekOffset = 0): DayBounds[] {
  const today = localParts(tz, nowMs).date;
  const out: DayBounds[] = [];
  for (let i = days - 1 + weekOffset * days; i >= weekOffset * days; i--) {
    const date = shiftDate(today, -i);
    const next = shiftDate(today, -i + 1);
    out.push({ date, startMs: utcFromLocal(tz, `${date}T00:00:00`), endMs: utcFromLocal(tz, `${next}T00:00:00`) });
  }
  return out;
}

/** `YYYY-MM-DD` plus `delta` calendar days, on the calendar alone (no zone involved). */
export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

export function traceDays(env: Env, accountId: string, tz: string, nowMs: number, days = 7, weekOffset = 0): TraceDay[] {
  const bounds = lastLocalDays(tz, nowMs, days, weekOffset);
  const from = new Date(bounds[0].startMs).toISOString();
  const to = new Date(bounds[bounds.length - 1].endMs).toISOString();

  const plays = (
    env.DB.prepare(
      `SELECT ts_utc FROM events WHERE account_id = ? AND type = 'listen' AND ts_utc >= ? AND ts_utc < ?`
    ).all(accountId, from, to) as { ts_utc: string }[]
  ).map((r) => Date.parse(r.ts_utc));

  const gaps = (
    env.DB.prepare(
      `SELECT from_utc, to_utc FROM gaps WHERE account_id = ? AND to_utc > ? AND from_utc < ?`
    ).all(accountId, from, to) as { from_utc: string; to_utc: string }[]
  ).map((g) => [Date.parse(g.from_utc), Date.parse(g.to_utc)] as [number, number]);

  return bounds.map((b) =>
    bucketDay(
      b.date,
      b.startMs,
      b.endMs,
      plays.filter((t) => t >= b.startMs && t < b.endMs),
      gaps,
      nowMs
    )
  );
}

/**
 * Today's attempts of the `played` collector, each with where it falls in the
 * local day (0 = midnight, 1 = the next midnight) and whether it succeeded —
 * the desktop dial draws them where they happened, not as an ideal schedule.
 */
export function pollsToday(
  env: Env,
  accountId: string,
  tz: string,
  nowMs: number
): { ok: number; failed: number; polls: { at: number; ok: boolean }[] } {
  const [today] = lastLocalDays(tz, nowMs, 1);
  const rows = env.DB.prepare(
    `SELECT started_at, status FROM poller_runs
     WHERE account_id = ? AND collector = 'played' AND started_at >= ? AND started_at < ?
     ORDER BY started_at`
  ).all(accountId, new Date(today.startMs).toISOString(), new Date(today.endMs).toISOString()) as {
    started_at: string;
    status: string | null;
  }[];
  const span = today.endMs - today.startMs;
  const polls: { at: number; ok: boolean }[] = [];
  let ok = 0;
  let failed = 0;
  for (const r of rows) {
    // A run still in flight (no status yet) is neither: it is drawn by "now".
    if (r.status === null) continue;
    const success = r.status === "ok" || r.status === "partial";
    if (success) ok++;
    else failed++;
    polls.push({ at: (Date.parse(r.started_at) - today.startMs) / span, ok: success });
  }
  return { ok, failed, polls };
}
