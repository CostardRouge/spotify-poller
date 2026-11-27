import { tracePaths, type TraceDay } from "@/lib/trace";

/**
 * One day of the trace as an SVG strip (lib/trace.ts holds the grammar). Pure
 * markup, rendered on the server: no chart library, no client JavaScript.
 *
 * The viewBox is fixed and stretched to the container's width with
 * `preserveAspectRatio="none"`; `vector-effect: non-scaling-stroke` keeps the
 * pen's width constant however wide the strip is drawn.
 */
const VB_W = 960;

export default function TraceStrip({
  day,
  height = 40,
  label,
  showPen = true,
}: {
  day: TraceDay;
  height?: number;
  /** Accessible description; the strip is an image of the day. */
  label: string;
  showPen?: boolean;
}) {
  const { line, gaps, penX } = tracePaths(day, VB_W, height);
  return (
    <svg
      viewBox={`0 0 ${VB_W} ${height}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label}
      className="block w-full"
      style={{ height }}
    >
      <line x1="0" y1={height / 2} x2={VB_W} y2={height / 2} className="trace-mid" vectorEffect="non-scaling-stroke" />
      <path d={line} className="trace-line" vectorEffect="non-scaling-stroke" />
      {gaps && <path d={gaps} className="trace-gap" vectorEffect="non-scaling-stroke" />}
      {showPen && penX !== null && (
        // An ellipse stretched back by the inverse of the strip's scale would
        // need the rendered width; a short vertical bar reads as the pen at
        // any width and is honest about where "now" is.
        <rect
          x={penX - 3}
          y={height / 2 - Math.min(14, height / 2 - 2)}
          width={6}
          height={Math.min(28, height - 4)}
          rx={3}
          className="trace-pen"
        />
      )}
    </svg>
  );
}

/** "Fri", "Sat"… for a `YYYY-MM-DD`, in English like the rest of the UI. */
export function weekdayOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
}

/** "27 Nov" for a `YYYY-MM-DD`. */
export function shortDateOf(date: string): string {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** The strip's accessible description: plays, and the gaps in local hours. */
export function traceLabel(day: TraceDay): string {
  const hhmm = (slot: number) => {
    const m = Math.round((slot / 96) * 24 * 60);
    return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  };
  const gaps = day.gaps.map(([a, b]) => `a declared gap from ${hhmm(a)} to ${hhmm(b)}`);
  return `${weekdayOf(day.date)} ${shortDateOf(day.date)}: ${day.total} plays${gaps.length ? `, ${gaps.join(", ")}` : ", no gap"}`;
}
