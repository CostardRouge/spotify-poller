import type { Bucket } from "@/lib/server/listening";

/**
 * A bar per bucket, every bar a link that adds or removes that value from the
 * filter — this is how the page crosses its axes: click 22:00, then Sunday, and
 * every other chart redraws for Sunday nights.
 *
 * Deliberately not a chart library, and deliberately not coloured by value.
 * Green in this project means *healthy* (`PRODUCT.md`), never "a lot", so a
 * heat ramp built from the accent would be saying something false. Volume is
 * drawn in neutral ink; the accent is reserved for what is currently selected,
 * which is the one thing here that is a state.
 *
 * A zero bucket keeps a 2px stub: a silent hour is a fact, and an invisible bar
 * would read as a missing category.
 */
export default function BarChart({
  buckets,
  selected,
  hrefFor,
  unit,
  tick,
  labelEvery = 1,
  showValues = false,
  height = "h-28",
}: {
  buckets: Bucket[];
  /** Keys currently in the filter — these bars read as pressed. */
  selected: string[];
  hrefFor: (key: string) => string;
  /** Plural noun for the screen-reader label: "listens", "events"… */
  unit: string;
  /** Axis tick text. The full label stays in the accessible name either way. */
  tick?: (b: Bucket, index: number) => string;
  /** Render one label in N, for axes too dense to label every tick. */
  labelEvery?: number;
  /**
   * Print the count under each tick. For a short axis whose bars are all within
   * a few percent of each other — weekdays, months — the shape says nothing and
   * the numbers say everything. The axis stays zero-based either way: cropping
   * it to exaggerate the difference would be the dishonest fix.
   */
  showValues?: boolean;
  height?: string;
}) {
  const max = Math.max(1, ...buckets.map((b) => b.n));

  return (
    <div className="min-w-0">
      <ul className={`flex ${height} items-end gap-px`}>
        {buckets.map((b) => {
          const isSelected = selected.includes(b.key);
          return (
            <li key={b.key} className="flex h-full min-w-0 flex-1 items-end">
              <a
                href={hrefFor(b.key)}
                title={`${b.label} — ${b.n.toLocaleString()} ${unit}`}
                aria-label={`${b.label}, ${b.n.toLocaleString()} ${unit}${isSelected ? " (in the filter, click to remove)" : ""}`}
                className="flex h-full w-full items-end rounded-t-[3px] hover:bg-[color:var(--surface-2)]"
              >
                <span
                  style={{ height: `max(2px, ${(b.n / max) * 100}%)` }}
                  className={
                    "block w-full rounded-t-[3px] " +
                    (isSelected ? "bg-[color:var(--accent)]" : "bg-[color:var(--line-strong)]")
                  }
                />
              </a>
            </li>
          );
        })}
      </ul>
      <ul aria-hidden className="mt-1 flex gap-px font-[family-name:var(--mono)] text-[10px] text-[color:var(--ink-2)]">
        {buckets.map((b, i) => (
          <li
            key={b.key}
            className={
              "min-w-0 flex-1 whitespace-nowrap text-center " +
              // The selected bar is also underlined: the accent alone would make
              // the selection a colour-only state (PRODUCT.md).
              (selected.includes(b.key) ? "text-[color:var(--accent-text)] underline underline-offset-2" : "")
            }
          >
            {i % labelEvery === 0 ? (tick ? tick(b, i) : b.label) : "\u00a0"}
          </li>
        ))}
      </ul>
      {showValues && (
        <ul
          aria-hidden
          className="flex gap-px font-[family-name:var(--mono)] text-[9px] text-[color:var(--ink-2)]"
        >
          {buckets.map((b) => (
            <li key={b.key} className="min-w-0 flex-1 truncate text-center">
              {b.n.toLocaleString()}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
