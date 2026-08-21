/**
 * One square per local day, weeks as columns, Monday at the top.
 *
 * This is the only view on the page that shows the SHAPE of the history rather
 * than a summary of it — a holiday, a move, a month with the poller down all
 * look different here, and a run of blank squares is exactly the thing
 * `PRODUCT.md` refuses to let read as "listened to nothing". The declared gaps
 * are listed underneath it on the page for that reason.
 *
 * Capped at the most recent `weeks` columns of the range in view, because a
 * five-year calendar at a legible cell size is a horizontal scroll nobody
 * finishes. The page says so next to it.
 */
const DAY_INITIALS = ["M", "T", "W", "T", "F", "S", "S"];

export default function CalendarStrip({
  days,
  from,
  to,
  weeks = 53,
  hrefFor,
}: {
  /** Only the days that carry events; the rest are drawn as zero. */
  days: { date: string; n: number }[];
  /** Local date bounds of the data in view, `YYYY-MM-DD`. */
  from: string;
  to: string;
  weeks?: number;
  hrefFor: (date: string) => string;
}) {
  const counts = new Map(days.map((d) => [d.date, d.n]));
  const max = Math.max(1, ...days.map((d) => d.n));

  const end = new Date(`${to}T00:00:00Z`);
  // Columns are ISO weeks: walk back to the Monday of the last one, then span
  // `weeks` columns — or fewer if the range itself is shorter.
  const endMonday = new Date(end);
  endMonday.setUTCDate(end.getUTCDate() - ((end.getUTCDay() + 6) % 7));
  const earliest = new Date(`${from}T00:00:00Z`);
  const firstMonday = new Date(endMonday);
  firstMonday.setUTCDate(endMonday.getUTCDate() - (weeks - 1) * 7);
  const start = firstMonday < earliest ? earliest : firstMonday;
  const startMonday = new Date(start);
  startMonday.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));

  const columns: { key: string; label: string; days: (string | null)[] }[] = [];
  for (let cursor = new Date(startMonday); cursor <= endMonday; cursor.setUTCDate(cursor.getUTCDate() + 7)) {
    const week: (string | null)[] = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(cursor);
      d.setUTCDate(cursor.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      week.push(iso >= from && iso <= to ? iso : null);
    }
    const iso = cursor.toISOString().slice(0, 10);
    columns.push({ key: iso, label: iso.slice(0, 7), days: week });
  }

  // A month label above the first column that belongs to that month.
  let previousMonth = "";
  const monthLabels = columns.map((c) => {
    const month = c.key.slice(0, 7);
    if (month === previousMonth) return "";
    previousMonth = month;
    return new Date(`${c.key}T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });
  });

  return (
    <div className="overflow-x-auto">
      <div className="flex gap-[3px]">
        <div className="flex shrink-0 flex-col gap-[3px] pt-[14px]">
          {DAY_INITIALS.map((d, i) => (
            <span
              key={i}
              aria-hidden
              className="h-[11px] text-right text-[9px] leading-[11px] text-[color:var(--ink-2)]"
            >
              {i % 2 === 1 ? d : " "}
            </span>
          ))}
        </div>
        {columns.map((c, ci) => (
          <div key={c.key} className="flex shrink-0 flex-col gap-[3px]">
            <span aria-hidden className="h-[11px] text-[9px] leading-[11px] text-[color:var(--ink-2)]">
              {monthLabels[ci]}
            </span>
            {c.days.map((iso, di) =>
              iso === null ? (
                <span key={di} className="h-[11px] w-[11px]" />
              ) : (
                <a
                  key={di}
                  href={hrefFor(iso)}
                  title={`${iso} — ${(counts.get(iso) ?? 0).toLocaleString()}`}
                  aria-label={`${iso}, ${(counts.get(iso) ?? 0).toLocaleString()}`}
                  style={{
                    backgroundColor: counts.get(iso)
                      ? `color-mix(in oklab, var(--ink) ${Math.round(
                          (0.15 + 0.85 * ((counts.get(iso) as number) / max)) * 78
                        )}%, var(--surface-2))`
                      : "var(--surface-sunk)",
                  }}
                  className="block h-[11px] w-[11px] rounded-[2px]"
                />
              )
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
