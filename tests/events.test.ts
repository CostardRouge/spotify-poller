/**
 * Invariant I2 on a real SQLite database, in memory: replaying a run inserts
 * nothing the second time, and two accounts never share a row even when their
 * events carry the same id (the primary key is the pair `account_id, id`).
 *
 * The schema comes from `migrations/*.sql` applied in name order — the same
 * files and the same order as `scripts/migrate.ts`, which cannot be imported
 * because it opens `DB_PATH` on load. Nothing here touches a file on disk.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { type EventRow, insertEvents, listEvents } from "../lib/server/db";
import type { Env } from "../lib/server/types";

const MIGRATIONS = join(__dirname, "..", "migrations");

/** A fresh in-memory database with every migration applied. Only `DB` is used by the functions under test. */
function freshEnv(): Env {
  const db = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return { DB: db } as unknown as Env;
}

/** Two listens as `recently-played` shapes them: the id is derived from the play's timestamp. */
function twoListens(): EventRow[] {
  return ["2026-10-19T08:00:00.000Z", "2026-10-19T08:03:30.000Z"].map((at, i) => ({
    id: `spotify:listen:${at}`,
    ts_utc: at,
    type: "listen",
    source: "spotify",
    duration_s: 210,
    title: `Track ${i + 1}`,
    subtitle: "An Artist",
    payload: JSON.stringify({ track_id: `t${i + 1}` }),
  }));
}

describe("insertEvents", () => {
  it("inserts every new row, then nothing on a replay of the same run", () => {
    const env = freshEnv();
    assert.equal(insertEvents(env, "acct_a", twoListens()), 2);
    assert.equal(insertEvents(env, "acct_a", twoListens()), 0);
    assert.equal(listEvents(env, "acct_a", { limit: 10, offset: 0 }).total, 2);
    env.DB.close();
  });

  it("keeps two accounts apart even when their events share an id", () => {
    const env = freshEnv();
    insertEvents(env, "acct_a", twoListens());
    assert.equal(insertEvents(env, "acct_b", twoListens()), 2, "same ids, other account: two new rows");

    const a = listEvents(env, "acct_a", { limit: 10, offset: 0 });
    const b = listEvents(env, "acct_b", { limit: 10, offset: 0 });
    assert.equal(a.total, 2);
    assert.equal(b.total, 2);
    assert.ok(a.items.every((row) => (row as { account_id: string }).account_id === "acct_a"));
    assert.ok(b.items.every((row) => (row as { account_id: string }).account_id === "acct_b"));
    env.DB.close();
  });

  it("does nothing for an empty batch", () => {
    const env = freshEnv();
    assert.equal(insertEvents(env, "acct_a", []), 0);
    env.DB.close();
  });
});
