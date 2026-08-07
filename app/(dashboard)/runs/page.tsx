import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listRuns } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import StatusPill from "@/components/StatusPill";

type Run = {
  id: number;
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

export default async function RunsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = getActiveAccountId(env) ?? GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const result = listRuns(env, scope, limit, offset);
  const items = result.items as Run[];

  return (
    <div>
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Runs</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">{result.total.toLocaleString()} logged run(s).</p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)]">
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
            {items.map((r) => (
              <tr key={r.id} className="border-t border-[color:var(--line-soft)]">
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
            {items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No runs logged yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <a
          href={`?offset=${Math.max(0, offset - limit)}`}
          className={
            "rounded-md border border-[color:var(--line)] px-3 py-1.5 " +
            (offset > 0 ? "text-[color:var(--text)]" : "pointer-events-none text-[color:var(--faint)]")
          }
        >
          Previous
        </a>
        <a
          href={`?offset=${offset + limit}`}
          className={
            "rounded-md border border-[color:var(--line)] px-3 py-1.5 " +
            (offset + limit < result.total ? "text-[color:var(--text)]" : "pointer-events-none text-[color:var(--faint)]")
          }
        >
          Next
        </a>
      </div>
    </div>
  );
}
