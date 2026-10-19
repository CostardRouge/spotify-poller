/**
 * The Listening page's filter travels in the query string — every chart is a
 * link made by `filterToParams`, read back by `parseListeningFilter`. So the
 * two must round-trip exactly, a malformed value must be dropped rather than
 * silently widened, and "empty" must mean what the page shows.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EMPTY_FILTER,
  type ListeningFilter,
  filterToParams,
  isFilterEmpty,
  parseListeningFilter,
} from "../lib/server/listening";

describe("parseListeningFilter", () => {
  it("drops a malformed date and anything out of range, and dedupes the clock facets", () => {
    const f = parseListeningFilter(
      new URLSearchParams("type=like&from=2026-01-01&to=last%20week&hour=9,8,9,25&weekday=7&weekday=1&month=0")
    );
    assert.equal(f.type, "like");
    assert.equal(f.from, "2026-01-01");
    assert.equal(f.to, null, "a date that is not YYYY-MM-DD is dropped, not applied");
    assert.deepEqual(f.hours, [8, 9]);
    assert.deepEqual(f.weekdays, [1, 7]);
    assert.deepEqual(f.months, [], "month 0 is out of range");
  });

  it("reads an unknown type as listens and a blank facet as absent", () => {
    const f = parseListeningFilter(new URLSearchParams("type=podcast&artist=%20&q="));
    assert.equal(f.type, "listen");
    assert.equal(f.artist, null);
    assert.equal(f.q, null);
  });
});

describe("filterToParams", () => {
  it("round-trips a filter through the query string", () => {
    const f: ListeningFilter = {
      ...EMPTY_FILTER,
      type: "all",
      from: "2025-11-01",
      q: "nina simone",
      genre: "vocal jazz",
      context: "none",
      hours: [7, 8, 22],
      weekdays: [6, 7],
      years: [2025, 2026],
    };
    assert.deepEqual(parseListeningFilter(filterToParams(f, null)), f);
  });

  it("writes nothing for the defaults and puts the account first", () => {
    assert.equal(filterToParams(EMPTY_FILTER, null).toString(), "");
    assert.equal(filterToParams({ ...EMPTY_FILTER, months: [12] }, "acct_a").toString(), "account=acct_a&month=12");
  });
});

describe("isFilterEmpty", () => {
  it("is true only for the defaults", () => {
    assert.equal(isFilterEmpty(EMPTY_FILTER), true);
    assert.equal(isFilterEmpty({ ...EMPTY_FILTER, type: "all" }), false);
    assert.equal(isFilterEmpty({ ...EMPTY_FILTER, mdays: [1] }), false);
  });
});
