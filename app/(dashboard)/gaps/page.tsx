import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listGaps } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import Icon from "@/components/Icon";

type Gap = { id: number; collector: string; from_utc: string; to_utc: string; detected_at: string; note: string };

export default async function GapsPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; account?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = sp.account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const result = listGaps(env, scope, limit, offset);
  const items = result.items as Gap[];

  return (
    <div>
      <div className="panel">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-wide text-[color:var(--ink-2)]">
              <tr>
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Collector</th>
                <th className="px-3 py-2">From</th>
                <th className="px-3 py-2">To</th>
                <th className="px-3 py-2">Detected</th>
                <th className="px-3 py-2">Note</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => (
                <tr key={g.id} className="border-t border-[color:var(--line)]">
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                    #{g.id}
                  </td>
                  <td className="px-3 py-2 font-[family-name:var(--mono)]">{g.collector}</td>
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)]">
                    {formatTimestamp(g.from_utc, env.TIMEZONE)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)]">
                    {formatTimestamp(g.to_utc, env.TIMEZONE)}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                    {formatTimestamp(g.detected_at, env.TIMEZONE)}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--ink-2)]">{g.note}</td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <div className="empty">
                      <Icon name="check" className="h-6 w-6" />
                      <h3>No declared gaps</h3>
                      <p>Every window the poller was responsible for is covered.</p>
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
      <p className="mt-3 text-sm text-[color:var(--ink-2)]">
        A gap is a window the poller knows it did not cover. Declaring it beats an empty day that silently reads as
        &quot;listened to nothing&quot;.
      </p>
    </div>
  );
}
