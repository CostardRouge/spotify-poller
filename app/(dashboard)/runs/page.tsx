import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listRuns } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import StatusPill from "@/components/StatusPill";
import RunButtons from "@/components/RunButtons";
import Icon from "@/components/Icon";

type Run = {
  id: number;
  collector: string;
  trigger_kind: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "partial" | "error" | null;
  items_fetched: number;
  items_inserted: number;
  error: string | null;
};

const TONE: Record<string, "ok" | "warn" | "danger"> = { ok: "ok", partial: "warn", error: "danger" };

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; account?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = sp.account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const result = listRuns(env, scope, limit, offset);
  const items = result.items as Run[];

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <RunButtons playbackEnabled={false} />
      </div>

      <div className="panel mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-wide text-[color:var(--ink-2)]">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Collector</th>
                <th className="px-3 py-2">Trigger</th>
                <th className="px-3 py-2">Started</th>
                <th className="px-3 py-2">Finished</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Fetched</th>
                <th className="px-3 py-2">New</th>
                <th className="px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id} className="border-t border-[color:var(--line)]">
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                    #{r.id}
                  </td>
                  <td className="px-3 py-2 font-[family-name:var(--mono)]">{r.collector}</td>
                  <td className="px-3 py-2 text-[color:var(--ink-2)]">{r.trigger_kind}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)]">
                    {formatTimestamp(r.started_at, env.TIMEZONE)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                    {r.finished_at ? formatTimestamp(r.finished_at, env.TIMEZONE) : "—"}
                  </td>
                  <td className="px-3 py-2">
                    {r.status ? <StatusPill tone={TONE[r.status]}>{r.status}</StatusPill> : "never finished"}
                  </td>
                  <td className="px-3 py-2">{r.items_fetched}</td>
                  <td className="px-3 py-2">{r.items_inserted}</td>
                  <td className="max-w-xs truncate px-3 py-2 text-[color:var(--ink-2)]" title={r.error ?? ""}>
                    {r.error ?? ""}
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">
                      <Icon name="runs" className="h-6 w-6" />
                      <h3>No runs recorded</h3>
                      <p>Every collection attempt is logged here, successful or not.</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <footer className="flex items-center gap-3 border-t border-[color:var(--line)] px-4 py-3 text-sm">
          <a href={`?offset=${Math.max(0, offset - limit)}`} className="btn sm" aria-disabled={offset === 0}>
            ← Previous
          </a>
          <a href={`?offset=${offset + limit}`} className="btn sm" aria-disabled={offset + limit >= result.total}>
            Next →
          </a>
          <span className="ml-auto font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
            {result.total === 0
              ? "0 of 0"
              : `${offset + 1}–${Math.min(offset + limit, result.total)} of ${result.total.toLocaleString()}`}
          </span>
        </footer>
      </div>
    </div>
  );
}
