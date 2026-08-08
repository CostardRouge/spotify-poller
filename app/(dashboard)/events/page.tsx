import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listEvents } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import EventsTable, { EventRowData } from "@/components/EventsTable";

type SearchParams = Record<string, string | string[] | undefined>;

function str(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

type DbEvent = {
  id: string;
  ts_utc: string;
  type: string;
  source: string;
  duration_s: number | null;
  title: string;
  subtitle: string;
  payload: string;
  ingested_at: string;
};

export default async function EventsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams;
  const env = getEnv();
  const scope = str(sp.account) || getActiveAccountId(env) || GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(str(sp.offset)) || 0);
  const order = str(sp.order) === "asc" ? "asc" : "desc";

  const filter = {
    type: str(sp.type) || undefined,
    q: str(sp.q) || undefined,
    from: str(sp.from) || undefined,
    to: str(sp.to) || undefined,
  };
  const result = listEvents(env, scope, { ...filter, order, limit, offset });

  const items: EventRowData[] = (result.items as DbEvent[]).map((ev) => ({
    id: ev.id,
    when: formatTimestamp(ev.ts_utc, env.TIMEZONE),
    type: ev.type,
    title: ev.title,
    subtitle: ev.subtitle,
    source: ev.source,
    duration_s: ev.duration_s,
    ingested_at: ev.ingested_at,
    payload: ev.payload,
  }));

  const hasPrev = offset > 0;
  const hasNext = offset + limit < result.total;

  // The export honours the ACTIVE filter — what you see is what you download.
  const exportParams = new URLSearchParams();
  if (str(sp.account)) exportParams.set("account", str(sp.account));
  if (filter.type) exportParams.set("type", filter.type);
  if (filter.q) exportParams.set("q", filter.q);
  if (filter.from) exportParams.set("from", filter.from);
  if (filter.to) exportParams.set("to", filter.to);

  return (
    <div>
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Events</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        {result.total.toLocaleString()} event(s) for account <code className="text-xs">{scope || "(global)"}</code>
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        <form method="get" className="flex flex-wrap gap-2">
          {str(sp.account) && <input type="hidden" name="account" value={str(sp.account)} />}
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
          <button type="submit" className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-[color:var(--on-accent)]">
            Filter
          </button>
        </form>
        <a
          href={`/api/export${exportParams.size ? `?${exportParams}` : ""}`}
          className="rounded-md border border-[color:var(--line)] px-3 py-1.5 text-[color:var(--text)] hover:bg-[color:var(--accent-wash)]"
          title="NDJSON download of the events matching the current filter — carries no secret"
        >
          Export NDJSON
        </a>
      </div>

      <div className="mt-4">
        <EventsTable items={items} timezone={env.TIMEZONE} />
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
