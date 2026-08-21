/**
 * Listening statistics — the aggregation behind the Listening page.
 *
 * What this is for: the rest of the app answers *is collection alive*. This one
 * answers *what does the collected history say* — at what hours, on which days,
 * in which months, and what kind of music at what time of day. It reads; it
 * never writes.
 *
 * Three constraints shape the whole file.
 *
 * 1. **Local clock, UTC storage.** Every bucket ("Tuesdays", "22:00", "January")
 *    is a statement about the operator's wall clock, and the database only
 *    stores UTC. The shift comes from `localtime.ts` as a CASE expression over
 *    the few DST segments the range spans — read the header there for why not a
 *    UDF and why not a stored local column.
 *
 * 2. **One materialisation, many aggregates.** The filtered rows are extracted
 *    once into a temp table with the local-clock parts already computed, and the
 *    ~20 aggregates below run against that. Recomputing the local shift and
 *    re-parsing the JSON payload in every query would multiply the cost of the
 *    single expensive step by twenty.
 *
 * 3. **Synchronous from the first statement to the last.** better-sqlite3 is
 *    synchronous and the connection is a process-wide singleton, so the temp
 *    table is shared state. `listeningStats` never awaits: no other request can
 *    run between its CREATE and its DROP, because nothing else can run at all.
 *    Keep it that way — an `await` anywhere inside would let two page loads
 *    stomp on each other's scope.
 *
 * Cost is O(the account's history): ~350 ms unfiltered over 30k events, less as
 * soon as a date range narrows it. That is affordable on a page you open to
 * think, and unaffordable on the Overview — which is why nothing here is called
 * from the health surface.
 */
import { Env } from "./types";
import { offsetMinutesAt, sqlLocalExpr, tzSegments, utcFromLocal } from "./localtime";

// ---------- the filter ----------

export type EventTypeFilter = "listen" | "like" | "all";

/**
 * Everything the page can slice by. Every field is composable with every other
 * one — that is the point of the page: the interesting questions ("what do I
 * play on a Sunday morning in winter") are intersections, not single axes.
 */
export interface ListeningFilter {
  type: EventTypeFilter;
  /** Local calendar dates, inclusive. */
  from: string | null;
  to: string | null;
  /** Substring match on the track title or the artist credit. */
  q: string | null;
  /** Exact facet values, as clicked from the charts. */
  artist: string | null;
  album: string | null;
  track: string | null;
  genre: string | null;
  /** Spotify playback context: playlist, album, artist, collection, or 'none'. */
  context: string | null;
  /** Local clock facets. Empty = no restriction. */
  hours: number[];
  weekdays: number[]; // 1 = Monday … 7 = Sunday (ISO), not SQLite's 0 = Sunday
  mdays: number[]; // 1 … 31, the day of the month
  months: number[]; // 1 … 12
  years: number[];
}

export const EMPTY_FILTER: ListeningFilter = {
  type: "listen",
  from: null,
  to: null,
  q: null,
  artist: null,
  album: null,
  track: null,
  genre: null,
  context: null,
  hours: [],
  weekdays: [],
  mdays: [],
  months: [],
  years: [],
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(sp: URLSearchParams, name: string): string | null {
  const v = sp.get(name);
  return v === null || v.trim() === "" ? null : v.trim();
}

/** Repeated or comma-joined integers, deduplicated, in range, sorted. */
function ints(sp: URLSearchParams, name: string, min: number, max: number): number[] {
  const raw = sp.getAll(name).flatMap((v) => v.split(","));
  const out = new Set<number>();
  for (const r of raw) {
    const n = Number(r);
    if (Number.isInteger(n) && n >= min && n <= max) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

export function parseListeningFilter(sp: URLSearchParams): ListeningFilter {
  const type = sp.get("type");
  const from = str(sp, "from");
  const to = str(sp, "to");
  return {
    type: type === "like" || type === "all" ? type : "listen",
    // A malformed date must not silently become "no filter that anyone can see":
    // it is dropped, and the form redisplays what is actually being applied.
    from: from && DATE_RE.test(from) ? from : null,
    to: to && DATE_RE.test(to) ? to : null,
    q: str(sp, "q"),
    artist: str(sp, "artist"),
    album: str(sp, "album"),
    track: str(sp, "track"),
    genre: str(sp, "genre"),
    context: str(sp, "context"),
    hours: ints(sp, "hour", 0, 23),
    weekdays: ints(sp, "weekday", 1, 7),
    mdays: ints(sp, "mday", 1, 31),
    months: ints(sp, "month", 1, 12),
    years: ints(sp, "year", 1970, 2999),
  };
}

/** The filter as query parameters — what every cross-filter link is built from. */
export function filterToParams(f: ListeningFilter, account: string | null): URLSearchParams {
  const p = new URLSearchParams();
  if (account) p.set("account", account);
  if (f.type !== "listen") p.set("type", f.type);
  for (const [k, v] of [
    ["from", f.from],
    ["to", f.to],
    ["q", f.q],
    ["artist", f.artist],
    ["album", f.album],
    ["track", f.track],
    ["genre", f.genre],
    ["context", f.context],
  ] as const) {
    if (v) p.set(k, v);
  }
  for (const [k, list] of [
    ["hour", f.hours],
    ["weekday", f.weekdays],
    ["mday", f.mdays],
    ["month", f.months],
    ["year", f.years],
  ] as const) {
    if (list.length > 0) p.set(k, list.join(","));
  }
  return p;
}

export function isFilterEmpty(f: ListeningFilter): boolean {
  return (
    f.type === "listen" &&
    !f.from &&
    !f.to &&
    !f.q &&
    !f.artist &&
    !f.album &&
    !f.track &&
    !f.genre &&
    !f.context &&
    f.hours.length === 0 &&
    f.weekdays.length === 0 &&
    f.mdays.length === 0 &&
    f.months.length === 0 &&
    f.years.length === 0
  );
}

// ---------- the result ----------

export interface Bucket {
  key: string;
  label: string;
  n: number;
}

export interface RankedItem {
  key: string;
  label: string;
  sub: string | null;
  n: number;
  /** Distinct tracks behind the count — an artist heard 300 times through two
   *  tracks is a different fact from one heard 300 times through forty. */
  variety: number | null;
}

export interface ListeningStats {
  account_id: string;
  timezone: string;
  filter: ListeningFilter;

  totals: {
    events: number;
    listens: number;
    likes: number;
    distinct_tracks: number;
    distinct_artists: number;
    distinct_albums: number;
    /** Sum of the FULL track durations of the listens in scope — an upper bound. */
    estimated_seconds: number;
    first_ts: string | null;
    last_ts: string | null;
    /** Local days carrying at least one event in scope. */
    active_days: number;
    /** Local days between the first and the last, inclusive. */
    span_days: number;
    per_active_day: number;
  };

  by_hour: Bucket[];
  by_weekday: Bucket[];
  by_month: Bucket[];
  by_day_of_month: Bucket[];
  by_year: Bucket[];
  /** One point per local month between the first and the last, holes included. */
  by_month_series: Bucket[];
  /** One entry per local day that has events — the calendar and the streaks. */
  by_day: { date: string; n: number }[];
  /** weekday (1-7) × hour (0-23) counts, row-major. */
  heatmap: number[][];

  top_artists: RankedItem[];
  top_tracks: RankedItem[];
  top_albums: RankedItem[];
  top_genres: RankedItem[];
  /** Top genres per part of the local day — "what kind of music, and when". */
  genres_by_daypart: { part: string; label: string; total: number; genres: RankedItem[] }[];
  context_mix: Bucket[];

  /** Share of the rows in scope whose artists are cached AND carry a genre. */
  genre_coverage: { rows: number; with_genre: number; artists_cached: number; artists_with_genres: number };

  sessions: {
    count: number;
    median_minutes: number;
    median_tracks: number;
    longest: { started_at: string; ended_at: string; tracks: number; minutes: number } | null;
  };

  streaks: {
    longest_days: number;
    longest_from: string | null;
    longest_to: string | null;
    current_days: number;
    silent_days_in_span: number;
  };

  /** Artists heard for the first time, per local month inside the range. */
  discoveries: { by_month: Bucket[]; total: number; newest: RankedItem[] };

  repeat: {
    listens_per_track: number;
    /** Heaviest single-day repeat of one track inside the range. */
    top_day: { date: string; title: string; artist: string; n: number } | null;
  };

  likes: {
    total: number;
    by_daypart: Bucket[];
    /** Hours between a track's first collected listen and the moment it was liked. */
    latency_median_hours: number | null;
    latency_sample: number;
    /** Likes whose track was never seen as a listen — liked without collected evidence. */
    without_listen: number;
  };

  /** Declared holes overlapping the range: a quiet day may be a lost day. */
  gaps_in_range: { from_utc: string; to_utc: string; collector: string; note: string | null }[];
}

// ---------- helpers ----------

const WEEKDAY_LABELS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYPARTS = [
  { part: "night", label: "Night · 00–06" },
  { part: "morning", label: "Morning · 06–12" },
  { part: "afternoon", label: "Afternoon · 12–18" },
  { part: "evening", label: "Evening · 18–24" },
];

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Dense 0…n-1 buckets from a sparse GROUP BY, so a silent hour is a visible zero. */
function densify(rows: { k: number; n: number }[], keys: number[], label: (k: number) => string): Bucket[] {
  const found = new Map(rows.map((r) => [r.k, r.n]));
  return keys.map((k) => ({ key: String(k), label: label(k), n: found.get(k) ?? 0 }));
}

// ---------- the aggregation ----------

/**
 * Everything the Listening page shows, for one account and one filter.
 *
 * Synchronous end to end — see the note at the top of the file before adding an
 * `await` anywhere in here.
 */
export function listeningStats(env: Env, accountId: string, filter: ListeningFilter): ListeningStats {
  const db = env.DB;
  const tz = env.TIMEZONE;

  // The local-clock shift needs the span it will cover. Asking the events table
  // first is one indexed lookup and keeps the DST probing proportional to the
  // history that exists, not to an arbitrary window.
  const span = db
    .prepare(`SELECT MIN(ts_utc) AS lo, MAX(ts_utc) AS hi FROM events WHERE account_id = ?`)
    .get(accountId) as { lo: string | null; hi: string | null };
  const spanFrom = span.lo ? Date.parse(span.lo) : Date.now();
  const spanTo = span.hi ? Date.parse(span.hi) : Date.now();
  const segments = tzSegments(tz, spanFrom, spanTo);
  const localExpr = sqlLocalExpr(segments, "e.ts_utc");

  // --- the scope: non-local filters, bound; local filters applied after the shift
  const where: string[] = ["e.account_id = ?"];
  const params: unknown[] = [accountId];

  // Pre-bounding ts_utc lets idx_events_ts do the work; the exact local-date
  // test happens after the shift. One day of slack on each side covers every
  // offset on earth (UTC-12 … UTC+14).
  if (filter.from) {
    where.push("e.ts_utc >= ?");
    params.push(new Date(utcFromLocal(tz, `${filter.from}T00:00:00`) - 86_400_000).toISOString());
  }
  if (filter.to) {
    where.push("e.ts_utc <= ?");
    params.push(new Date(utcFromLocal(tz, `${filter.to}T23:59:59`) + 86_400_000).toISOString());
  }
  if (filter.q) {
    where.push("(e.title LIKE ? OR e.subtitle LIKE ?)");
    params.push(`%${filter.q}%`, `%${filter.q}%`);
  }
  if (filter.artist) {
    where.push("e.subtitle = ?");
    params.push(filter.artist);
  }
  if (filter.album) {
    where.push("json_extract(e.payload, '$.album') = ?");
    params.push(filter.album);
  }
  if (filter.track) {
    where.push("json_extract(e.payload, '$.track_id') = ?");
    params.push(filter.track);
  }
  if (filter.context) {
    where.push("COALESCE(json_extract(e.payload, '$.context.type'), 'none') = ?");
    params.push(filter.context);
  }
  // Migration 0008 is applied at every container boot, but a dev database that
  // has not run `npm run migrate` yet would otherwise take the whole page down
  // with "no such table: artists". Absent cache = no genre known, which the
  // page already has an honest empty state for.
  const hasArtists =
    db.prepare(`SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = 'artists'`).get() as {
      n: number;
    };
  const genresAvailable = hasArtists.n > 0;

  if (filter.genre && genresAvailable) {
    where.push(
      `EXISTS (SELECT 1
                 FROM json_each(COALESCE(json_extract(e.payload, '$.artist_ids'), '[]')) a,
                      artists ar,
                      json_each(ar.genres) g
                WHERE ar.id = a.value AND g.value = ?)`
    );
    params.push(filter.genre);
  }

  // Local-clock predicates. The values are integers validated by the parser, so
  // they are inlined rather than bound — a bound list would mean rebuilding the
  // placeholder string anyway, and there is nothing here a string could inject.
  const localWhere: string[] = [];
  if (filter.from) localWhere.push(`local_date >= '${filter.from}'`);
  if (filter.to) localWhere.push(`local_date <= '${filter.to}'`);
  if (filter.hours.length) localWhere.push(`hour IN (${filter.hours.join(",")})`);
  if (filter.weekdays.length) localWhere.push(`weekday IN (${filter.weekdays.join(",")})`);
  if (filter.mdays.length) localWhere.push(`mday IN (${filter.mdays.join(",")})`);
  if (filter.months.length) localWhere.push(`month IN (${filter.months.join(",")})`);
  if (filter.years.length) localWhere.push(`year IN (${filter.years.join(",")})`);

  // The type facet is NOT part of the materialisation: the Likes panel needs the
  // likes even when the charts are showing listens only. It is applied per
  // query instead, from a closed set of literals.
  const typeWhere = filter.type === "all" ? "" : `type = '${filter.type}'`;
  const and = (...clauses: string[]) => {
    const kept = clauses.filter(Boolean);
    return kept.length ? `WHERE ${kept.join(" AND ")}` : "";
  };
  const scope = and(typeWhere);

  db.exec(`DROP TABLE IF EXISTS temp.ls`);
  db.prepare(
    `CREATE TEMP TABLE ls AS
     -- datetime() returns a fixed-width 'YYYY-MM-DD HH:MM:SS', so the calendar
     -- parts are substrings. Cheaper than a strftime call each, and this runs
     -- once per row of the history.
     SELECT ts_utc, type, duration_s, title, artist, track_id, album, artist_ids, context, local_dt,
            substr(local_dt, 1, 10)                  AS local_date,
            CAST(substr(local_dt, 12, 2) AS INTEGER) AS hour,
            CAST(substr(local_dt, 6, 2) AS INTEGER)  AS month,
            CAST(substr(local_dt, 9, 2) AS INTEGER)  AS mday,
            CAST(substr(local_dt, 1, 4) AS INTEGER)  AS year,
            -- strftime('%w') is 0 = Sunday; the UI reads Monday-first (ISO).
            ((CAST(strftime('%w', local_dt) AS INTEGER) + 6) % 7) + 1 AS weekday
     FROM (
       SELECT e.ts_utc                                                     AS ts_utc,
              e.type                                                       AS type,
              e.duration_s                                                 AS duration_s,
              e.title                                                      AS title,
              e.subtitle                                                   AS artist,
              json_extract(e.payload, '$.track_id')                        AS track_id,
              json_extract(e.payload, '$.album')                           AS album,
              json_extract(e.payload, '$.artist_ids')                      AS artist_ids,
              COALESCE(json_extract(e.payload, '$.context.type'), 'none')  AS context,
              ${localExpr}                                                 AS local_dt
       FROM events e
       WHERE ${where.join(" AND ")}
     )
     ${localWhere.length ? `WHERE ${localWhere.join(" AND ")}` : ""}`
  ).run(...params);

  try {
    return collect(db, accountId, tz, filter, scope, typeWhere, and, genresAvailable);
  } finally {
    // A throw between the CREATE and here would otherwise leave the scope behind
    // on a connection that lives as long as the process.
    db.exec(`DROP TABLE IF EXISTS temp.ls`);
  }
}

type Db = Env["DB"];

function collect(
  db: Db,
  accountId: string,
  tz: string,
  filter: ListeningFilter,
  scope: string,
  typeWhere: string,
  and: (...clauses: string[]) => string,
  genresAvailable: boolean
): ListeningStats {
  const totalsRow = db
    .prepare(
      `SELECT COUNT(*)                                                      AS events,
              SUM(CASE WHEN type = 'listen' THEN 1 ELSE 0 END)              AS listens,
              SUM(CASE WHEN type = 'like'   THEN 1 ELSE 0 END)              AS likes,
              COUNT(DISTINCT track_id)                                      AS tracks,
              COUNT(DISTINCT artist)                                        AS artists,
              COUNT(DISTINCT album)                                         AS albums,
              SUM(CASE WHEN type = 'listen' THEN COALESCE(duration_s, 0) ELSE 0 END) AS seconds,
              MIN(ts_utc)                                                   AS first_ts,
              MAX(ts_utc)                                                   AS last_ts,
              COUNT(DISTINCT local_date)                                    AS active_days,
              MIN(local_date)                                               AS first_day,
              MAX(local_date)                                               AS last_day
       FROM ls ${scope}`
    )
    .get() as Record<string, number | string | null>;

  const events = Number(totalsRow.events ?? 0);
  const firstDay = totalsRow.first_day as string | null;
  const lastDay = totalsRow.last_day as string | null;
  const spanDays =
    firstDay && lastDay
      ? Math.round((Date.parse(`${lastDay}T00:00:00Z`) - Date.parse(`${firstDay}T00:00:00Z`)) / 86_400_000) + 1
      : 0;
  const activeDays = Number(totalsRow.active_days ?? 0);

  const group = (expr: string): { k: number; n: number }[] =>
    db.prepare(`SELECT ${expr} AS k, COUNT(*) AS n FROM ls ${scope} GROUP BY k`).all() as { k: number; n: number }[];

  const by_hour = densify(group("hour"), [...Array(24).keys()], (h) => `${String(h).padStart(2, "0")}:00`);
  const by_weekday = densify(group("weekday"), [1, 2, 3, 4, 5, 6, 7], (d) => WEEKDAY_LABELS[d - 1]);
  const by_month = densify(group("month"), [...Array(12).keys()].map((i) => i + 1), (m) => MONTH_LABELS[m - 1]);
  const by_day_of_month = densify(group("mday"), [...Array(31).keys()].map((i) => i + 1), (d) => String(d));

  const yearRows = group("year").sort((a, b) => a.k - b.k);
  const by_year: Bucket[] =
    yearRows.length === 0
      ? []
      : densify(
          yearRows,
          Array.from({ length: yearRows[yearRows.length - 1].k - yearRows[0].k + 1 }, (_, i) => yearRows[0].k + i),
          (y) => String(y)
        );

  // --- day and month series
  const dayRows = db
    .prepare(`SELECT local_date AS date, COUNT(*) AS n FROM ls ${scope} GROUP BY date ORDER BY date`)
    .all() as { date: string; n: number }[];

  const by_month_series: Bucket[] = [];
  if (firstDay && lastDay) {
    const monthCounts = new Map<string, number>();
    for (const d of dayRows) {
      const ym = d.date.slice(0, 7);
      monthCounts.set(ym, (monthCounts.get(ym) ?? 0) + d.n);
    }
    // Walk the calendar rather than the data: a month with nothing in it is a
    // fact about the history, and dropping it would draw a continuous line
    // across a hole.
    let y = Number(firstDay.slice(0, 4));
    let m = Number(firstDay.slice(5, 7));
    const endY = Number(lastDay.slice(0, 4));
    const endM = Number(lastDay.slice(5, 7));
    while (y < endY || (y === endY && m <= endM)) {
      const ym = `${y}-${String(m).padStart(2, "0")}`;
      by_month_series.push({ key: ym, label: `${MONTH_LABELS[m - 1].slice(0, 3)} ${y}`, n: monthCounts.get(ym) ?? 0 });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }
  }

  // --- heatmap
  const heatmap: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const r of db
    .prepare(`SELECT weekday AS w, hour AS h, COUNT(*) AS n FROM ls ${scope} GROUP BY w, h`)
    .all() as { w: number; h: number; n: number }[]) {
    heatmap[r.w - 1][r.h] = r.n;
  }

  // --- rankings
  const top_artists = (
    db
      .prepare(
        `SELECT artist AS k, COUNT(*) AS n, COUNT(DISTINCT track_id) AS variety
         FROM ls ${and(typeWhere, "artist IS NOT NULL AND artist <> ''")}
         GROUP BY artist ORDER BY n DESC, artist LIMIT 12`
      )
      .all() as { k: string; n: number; variety: number }[]
  ).map((r) => ({ key: r.k, label: r.k, sub: `${r.variety} track${r.variety === 1 ? "" : "s"}`, n: r.n, variety: r.variety }));

  const top_tracks = (
    db
      .prepare(
        `SELECT COALESCE(track_id, title || ' — ' || artist) AS k,
                MIN(title) AS title, MIN(artist) AS artist, COUNT(*) AS n
         FROM ls ${and(typeWhere, "title IS NOT NULL")}
         GROUP BY k ORDER BY n DESC, title LIMIT 12`
      )
      .all() as { k: string; title: string; artist: string; n: number }[]
  ).map((r) => ({ key: r.k, label: r.title, sub: r.artist, n: r.n, variety: null }));

  const top_albums = (
    db
      .prepare(
        `SELECT album AS k, COUNT(*) AS n, COUNT(DISTINCT track_id) AS variety
         FROM ls ${and(typeWhere, "album IS NOT NULL AND album <> ''")}
         GROUP BY album ORDER BY n DESC, album LIMIT 12`
      )
      .all() as { k: string; n: number; variety: number }[]
  ).map((r) => ({ key: r.k, label: r.k, sub: `${r.variety} track${r.variety === 1 ? "" : "s"}`, n: r.n, variety: r.variety }));

  // --- genres (needs the artists cache — see collectors/artists.ts)
  const genreFrom = `FROM ls l, json_each(COALESCE(l.artist_ids, '[]')) a, artists ar, json_each(ar.genres) g`;
  const genreJoin = `ar.id = a.value`;
  const top_genres = !genresAvailable
    ? []
    : (
        db
          .prepare(
            `SELECT g.value AS k, COUNT(DISTINCT l.rowid) AS n
             ${genreFrom} ${and(typeWhere ? `l.${typeWhere}` : "", genreJoin)}
             GROUP BY k ORDER BY n DESC, k LIMIT 14`
          )
          .all() as { k: string; n: number }[]
      ).map((r) => ({ key: r.k, label: r.k, sub: null, n: r.n, variety: null }));

  const daypartExpr = `CASE WHEN l.hour < 6 THEN 0 WHEN l.hour < 12 THEN 1 WHEN l.hour < 18 THEN 2 ELSE 3 END`;
  const daypartGenreRows = !genresAvailable
    ? []
    : (db
        .prepare(
          `SELECT ${daypartExpr} AS part, g.value AS k, COUNT(DISTINCT l.rowid) AS n
           ${genreFrom} ${and(typeWhere ? `l.${typeWhere}` : "", genreJoin)}
           GROUP BY part, k ORDER BY part, n DESC`
        )
        .all() as { part: number; k: string; n: number }[]);
  const daypartTotals = db
    .prepare(
      `SELECT CASE WHEN hour < 6 THEN 0 WHEN hour < 12 THEN 1 WHEN hour < 18 THEN 2 ELSE 3 END AS part,
              COUNT(*) AS n
       FROM ls ${scope} GROUP BY part`
    )
    .all() as { part: number; n: number }[];
  const genres_by_daypart = DAYPARTS.map((d, i) => ({
    part: d.part,
    label: d.label,
    total: daypartTotals.find((t) => t.part === i)?.n ?? 0,
    genres: daypartGenreRows
      .filter((r) => r.part === i)
      .slice(0, 5)
      .map((r) => ({ key: r.k, label: r.k, sub: null, n: r.n, variety: null })),
  }));

  // Honesty: a genre chart drawn over a half-empty cache is a lie by omission.
  const coverage = !genresAvailable
    ? { rows: events, with_genre: 0 }
    : (db
        .prepare(
          `SELECT COUNT(*) AS rows,
                  SUM(CASE WHEN EXISTS (
                        SELECT 1 FROM json_each(COALESCE(l.artist_ids, '[]')) a, artists ar
                         WHERE ar.id = a.value AND json_array_length(ar.genres) > 0)
                      THEN 1 ELSE 0 END) AS with_genre
           FROM ls l ${scope}`
        )
        .get() as { rows: number; with_genre: number | null });
  const cache = !genresAvailable
    ? { cached: 0, with_genres: 0 }
    : (db
        .prepare(
          `SELECT COUNT(*) AS cached,
                  SUM(CASE WHEN json_array_length(genres) > 0 THEN 1 ELSE 0 END) AS with_genres
           FROM artists`
        )
        .get() as { cached: number; with_genres: number | null });

  const context_mix = (
    db
      .prepare(`SELECT context AS k, COUNT(*) AS n FROM ls ${scope} GROUP BY k ORDER BY n DESC`)
      .all() as { k: string; n: number }[]
  ).map((r) => ({ key: r.k, label: r.k, n: r.n }));

  // --- sessions: consecutive listens separated by less than SESSION_GAP minutes
  const SESSION_GAP_MIN = 30;
  const sessionRows = db
    .prepare(
      `WITH ordered AS (
         SELECT ts_utc, LAG(ts_utc) OVER (ORDER BY ts_utc) AS prev FROM ls WHERE type = 'listen'
       ),
       marked AS (
         SELECT ts_utc,
                CASE WHEN prev IS NULL OR (julianday(ts_utc) - julianday(prev)) * 1440.0 > ${SESSION_GAP_MIN}
                     THEN 1 ELSE 0 END AS starts
         FROM ordered
       ),
       grouped AS (
         SELECT ts_utc, SUM(starts) OVER (ORDER BY ts_utc ROWS UNBOUNDED PRECEDING) AS g FROM marked
       )
       SELECT COUNT(*) AS tracks, MIN(ts_utc) AS started_at, MAX(ts_utc) AS ended_at
       FROM grouped GROUP BY g`
    )
    .all() as { tracks: number; started_at: string; ended_at: string }[];
  const sessionMinutes = sessionRows.map((s) => (Date.parse(s.ended_at) - Date.parse(s.started_at)) / 60_000);
  const longestIdx = sessionRows.reduce(
    (best, s, i) => (s.tracks > (sessionRows[best]?.tracks ?? -1) ? i : best),
    -1
  );
  const sessions = {
    count: sessionRows.length,
    median_minutes: Math.round(median(sessionMinutes)),
    median_tracks: Math.round(median(sessionRows.map((s) => s.tracks))),
    longest:
      longestIdx >= 0
        ? {
            started_at: sessionRows[longestIdx].started_at,
            ended_at: sessionRows[longestIdx].ended_at,
            tracks: sessionRows[longestIdx].tracks,
            minutes: Math.round(sessionMinutes[longestIdx]),
          }
        : null,
  };

  // --- streaks, from the dense day list
  let longest = 0;
  let longestFrom: string | null = null;
  let longestTo: string | null = null;
  let runStart: string | null = null;
  let runLength = 0;
  let previous: string | null = null;
  for (const d of dayRows) {
    const consecutive =
      previous !== null && Date.parse(`${d.date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) === 86_400_000;
    if (consecutive) {
      runLength += 1;
    } else {
      runStart = d.date;
      runLength = 1;
    }
    if (runLength > longest) {
      longest = runLength;
      longestFrom = runStart;
      longestTo = d.date;
    }
    previous = d.date;
  }
  // "Current" only means something if the history runs up to now — and "now"
  // here is the operator's today, not the server's.
  const todayLocal = localDateOf(new Date().toISOString(), tz);
  const current =
    previous && (previous === todayLocal || Date.parse(`${todayLocal}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`) <= 86_400_000)
      ? runLength
      : 0;

  // --- discovery: first time each artist appears in the WHOLE collected
  // history, then counted inside the range. Computed over everything on
  // purpose — an artist first heard in 2023 is not a discovery of this month
  // just because the filter starts there.
  const firstSeen = db
    .prepare(
      `SELECT subtitle AS artist, MIN(ts_utc) AS first_ts
       FROM events WHERE account_id = ? AND type = 'listen' AND subtitle IS NOT NULL AND subtitle <> ''
       GROUP BY subtitle`
    )
    .all(accountId) as { artist: string; first_ts: string }[];
  const scopeArtists = new Set(
    (db.prepare(`SELECT DISTINCT artist FROM ls ${scope}`).all() as { artist: string | null }[])
      .map((r) => r.artist)
      .filter((a): a is string => !!a)
  );
  const firstDayLocal = firstDay ?? null;
  const lastDayLocal = lastDay ?? null;
  const discoveryMonths = new Map<string, number>();
  const newest: RankedItem[] = [];
  for (const r of firstSeen) {
    if (!scopeArtists.has(r.artist)) continue;
    // Same shift as everything else, so a late-night discovery does not land in
    // the previous month.
    const localDate = localDateOf(r.first_ts, tz);
    if (firstDayLocal && localDate < firstDayLocal) continue;
    if (lastDayLocal && localDate > lastDayLocal) continue;
    const ym = localDate.slice(0, 7);
    discoveryMonths.set(ym, (discoveryMonths.get(ym) ?? 0) + 1);
    newest.push({ key: r.artist, label: r.artist, sub: localDate, n: 0, variety: null });
  }
  newest.sort((a, b) => (b.sub ?? "").localeCompare(a.sub ?? ""));
  const discoveries = {
    total: [...discoveryMonths.values()].reduce((a, b) => a + b, 0),
    by_month: by_month_series.map((m) => ({ ...m, n: discoveryMonths.get(m.key) ?? 0 })),
    newest: newest.slice(0, 10),
  };

  // --- repetition
  const repeatDay = db
    .prepare(
      `SELECT local_date AS date, MIN(title) AS title, MIN(artist) AS artist, COUNT(*) AS n
       FROM ls ${and("type = 'listen'", "track_id IS NOT NULL")}
       GROUP BY local_date, track_id ORDER BY n DESC LIMIT 1`
    )
    .get() as { date: string; title: string; artist: string; n: number } | undefined;
  const distinctTracks = Number(totalsRow.tracks ?? 0);
  const repeat = {
    listens_per_track: distinctTracks > 0 ? Number(totalsRow.listens ?? 0) / distinctTracks : 0,
    top_day: repeatDay ?? null,
  };

  // --- likes: always computed, whatever the type facet is showing
  const likeRows = db
    .prepare(`SELECT ts_utc, track_id, hour FROM ls WHERE type = 'like'`)
    .all() as { ts_utc: string; track_id: string | null; hour: number }[];
  const likeDayparts = [0, 0, 0, 0];
  for (const l of likeRows) likeDayparts[l.hour < 6 ? 0 : l.hour < 12 ? 1 : l.hour < 18 ? 2 : 3] += 1;

  let latencies: number[] = [];
  let withoutListen = 0;
  if (likeRows.length > 0) {
    const firstListen = new Map(
      (
        db
          .prepare(
            `SELECT json_extract(payload, '$.track_id') AS track_id, MIN(ts_utc) AS first_ts
             FROM events WHERE account_id = ? AND type = 'listen'
                           AND json_extract(payload, '$.track_id') IS NOT NULL
             GROUP BY track_id`
          )
          .all(accountId) as { track_id: string; first_ts: string }[]
      ).map((r) => [r.track_id, r.first_ts])
    );
    for (const l of likeRows) {
      const first = l.track_id ? firstListen.get(l.track_id) : undefined;
      if (!first) {
        withoutListen += 1;
        continue;
      }
      const hours = (Date.parse(l.ts_utc) - Date.parse(first)) / 3_600_000;
      // A like recorded before any listen we hold says nothing about latency —
      // it means the track was played before collection started, or liked from
      // a search. Counted as "no evidence", never as a negative delay.
      if (hours >= 0) latencies.push(hours);
      else withoutListen += 1;
    }
  }
  latencies = latencies.sort((a, b) => a - b);

  const likes = {
    total: likeRows.length,
    by_daypart: DAYPARTS.map((d, i) => ({ key: d.part, label: d.label, n: likeDayparts[i] })),
    latency_median_hours: latencies.length ? median(latencies) : null,
    latency_sample: latencies.length,
    without_listen: withoutListen,
  };

  // --- declared gaps overlapping the range in view
  const gapWhere = ["account_id = ?"];
  const gapParams: unknown[] = [accountId];
  const rangeLo = totalsRow.first_ts as string | null;
  const rangeHi = totalsRow.last_ts as string | null;
  if (rangeLo && rangeHi) {
    gapWhere.push("to_utc >= ?", "from_utc <= ?");
    gapParams.push(rangeLo, rangeHi);
  }
  const gaps_in_range = db
    .prepare(
      `SELECT collector, from_utc, to_utc, note FROM gaps WHERE ${gapWhere.join(" AND ")}
       ORDER BY from_utc DESC LIMIT 50`
    )
    .all(...gapParams) as ListeningStats["gaps_in_range"];

  return {
    account_id: accountId,
    timezone: tz,
    filter,
    totals: {
      events,
      listens: Number(totalsRow.listens ?? 0),
      likes: Number(totalsRow.likes ?? 0),
      distinct_tracks: distinctTracks,
      distinct_artists: Number(totalsRow.artists ?? 0),
      distinct_albums: Number(totalsRow.albums ?? 0),
      estimated_seconds: Number(totalsRow.seconds ?? 0),
      first_ts: rangeLo,
      last_ts: rangeHi,
      active_days: activeDays,
      span_days: spanDays,
      per_active_day: activeDays > 0 ? events / activeDays : 0,
    },
    by_hour,
    by_weekday,
    by_month,
    by_day_of_month,
    by_year,
    by_month_series,
    by_day: dayRows,
    heatmap,
    top_artists,
    top_tracks,
    top_albums,
    top_genres,
    genres_by_daypart,
    context_mix,
    genre_coverage: {
      rows: coverage.rows,
      with_genre: coverage.with_genre ?? 0,
      artists_cached: cache.cached,
      artists_with_genres: cache.with_genres ?? 0,
    },
    sessions,
    streaks: {
      longest_days: longest,
      longest_from: longestFrom,
      longest_to: longestTo,
      current_days: current,
      silent_days_in_span: Math.max(0, spanDays - activeDays),
    },
    discoveries,
    repeat,
    likes,
    gaps_in_range,
  };
}

/**
 * Local calendar date of a UTC instant, without going back through SQL.
 * Reads the offset directly rather than through `tzSegments`: this is called
 * once per artist, and a per-instant range would thrash that cache.
 */
function localDateOf(tsUtc: string, tz: string): string {
  const ms = Date.parse(tsUtc);
  if (!Number.isFinite(ms)) return tsUtc.slice(0, 10);
  return new Date(ms + offsetMinutesAt(tz, ms) * 60_000).toISOString().slice(0, 10);
}
