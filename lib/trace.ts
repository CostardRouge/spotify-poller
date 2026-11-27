/**
 * The trace — the listening history drawn as a seismograph line, one strip per
 * local day (the Témoin design, 2026-11-27: the name of Témoin, the paper and
 * the pen of the "Sismo" direction in the design lab).
 *
 * Pure and client-safe: no database, no Node API. `lib/server/trace.ts` reads
 * the rows; this file turns instants into slots and slots into an SVG path, so
 * both halves can be tested without a server.
 *
 * Grammar, held everywhere a trace is drawn (`docs/memory/frontend.md`):
 *   - the blue pen line swings with the number of plays in each quarter hour;
 *   - a declared gap is a dashed amber segment, never an empty stretch that
 *     could read as "listened to nothing";
 *   - the future of today is not drawn at all.
 */

/** Quarter hours: fine enough to show a listening session, coarse enough to read on a phone. */
export const SLOTS_PER_DAY = 96;

export interface TraceDay {
  /** Local calendar date, `YYYY-MM-DD`. */
  date: string;
  /** Plays per slot, `SLOTS_PER_DAY` long. */
  counts: number[];
  /** Declared gaps as `[fromSlot, toSlot)` ranges, clipped to the day. */
  gaps: [number, number][];
  /** How far the day has been lived: `SLOTS_PER_DAY` for a past day, fewer for today. */
  until: number;
  /** Plays in the day. */
  total: number;
}

/**
 * Slot of an instant inside a local day that starts at `dayStartMs` and ends at
 * `dayEndMs`. Proportional, not `/ 15 min`: a day that changes clock is 23 or
 * 25 hours long, and its 96 slots stretch to fit, so 18:00 still sits at three
 * quarters of the strip.
 */
export function slotOf(instantMs: number, dayStartMs: number, dayEndMs: number): number {
  const ratio = (instantMs - dayStartMs) / (dayEndMs - dayStartMs);
  return Math.min(SLOTS_PER_DAY - 1, Math.max(0, Math.floor(ratio * SLOTS_PER_DAY)));
}

/**
 * One day's strip from raw instants. `plays` are UTC milliseconds already
 * restricted to the day; `gaps` are `[fromMs, toMs]` pairs that may overlap the
 * day's edges and are clipped here; `nowMs` cuts today short.
 */
export function bucketDay(
  date: string,
  dayStartMs: number,
  dayEndMs: number,
  plays: number[],
  gaps: [number, number][],
  nowMs: number
): TraceDay {
  const counts = new Array<number>(SLOTS_PER_DAY).fill(0);
  let total = 0;
  for (const t of plays) {
    if (t < dayStartMs || t >= dayEndMs) continue;
    counts[slotOf(t, dayStartMs, dayEndMs)]++;
    total++;
  }
  const clipped: [number, number][] = [];
  for (const [from, to] of gaps) {
    const a = Math.max(from, dayStartMs);
    const b = Math.min(to, dayEndMs);
    if (b <= a) continue;
    const fromSlot = slotOf(a, dayStartMs, dayEndMs);
    // An end exactly on a slot boundary closes that slot; anything past it
    // covers the slot it lands in.
    const endRatio = ((b - dayStartMs) / (dayEndMs - dayStartMs)) * SLOTS_PER_DAY;
    const toSlot = Math.min(SLOTS_PER_DAY, Math.max(fromSlot + 1, Math.ceil(endRatio)));
    clipped.push([fromSlot, toSlot]);
  }
  const until =
    nowMs >= dayEndMs
      ? SLOTS_PER_DAY
      : nowMs <= dayStartMs
        ? 0
        : Math.min(SLOTS_PER_DAY, ((nowMs - dayStartMs) / (dayEndMs - dayStartMs)) * SLOTS_PER_DAY);
  return { date, counts, gaps: clipped, until, total };
}

/**
 * The pen line and the gap segments of one strip, as SVG path data in a
 * `width` × `height` box. Each slot is a swing away from the midline and back,
 * alternating up and down like a seismograph needle, its amplitude growing
 * with the plays and capped so a binge never leaves the strip. Gaps lift the
 * pen: the line jumps over them and they are returned separately, to be drawn
 * dashed.
 */
export function tracePaths(
  day: Pick<TraceDay, "counts" | "gaps" | "until">,
  width: number,
  height: number
): { line: string; gaps: string; penX: number | null } {
  const mid = height / 2;
  const maxSwing = height / 2 - 2;
  const step = width / SLOTS_PER_DAY;
  const inGap = new Array<boolean>(SLOTS_PER_DAY).fill(false);
  for (const [a, b] of day.gaps) for (let i = a; i < b; i++) inGap[i] = true;

  const last = Math.floor(day.until);
  const parts: string[] = [`M0 ${mid}`];
  let lifted = false;
  for (let i = 0; i < last; i++) {
    const x = i * step;
    if (inGap[i]) {
      lifted = true;
      continue;
    }
    if (lifted) {
      parts.push(`M${fmt(x)} ${mid}`);
      lifted = false;
    }
    const n = day.counts[i];
    if (n > 0) {
      const swing = Math.min(maxSwing, 4 + n * (maxSwing / 4));
      const y = i % 2 ? mid + swing : mid - swing;
      parts.push(`L${fmt(x + step * 0.25)} ${fmt(y)}`, `L${fmt(x + step * 0.75)} ${mid}`);
    }
    parts.push(`L${fmt(x + step)} ${mid}`);
  }
  const partial = day.until - last;
  if (partial > 0 && last < SLOTS_PER_DAY && !lifted) parts.push(`L${fmt(day.until * step)} ${mid}`);

  const gapParts = day.gaps
    .filter(([a]) => a < Math.ceil(day.until))
    .map(([a, b]) => `M${fmt(a * step)} ${mid} L${fmt(Math.min(b, day.until) * step)} ${mid}`);

  return {
    line: parts.join(" "),
    gaps: gapParts.join(" "),
    penX: day.until < SLOTS_PER_DAY ? day.until * step : null,
  };
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}
