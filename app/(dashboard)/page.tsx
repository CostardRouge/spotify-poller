import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, healthSnapshot, statsSnapshot } from "@/lib/server/db";
import { schedulerEnabled, schedulerOptionsFromProcess } from "@/lib/server/scheduler";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp, relativeFromNow } from "@/lib/format";
import Row, { RowTone } from "@/components/Row";
import RunNowButton from "@/components/RunNowButton";
import StatusPill from "@/components/StatusPill";

type RecentRun = {
  collector: string;
  trigger_kind: string;
  started_at: string;
  status: "ok" | "partial" | "error";
  items_fetched: number;
  items_inserted: number;
};

const RUN_TONE: Record<RecentRun["status"], "ok" | "warn" | "danger"> = { ok: "ok", partial: "warn", error: "danger" };

/** Same freshness bands as the old UI: ok within the expected window, warn to 4×, bad past that. */
function freshness(iso: string | null, expectedMs: number): RowTone {
  if (!iso) return "none";
  const age = Date.now() - Date.parse(iso);
  if (age <= expectedMs) return "ok";
  if (age <= expectedMs * 4) return "warn";
  return "bad";
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; auth_error?: string; account?: string }>;
}) {
  const { connected, auth_error, account } = await searchParams;
  const env = getEnv();
  const scope = account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const health = healthSnapshot(env, scope);
  const stats = statsSnapshot(env, scope);
  const sched = schedulerEnabled() ? schedulerOptionsFromProcess() : null;

  const expPlayed = (sched ? sched.playedEveryMinutes * 3 : 90) * 60_000;
  const expLiked = (sched ? sched.likedEveryHours * 1.5 : 36) * 3_600_000;

  const byType = Object.entries(health.events_by_type)
    .map(([k, v]) => `${k} ${v.toLocaleString()}`)
    .join(" · ");
  const gapCount = (stats.gaps as unknown[]).length;
  const recentRuns = (stats.last_20_runs as RecentRun[]).slice(0, 6);

  const tz = env.TIMEZONE;
  const collectorRow = (id: string, iso: string | null, expMs: number, note: string) => (
    <Row
      tone={freshness(iso, expMs)}
      label={id}
      value={iso ? relativeFromNow(iso) : "Never succeeded"}
      sub={iso ? formatTimestamp(iso, tz) : note}
      action={<RunNowButton collector={id} />}
    />
  );

  return (
    <div className="grid max-w-5xl gap-4">
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

      <section className="panel">
        <header>
          <h2>Collection</h2>
          <span className="hint">
            {sched
              ? `in-process scheduler · played every ${sched.playedEveryMinutes} min · liked every ${sched.likedEveryHours} h`
              : "driven by systemd timers"}
          </span>
        </header>
        <div className="rows">
          {collectorRow("played", health.collector_played_last_success, expPlayed, "Spotify only keeps the last 50 tracks.")}
          {collectorRow("liked", health.collector_liked_last_success, expLiked, "Liked tracks and the initial backfill.")}
          {health.playback.enabled ? (
            collectorRow("playback", health.playback.last_success, 15 * 60_000, "Sampled every few seconds.")
          ) : (
            <Row
              tone="none"
              label="playback"
              value="Disabled"
              sub={
                <>
                  Opt-in: set <code className="font-[family-name:var(--mono)]">PLAYBACK_ENABLED=1</code> with the
                  in-process scheduler.
                </>
              }
            />
          )}
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>Stored data</h2>
          <span className="hint">account {scope || "—"}</span>
        </header>
        <div className="rows">
          <Row tone={null} label="Events" value={stats.event_rows.toLocaleString()} sub={byType || "no events yet"} />
          <Row
            tone={null}
            label="Raw API rows"
            value={stats.raw_rows.toLocaleString()}
            sub="Untouched Spotify responses, kept for replay."
          />
          <Row
            tone={gapCount === 0 ? "ok" : "warn"}
            label="Declared gaps"
            value={gapCount.toLocaleString()}
            sub={gapCount === 0 ? "No window is known to be missing." : "Windows the poller knows it did not cover."}
            action={
              gapCount > 0 ? (
                <Link href="/gaps" className="btn sm">
                  Review
                </Link>
              ) : undefined
            }
          />
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>Recent runs</h2>
          <Link href="/runs" className="hint underline">
            all runs
          </Link>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-wide text-[color:var(--ink-2)]">
              <tr>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Collector</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Fetched</th>
                <th className="px-3 py-2">New</th>
              </tr>
            </thead>
            <tbody>
              {recentRuns.map((r, i) => (
                <tr key={`${r.started_at}-${i}`} className="border-t border-[color:var(--line)]">
                  <td className="whitespace-nowrap px-3 py-2">
                    {formatTimestamp(r.started_at, tz)}
                    <span className="block text-xs text-[color:var(--ink-2)]">{relativeFromNow(r.started_at)}</span>
                  </td>
                  <td className="px-3 py-2 font-[family-name:var(--mono)]">
                    {r.collector} <span className="text-[color:var(--ink-2)]">{r.trigger_kind}</span>
                  </td>
                  <td className="px-3 py-2">
                    <StatusPill tone={RUN_TONE[r.status]}>{r.status}</StatusPill>
                  </td>
                  <td className="px-3 py-2">{r.items_fetched}</td>
                  <td className="px-3 py-2">{r.items_inserted}</td>
                </tr>
              ))}
              {recentRuns.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-6 text-center text-[color:var(--ink-2)]">
                    No runs logged yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
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
            sub={
              env.BACKUP_ENABLED
                ? `${env.BACKUP_DIR} · keep ${env.BACKUP_KEEP}`
                : "Set BACKUP_ENABLED=1 to snapshot the database."
            }
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
            sub={env.AUTH_MODE === "proxy" ? "A reverse proxy authenticates requests." : "JWT session unlocked by ADMIN_TOKEN."}
          />
          <Row tone={null} label="Timezone" value={tz} sub="Display only; every timestamp is stored in UTC." />
        </div>
      </section>
    </div>
  );
}
