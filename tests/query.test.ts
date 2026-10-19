/**
 * The two pure helpers every browsing route is built on: how a query
 * parameter becomes a number, and how a filter becomes SQL — with the account
 * scope first in both the clause list and the parameter list, which is the
 * invariant `docs/memory/data-model.md` names (nothing reads events without
 * an `account_id = ?`).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildEventWhere } from "../lib/server/db";
import { intParam } from "../lib/server/query";

const params = (s: string) => new URLSearchParams(s);

describe("intParam", () => {
  it("falls back when the parameter is absent or blank, never to 0", () => {
    assert.equal(intParam(params(""), "limit", 20, 200), 20);
    assert.equal(intParam(params("limit="), "limit", 20, 200), 20);
    assert.equal(intParam(params("limit=%20"), "limit", 20, 200), 20);
  });

  it("falls back on garbage and on a negative number", () => {
    assert.equal(intParam(params("limit=abc"), "limit", 20, 200), 20);
    assert.equal(intParam(params("limit=-5"), "limit", 20, 200), 20);
    assert.equal(intParam(params("limit=Infinity"), "limit", 20, 200), 20);
  });

  it("reads 0 as a value, not as an absence", () => {
    assert.equal(intParam(params("offset=0"), "offset", 40, 10_000), 0);
  });

  it("floors a decimal and caps at the maximum", () => {
    assert.equal(intParam(params("limit=12.9"), "limit", 20, 200), 12);
    assert.equal(intParam(params("limit=999"), "limit", 20, 200), 200);
  });
});

describe("buildEventWhere", () => {
  it("scopes to the account even with an empty filter, newest first", () => {
    const w = buildEventWhere("acct_a", {});
    assert.equal(w.sql, "WHERE account_id = ?");
    assert.deepEqual(w.params, ["acct_a"]);
    assert.equal(w.order, "DESC");
  });

  it("keeps the account first and adds one clause per filter, in order", () => {
    const w = buildEventWhere("acct_a", {
      type: "listen",
      q: "nina",
      from: "2026-01-01T00:00:00Z",
      to: "2026-01-31T23:59:59Z",
      order: "asc",
    });
    assert.equal(
      w.sql,
      "WHERE account_id = ? AND type = ? AND (title LIKE ? OR subtitle LIKE ?) AND ts_utc >= ? AND ts_utc <= ?"
    );
    // The search term is bound twice (title, then subtitle) and never spliced into the SQL.
    assert.deepEqual(w.params, [
      "acct_a",
      "listen",
      "%nina%",
      "%nina%",
      "2026-01-01T00:00:00Z",
      "2026-01-31T23:59:59Z",
    ]);
    assert.equal(w.order, "ASC");
  });

  it("ignores empty filter values and anything but 'asc' for the order", () => {
    const w = buildEventWhere("acct_a", { type: "", q: "", order: "sideways" as "asc" });
    assert.equal(w.sql, "WHERE account_id = ?");
    assert.deepEqual(w.params, ["acct_a"]);
    assert.equal(w.order, "DESC");
  });
});
