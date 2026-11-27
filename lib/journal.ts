/**
 * The Journal's thread (2026-11-27, design lab iteration 2): collection runs
 * and declared gaps in one list, newest first, cut into the operator's local
 * days. It replaces three pages that each held part of the story — Runs,
 * Gaps, and Stats' "last 20 runs" — so a gap now sits between the runs that
 * frame it instead of on a page of its own.
 *
 * A gap is placed at `from_utc`, where the needle lifted: in a list read top
 * down it lands right under the run that recovered from it and above the last
 * run before it, which is the order the operator reasons in. On an equal
 * instant the run comes first.
 *
 * Pure: no database, no Next. The page fetches one page of runs and the gaps
 * inside the same window (lib/server/db.ts, `journalRuns` and `gapsBetween`).
 */
import { localParts } from "./server/localtime";

export interface JournalRun {
  id: number;
  collector: string;
  trigger_kind: string;
  started_at: string;
  finished_at: string | null;
  status: "ok" | "partial" | "error" | null;
  items_fetched: number;
  items_inserted: number;
  error: string | null;
}

export interface JournalGap {
  id: number;
  collector: string;
  from_utc: string;
  to_utc: string;
  detected_at: string;
  note: string;
}

export type JournalEntry = { kind: "run"; at: number; run: JournalRun } | { kind: "gap"; at: number; gap: JournalGap };

export interface JournalDay {
  /** Local calendar date, `YYYY-MM-DD`, in the zone the page was built for. */
  date: string;
  entries: JournalEntry[];
  runs: number;
  ok: number;
  partial: number;
  error: number;
  /** A run with no status: still running, or the process died under it. */
  unfinished: number;
  gaps: number;
}

export function buildJournal(runs: JournalRun[], gaps: JournalGap[], tz: string): JournalDay[] {
  const entries: JournalEntry[] = [
    ...runs.map((run) => ({ kind: "run" as const, at: Date.parse(run.started_at), run })),
    ...gaps.map((gap) => ({ kind: "gap" as const, at: Date.parse(gap.from_utc), gap })),
  ];
  entries.sort((a, b) => b.at - a.at || (a.kind === b.kind ? 0 : a.kind === "run" ? -1 : 1));

  const days: JournalDay[] = [];
  for (const e of entries) {
    const date = localParts(tz, e.at).date;
    let day = days[days.length - 1];
    if (!day || day.date !== date) {
      day = { date, entries: [], runs: 0, ok: 0, partial: 0, error: 0, unfinished: 0, gaps: 0 };
      days.push(day);
    }
    day.entries.push(e);
    if (e.kind === "gap") day.gaps++;
    else {
      day.runs++;
      if (e.run.status === "ok") day.ok++;
      else if (e.run.status === "partial") day.partial++;
      else if (e.run.status === "error") day.error++;
      else day.unfinished++;
    }
  }
  return days;
}

/** "23 runs · 22 ok · 1 partial" — only the counts that are not zero, past the total. */
export function daySummary(d: JournalDay): string {
  const parts: string[] = [];
  if (d.runs) parts.push(`${d.runs} run${d.runs === 1 ? "" : "s"}`);
  if (d.ok) parts.push(`${d.ok} ok`);
  if (d.partial) parts.push(`${d.partial} partial`);
  if (d.error) parts.push(`${d.error} failed`);
  if (d.unfinished) parts.push(`${d.unfinished} unfinished`);
  if (d.gaps) parts.push(`${d.gaps} gap${d.gaps === 1 ? "" : "s"}`);
  return parts.join(" · ");
}
