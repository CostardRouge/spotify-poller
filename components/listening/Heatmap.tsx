import type { ListeningFilter } from "@/lib/server/listening";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * Weekday × hour of the local clock — the one view that answers "when, really"
 * without making you cross two bar charts in your head.
 *
 * Each cell is a link that pins BOTH axes at once (weekday=3&hour=22), which is
 * the whole reason this page exists: the interesting questions are
 * intersections. Density is drawn in neutral ink, not in the accent — see the
 * note in `BarChart.tsx` for why green is not available as a quantity here.
 *
 * The count is in every cell's accessible name and tooltip, so nothing is
 * carried by the shade alone.
 */
export default function Heatmap({
  matrix,
  filter,
  hrefFor,
}: {
  /** [weekday 0..6 (Monday first)][hour 0..23] */
  matrix: number[][];
  filter: ListeningFilter;
  hrefFor: (weekday: number, hour: number) => string;
}) {
  const max = Math.max(1, ...matrix.flat());

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[19rem]">
        <div className="grid grid-cols-[2.4rem_repeat(24,minmax(0,1fr))] gap-px">
          <span aria-hidden />
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              aria-hidden
              className="text-center font-[family-name:var(--mono)] text-[9px] text-[color:var(--ink-2)]"
            >
              {h % 3 === 0 ? String(h).padStart(2, "0") : " "}
            </span>
          ))}

          {matrix.map((row, d) => (
            <Row
              key={d}
              day={d}
              row={row}
              max={max}
              filter={filter}
              hrefFor={hrefFor}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function Row({
  day,
  row,
  max,
  filter,
  hrefFor,
}: {
  day: number;
  row: number[];
  max: number;
  filter: ListeningFilter;
  hrefFor: (weekday: number, hour: number) => string;
}) {
  const dayPinned = filter.weekdays.includes(day + 1);
  return (
    <>
      <span className="pr-1 text-right text-[10px] leading-5 text-[color:var(--ink-2)]">{DAYS[day]}</span>
      {row.map((n, h) => {
        const pinned = dayPinned && filter.hours.includes(h);
        // A share of the busiest cell, floored so a non-zero cell is never
        // invisible; zero stays flat so an empty hour reads as empty.
        const weight = n === 0 ? 0 : 0.12 + 0.88 * (n / max);
        return (
          <a
            key={h}
            href={hrefFor(day + 1, h)}
            title={`${FULL_DAYS[day]} ${String(h).padStart(2, "0")}:00 — ${n.toLocaleString()}`}
            aria-label={`${FULL_DAYS[day]} at ${String(h).padStart(2, "0")}:00, ${n.toLocaleString()}${pinned ? " (in the filter, click to remove)" : ""}`}
            style={{
              backgroundColor:
                n === 0
                  ? "var(--surface-2)"
                  : `color-mix(in oklab, var(--ink) ${Math.round(weight * 78)}%, var(--surface-2))`,
            }}
            className={
              "h-5 rounded-[2px] " +
              (pinned ? "outline outline-2 outline-offset-1 outline-[color:var(--accent)]" : "")
            }
          />
        );
      })}
    </>
  );
}
