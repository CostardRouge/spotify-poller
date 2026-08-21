/**
 * One headline number with its unit and a one-line qualifier.
 *
 * The qualifier is not decoration: most of these numbers are derived or
 * estimated, and `PRODUCT.md` requires the interface to say so where it shows
 * them rather than in a footnote nobody reads.
 */
export default function StatTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-3">
      <p className="text-xs font-medium text-[color:var(--ink-2)]">{label}</p>
      <p className="mt-1 text-2xl leading-tight text-[color:var(--ink)]">{value}</p>
      {sub && <p className="mt-1 text-xs text-[color:var(--ink-2)] text-pretty">{sub}</p>}
    </div>
  );
}
