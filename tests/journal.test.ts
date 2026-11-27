/**
 * The Journal's merge of runs and gaps (lib/journal.ts): newest first, a gap
 * at the instant the needle lifted, cut into the operator's local days — so a
 * run at 00:30 in Paris belongs to the day after the UTC date it carries.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildJournal, daySummary, type JournalGap, type JournalRun } from "../lib/journal";

function run(id: number, started_at: string, status: JournalRun["status"] = "ok"): JournalRun {
  return { id, collector: "played", trigger_kind: "cron", started_at, finished_at: started_at, status, items_fetched: 50, items_inserted: 0, error: null };
}
function gap(id: number, from_utc: string, to_utc: string): JournalGap {
  return { id, collector: "played", from_utc, to_utc, detected_at: to_utc, note: "" };
}

describe("buildJournal", () => {
  it("puts a gap between the run that recovered and the last run before it", () => {
    const days = buildJournal(
      [run(1, "2026-11-25T01:59:00Z"), run(2, "2026-11-25T03:31:00Z")],
      [gap(9, "2026-11-25T02:00:00Z", "2026-11-25T03:30:00Z")],
      "UTC"
    );
    assert.equal(days.length, 1);
    assert.deepEqual(
      days[0].entries.map((e) => (e.kind === "run" ? `run ${e.run.id}` : `gap ${e.gap.id}`)),
      ["run 2", "gap 9", "run 1"]
    );
  });

  it("cuts days on the local clock, not the UTC date", () => {
    // 23:30 UTC on the 24th is 00:30 on the 25th in Paris (UTC+1 in November).
    const days = buildJournal([run(1, "2026-11-24T23:30:00Z"), run(2, "2026-11-24T22:30:00Z")], [], "Europe/Paris");
    assert.deepEqual(
      days.map((d) => [d.date, d.runs]),
      [
        ["2026-11-25", 1],
        ["2026-11-24", 1],
      ]
    );
  });

  it("counts each status, and a run with none as unfinished", () => {
    const [d] = buildJournal(
      [run(1, "2026-11-25T10:00:00Z"), run(2, "2026-11-25T10:30:00Z", "partial"), run(3, "2026-11-25T11:00:00Z", "error"), run(4, "2026-11-25T11:30:00Z", null)],
      [gap(1, "2026-11-25T09:00:00Z", "2026-11-25T09:40:00Z")],
      "UTC"
    );
    assert.deepEqual([d.runs, d.ok, d.partial, d.error, d.unfinished, d.gaps], [4, 1, 1, 1, 1, 1]);
    assert.equal(daySummary(d), "4 runs · 1 ok · 1 partial · 1 failed · 1 unfinished · 1 gap");
  });

  it("puts the run first when a gap starts at the same instant", () => {
    const [d] = buildJournal([run(1, "2026-11-25T10:00:00Z")], [gap(1, "2026-11-25T10:00:00Z", "2026-11-25T11:00:00Z")], "UTC");
    assert.deepEqual(d.entries.map((e) => e.kind), ["run", "gap"]);
  });

  it("returns nothing for nothing", () => {
    assert.deepEqual(buildJournal([], [], "UTC"), []);
  });
});
