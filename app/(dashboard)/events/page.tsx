import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listEvents } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";
import EventsTable, { EventRowData } from "@/components/EventsTable";
import Icon from "@/components/Icon";

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

  // A bare date bound needs its time-of-day edges (the old UI did the same):
  // `to=2026-08-08` must include the whole 8th, not cut off at midnight.
  const dayStart = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T00:00:00Z` : d);
  const dayEnd = (d: string) => (/^\d{4}-\d{2}-\d{2}$/.test(d) ? `${d}T23:59:59Z` : d);
  const filter = {
    type: str(sp.type) || undefined,
    q: str(sp.q) || undefined,
    from: str(sp.from) ? dayStart(str(sp.from)) : undefined,
    to: str(sp.to) ? dayEnd(str(sp.to)) : undefined,
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
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <form method="get" className="flex flex-wrap gap-2">
          {str(sp.account) && <input type="hidden" name="account" value={str(sp.account)} />}
          <select name="type" defaultValue={str(sp.type)} aria-label="Event type" className="field">
            <option value="">All types</option>
            <option value="listen">Listens</option>
            <option value="like">Likes</option>
          </select>
          <input
            id="event-search"
            name="q"
            type="search"
            defaultValue={str(sp.q)}
            placeholder="Search title or artist"
            aria-label="Search title or artist"
            className="field min-w-48"
          />
          <input type="date" name="from" defaultValue={str(sp.from)} aria-label="From date" className="field" />
          <input type="date" name="to" defaultValue={str(sp.to)} aria-label="To date" className="field" />
          <select name="order" defaultValue={order} aria-label="Sort order" className="field">
            <option value="desc">Newest first</option>
            <option value="asc">Oldest first</option>
          </select>
          <button type="submit" className="btn primary">
            Apply filters
          </button>
        </form>
        <a
          href={str(sp.account) ? `/events?account=${encodeURIComponent(str(sp.account))}` : "/events"}
          className="btn ghost"
        >
          Clear
        </a>
        <a
          href={`/api/export${exportParams.size ? `?${exportParams}` : ""}`}
          className="btn ml-auto"
          title="Download the filtered events as NDJSON. Contains no secret."
        >
          <Icon name="download" className="h-4 w-4" />
          Export NDJSON
        </a>
      </div>

      <div className="mt-4">
        <EventsTable
          items={items}
          timezone={env.TIMEZONE}
          filtered={Boolean(filter.type || filter.q || filter.from || filter.to)}
          clearHref={str(sp.account) ? `/events?account=${encodeURIComponent(str(sp.account))}` : "/events"}
        />
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <a
          href={hasPrev ? `?${new URLSearchParams({ ...sp2str(sp), offset: String(Math.max(0, offset - limit)) })}` : "#"}
          aria-disabled={!hasPrev}
          className="btn sm"
        >
          ← Previous
        </a>
        <a
          href={hasNext ? `?${new URLSearchParams({ ...sp2str(sp), offset: String(offset + limit) })}` : "#"}
          aria-disabled={!hasNext}
          className="btn sm"
        >
          Next →
        </a>
        <span className="ml-auto font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
          {result.total === 0
            ? "0 of 0"
            : `${offset + 1}–${Math.min(offset + limit, result.total)} of ${result.total.toLocaleString()}`}
        </span>
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
