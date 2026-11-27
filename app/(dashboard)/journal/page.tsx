import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { gapsBetween, gapsByStart, getActiveAccountId, healthSnapshot, journalRuns, journalSummary, runCollectors, statsSnapshot } from "@/lib/server/db";
import { localParts } from "@/lib/server/localtime";
import { shiftDate } from "@/lib/server/trace";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { buildJournal, daySummary, type JournalDay, type JournalGap, type JournalRun } from "@/lib/journal";
import { formatDuration } from "@/lib/format";
import { renderTime } from "@/lib/clock";
import Icon from "@/components/Icon";

/**
 * The Journal (2026-11-27, design lab iteration 2): every collection attempt
 * and every window the poller knows it missed, in one thread, by local day.
 * It replaces Runs, Gaps and Stats, which each held part of it (`/runs`,
 * `/gaps` and `/stats` redirect here). The merge is lib/journal.ts; the side
 * card carries what Stats showed — the counts — beside the thread they sum up.
 *
 * Everything is a link (collector filter, "Gaps only", paging): no client
 * JavaScript, and ?account= survives every one of them.
 */
const LIMIT = 60;
const RUN_TONE: Record<string, "ok" | "warn" | "bad"> = { ok: "ok", partial: "warn", error: "bad" };
const RUN_WORD: Record<string, string> = { ok: "ok", partial: "partial", error: "failed" };

function hhmm(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
}

/** "Today, Thu 27 Nov" / "Yesterday, …" / "Tue 25 Nov" — a calendar date, so formatted in UTC from its noon. */
function dayLabel(date: string, today: string): string {
  const d = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short" }).format(new Date(`${date}T12:00:00Z`));
  if (date === today) return `Today, ${d}`;
  if (date === shiftDate(today, -1)) return `Yesterday, ${d}`;
  return d;
}

function RunLine({ run, tz }: { run: JournalRun; tz: string }) {
  const tone = run.status ? RUN_TONE[run.status] : "warn";
  // Three cells on every width; the middle one stacks collector over counts
  // in a narrow thread and lays them side by side from @xl of the thread.
  return (
    <li className="grid grid-cols-[3.25rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-t border-[color:var(--line)] px-1 py-2.5 text-sm">
      <span className="font-[family-name:var(--mono)] text-[13px]">{hhmm(run.started_at, tz)}</span>
      <span className="flex min-w-0 flex-col @xl:flex-row @xl:items-baseline @xl:gap-3">
        <span className="shrink-0 font-semibold @xl:w-[5.5rem]">{run.collector}</span>
        <span className="min-w-0 text-[color:var(--ink-2)]">
          {run.items_fetched} fetched · {run.items_inserted} new
          {run.trigger_kind !== "cron" && <span className="font-[family-name:var(--mono)] text-xs"> · {run.trigger_kind}</span>}
          {run.error && (
            <span className="block truncate font-[family-name:var(--mono)] text-xs" title={run.error}>
              {run.error}
            </span>
          )}
        </span>
      </span>
      <span className={`flex items-center justify-end gap-1.5 font-[family-name:var(--mono)] text-xs tone-${tone}`}>
        <span aria-hidden className={`voyant ${tone}`} />
        {run.status ? RUN_WORD[run.status] : "unfinished"}
      </span>
    </li>
  );
}

function GapLine({ gap, tz }: { gap: JournalGap; tz: string }) {
  const seconds = (Date.parse(gap.to_utc) - Date.parse(gap.from_utc)) / 1000;
  return (
    <li className="my-1 grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-3 rounded-[14px] bg-[color:var(--warn-soft)] px-1 py-3 text-sm">
      <span className="font-[family-name:var(--mono)] text-[13px]">{hhmm(gap.from_utc, tz)}</span>
      <span className="flex min-w-0 flex-col gap-1">
        <span className="flex items-center gap-2.5 font-semibold">
          <span aria-hidden className="gap-dash" />
          Needle lifted · {formatDuration(seconds)}
        </span>
        <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--warn-text)]">
          {hhmm(gap.from_utc, tz)} → {hhmm(gap.to_utc, tz)} · {gap.collector} · declared
          {gap.note ? ` · ${gap.note}` : ""}
        </span>
      </span>
    </li>
  );
}

export default async function JournalPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; account?: string; collector?: string; gaps?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const tz = env.TIMEZONE;
  const now = renderTime();
  const scope = sp.account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const collectors = runCollectors(env, scope);
  const collector = sp.collector && collectors.includes(sp.collector) ? sp.collector : null;
  const gapsOnly = sp.gaps === "1";
  const offset = Math.max(0, Math.floor(Number(sp.offset)) || 0);

  let days: JournalDay[];
  let total: number;
  if (gapsOnly) {
    const page = gapsByStart(env, scope, collector, LIMIT, offset);
    total = page.total;
    days = buildJournal([], page.items as JournalGap[], tz);
  } else {
    const page = journalRuns(env, scope, collector, LIMIT, offset);
    total = page.total;
    days = buildJournal(page.items as JournalRun[], gapsBetween(env, scope, collector, page.window.from, page.window.to) as JournalGap[], tz);
  }

  const week = journalSummary(env, scope, new Date(now - 7 * 86_400_000).toISOString());
  const stats = statsSnapshot(env, scope);
  const byType = Object.entries(healthSnapshot(env, scope).events_by_type);
  const today = localParts(tz, now).date;

  // Every link keeps the others' state: account, collector, gaps-only.
  const href = (over: { collector?: string | null; gaps?: boolean; offset?: number }) => {
    const p = new URLSearchParams();
    if (sp.account) p.set("account", sp.account);
    const c = over.collector === undefined ? collector : over.collector;
    if (c) p.set("collector", c);
    if (over.gaps ?? gapsOnly) p.set("gaps", "1");
    if (over.offset) p.set("offset", String(over.offset));
    const q = p.toString();
    return `/journal${q ? `?${q}` : ""}`;
  };

  return (
    // The query container is the wrapper, not the grid: an element cannot
    // query its own width, so @4xl on the grid itself would read the next
    // container up (none) and the aside would never move beside the thread.
    <div className="@container max-w-6xl">
      <div className="grid gap-4 md:gap-5 @4xl:grid-cols-[minmax(0,1fr)_19rem] @4xl:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <nav aria-label="Collector" className="subnav">
              <Link href={href({ collector: null, offset: 0 })} aria-current={!collector ? "page" : undefined}>
                All
              </Link>
              {collectors.map((c) => (
                <Link key={c} href={href({ collector: c, offset: 0 })} aria-current={collector === c ? "page" : undefined}>
                  {c}
                </Link>
              ))}
            </nav>
            <Link href={href({ gaps: !gapsOnly, offset: 0 })} aria-pressed={gapsOnly} className={`btn ${gapsOnly ? "outline" : ""}`}>
              <span aria-hidden className="gap-dash sm" />
              Gaps only
            </Link>
          </div>

          <section className="@container panel px-4 pb-3 sm:px-5">
            {days.map((d) => (
              <div key={d.date}>
                <h2 className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 pb-1.5 pt-4">
                  <span className="text-base font-bold">{dayLabel(d.date, today)}</span>
                  <span className="font-[family-name:var(--mono)] text-xs font-normal text-[color:var(--ink-2)]">{daySummary(d)}</span>
                </h2>
                <ul className="flex flex-col">
                  {d.entries.map((e) =>
                    e.kind === "run" ? <RunLine key={`r${e.run.id}`} run={e.run} tz={tz} /> : <GapLine key={`g${e.gap.id}`} gap={e.gap} tz={tz} />
                  )}
                </ul>
              </div>
            ))}
            {days.length === 0 && (
              <div className="empty">
                <Icon name={gapsOnly ? "check" : "runs"} className="h-6 w-6" />
                <h3>{gapsOnly ? "No declared gaps" : "No runs recorded"}</h3>
                <p>
                  {gapsOnly
                    ? "Every window the poller was responsible for is covered."
                    : "Every collection attempt is logged here, successful or not."}
                </p>
              </div>
            )}
            {total > LIMIT && (
              <footer className="mt-2 flex items-center gap-3 border-t border-[color:var(--line)] pt-3 text-sm">
                <Link href={href({ offset: Math.max(0, offset - LIMIT) })} className="btn sm" aria-disabled={offset === 0}>
                  ← Newer
                </Link>
                <Link href={href({ offset: offset + LIMIT })} className="btn sm" aria-disabled={offset + LIMIT >= total}>
                  Older →
                </Link>
                <span className="ml-auto font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                  {gapsOnly ? "gaps" : "runs"} {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
                </span>
              </footer>
            )}
          </section>
          <p className="px-1 text-sm text-[color:var(--ink-2)]">
            A gap is a window the poller knows it did not cover. Declaring it beats an empty day that silently reads as
            &quot;listened to nothing&quot;.
          </p>
        </div>

        <aside className="grid gap-4 sm:grid-cols-2 @4xl:grid-cols-1">
          <section className="flex flex-col gap-2.5 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4">
            <span className="menu-label">Last 7 days</span>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-[family-name:var(--display)] text-3xl font-bold tracking-[-0.03em]">{week.runs.toLocaleString()}</span>
              <span className="text-sm text-[color:var(--ink-2)]">
                run{week.runs === 1 ? "" : "s"}
                {week.ok ? ` · ${week.ok} ok` : ""}
                {week.partial ? ` · ${week.partial} partial` : ""}
                {week.error ? ` · ${week.error} failed` : ""}
                {week.unfinished ? ` · ${week.unfinished} unfinished` : ""}
              </span>
            </p>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className={`font-[family-name:var(--display)] text-3xl font-bold tracking-[-0.03em] ${week.gaps ? "tone-warn" : ""}`}>{week.gaps}</span>
              <span className="text-sm text-[color:var(--ink-2)]">
                declared gap{week.gaps === 1 ? "" : "s"}
                {week.gaps ? ` · ${formatDuration(week.gapSeconds)} in all` : ""}
              </span>
            </p>
          </section>
          <section className="flex flex-col gap-2 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4 text-sm">
            <span className="menu-label">Stored</span>
            <p className="flex justify-between gap-3">
              <span>Events</span>
              <span className="font-[family-name:var(--mono)]">{stats.event_rows.toLocaleString()}</span>
            </p>
            {byType.length > 1 && (
              <p className="flex justify-between gap-3 text-[color:var(--ink-2)]">
                <span>{byType.map(([k]) => k).join(" · ")}</span>
                <span className="font-[family-name:var(--mono)]">{byType.map(([, n]) => n.toLocaleString()).join(" · ")}</span>
              </p>
            )}
            <p className="flex justify-between gap-3">
              <span>Raw API rows</span>
              <span className="font-[family-name:var(--mono)]">{stats.raw_rows.toLocaleString()}</span>
            </p>
            <p className="text-xs leading-snug text-[color:var(--ink-2)]">
              Events are the interpreted rows the export carries; raw rows are Spotify&apos;s answers, kept before interpretation.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}
