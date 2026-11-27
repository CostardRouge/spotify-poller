/**
 * The trace: instants into quarter-hour slots of a LOCAL day, declared gaps
 * clipped to it, today cut at "now", and the account scope of the queries.
 * What goes wrong silently here is a play drawn in the wrong hour (a DST day),
 * a gap that leaks into the next day, or the future of today drawn as silence.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { SLOTS_PER_DAY, bucketDay, slotOf, tracePaths } from "../lib/trace";
import { lastLocalDays, pollsToday, shiftDate, traceDays } from "../lib/server/trace";
import type { Env } from "../lib/server/types";

const PARIS = "Europe/Paris";
const H = 3_600_000;

describe("slotOf / bucketDay", () => {
  const start = Date.UTC(2026, 10, 26, 23); // 27 Nov 00:00 in Paris (UTC+1)
  const end = start + 24 * H;

  it("puts a play in its quarter hour", () => {
    assert.equal(slotOf(start, start, end), 0);
    assert.equal(slotOf(start + 18 * H, start, end), 72);
    assert.equal(slotOf(end - 1, start, end), SLOTS_PER_DAY - 1);
  });

  it("stretches the slots over a 25-hour day so 18:00 stays at three quarters", () => {
    const octStart = Date.UTC(2026, 9, 24, 22); // 25 Oct 00:00 Paris, a 25-hour day
    const octEnd = Date.UTC(2026, 9, 25, 23);
    assert.equal(octEnd - octStart, 25 * H);
    assert.equal(slotOf(octStart + 18.75 * H, octStart, octEnd), 72);
  });

  it("counts plays, ignores those outside the day, and clips gaps to it", () => {
    const day = bucketDay(
      "2026-11-27",
      start,
      end,
      [start + 3 * H, start + 3 * H + 60_000, end + 5],
      [
        [start - 2 * H, start + H], // starts the day before
        [start + 10 * H, start + 11.5 * H],
        [end + H, end + 2 * H], // the next day only
      ],
      end + 10 * H
    );
    assert.equal(day.total, 2);
    assert.equal(day.counts[12], 2);
    assert.deepEqual(day.gaps, [
      [0, 4],
      [40, 46],
    ]);
    assert.equal(day.until, SLOTS_PER_DAY);
  });

  it("cuts today at now, so the rest of the day is not drawn as silence", () => {
    const day = bucketDay("2026-11-27", start, end, [], [], start + 11.5 * H);
    assert.equal(day.until, 46);
    const paths = tracePaths(day, 960, 40);
    assert.equal(paths.penX, 460);
    assert.ok(!paths.line.includes("L960 "), "the line stops at now");
  });
});

describe("tracePaths", () => {
  it("lifts the pen over a gap and returns the gap on its own", () => {
    const counts = new Array<number>(SLOTS_PER_DAY).fill(0);
    counts[2] = 3;
    const paths = tracePaths({ counts, gaps: [[10, 14]], until: SLOTS_PER_DAY }, 96, 20);
    assert.match(paths.line, /M14 10/, "the line resumes after the gap");
    assert.equal(paths.gaps, "M10 10 L14 10");
    assert.equal(paths.penX, null, "a finished day has no pen");
    assert.match(paths.line, /L2\.3 /, "the played slot swings away from the midline");
  });
});

describe("local days", () => {
  it("shifts dates on the calendar alone", () => {
    assert.equal(shiftDate("2026-03-01", -1), "2026-02-28");
    assert.equal(shiftDate("2026-12-31", 1), "2027-01-01");
  });

  it("lists the last days oldest first, each starting at local midnight", () => {
    const now = Date.UTC(2026, 10, 27, 10, 27);
    const days = lastLocalDays(PARIS, now, 7);
    assert.deepEqual(
      days.map((d) => d.date),
      ["2026-11-21", "2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]
    );
    assert.equal(new Date(days[6].startMs).toISOString(), "2026-11-26T23:00:00.000Z");
    assert.equal(lastLocalDays(PARIS, now, 7, 1)[6].date, "2026-11-20", "one week back");
  });
});

function freshEnv(): Env {
  const db = new Database(":memory:");
  const dir = join(__dirname, "..", "migrations");
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(dir, file), "utf8"));
  }
  return { DB: db } as unknown as Env;
}

describe("traceDays / pollsToday on SQLite", () => {
  it("reads only the account asked for, and only listens", () => {
    const env = freshEnv();
    const insert = env.DB.prepare(
      `INSERT INTO events (account_id, id, ts_utc, type, source, title, payload, ingested_at) VALUES (?, ?, ?, ?, 'spotify', 't', '{}', '2026-11-27T10:00:00Z')`
    );
    insert.run("me", "a", "2026-11-27T08:00:00.000Z", "listen");
    insert.run("me", "b", "2026-11-27T08:05:00.000Z", "like");
    insert.run("other", "a", "2026-11-27T08:00:00.000Z", "listen");
    env.DB.prepare(
      `INSERT INTO gaps (account_id, collector, from_utc, to_utc, detected_at) VALUES (?, 'played', ?, ?, ?)`
    ).run("other", "2026-11-27T02:00:00.000Z", "2026-11-27T03:00:00.000Z", "2026-11-27T04:00:00.000Z");
    const runs = env.DB.prepare(
      `INSERT INTO poller_runs (account_id, collector, trigger_kind, started_at, status) VALUES (?, ?, 'cron', ?, ?)`
    );
    runs.run("me", "played", "2026-11-27T07:00:00.000Z", "ok");
    runs.run("me", "played", "2026-11-27T07:30:00.000Z", "error");
    runs.run("me", "liked", "2026-11-27T07:31:00.000Z", "ok");
    runs.run("other", "played", "2026-11-27T07:45:00.000Z", "ok");

    const now = Date.UTC(2026, 10, 27, 10);
    const days = traceDays(env, "me", PARIS, now, 7);
    assert.equal(days.length, 7);
    assert.equal(days[6].total, 1);
    assert.deepEqual(days[6].gaps, [], "another account's gap stays out");
    const polls = pollsToday(env, "me", PARIS, now);
    assert.equal(polls.ok, 1);
    assert.equal(polls.failed, 1);
    assert.deepEqual(
      polls.polls.map((p) => [Math.round(p.at * 96), p.ok]),
      [[32, true], [34, false]],
      "08:00 and 08:30 Paris, in order, liked and the other account left out"
    );
  });
});
