import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, healthSnapshot, statsSnapshot } from "@/lib/server/db";
import { schedulerEnabled, schedulerOptionsFromProcess } from "@/lib/server/scheduler";
import { authStatus } from "@/lib/server/spotify/auth";
import { getRateLimit } from "@/lib/server/spotify/api";
import { pollsToday, traceDays } from "@/lib/server/trace";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp, relativeFromNow } from "@/lib/format";
import { ago, verdict } from "@/lib/verdict";
import { renderTime } from "@/lib/clock";
import Row, { RowTone } from "@/components/Row";
import RunNowButton from "@/components/RunNowButton";
import TraceStrip, { traceLabel, weekdayOf } from "@/components/TraceStrip";

type RecentRun = {
  collector: string;
  trigger_kind: string;
  started_at: string;
  status: "ok" | "partial" | "error";
  items_fetched: number;
  items_inserted: number;
};

type Gap = { id: number; collector: string; from_utc: string; to_utc: string; note: string | null };

const RUN_TONE: Record<RecentRun["status"], "ok" | "warn" | "bad"> = { ok: "ok", partial: "warn", error: "bad" };

/** Same freshness bands as the old UI: ok within the expected window, warn to 4×, bad past that. */
function freshness(iso: string | null, expectedMs: number): RowTone {
  if (!iso) return "none";
  const age = Date.now() - Date.parse(iso);
  if (age <= expectedMs) return "ok";
  if (age <= expectedMs * 4) return "warn";
  return "bad";
}

const FRESH_WORD: Record<string, string> = { ok: "on time", warn: "late", bad: "stale", none: "never" };

/** "in 23 min" / "due now" — when the in-process scheduler should poll next. */
function nextPoll(lastSuccess: string | null, everyMinutes: number, nowMs: number): string {
  if (!lastSuccess) return "due now";
  const due = Date.parse(lastSuccess) + everyMinutes * 60_000;
  const m = Math.ceil((due - nowMs) / 60_000);
  return m <= 0 ? "due now" : `in ${m} min`;
}

/** The hours under every trace: the strip is a local day, midnight to midnight. */
function HourAxis() {
  return (
    <div className="flex justify-between font-[family-name:var(--mono)] text-[11px] text-[color:var(--ink-2)]" aria-hidden>
      <span>00</span>
      <span>06</span>
      <span>12</span>
      <span>18</span>
      <span>24</span>
    </div>
  );
}

/**
 * The Overview — Témoin's "now" (the design lab's fusion, 2026-11-27).
 *
 * Order of reading, on every viewport: the voyant and one sentence (healthy or
 * not, in under two seconds), what to do about it, then the evidence — today's
 * trace on a phone, the dial and the week on a desk — and the details last.
 * The verdict comes from lib/verdict.ts, the same tree the top bar uses on
 * every other page, so the two can never disagree.
 */
export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; auth_error?: string; account?: string }>;
}) {
  const { connected, auth_error, account } = await searchParams;
  const env = getEnv();
  const now = renderTime();
  const scope = account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const health = healthSnapshot(env, scope);
  const stats = statsSnapshot(env, scope);
  const sched = schedulerEnabled() ? schedulerOptionsFromProcess() : null;
  const auth = authStatus(env);
  const rate = getRateLimit(env);
  const tz = env.TIMEZONE;

  const active = auth.accounts.find((a) => a.id === auth.active_account_id);
  const v = verdict(
    {
      playedLastSuccess: health.collector_played_last_success,
      connected: auth.connected,
      activeRevoked: active?.status === "revoked",
      rateLimitedUntil: rate.limited ? rate.until : null,
      playedEveryMinutes: sched?.playedEveryMinutes ?? null,
    },
    now
  );

  const week = traceDays(env, scope, tz, now, 7);
  const today = week[week.length - 1];
  const polls = pollsToday(env, scope, tz, now);
  const weekPlays = week.reduce((n, d) => n + d.total, 0);

  const expPlayed = (sched ? sched.playedEveryMinutes * 3 : 90) * 60_000;
  const expLiked = (sched ? sched.likedEveryHours * 1.5 : 36) * 3_600_000;
  const collectors = [
    { id: "played", iso: health.collector_played_last_success, cadence: sched ? `every ${sched.playedEveryMinutes} min` : "systemd timer", tone: freshness(health.collector_played_last_success, expPlayed) },
    { id: "liked", iso: health.collector_liked_last_success, cadence: sched ? `every ${sched.likedEveryHours} h` : "systemd timer", tone: freshness(health.collector_liked_last_success, expLiked) },
    ...(health.playback.enabled
      ? [{ id: "playback", iso: health.playback.last_success, cadence: "every 15 s while playing", tone: freshness(health.playback.last_success, 15 * 60_000) }]
      : []),
  ];

  const byType = Object.entries(health.events_by_type)
    .map(([k, n]) => `${k} ${n.toLocaleString()}`)
    .join(" · ");
  const gaps = stats.gaps as Gap[];
  const recentRuns = (stats.last_20_runs as RecentRun[]).slice(0, 5);
  const latestGap = gaps[0];

  // The dial: one tick per poll where it happened, hour marks for the rest of
  // the day, and the pen at "now". Angles are fractions of the LOCAL day.
  const nowFrac = today.until / 96;
  const dial = [
    ...Array.from({ length: 24 }, (_, h) => ({ deg: h * 15, cls: "bg-[color:var(--line-strong)]", len: h % 6 === 0 ? 14 : 8 })),
    ...polls.polls.map((p) => ({ deg: p.at * 360, cls: p.ok ? "bg-[color:var(--ink)]" : "bg-[color:var(--warn)]", len: 14 })),
    { deg: nowFrac * 360, cls: "bg-[color:var(--pen)]", len: 22 },
  ];

  const lastLine = `Last poll ${ago(health.collector_played_last_success, now)}${sched ? ` · next ${nextPoll(health.collector_played_last_success, sched.playedEveryMinutes, now)}` : ""}`;

  return (
    <div className="grid max-w-6xl gap-4 md:gap-5">
      {connected && (
        <div role="status" className="alert">
          <p>
            Account <strong>{connected}</strong> connected — collection targets it from the next run.
          </p>
        </div>
      )}
      {auth_error && (
        <div role="alert" className="alert bad">
          <p>
            Spotify connection failed: <code className="font-[family-name:var(--mono)]">{auth_error}</code>. Try
            again from the Accounts page.
          </p>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] md:gap-5">
        {/* The verdict. On a phone it sits on the paper itself; on a desk it is a sheet. */}
        <section className="flex min-w-0 flex-col gap-3 pt-2 md:rounded-[24px] md:border md:border-[color:var(--line)] md:bg-[color:var(--surface)] md:p-8">
          <div className="flex items-center gap-2.5">
            <span aria-hidden className={`voyant lg ${v.tone}`} />
            <span className={`text-sm font-semibold tone-${v.tone}`}>{v.text}</span>
          </div>
          <h1 className="text-[2.5rem] font-bold leading-[1.02] tracking-[-0.04em] text-[color:var(--ink)] md:text-[3.25rem]">
            {v.headline}
          </h1>
          <p className="font-[family-name:var(--mono)] text-sm text-[color:var(--ink-2)]">
            {v.tone === "ok" ? lastLine : v.why}
          </p>
          <div className="mt-2 flex flex-wrap gap-2.5">
            <RunNowButton collector="played" label="Run played now" variant={v.tone === "ok" ? "outline" : "primary"} />
            <RunNowButton collector="liked" label="Run liked" variant="outline" />
            {/* Wrapped: .btn sets its own display, unlayered, so a `hidden` on
                the link itself would lose to it. The phone exports from Library. */}
            <span className="hidden md:inline">
              <a href="/api/export" className="btn lg">
                Export NDJSON
              </a>
            </span>
          </div>
        </section>

        {/* Desk: the dial of today's polls, and the collectors with their own Run now. */}
        <section className="hidden min-w-0 items-center gap-6 rounded-[24px] border border-[color:var(--line)] bg-[color:var(--surface)] p-6 md:grid md:grid-cols-[176px_minmax(0,1fr)]">
          <div className="relative h-44 w-44" role="img" aria-label={`${polls.ok} successful polls today${polls.failed ? `, ${polls.failed} failed` : ""}`}>
            {dial.map((t, i) => (
              <span
                key={i}
                aria-hidden
                className={`absolute left-1/2 top-0 w-[2px] rounded-full ${t.cls}`}
                style={{ height: t.len, transformOrigin: "1px 88px", transform: `translateX(-50%) rotate(${t.deg}deg)` }}
              />
            ))}
            <div className="absolute inset-9 flex flex-col items-center justify-center text-center">
              <span className="font-[family-name:var(--display)] text-3xl font-bold tracking-[-0.03em]">{polls.ok}</span>
              <span className="text-xs text-[color:var(--ink-2)]">{polls.ok === 1 ? "poll" : "polls"} today</span>
              {polls.failed > 0 && <span className="mt-1 font-[family-name:var(--mono)] text-xs tone-warn">{polls.failed} failed</span>}
            </div>
          </div>
          <div className="flex min-w-0 flex-col">
            {collectors.map((c, i) => (
              <div key={c.id} className={`flex items-center justify-between gap-3 py-2.5 ${i ? "border-t border-[color:var(--line)]" : ""}`}>
                <div className="flex min-w-0 flex-col">
                  <span className="text-sm font-semibold capitalize">{c.id}</span>
                  <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                    {c.iso ? relativeFromNow(c.iso) : "never"} · <span className={`tone-${c.tone === "none" ? "warn" : c.tone}`}>{FRESH_WORD[c.tone ?? "none"]}</span>
                  </span>
                </div>
                <RunNowButton collector={c.id} />
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Phone: today as the pen drew it, then the collectors in one row. */}
      <section className="flex flex-col gap-2.5 rounded-[22px] border border-[color:var(--line)] bg-[color:var(--surface)] p-4 md:hidden">
        <div className="flex items-baseline justify-between">
          <h2 className="text-base font-bold">Today</h2>
          <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
            {today.total} plays · {polls.ok} {polls.ok === 1 ? "poll" : "polls"}{polls.failed ? ` · ${polls.failed} failed` : ""}
          </span>
        </div>
        <TraceStrip day={today} height={88} label={traceLabel(today)} />
        <HourAxis />
      </section>
      <div
        className="grid border-y border-[color:var(--line-strong)] md:hidden"
        style={{ gridTemplateColumns: `repeat(${Math.min(3, collectors.length)}, minmax(0, 1fr))` }}
      >
        {collectors.slice(0, 3).map((c, i) => (
          <div key={c.id} className={`flex flex-col gap-0.5 px-1.5 py-3 ${i ? "border-l border-[color:var(--line-strong)]" : ""}`}>
            <span className="text-[13px] font-semibold capitalize">{c.id}</span>
            <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">{c.iso ? relativeFromNow(c.iso) : "never"}</span>
          </div>
        ))}
      </div>
      <Link href="/trace" className="flex items-center justify-between px-1.5 py-1 text-sm md:hidden">
        <span>
          <strong>{weekPlays.toLocaleString()}</strong> plays this week · <strong>{week.reduce((n, d) => n + d.gaps.length, 0)}</strong> declared gap
          {week.reduce((n, d) => n + d.gaps.length, 0) === 1 ? "" : "s"}
        </span>
        <span aria-hidden>→</span>
      </Link>

      {/* Desk: the week, one strip per day. */}
      <section className="hidden rounded-[24px] border border-[color:var(--line)] bg-[color:var(--surface)] px-6 py-5 md:block">
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-bold">The week, as a trace</h2>
          <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
            {weekPlays.toLocaleString()} plays · dashed = needle lifted, declared
          </span>
        </div>
        <div className="mt-2 grid grid-cols-[52px_minmax(0,1fr)_84px] items-center">
          <span />
          <HourAxis />
          <span />
          {week.map((d) => (
            <div key={d.date} className="contents">
              <span className="border-t border-[color:var(--line)] py-1 text-[13px] font-semibold">{weekdayOf(d.date)}</span>
              <div className="border-t border-[color:var(--line)] py-1">
                <TraceStrip day={d} height={34} label={traceLabel(d)} />
              </div>
              <span className="border-t border-[color:var(--line)] py-1 text-right font-[family-name:var(--mono)] text-xs leading-[34px] text-[color:var(--ink-2)]">
                {d.total} {d.until < 96 ? "so far" : "plays"}
              </span>
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <section className="panel">
          <header>
            <h2>Recent runs</h2>
            <Link href="/runs" className="hint underline">
              all runs
            </Link>
          </header>
          <div className="flex flex-col px-4 py-1">
            {recentRuns.map((r, i) => (
              <div key={`${r.started_at}-${i}`} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-2.5 text-sm ${i ? "border-t border-[color:var(--line)]" : ""}`}>
                <div className="flex min-w-0 flex-col">
                  <span>
                    <span className="font-semibold">{r.collector}</span>{" "}
                    <span className="text-[color:var(--ink-2)]">
                      {r.items_fetched} fetched · {r.items_inserted} new
                    </span>
                  </span>
                  <span className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                    {formatTimestamp(r.started_at, tz)} · {r.trigger_kind}
                  </span>
                </div>
                <span className={`flex items-center gap-1.5 font-[family-name:var(--mono)] text-xs tone-${RUN_TONE[r.status]}`}>
                  <span aria-hidden className={`voyant ${RUN_TONE[r.status]}`} />
                  {r.status}
                </span>
              </div>
            ))}
            {recentRuns.length === 0 && <p className="py-6 text-center text-sm text-[color:var(--ink-2)]">No runs logged yet.</p>}
          </div>
        </section>

        {latestGap ? (
          <section className="flex flex-col gap-2 rounded-[20px] bg-[color:var(--warn-soft)] px-5 py-4">
            <div className="flex items-center gap-2.5">
              <span className="gap-dash" aria-hidden />
              <h2 className="text-base font-bold">
                {gaps.length} declared gap{gaps.length === 1 ? "" : "s"}
              </h2>
            </div>
            <p className="font-[family-name:var(--mono)] text-xs">
              Latest: {formatTimestamp(latestGap.from_utc, tz)} → {formatTimestamp(latestGap.to_utc, tz)} · {latestGap.collector}
              {latestGap.note ? ` · ${latestGap.note}` : ""}
            </p>
            <p className="text-sm leading-relaxed text-[color:var(--ink-2)]">
              Plays from a gap are recovered on the next poll if they were still among your last 50. The window stays
              declared, so an empty stretch never reads as silence.
            </p>
            <Link href="/gaps" className="btn sm mt-auto self-start">
              Review
            </Link>
          </section>
        ) : (
          <section className="flex flex-col justify-center gap-1 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4">
            <h2 className="text-base font-bold">No declared gap</h2>
            <p className="text-sm text-[color:var(--ink-2)]">No window is known to be missing.</p>
          </section>
        )}
      </div>

      {/* The details: everything the old Overview showed, kept, below the fold. */}
      <div className="grid gap-4 md:grid-cols-2 md:gap-5">
        <section className="panel">
          <header>
            <h2>Stored data</h2>
            <span className="hint">account {scope || "—"}</span>
          </header>
          <div className="rows">
            <Row tone={null} label="Events" value={stats.event_rows.toLocaleString()} sub={byType || "no events yet"} />
            <Row tone={null} label="Raw API rows" value={stats.raw_rows.toLocaleString()} sub="Untouched Spotify responses, kept for replay." />
            {!health.playback.enabled && (
              <Row
                tone="none"
                label="Playback"
                value="Disabled"
                sub={
                  <>
                    Opt-in: set <code className="font-[family-name:var(--mono)]">PLAYBACK_ENABLED=1</code> with the in-process scheduler.
                  </>
                }
              />
            )}
          </div>
        </section>

        <section className="panel">
          <header>
            <h2>Server</h2>
          </header>
          <div className="rows">
            <Row
              tone={sched ? "ok" : null}
              label="Scheduler"
              value={sched ? "In-process" : "External (systemd)"}
              sub={sched ? `backup every ${sched.backupEveryHours} h` : "collection driven by systemd timers"}
            />
            <Row
              tone={env.BACKUP_ENABLED ? "ok" : "warn"}
              label="Backups"
              value={env.BACKUP_ENABLED ? "Enabled" : "Disabled"}
              sub={env.BACKUP_ENABLED ? `${env.BACKUP_DIR} · keep ${env.BACKUP_KEEP}` : "Set BACKUP_ENABLED=1 to snapshot the database."}
            />
            <Row
              tone={env.WATCHDOG_URL ? "ok" : "warn"}
              label="Watchdog"
              value={env.WATCHDOG_URL ? "Configured" : "Not configured"}
              sub={
                env.WATCHDOG_URL
                  ? "Alerts on silence, the only thing that catches a dead poller."
                  : "Without WATCHDOG_URL nothing alerts you when the poller goes quiet."
              }
            />
            <Row
              tone={env.NTFY_URL ? "ok" : null}
              label="ntfy"
              value={env.NTFY_URL ? "Configured" : "Not configured"}
              sub="Push channel for actionable events. It cannot detect silence."
            />
            <Row
              tone={null}
              label="Auth mode"
              value={env.AUTH_MODE}
              sub={
                env.AUTH_MODE === "proxy"
                  ? "A reverse proxy authenticates requests."
                  : env.AUTH_MODE === "sesame"
                    ? "Sésame opens the session."
                    : "JWT session unlocked by ADMIN_TOKEN."
              }
            />
            <Row tone={null} label="Timezone" value={tz} sub="Display only; every timestamp is stored in UTC." />
          </div>
        </section>
      </div>
    </div>
  );
}
