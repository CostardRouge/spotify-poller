import type { RankedItem } from "@/lib/server/listening";

/**
 * A ranked list where the bar is the background of the row rather than a
 * separate column: the label stays readable at 360 px, and the proportion is
 * still there to be read at a glance.
 *
 * Each row is a link that pins that value in the filter, so a top artist is
 * also the way into "when do I play THIS artist".
 */
export default function RankList({
  items,
  selected,
  hrefFor,
  unit,
  empty,
}: {
  items: RankedItem[];
  selected: string | null;
  hrefFor: (key: string) => string;
  unit: string;
  empty: string;
}) {
  if (items.length === 0) {
    return <p className="px-4 py-6 text-center text-sm text-[color:var(--ink-2)]">{empty}</p>;
  }
  const max = Math.max(1, ...items.map((i) => i.n));

  return (
    <ol className="divide-y divide-[color:var(--line)]">
      {items.map((item, i) => {
        const isSelected = selected === item.key;
        return (
          <li key={item.key}>
            <a
              href={hrefFor(item.key)}
              aria-label={`${item.label}${item.sub ? `, ${item.sub}` : ""}, ${item.n.toLocaleString()} ${unit}${isSelected ? " (in the filter, click to remove)" : ""}`}
              className="relative flex items-baseline gap-3 px-3 py-2 hover:bg-[color:var(--surface-2)]"
            >
              <span
                aria-hidden
                style={{ width: `${(item.n / max) * 100}%` }}
                className={
                  "absolute inset-y-0 left-0 " +
                  (isSelected ? "bg-[color:var(--accent-soft)]" : "bg-[color:var(--surface-sunk)]")
                }
              />
              <span className="relative w-5 shrink-0 font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                {i + 1}
              </span>
              <span className="relative min-w-0 flex-1">
                <span className={"block truncate text-sm " + (isSelected ? "font-medium underline underline-offset-2" : "")}>
                  {item.label}
                </span>
                {item.sub && <span className="block truncate text-xs text-[color:var(--ink-2)]">{item.sub}</span>}
              </span>
              <span className="relative shrink-0 font-[family-name:var(--mono)] text-xs text-[color:var(--ink)]">
                {item.n.toLocaleString()}
              </span>
            </a>
          </li>
        );
      })}
    </ol>
  );
}
