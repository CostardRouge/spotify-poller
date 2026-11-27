import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listGaps } from "@/lib/server/db";
import { lastLocalDays, traceDays } from "@/lib/server/trace";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import { renderTime } from "@/lib/clock";
import Icon from "@/components/Icon";
import TraceStrip, { shortDateOf, traceLabel, weekdayOf } from "@/components/TraceStrip";

type Gap = { id: number; collector: string; from_utc: string; to_utc: string; note: string | null };

/**
 * The Trace — the history as the pen drew it, one strip per local day, seven
 * days a page (the design lab's "Sismo" strips, kept in Témoin). It answers
 * the custody question by eye: a quiet stretch is a flat line, a window the
 * poller missed is a dashed amber segment, and the two can never be confused.
 *
 * `?week=N` walks back N weeks; the links are plain hrefs, no client script.
 */
export default async function TracePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string; account?: string }>;
}) {
  const { week: weekParam, account } = await searchParams;
  const env = getEnv();
  const scope = account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const week = Math.max(0, Math.min(520, Number.parseInt(weekParam ?? "0", 10) || 0));
  const now = renderTime();
  const days = traceDays(env, scope, env.TIMEZONE, now, 7, week).reverse();
  const plays = days.reduce((n, d) => n + d.total, 0);
  const gapCount = days.reduce((n, d) => n + d.gaps.length, 0);
  const first = days[days.length - 1];
  const last = days[0];
  // The gaps drawn on this page, listed below it: those overlapping its local days.
  const bounds = lastLocalDays(env.TIMEZONE, now, 7, week);
  const fromMs = bounds[0].startMs;
  const toMs = bounds[bounds.length - 1].endMs;
  const gaps = (listGaps(env, scope, 200, 0).items as Gap[]).filter(
    (g) => Date.parse(g.to_utc) > fromMs && Date.parse(g.from_utc) < toMs
  );
  const href = (w: number) => {
    const p = new URLSearchParams();
    if (w > 0) p.set("week", String(w));
    if (account) p.set("account", account);
    const q = p.toString();
    return q ? `/trace?${q}` : "/trace";
  };

  return (
    <div className="grid max-w-5xl gap-4 md:gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[1.75rem] font-bold leading-none tracking-[-0.04em]">
            {week === 0 ? "This week" : `${shortDateOf(first.date)} – ${shortDateOf(last.date)}`}
          </h2>
          <span className="font-[family-name:var(--mono)] text-[13px] text-[color:var(--ink-2)]">
            {plays.toLocaleString()} plays · {gapCount} declared gap{gapCount === 1 ? "" : "s"}
          </span>
        </div>
        <nav aria-label="Weeks" className="flex gap-1.5">
          <Link href={href(week + 1)} className="btn icon-only" aria-label="Previous week">
            <Icon name="chevron-left" className="h-4 w-4" />
          </Link>
          {week > 0 ? (
            <Link href={href(week - 1)} className="btn icon-only" aria-label="Next week">
              <Icon name="chevron-right" className="h-4 w-4" />
            </Link>
          ) : (
            <span className="btn icon-only" aria-disabled="true" aria-label="Next week (this is the current week)">
              <Icon name="chevron-right" className="h-4 w-4" />
            </span>
          )}
        </nav>
      </div>

      <section className="rounded-[22px] border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3 md:px-6 md:py-4">
        <div className="grid grid-cols-[48px_minmax(0,1fr)] items-center gap-x-2 md:grid-cols-[72px_minmax(0,1fr)_84px]">
          <span />
          <div className="flex justify-between font-[family-name:var(--mono)] text-[11px] text-[color:var(--ink-2)]" aria-hidden>
            <span>00</span>
            <span>06</span>
            <span>12</span>
            <span>18</span>
            <span>24</span>
          </div>
          <span className="hidden md:block" />
          {days.map((d) => (
            <div key={d.date} className="contents">
              <span className="flex flex-col border-t border-[color:var(--line)] py-1.5">
                <span className="text-[13px] font-semibold">{weekdayOf(d.date)}</span>
                <span className="font-[family-name:var(--mono)] text-[11px] text-[color:var(--ink-2)]">{shortDateOf(d.date)}</span>
              </span>
              <div className="border-t border-[color:var(--line)] py-1.5">
                <TraceStrip day={d} height={44} label={traceLabel(d)} />
              </div>
              <span className="hidden border-t border-[color:var(--line)] py-1.5 text-right font-[family-name:var(--mono)] text-xs leading-[44px] text-[color:var(--ink-2)] md:block">
                {d.until === 0 ? "—" : `${d.total} ${d.until < 96 ? "so far" : "plays"}`}
              </span>
            </div>
          ))}
        </div>
      </section>
      <p className="text-xs text-[color:var(--ink-2)]">
        One swing per quarter hour, taller with more plays · a dashed amber stretch is a window the poller declared it did
        not cover · days are local ({env.TIMEZONE}).
      </p>

      {gaps.length > 0 && (
        <section className="flex flex-col gap-2">
          {gaps.map((g) => (
            <Link
              key={g.id}
              href="/journal?gaps=1"
              className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3 rounded-[18px] bg-[color:var(--warn-soft)] px-4 py-3.5"
            >
              <span className="gap-dash" aria-hidden />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-sm font-semibold">
                  Needle lifted · {formatTimestamp(g.from_utc, env.TIMEZONE)} → {formatTimestamp(g.to_utc, env.TIMEZONE)}
                </span>
                <span className="text-[13px] text-[color:var(--ink-2)]">
                  {g.collector}
                  {g.note ? ` · ${g.note}` : ""} · declared, not silent
                </span>
              </span>
              <span aria-hidden>→</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
