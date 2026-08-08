/**
 * The Overview row primitive from the old UI: state dot, label, value with an
 * optional sub-line, actions pushed right.
 */
export type RowTone = "ok" | "warn" | "bad" | "none" | null;

const DOT: Record<string, string> = { ok: "dot ok", warn: "dot warn", bad: "dot bad" };

export default function Row({
  tone,
  label,
  value,
  sub,
  action,
}: {
  tone: RowTone;
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="row">
      <span className="r-state">
        <span aria-hidden className={DOT[tone ?? ""] ?? "dot"} />
      </span>
      <span className="r-label">{label}</span>
      <span className="r-value">
        {value}
        {sub && <span className="sub">{sub}</span>}
      </span>
      <span className="r-act">{action}</span>
    </div>
  );
}
