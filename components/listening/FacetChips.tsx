import Icon from "@/components/Icon";

export interface Facet {
  label: string;
  value: string;
  /** Link with this facet removed. */
  removeHref: string;
}

/**
 * What is currently being asked, spelled out, with one click to undo each part.
 *
 * Charts that filter by being clicked are only honest if the resulting question
 * stays visible: without this row, "Sundays, 22:00, techno" and "everything"
 * look the same except for the numbers.
 */
export default function FacetChips({ facets, clearHref }: { facets: Facet[]; clearHref: string }) {
  if (facets.length === 0) {
    return (
      <p className="text-xs text-[color:var(--ink-2)]">
        No filter — every collected listen, all the way back.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-[color:var(--ink-2)]">Showing</span>
      {facets.map((f) => (
        <a
          key={`${f.label}:${f.value}`}
          href={f.removeHref}
          className="chip hover:bg-[color:var(--surface-2)]"
          aria-label={`Remove filter ${f.label} ${f.value}`}
          title={`Remove ${f.label}: ${f.value}`}
        >
          <span className="text-[color:var(--ink-2)]">{f.label}</span>
          <span className="max-w-[16rem] truncate">{f.value}</span>
          <Icon name="x" className="h-3 w-3 text-[color:var(--ink-2)]" />
        </a>
      ))}
      <a href={clearHref} className="btn sm ghost">
        Clear all
      </a>
    </div>
  );
}
