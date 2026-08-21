/**
 * Local-clock bucketing for the listening statistics.
 *
 * "At what hour do I listen?" is a question about the LOCAL clock, and the
 * database only stores UTC (`docs/memory/data-model.md`: `ts_utc` is the stored
 * and queried value, `TIMEZONE` is display-only). Answering it means shifting
 * every row by the offset that IANA zone had AT THAT INSTANT — not by today's
 * offset, or a summer of plays lands in the wrong hour.
 *
 * SQLite has no IANA database: `datetime(ts, 'localtime')` reads the SERVER's
 * zone, which in a container is UTC, and it cannot be pointed at `Europe/Paris`.
 * So the zone knowledge has to come from Node's `Intl`, and the only question is
 * how to get it into the query.
 *
 * The shape used here: an offset is piecewise constant over time — two changes a
 * year at most, for a handful of segments over a decade of history. So we probe
 * `Intl` once per day of the range (~23 ms for eleven years, memoised), refine
 * each change to the minute by bisection, and hand SQL a plain CASE expression
 * over those few boundaries. Nothing is called per row.
 *
 * Rejected: a `db.function()` user-defined function — correct, but it crosses
 * into JS once per row per query, on the connection that also serves the UI and
 * the collectors. Rejected too: storing a local timestamp alongside `ts_utc` —
 * `TIMEZONE` is a display setting the operator can change, and a materialised
 * local time would silently go stale the day they do (and `events.ts_local` is
 * reserved for something else entirely, the photo oracle of spec §10).
 */

/** One stretch of history over which the zone's UTC offset does not change. */
export interface TzSegment {
  /** Inclusive start, `YYYY-MM-DDTHH:MM:SS` (UTC, no zone suffix — see `sqlLocalExpr`). */
  from: string;
  offsetMinutes: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" });
    formatters.set(tz, f);
  }
  return f;
}

/**
 * Minutes to add to a UTC instant to read the local wall clock in `tz`.
 * `longOffset` yields "GMT+02:00" / "GMT-05:30" / "GMT" — the last one for a
 * zone sitting exactly on UTC, which is why the parse tolerates a bare "GMT".
 */
export function offsetMinutesAt(tz: string, instantMs: number): number {
  const name =
    formatterFor(tz)
      .formatToParts(new Date(instantMs))
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3]));
}

/** UTC instant, to the minute, where the offset switches between `lo` and `hi`. */
function bisect(tz: string, lo: number, hi: number): number {
  const before = offsetMinutesAt(tz, lo);
  while (hi - lo > 60_000) {
    const mid = lo + Math.floor((hi - lo) / 2 / 60_000) * 60_000;
    if (mid === lo) break;
    if (offsetMinutesAt(tz, mid) === before) lo = mid;
    else hi = mid;
  }
  return hi;
}

const DAY_MS = 86_400_000;
const segmentCache = new Map<string, TzSegment[]>();

/** `2026-08-07T14:39:02.123Z` -> `2026-08-07T14:39:02`, the form SQL compares. */
function toSqlInstant(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19);
}

/**
 * The offset segments covering [fromMs, toMs], oldest first, the first one
 * starting at the epoch so every row matches a branch.
 *
 * Probing daily assumes no zone changes its offset twice within 24 h, which no
 * entry in the IANA database does in the era this project can hold data for.
 */
export function tzSegments(tz: string, fromMs: number, toMs: number): TzSegment[] {
  // Cache on whole days: two page loads a minute apart must not re-probe.
  const key = `${tz}|${Math.floor(fromMs / DAY_MS)}|${Math.ceil(toMs / DAY_MS)}`;
  const hit = segmentCache.get(key);
  if (hit) return hit;

  const segments: TzSegment[] = [{ from: "0000-01-01T00:00:00", offsetMinutes: offsetMinutesAt(tz, fromMs) }];
  let previous = segments[0].offsetMinutes;
  for (let t = fromMs; t <= toMs + DAY_MS; t += DAY_MS) {
    const current = offsetMinutesAt(tz, t);
    if (current !== previous) {
      const at = bisect(tz, t - DAY_MS, t);
      segments.push({ from: toSqlInstant(at), offsetMinutes: current });
      previous = current;
    }
  }

  // Unbounded growth would be a leak in a process that runs for months; the
  // working set is a handful of ranges, so a plain cap is enough.
  if (segmentCache.size > 64) segmentCache.clear();
  segmentCache.set(key, segments);
  return segments;
}

/**
 * SQL expression turning a UTC timestamp column into local wall-clock text
 * (`YYYY-MM-DD HH:MM:SS`), which `strftime` then slices into hour, weekday,
 * month and so on.
 *
 * Comparisons run on `substr(col, 1, 19)` rather than the raw value because the
 * two producers disagree on precision — `played_at` carries milliseconds,
 * `added_at` does not — and `'…:00.123Z' < '…:00Z'` is true as a string. Cutting
 * both sides to whole seconds makes the boundary test mean what it reads.
 *
 * The literals are built here, never bound: they come from `tzSegments`, which
 * derives them from `Intl` and a numeric range, so no user input reaches the SQL.
 */
export function sqlLocalExpr(segments: TzSegment[], column: string): string {
  if (segments.length === 1) {
    return `datetime(${column}, '${segments[0].offsetMinutes} minutes')`;
  }
  const branches = segments
    .slice(1)
    .reverse()
    .map((s) => `WHEN substr(${column}, 1, 19) >= '${s.from}' THEN '${s.offsetMinutes} minutes'`)
    .join(" ");
  return `datetime(${column}, CASE ${branches} ELSE '${segments[0].offsetMinutes} minutes' END)`;
}

/** Local wall-clock parts of an instant — for bounds computed outside SQL. */
export function localParts(tz: string, instantMs: number): { date: string; hour: number } {
  const shifted = new Date(instantMs + offsetMinutesAt(tz, instantMs) * 60_000);
  return { date: shifted.toISOString().slice(0, 10), hour: shifted.getUTCHours() };
}

/**
 * UTC instant of a local wall-clock date/time. Used to turn the `from`/`to`
 * date filters (which the operator types in local time) into the `ts_utc` bounds
 * that can use `idx_events_ts`.
 *
 * Two passes: guess with the offset at the naive instant, then re-read the
 * offset at the guess. That settles every case except the hour that does not
 * exist on a spring-forward day, where the result lands on the transition — an
 * acceptable answer for a day boundary.
 */
export function utcFromLocal(tz: string, localIso: string): number {
  const naive = Date.parse(`${localIso}Z`);
  if (!Number.isFinite(naive)) return NaN;
  const guess = naive - offsetMinutesAt(tz, naive) * 60_000;
  return naive - offsetMinutesAt(tz, guess) * 60_000;
}
