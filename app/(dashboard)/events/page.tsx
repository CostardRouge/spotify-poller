import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listEvents } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";

type SearchParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = str(sp.account) || getActiveAccountId(env) || GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(str(sp.offset)) || 0);
  const order = str(sp.order) === "asc" ? "asc" : "desc";

  const result = listEvents(env, scope, {
    type: str(sp.type) || undefined,
    q: str(sp.q) || undefined,
    from: str(sp.from) || undefined,
    to: str(sp.to) || undefined,
    order,
    limit,
    offset,
  });

  const hasPrev = offset > 0;
  const hasNext = offset + limit < result.total;

  return (
    <div>
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Events</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        {result.total.toLocaleString()} event(s) for account <code className="text-xs">{scope || "(global)"}</code>
      </p>

      <form method="get" className="mt-4 flex flex-wrap gap-2 text-sm">
        <input
          name="q"
          defaultValue={str(sp.q)}
          placeholder="search title / artist"
          className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-[color:var(--text)]"
        />
        <select
          name="type"
          defaultValue={str(sp.type)}
          className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-[color:var(--text)]"
        >
          <option value="">any type</option>
          <option value="listen">listen</option>
          <option value="like">like</option>
        </select>
        <input
          type="date"
          name="from"
          defaultValue={str(sp.from)}
          className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-[color:var(--text)]"
        />
        <input
          type="date"
          name="to"
          defaultValue={str(sp.to)}
          className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-[color:var(--text)]"
        />
        <select
          name="order"
          defaultValue={order}
          className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-[color:var(--text)]"
        >
          <option value="desc">newest first</option>
          <option value="asc">oldest first</option>
        </select>
        <button
          type="submit"
          className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-[color:var(--on-accent)]"
        >
          Filter
        </button>
      </form>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">When ({env.TIMEZONE})</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Subtitle</th>
            </tr>
          </thead>
          <tbody>
            {(result.items as { id: string; ts_utc: string; type: string; title: string; subtitle: string }[]).map(
              (ev) => (
                <tr key={ev.id} className="border-t border-[color:var(--line-soft)]">
                  <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                    {formatTimestamp(ev.ts_utc, env.TIMEZONE)}
                  </td>
                  <td className="px-3 py-2">{ev.type}</td>
                  <td className="px-3 py-2 text-[color:var(--text)]">{ev.title}</td>
                  <td className="px-3 py-2 text-[color:var(--muted)]">{ev.subtitle}</td>
                </tr>
              )
            )}
            {result.items.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No events match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <a
          href={hasPrev ? `?${new URLSearchParams({ ...sp2str(sp), offset: String(Math.max(0, offset - limit)) })}` : "#"}
          aria-disabled={!hasPrev}
          className={
            "rounded-md border border-[color:var(--line)] px-3 py-1.5 " +
            (hasPrev ? "text-[color:var(--text)]" : "pointer-events-none text-[color:var(--faint)]")
          }
        >
          Previous
        </a>
        <a
          href={hasNext ? `?${new URLSearchParams({ ...sp2str(sp), offset: String(offset + limit) })}` : "#"}
          aria-disabled={!hasNext}
          className={
            "rounded-md border border-[color:var(--line)] px-3 py-1.5 " +
            (hasNext ? "text-[color:var(--text)]" : "pointer-events-none text-[color:var(--faint)]")
          }
        >
          Next
        </a>
      </div>
    </div>
  );
}

function sp2str(sp: SearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(sp)) {
    if (k === "offset") continue;
    const s = Array.isArray(v) ? v[0] : v;
    if (s) out[k] = s;
  }
  return out;
}
