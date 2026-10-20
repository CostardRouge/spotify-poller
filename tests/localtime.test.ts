/**
 * The local-clock arithmetic behind the Listening page: the offset an IANA
 * zone had at a given instant, the few segments a date range splits into at a
 * DST change, the SQL those segments become, and the way back from a local
 * day boundary to a UTC instant. All of it reads Node's own Intl data.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localParts, offsetMinutesAt, sqlLocalExpr, tzSegments, utcFromLocal } from "../lib/server/localtime";

const PARIS = "Europe/Paris";
const SUMMER = Date.UTC(2026, 6, 1, 12);
const WINTER = Date.UTC(2026, 0, 15, 12);

describe("offsetMinutesAt", () => {
  it("reads the offset the zone had at that instant, not today's", () => {
    assert.equal(offsetMinutesAt(PARIS, SUMMER), 120);
    assert.equal(offsetMinutesAt(PARIS, WINTER), 60);
    assert.equal(offsetMinutesAt("America/New_York", WINTER), -300);
    assert.equal(offsetMinutesAt("Asia/Kolkata", SUMMER), 330);
  });

  it("reads a bare GMT as zero", () => {
    assert.equal(offsetMinutesAt("UTC", SUMMER), 0);
    assert.equal(offsetMinutesAt("Etc/GMT", WINTER), 0);
  });
});

describe("tzSegments", () => {
  it("cuts a range at the DST change, to the minute, with a first segment from the epoch", () => {
    const segments = tzSegments(PARIS, Date.UTC(2026, 2, 1), Date.UTC(2026, 3, 30));
    assert.deepEqual(segments, [
      { from: "0000-01-01T00:00:00", offsetMinutes: 60 },
      // Clocks went forward on the last Sunday of March 2026, at 01:00 UTC.
      { from: "2026-03-29T01:00:00", offsetMinutes: 120 },
    ]);
  });

  it("yields one segment for a zone that never changes", () => {
    assert.deepEqual(tzSegments("UTC", Date.UTC(2020, 0, 1), Date.UTC(2026, 0, 1)), [
      { from: "0000-01-01T00:00:00", offsetMinutes: 0 },
    ]);
  });
});

describe("sqlLocalExpr", () => {
  it("is a plain shift for one segment", () => {
    assert.equal(
      sqlLocalExpr([{ from: "0000-01-01T00:00:00", offsetMinutes: 60 }], "ts_utc"),
      "datetime(ts_utc, '60 minutes')"
    );
  });

  it("is a CASE over whole-second timestamps for several, newest boundary first", () => {
    const sql = sqlLocalExpr(
      [
        { from: "0000-01-01T00:00:00", offsetMinutes: 60 },
        { from: "2026-03-29T01:00:00", offsetMinutes: 120 },
        { from: "2026-10-25T01:00:00", offsetMinutes: 60 },
      ],
      "ts_utc"
    );
    assert.equal(
      sql,
      "datetime(ts_utc, CASE WHEN substr(ts_utc, 1, 19) >= '2026-10-25T01:00:00' THEN '60 minutes' " +
        "WHEN substr(ts_utc, 1, 19) >= '2026-03-29T01:00:00' THEN '120 minutes' ELSE '60 minutes' END)"
    );
  });
});

describe("utcFromLocal and localParts", () => {
  it("turns a local midnight into the UTC instant of that zone, summer and winter", () => {
    assert.equal(utcFromLocal(PARIS, "2026-07-01T00:00:00"), Date.UTC(2026, 5, 30, 22));
    assert.equal(utcFromLocal(PARIS, "2026-01-15T00:00:00"), Date.UTC(2026, 0, 14, 23));
  });

  it("answers NaN for a date it cannot parse", () => {
    assert.ok(Number.isNaN(utcFromLocal(PARIS, "not a date")));
  });

  it("reads the local date and hour of an instant", () => {
    assert.deepEqual(localParts(PARIS, Date.UTC(2026, 6, 1, 23, 30)), { date: "2026-07-02", hour: 1 });
    assert.deepEqual(localParts("UTC", Date.UTC(2026, 6, 1, 23, 30)), { date: "2026-07-01", hour: 23 });
  });
});
