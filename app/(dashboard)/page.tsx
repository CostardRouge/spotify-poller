import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount, getActiveAccountId, healthSnapshot, listRuns } from "@/lib/server/db";
import { authStatus } from "@/lib/server/spotify/auth";
import { getRateLimit } from "@/lib/server/spotify/api";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp, relativeFromNow } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import RunButtons from "@/components/RunButtons";
import BackupButton from "@/components/BackupButton";

type RecentRun = {
  id: number;
  collector: string;
  started_at: string;
  status: "ok" | "partial" | "error";
  items_inserted: number;
  error: string | null;
};

const RUN_TONE: Record<RecentRun["status"], "ok" | "warn" | "danger"> = { ok: "ok", partial: "warn", error: "danger" };

const STALE_PLAYED_MS = 45 * 60 * 1000; // 30 min cadence + margin
const STALE_LIKED_MS = 26 * 60 * 60 * 1000; // daily cadence + margin

function freshnessTone(lastSuccess: string | null, staleAfterMs: number): "ok" | "warn" | "danger" {
  if (!lastSuccess) return "danger";
  const age = Date.now() - Date.parse(lastSuccess);
  if (age <= staleAfterMs) return "ok";
  if (age <= staleAfterMs * 3) return "warn";
  return "danger";
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; auth_error?: string }>;
}) {
  const { connected, auth_error } = await searchParams;
  const env = getEnv();
  const scope = getActiveAccountId(env) ?? GLOBAL_SCOPE;
  const recentRuns = listRuns(env, scope, 5, 0).items as RecentRun[];
  const health = healthSnapshot(env, scope);
  const auth = authStatus(env);
  const rateLimit = getRateLimit(env);
  const counts = eventCountsByAccount(env);
  const totalEvents = Object.values(counts).reduce((a, b) => a + b, 0);

  const playedTone = freshnessTone(health.collector_played_last_success, STALE_PLAYED_MS);
  const likedTone = freshnessTone(health.collector_liked_last_success, STALE_LIKED_MS);

  return (
    <div className="max-w-4xl">
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Dashboard</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Is collection still alive, and did I lose anything? — the custody report, at a glance.
      </p>

      {connected && (
        <div className="mt-6 rounded-md border border-[color:var(--ok)]/40 bg-[color:var(--panel)] p-4 text-sm text-[color:var(--text)]">
          Account <span className="font-medium">{connected}</span> connected — collection targets it from the next run.
        </div>
      )}

      {auth_error && (
        <div className="mt-6 rounded-md border border-[color:var(--danger)]/40 bg-[color:var(--panel)] p-4 text-sm text-[color:var(--text)]">
          Spotify connection failed: <code className="text-xs">{auth_error}</code>. Try again from{" "}
          <a href="/accounts" className="font-medium text-[color:var(--accent)] underline">
            Accounts
          </a>
          .
        </div>
      )}

      {!auth.connected && (
        <div className="mt-6 rounded-md border border-[color:var(--danger)]/40 bg-[color:var(--panel)] p-4 text-sm text-[color:var(--text)]">
          No Spotify account connected yet.{" "}
          <a href="/api/spotify/login" className="font-medium text-[color:var(--accent)] underline">
            Connect Spotify
          </a>{" "}
          to start collecting.
        </div>
      )}

      {auth.scope_state === "missing" && (
        <div className="mt-6 rounded-md border border-[color:var(--warn)]/40 bg-[color:var(--panel)] p-4 text-sm text-[color:var(--text)]">
          The connected account is missing scope(s): {auth.scopes_missing.join(", ")}.{" "}
          <a href="/api/spotify/login" className="font-medium text-[color:var(--accent)] underline">
            Reconnect
          </a>{" "}
          to grant them.
        </div>
      )}

      {rateLimit.limited && (
        <div className="mt-6 rounded-md border border-[color:var(--warn)]/40 bg-[color:var(--panel)] p-4 text-sm text-[color:var(--text)]">
          Rate-limited by Spotify — collection resumes after {rateLimit.until}.
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-[color:var(--text)]">played</h2>
            <StatusPill tone={playedTone}>{relativeFromNow(health.collector_played_last_success)}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            recently-played, every 30 min — the critical collector: Spotify only keeps the last 50 tracks.
          </p>
        </div>
        <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-[color:var(--text)]">liked</h2>
            <StatusPill tone={likedTone}>{relativeFromNow(health.collector_liked_last_success)}</StatusPill>
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">liked tracks, daily, plus the initial backfill.</p>
        </div>
      </div>

      {health.playback.enabled && (
        <div className="mt-4 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-[color:var(--text)]">playback</h2>
            <StatusPill tone={freshnessTone(health.playback.last_success, 5 * 60 * 1000)}>
              {relativeFromNow(health.playback.last_success)}
            </StatusPill>
          </div>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            {health.playback.now_playing ? `now playing: ${health.playback.now_playing.title ?? "unknown"}` : "idle"}
          </p>
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium text-[color:var(--text)]">Manual run</h2>
        <div className="mt-2">
          <RunButtons playbackEnabled={env.PLAYBACK_ENABLED} />
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-sm font-medium text-[color:var(--text)]">Maintenance</h2>
        <div className="mt-2 flex flex-wrap items-start gap-2">
          <BackupButton />
          <a
            href="/api/export"
            className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm text-[color:var(--text)] hover:bg-[color:var(--accent-wash)]"
            title="NDJSON download of every event — carries no secret"
          >
            Export NDJSON
          </a>
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-[color:var(--text)]">Recent runs</h2>
          <Link href="/runs" className="text-xs text-[color:var(--accent)] underline">
            all runs
          </Link>
        </div>
        <ul className="mt-2 flex flex-col gap-1.5">
          {recentRuns.map((r) => (
            <li key={r.id} className="flex items-center gap-3 text-sm">
              <StatusPill tone={RUN_TONE[r.status]}>{r.status}</StatusPill>
              <span className="text-[color:var(--text)]">{r.collector}</span>
              <span className="text-xs text-[color:var(--muted)]">{formatTimestamp(r.started_at, env.TIMEZONE)}</span>
              <span className="ml-auto truncate text-xs text-[color:var(--muted)]" title={r.error ?? ""}>
                {r.error ? r.error.slice(0, 60) : `${r.items_inserted} new`}
              </span>
            </li>
          ))}
          {recentRuns.length === 0 && <li className="text-sm text-[color:var(--muted)]">No runs logged yet.</li>}
        </ul>
      </div>

      <div className="mt-4 rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
        <h2 className="text-sm font-medium text-[color:var(--text)]">Collected</h2>
        <p className="mt-1 text-2xl font-[family-name:var(--serif)] text-[color:var(--text)]">
          {totalEvents.toLocaleString()} <span className="text-sm text-[color:var(--muted)]">events</span>
        </p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--muted)]">
          {Object.entries(health.events_by_type).map(([type, n]) => (
            <li key={type}>
              {type}: {n.toLocaleString()}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
