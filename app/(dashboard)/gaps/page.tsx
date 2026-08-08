import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listGaps } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";

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
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Gaps</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Declared holes in the history — the Spotify API only exposes the last 50 tracks, so a window not collected in
        time is lost for good. {result.total.toLocaleString()} recorded.
      </p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Detected</th>
              <th className="px-3 py-2">Collector</th>
              <th className="px-3 py-2">From</th>
              <th className="px-3 py-2">To</th>
              <th className="px-3 py-2">Note</th>
            </tr>
          </thead>
          <tbody>
            {items.map((g) => (
              <tr key={g.id} className="border-t border-[color:var(--line-soft)]">
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                  {formatTimestamp(g.detected_at, env.TIMEZONE)}
                </td>
                <td className="px-3 py-2">{g.collector}</td>
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                  {formatTimestamp(g.from_utc, env.TIMEZONE)}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                  {formatTimestamp(g.to_utc, env.TIMEZONE)}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted)]">{g.note}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No gaps recorded — collection has been continuous.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <a href={`?offset=${Math.max(0, offset - limit)}`} className="btn sm" aria-disabled={offset === 0}>
          ← Previous
        </a>
        <a href={`?offset=${offset + limit}`} className="btn sm" aria-disabled={offset + limit >= result.total}>
          Next →
        </a>
      </div>
    </div>
  );
}
