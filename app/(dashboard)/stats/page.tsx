import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, statsSnapshot } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import StatusPill from "@/components/StatusPill";

type Run = {
  collector: string;
  trigger_kind: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "partial" | "error";
  items_fetched: number;
  items_inserted: number;
  error: string | null;
};

const TONE: Record<Run["status"], "ok" | "warn" | "danger"> = { ok: "ok", partial: "warn", error: "danger" };

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ account?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = sp.account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const stats = statsSnapshot(env, scope);
  const runs = stats.last_20_runs as Run[];
  const gapCount = (stats.gaps as unknown[]).length;

  return (
    <div>
      <div className="mt-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <h2 className="text-sm font-medium text-[color:var(--text)]">Events</h2>
          <p className="mt-1 font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">
            {stats.event_rows.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">interpreted rows — what the export carries</p>
        </div>
        <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <h2 className="text-sm font-medium text-[color:var(--text)]">Raw responses</h2>
          <p className="mt-1 font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">
            {stats.raw_rows.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">evidence recorded before interpretation (I3)</p>
        </div>
        <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
          <h2 className="text-sm font-medium text-[color:var(--text)]">Gaps</h2>
          <p className="mt-1 font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">{gapCount}</p>
          <p className="mt-1 text-xs text-[color:var(--muted)]">
            declared holes — <Link href="/gaps" className="text-[color:var(--accent)] underline">details</Link>
          </p>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-medium text-[color:var(--text)]">Last 20 runs</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Collector</th>
              <th className="px-3 py-2">Trigger</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Fetched</th>
              <th className="px-3 py-2">Inserted</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r, i) => (
              <tr key={`${r.started_at}-${i}`} className="border-t border-[color:var(--line-soft)]">
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                  {formatTimestamp(r.started_at, env.TIMEZONE)}
                </td>
                <td className="px-3 py-2">{r.collector}</td>
                <td className="px-3 py-2 text-[color:var(--muted)]">{r.trigger_kind}</td>
                <td className="px-3 py-2">
                  <StatusPill tone={TONE[r.status]}>{r.status}</StatusPill>
                </td>
                <td className="px-3 py-2">{r.items_fetched}</td>
                <td className="px-3 py-2">{r.items_inserted}</td>
                <td className="max-w-xs truncate px-3 py-2 text-[color:var(--muted)]" title={r.error ?? ""}>
                  {r.error ?? ""}
                </td>
              </tr>
            ))}
            {runs.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No runs logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
