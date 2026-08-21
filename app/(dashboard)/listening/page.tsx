import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import {
  type ListeningFilter,
  filterToParams,
  isFilterEmpty,
  listeningStats,
  parseListeningFilter,
} from "@/lib/server/listening";
import { formatDuration, formatTimestamp } from "@/lib/format";
import BarChart from "@/components/listening/BarChart";
import CalendarStrip from "@/components/listening/CalendarStrip";
import FacetChips, { type Facet } from "@/components/listening/FacetChips";
import Heatmap from "@/components/listening/Heatmap";
import RankList from "@/components/listening/RankList";
import StatTile from "@/components/listening/StatTile";
import Icon from "@/components/Icon";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * The Listening page — what the collected history says about the listening
 * itself, as opposed to every other page here, which is about whether the
 * collection is alive.
 *
 * Two decisions run through the whole page.
 *
 * **Every chart is a filter.** Bars, heatmap cells, calendar squares and ranked
 * rows are all links that add their value to the query string; the page
 * re-renders with every other chart restricted to it. That is how the axes
 * cross — "Sunday nights", "techno in the morning", "this artist, by month" —
 * without inventing a query builder. It is plain links and a GET form, so it
 * works with no client JavaScript, survives a reload, and can be bookmarked.
 *
 * **Numbers say how they were made.** Listening time is a sum of full track
 * lengths, sessions are inferred from gaps between plays, "first heard" is
 * first *collected*. Each of those is stated where it is shown, and the method
 * panel at the bottom carries the rest (`PRODUCT.md`: honest about what is
 * inferred).
 */
export default async function ListeningPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const env = getEnv();
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    for (const one of Array.isArray(v) ? v : v === undefined ? [] : [v]) params.append(k, one);
  }

  const accountParam = params.get("account");
  const scope = accountParam || getActiveAccountId(env) || GLOBAL_SCOPE;
  const filter = parseListeningFilter(params);
  const stats = listeningStats(env, scope, filter);
  const { totals } = stats;

  // --- link building: every interactive element is "the current filter, with
  // one thing changed", so there is exactly one place that knows the URL shape.
  const link = (patch: Partial<ListeningFilter>): string => {
    const next = filterToParams({ ...filter, ...patch }, accountParam);
    return next.size ? `/listening?${next}` : "/listening";
  };
  const toggle = (list: number[], value: number): number[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].sort((a, b) => a - b);
  const add = (list: number[], value: number): number[] =>
    list.includes(value) ? list : [...list, value].sort((a, b) => a - b);
  const remove = (list: number[], value: number): number[] => list.filter((v) => v !== value);
  /** A facet that is already on toggles off — clicking the same bar twice undoes it. */
  const toggleOne = (current: string | null, value: string): string | null => (current === value ? null : value);

  const clearHref = accountParam ? `/listening?account=${encodeURIComponent(accountParam)}` : "/listening";

  const facets: Facet[] = [];
  if (filter.type !== "listen") {
    facets.push({
      label: "events",
      value: filter.type === "all" ? "listens and likes" : "likes only",
      removeHref: link({ type: "listen" }),
    });
  }
  if (filter.from) facets.push({ label: "from", value: filter.from, removeHref: link({ from: null }) });
  if (filter.to) facets.push({ label: "to", value: filter.to, removeHref: link({ to: null }) });
  if (filter.q) facets.push({ label: "matching", value: filter.q, removeHref: link({ q: null }) });
  if (filter.artist) facets.push({ label: "artist", value: filter.artist, removeHref: link({ artist: null }) });
  if (filter.album) facets.push({ label: "album", value: filter.album, removeHref: link({ album: null }) });
  if (filter.track) {
    const name = stats.top_tracks.find((t) => t.key === filter.track)?.label ?? filter.track;
    facets.push({ label: "track", value: name, removeHref: link({ track: null }) });
  }
  if (filter.genre) facets.push({ label: "genre", value: filter.genre, removeHref: link({ genre: null }) });
  if (filter.context) facets.push({ label: "played from", value: filter.context, removeHref: link({ context: null }) });
  for (const h of filter.hours) {
    facets.push({
      label: "hour",
      value: `${String(h).padStart(2, "0")}:00`,
      removeHref: link({ hours: toggle(filter.hours, h) }),
    });
  }
  for (const d of filter.weekdays) {
    facets.push({
      label: "weekday",
      value: stats.by_weekday[d - 1].label,
      removeHref: link({ weekdays: toggle(filter.weekdays, d) }),
    });
  }
  for (const d of filter.mdays) {
    facets.push({
      label: "day of month",
      value: String(d),
      removeHref: link({ mdays: toggle(filter.mdays, d) }),
    });
  }
  for (const m of filter.months) {
    facets.push({
      label: "month",
      value: stats.by_month[m - 1].label,
      removeHref: link({ months: toggle(filter.months, m) }),
    });
  }
  for (const y of filter.years) {
    facets.push({ label: "year", value: String(y), removeHref: link({ years: toggle(filter.years, y) }) });
  }

  const unit = filter.type === "like" ? "likes" : filter.type === "all" ? "events" : "listens";
  const coveragePct =
    stats.genre_coverage.rows > 0
      ? Math.round((stats.genre_coverage.with_genre / stats.genre_coverage.rows) * 100)
      : 0;

  return (
    <div className="grid max-w-6xl gap-4">
      {/* ---------------- filter ---------------- */}
      <section className="panel">
        <header>
          <h2>Filter</h2>
          <span className="hint">
            local clock · {stats.timezone}
            {accountParam ? ` · account ${scope || "—"}` : ""}
          </span>
        </header>
        <div className="grid gap-3 p-3">
          <form method="get" className="flex flex-wrap items-center gap-2">
            {accountParam && <input type="hidden" name="account" value={accountParam} />}
            {/* The facets that come from clicking a chart survive a form submit
                only if they are carried through it. */}
            {filter.artist && <input type="hidden" name="artist" value={filter.artist} />}
            {filter.album && <input type="hidden" name="album" value={filter.album} />}
            {filter.track && <input type="hidden" name="track" value={filter.track} />}
            {filter.genre && <input type="hidden" name="genre" value={filter.genre} />}
            {filter.context && <input type="hidden" name="context" value={filter.context} />}
            {filter.hours.length > 0 && <input type="hidden" name="hour" value={filter.hours.join(",")} />}
            {filter.weekdays.length > 0 && <input type="hidden" name="weekday" value={filter.weekdays.join(",")} />}
            {filter.mdays.length > 0 && <input type="hidden" name="mday" value={filter.mdays.join(",")} />}
            {filter.months.length > 0 && <input type="hidden" name="month" value={filter.months.join(",")} />}
            {filter.years.length > 0 && <input type="hidden" name="year" value={filter.years.join(",")} />}

            <select name="type" defaultValue={filter.type} aria-label="Event type" className="field">
              <option value="listen">Listens</option>
              <option value="like">Likes</option>
              <option value="all">Listens and likes</option>
            </select>
            <input
              id="listening-search"
              name="q"
              type="search"
              defaultValue={filter.q ?? ""}
              placeholder="Track or artist contains…"
              aria-label="Track or artist contains"
              className="field min-w-48"
            />
            <label className="flex items-center gap-1.5 text-xs text-[color:var(--ink-2)]">
              from
              <input type="date" name="from" defaultValue={filter.from ?? ""} aria-label="From date" className="field" />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-[color:var(--ink-2)]">
              to
              <input type="date" name="to" defaultValue={filter.to ?? ""} aria-label="To date" className="field" />
            </label>
            <button type="submit" className="btn primary">
              Apply
            </button>
            <a
              href={`/api/listening${filterToParams(filter, accountParam).size ? `?${filterToParams(filter, accountParam)}` : ""}`}
              className="btn ml-auto"
              title="The same numbers as JSON, for the same filter."
            >
              <Icon name="download" className="h-4 w-4" />
              JSON
            </a>
          </form>
          <FacetChips facets={facets} clearHref={clearHref} />
        </div>
      </section>

      {totals.events === 0 ? (
        <section className="panel">
          <div className="empty">
            <Icon name="stats" />
            <h3>Nothing to summarise</h3>
            <p>
              {isFilterEmpty(filter)
                ? "No events have been collected for this account yet. Run the played collector, or check the Overview for why collection is quiet."
                : "No event matches this filter. Widen the dates, or clear the facets above."}
            </p>
            {!isFilterEmpty(filter) && (
              <a href={clearHref} className="btn">
                Clear the filter
              </a>
            )}
          </div>
        </section>
      ) : (
        <>
          {/* ---------------- headline ---------------- */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label={filter.type === "like" ? "Likes" : filter.type === "all" ? "Events" : "Listens"}
              value={totals.events.toLocaleString()}
              sub={`${totals.per_active_day.toFixed(1)} per active day`}
            />
            <StatTile
              label="Estimated time"
              value={formatDuration(totals.estimated_seconds)}
              sub="sum of full track lengths — an upper bound, not measured playtime"
            />
            <StatTile
              label="Distinct tracks"
              value={totals.distinct_tracks.toLocaleString()}
              sub={`${totals.distinct_artists.toLocaleString()} artists · ${totals.distinct_albums.toLocaleString()} albums`}
            />
            <StatTile
              label="Days with something"
              value={`${totals.active_days.toLocaleString()} / ${totals.span_days.toLocaleString()}`}
              sub={
                <>
                  {stats.streaks.silent_days_in_span.toLocaleString()} silent days in the span —{" "}
                  <Link href="/gaps" className="underline">
                    some may be lost, not quiet
                  </Link>
                </>
              }
            />
          </div>

          {/* ---------------- when ---------------- */}
          <section className="panel">
            <header>
              <h2>When you listen</h2>
              <span className="hint">click anything to filter by it</span>
            </header>
            <div className="grid gap-6 p-4">
              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                  Hour of the day
                </figcaption>
                <BarChart
                  buckets={stats.by_hour}
                  selected={filter.hours.map(String)}
                  hrefFor={(k) => link({ hours: toggle(filter.hours, Number(k)) })}
                  unit={unit}
                  tick={(b) => b.key.padStart(2, "0")}
                  labelEvery={3}
                />
              </figure>

              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Day of the week</figcaption>
                <BarChart
                  buckets={stats.by_weekday}
                  selected={filter.weekdays.map(String)}
                  hrefFor={(k) => link({ weekdays: toggle(filter.weekdays, Number(k)) })}
                  unit={unit}
                  tick={(b) => b.label.slice(0, 3)}
                  showValues
                  height="h-20"
                />
              </figure>

              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                  Week × hour — a cell pins both at once
                </figcaption>
                <Heatmap
                  matrix={stats.heatmap}
                  filter={filter}
                  hrefFor={(weekday, hour) => {
                    // A cell is a pair, so it toggles as a pair. Toggling each
                    // axis on its own would UNPIN Sunday when you click a
                    // Sunday cell with Sunday already selected — the opposite
                    // of what clicking a cell means.
                    const pinned = filter.weekdays.includes(weekday) && filter.hours.includes(hour);
                    return pinned
                      ? link({ weekdays: remove(filter.weekdays, weekday), hours: remove(filter.hours, hour) })
                      : link({ weekdays: add(filter.weekdays, weekday), hours: add(filter.hours, hour) });
                  }}
                />
              </figure>
            </div>
          </section>

          {/* ---------------- calendar shape ---------------- */}
          <section className="panel">
            <header>
              <h2>Across the year</h2>
              <span className="hint">every bar is a filter</span>
            </header>
            <div className="grid gap-6 p-4">
              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Month of the year</figcaption>
                <BarChart
                  buckets={stats.by_month}
                  selected={filter.months.map(String)}
                  hrefFor={(k) => link({ months: toggle(filter.months, Number(k)) })}
                  unit={unit}
                  tick={(b) => b.label.slice(0, 3)}
                  showValues
                  height="h-20"
                />
              </figure>
              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                  Day of the month — start of the month against the end of it
                </figcaption>
                <BarChart
                  buckets={stats.by_day_of_month}
                  selected={filter.mdays.map(String)}
                  hrefFor={(k) => link({ mdays: toggle(filter.mdays, Number(k)) })}
                  unit={unit}
                  tick={(b) => b.key}
                  labelEvery={5}
                  height="h-20"
                />
              </figure>
              {stats.by_year.length > 1 && (
                <figure className="min-w-0">
                  <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Year</figcaption>
                  <BarChart
                    buckets={stats.by_year}
                    selected={filter.years.map(String)}
                    hrefFor={(k) => link({ years: toggle(filter.years, Number(k)) })}
                    unit={unit}
                    showValues
                    height="h-20"
                  />
                </figure>
              )}
            </div>
          </section>

          {/* ---------------- over time ---------------- */}
          <section className="panel">
            <header>
              <h2>Over time</h2>
              <span className="hint">
                {stats.by_month_series.length} month{stats.by_month_series.length === 1 ? "" : "s"} in view
              </span>
            </header>
            <div className="grid gap-6 p-4">
              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                  Month by month — an empty column is a month with nothing collected
                </figcaption>
                <BarChart
                  buckets={stats.by_month_series}
                  selected={[]}
                  hrefFor={(k) => link({ from: `${k}-01`, to: monthEnd(k) })}
                  unit={unit}
                  tick={yearTick}
                />
              </figure>
              {totals.first_ts && totals.last_ts && (
                <figure className="min-w-0">
                  <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                    Day by day, most recent 53 weeks of the range
                  </figcaption>
                  <CalendarStrip
                    days={stats.by_day}
                    from={stats.by_day[0]?.date ?? totals.first_ts.slice(0, 10)}
                    to={stats.by_day[stats.by_day.length - 1]?.date ?? totals.last_ts.slice(0, 10)}
                    hrefFor={(date) => link({ from: date, to: date })}
                  />
                </figure>
              )}
              {stats.gaps_in_range.length > 0 && (
                <div className="alert warn">
                  <Icon name="gaps" className="icon h-4 w-4" />
                  <p>
                    {stats.gaps_in_range.length === 1
                      ? "1 declared gap overlaps this range"
                      : `${stats.gaps_in_range.length} declared gaps overlap this range`}{" "}
                    — those days are missing from every number above, and the plays are gone for good.{" "}
                    <Link href="/gaps" className="underline">
                      Review them
                    </Link>
                    .
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* ---------------- what ---------------- */}
          <section className="panel">
            <header>
              <h2>What you play</h2>
              <span className="hint">within the current filter</span>
            </header>
            <div className="grid gap-4 p-4 lg:grid-cols-3">
              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Artists</h3>
                <div className="overflow-clip rounded-lg border border-[color:var(--line)]">
                  <RankList
                    items={stats.top_artists}
                    selected={filter.artist}
                    hrefFor={(k) => link({ artist: toggleOne(filter.artist, k) })}
                    unit={unit}
                    empty="No artist in scope."
                  />
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Tracks</h3>
                <div className="overflow-clip rounded-lg border border-[color:var(--line)]">
                  <RankList
                    items={stats.top_tracks}
                    selected={filter.track}
                    hrefFor={(k) => link({ track: toggleOne(filter.track, k) })}
                    unit={unit}
                    empty="No track in scope."
                  />
                </div>
              </div>
              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Albums</h3>
                <div className="overflow-clip rounded-lg border border-[color:var(--line)]">
                  <RankList
                    items={stats.top_albums}
                    selected={filter.album}
                    hrefFor={(k) => link({ album: toggleOne(filter.album, k) })}
                    unit={unit}
                    empty="No album name in the collected payloads."
                  />
                </div>
              </div>
            </div>
          </section>

          {/* ---------------- genres ---------------- */}
          <section className="panel">
            <header>
              <h2>Kind of music</h2>
              <span className="hint">
                {coveragePct}% of the rows in view have a known genre
              </span>
            </header>
            {stats.genre_coverage.artists_cached === 0 ? (
              <div className="empty">
                <Icon name="info" />
                <h3>No artist has been looked up yet</h3>
                <p>
                  Genres live on Spotify&apos;s artist object, never on a play, so they have to be fetched
                  separately. Run the <code className="font-[family-name:var(--mono)]">artists</code> collector once
                  and this panel fills in — it needs no extra permission.
                </p>
                <Link href="/runs" className="btn">
                  Run it from the Runs page
                </Link>
              </div>
            ) : (
              <div className="grid gap-4 p-4 lg:grid-cols-2">
                <div className="min-w-0">
                  <h3 className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                    Top genres — a play counts once per genre its artists carry
                  </h3>
                  <div className="overflow-clip rounded-lg border border-[color:var(--line)]">
                    <RankList
                      items={stats.top_genres}
                      selected={filter.genre}
                      hrefFor={(k) => link({ genre: toggleOne(filter.genre, k) })}
                      unit={unit}
                      empty="The cached artists carry no genre."
                    />
                  </div>
                </div>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                  {stats.genres_by_daypart.map((part) => (
                    <div key={part.part} className="rounded-lg border border-[color:var(--line)] p-3">
                      <h3 className="text-xs font-medium text-[color:var(--ink)]">{part.label}</h3>
                      <p className="text-xs text-[color:var(--ink-2)]">{part.total.toLocaleString()} {unit}</p>
                      <ul className="mt-2 grid gap-1">
                        {part.genres.map((g) => (
                          <li key={g.key} className="flex items-baseline gap-2 text-xs">
                            <a
                              href={link({ genre: toggleOne(filter.genre, g.key) })}
                              className={
                                "min-w-0 flex-1 truncate hover:underline " +
                                (filter.genre === g.key ? "font-medium text-[color:var(--accent-text)]" : "")
                              }
                            >
                              {g.label}
                            </a>
                            <span className="font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                              {part.total > 0 ? Math.round((g.n / part.total) * 100) : 0}%
                            </span>
                          </li>
                        ))}
                        {part.genres.length === 0 && (
                          <li className="text-xs text-[color:var(--ink-2)]">nothing with a known genre</li>
                        )}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* ---------------- habits ---------------- */}
          <section className="panel">
            <header>
              <h2>Habits</h2>
              <span className="hint">all inferred from the plays — see the method below</span>
            </header>
            <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatTile
                label="Listening sessions"
                value={stats.sessions.count.toLocaleString()}
                sub={`median ${stats.sessions.median_tracks} tracks over ${stats.sessions.median_minutes} min — a run of plays less than 30 min apart`}
              />
              <StatTile
                label="Longest session"
                value={stats.sessions.longest ? `${stats.sessions.longest.tracks} tracks` : "—"}
                sub={
                  stats.sessions.longest
                    ? `${formatDuration(stats.sessions.longest.minutes * 60)} on ${formatTimestamp(stats.sessions.longest.started_at, stats.timezone).slice(0, 10)}`
                    : "no session in scope"
                }
              />
              <StatTile
                label="Longest daily streak"
                value={`${stats.streaks.longest_days} days`}
                sub={
                  stats.streaks.longest_from
                    ? `${stats.streaks.longest_from} → ${stats.streaks.longest_to}${stats.streaks.current_days > 0 ? ` · ${stats.streaks.current_days} day${stats.streaks.current_days === 1 ? "" : "s"} running now` : ""}`
                    : "—"
                }
              />
              <StatTile
                label="Plays per track"
                value={stats.repeat.listens_per_track.toFixed(1)}
                sub={
                  stats.repeat.top_day
                    ? `heaviest day: ${stats.repeat.top_day.n}× “${stats.repeat.top_day.title}” on ${stats.repeat.top_day.date}`
                    : "how often the same track comes back"
                }
              />
            </div>

            <div className="grid gap-4 border-t border-[color:var(--line)] p-4 lg:grid-cols-2">
              <figure className="min-w-0">
                <figcaption className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">
                  Artists heard for the first time — {stats.discoveries.total.toLocaleString()} in this range
                </figcaption>
                <BarChart
                  buckets={stats.discoveries.by_month}
                  selected={[]}
                  hrefFor={(k) => link({ from: `${k}-01`, to: monthEnd(k) })}
                  unit="new artists"
                  tick={yearTick}
                  height="h-20"
                />
                {stats.discoveries.newest.length > 0 && (
                  <p className="mt-2 text-xs text-[color:var(--ink-2)]">
                    Most recent:{" "}
                    {stats.discoveries.newest.slice(0, 5).map((a, i) => (
                      <span key={a.key}>
                        {i > 0 ? ", " : ""}
                        <a href={link({ artist: a.key })} className="underline">
                          {a.label}
                        </a>{" "}
                        <span className="font-[family-name:var(--mono)]">({a.sub})</span>
                      </span>
                    ))}
                  </p>
                )}
              </figure>

              <div className="min-w-0">
                <h3 className="mb-2 text-xs font-medium text-[color:var(--ink-2)]">Played from</h3>
                <div className="overflow-clip rounded-lg border border-[color:var(--line)]">
                  <RankList
                    items={stats.context_mix.map((c) => ({
                      key: c.key,
                      label: c.key === "none" ? "no context reported" : c.key,
                      sub: null,
                      n: c.n,
                      variety: null,
                    }))}
                    selected={filter.context}
                    hrefFor={(k) => link({ context: toggleOne(filter.context, k) })}
                    unit={unit}
                    empty="Spotify reported no context."
                  />
                </div>
                <p className="mt-2 text-xs text-[color:var(--ink-2)]">
                  Where the play came from, as Spotify reports it: a playlist, an album, an artist page, or your
                  library. It is absent on a fair share of plays.
                </p>
              </div>
            </div>
          </section>

          {/* ---------------- likes ---------------- */}
          <section className="panel">
            <header>
              <h2>Likes</h2>
              <span className="hint">independent of the event-type filter above</span>
            </header>
            {stats.likes.total === 0 ? (
              <p className="px-4 py-6 text-sm text-[color:var(--ink-2)]">
                No like was collected inside this range.
              </p>
            ) : (
              <div className="grid gap-3 p-4 sm:grid-cols-3">
                <StatTile
                  label="Likes in range"
                  value={stats.likes.total.toLocaleString()}
                  sub="an unlike removes nothing — the like did happen"
                />
                <StatTile
                  label="First listen → like"
                  value={
                    stats.likes.latency_median_hours === null
                      ? "—"
                      : formatDuration(stats.likes.latency_median_hours * 3600)
                  }
                  sub={`median over ${stats.likes.latency_sample.toLocaleString()} likes${stats.likes.without_listen > 0 ? ` · ${stats.likes.without_listen.toLocaleString()} liked without a collected listen` : ""}`}
                />
                <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3">
                  <p className="text-xs font-medium text-[color:var(--ink-2)]">When you like</p>
                  <ul className="mt-2 grid gap-1">
                    {stats.likes.by_daypart.map((d) => (
                      <li key={d.key} className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">{d.label}</span>
                        <span className="font-[family-name:var(--mono)] text-[color:var(--ink)]">
                          {d.n.toLocaleString()}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </section>

          {/* ---------------- method ---------------- */}
          <section className="panel">
            <header>
              <h2>How these numbers are made</h2>
            </header>
            <div className="grid gap-2 p-4 text-sm text-[color:var(--ink-2)]">
              <p>
                <strong className="text-[color:var(--ink)]">Clock.</strong>{" "}
                Every hour, weekday and month is your
                local clock in <code className="font-[family-name:var(--mono)]">{stats.timezone}</code>, shifted from
                the UTC stored in the database with the offset that applied on the day — a summer play stays in the
                hour you played it.
              </p>
              <p>
                <strong className="text-[color:var(--ink)]">Time listened is an upper bound.</strong>{" "}
                It is the sum of
                the full length of each track played. Spotify reports a play once a track has run for about 30
                seconds, and never says how much of it you actually heard — a track skipped at 40 seconds still
                counts its whole length here.
              </p>
              <p>
                <strong className="text-[color:var(--ink)]">Sessions are inferred</strong>{" "}
                from the plays alone: a new
                one starts after 30 minutes without a play. It is not what the playback collector measures, and
                whether Spotify&apos;s <code className="font-[family-name:var(--mono)]">played_at</code> marks the
                start or the end of a track is still an open question in this project.
              </p>
              <p>
                <strong className="text-[color:var(--ink)]">&ldquo;First heard&rdquo; means first collected.</strong>{" "}
                An artist you have listened to for years shows up as a discovery on the day collection started.
              </p>
              <p>
                <strong className="text-[color:var(--ink)]">Genres come from the artist</strong>, cached by the{" "}
                <code className="font-[family-name:var(--mono)]">artists</code> collector:{" "}
                {stats.genre_coverage.artists_cached.toLocaleString()} artists looked up,{" "}
                {stats.genre_coverage.artists_with_genres.toLocaleString()} of them with at least one genre, covering{" "}
                {coveragePct}% of the rows in view. Spotify has no genre at all for plenty of artists, and a play is
                counted once for each genre its artists carry.
              </p>
              <p>
                <strong className="text-[color:var(--ink)]">A silent day may be a lost day.</strong>{" "}
                Nothing here can
                tell &ldquo;did not listen&rdquo; from &ldquo;was not collected&rdquo;; only the{" "}
                <Link href="/gaps" className="underline">
                  declared gaps
                </Link>{" "}
                can, and only for the windows the poller noticed.
              </p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/**
 * Ticks for a month-by-month axis: the year, once, above its January. Repeating
 * a two-digit month under every few columns labels the axis without saying
 * anything; one anchor per year is what makes a multi-year strip readable.
 */
function yearTick(b: { key: string }, index: number): string {
  // The leftmost column is labelled too, or a range that starts in March and
  // ends in November would carry no tick at all.
  return b.key.slice(5, 7) === "01" || index === 0 ? b.key.slice(0, 4) : "\u00a0";
}

/** Last day of a `YYYY-MM` month — day 0 of the next month. */
function monthEnd(ym: string): string {
  const year = Number(ym.slice(0, 4));
  const month = Number(ym.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
