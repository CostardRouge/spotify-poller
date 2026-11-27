/**
 * The raw archive's snapshots (migration 0009) on a real in-memory SQLite
 * database: every call keeps its row, an identical body is stored once, every
 * body reads back byte for byte, the legacy compaction is lossless, and the
 * retention purge leaves no orphan behind — nor deletes a shared snapshot.
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import Database from "better-sqlite3";
import { insertRaw, purgeRawRows } from "../lib/server/db";
import { compactRawBatch, readRawPayload, type RawRowRef } from "../lib/server/raw-payload";
import type { Env } from "../lib/server/types";

const MIGRATIONS = join(__dirname, "..", "migrations");

function freshEnv(upTo?: string): Env {
  const db = new Database(":memory:");
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (upTo && file > upTo) break;
    db.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
  return { DB: db } as unknown as Env;
}

function applyFrom(env: Env, from: string): void {
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    if (file >= from) env.DB.exec(readFileSync(join(MIGRATIONS, file), "utf8"));
  }
}

/** A recently-played-shaped body: big and repetitive, like the real thing. */
function body(plays: string[]): string {
  return JSON.stringify({
    items: plays.map((at) => ({
      played_at: at,
      track: { id: at, name: "Track", available_markets: Array.from({ length: 180 }, (_, i) => `M${i}`) },
    })),
  });
}

const rows = (env: Env) =>
  env.DB.prepare(`SELECT id, account_id, payload, payload_sha256, http_status FROM raw_spotify ORDER BY id`).all() as (RawRowRef & {
    id: number;
    http_status: number;
  })[];
const snapshots = (env: Env) => env.DB.prepare(`SELECT COUNT(*) FROM raw_payloads`).pluck().get() as number;

describe("insertRaw with snapshots", () => {
  it("keeps one row per call but stores an identical body once", () => {
    const env = freshEnv();
    const b = body(["2026-11-27T20:00:00Z"]);
    insertRaw(env, "acct_a", "played", 200, "u", b);
    insertRaw(env, "acct_a", "played", 200, "u", b);
    insertRaw(env, "acct_a", "played", 200, "u", body(["2026-11-27T21:00:00Z"]));
    assert.equal(rows(env).length, 3, "every call has its row (I3)");
    assert.equal(snapshots(env), 2, "two distinct bodies, two snapshots");
    for (const r of rows(env)) assert.equal(r.payload, null, "no inline body any more");
  });

  it("reads every body back byte for byte", () => {
    const env = freshEnv();
    const texts = [body(["a"]), body(["a"]), '{"é":"ü — 🎵"}'];
    for (const t of texts) insertRaw(env, "acct_a", "played", 200, "u", t);
    assert.deepEqual(rows(env).map((r) => readRawPayload(env, r)), texts);
  });

  it("stores the snapshot compressed", () => {
    const env = freshEnv();
    const b = body(Array.from({ length: 50 }, (_, i) => `2026-11-27T20:${String(i).padStart(2, "0")}:00Z`));
    insertRaw(env, "acct_a", "played", 200, "u", b);
    const stored = env.DB.prepare(`SELECT length(body) FROM raw_payloads`).pluck().get() as number;
    assert.ok(stored * 10 < b.length, `${stored} bytes stored for ${b.length}`);
  });

  it("keeps a network error body-less, and two accounts apart", () => {
    const env = freshEnv();
    const b = body(["x"]);
    insertRaw(env, "acct_a", "played", 0, "u", null);
    insertRaw(env, "acct_a", "played", 200, "u", b);
    insertRaw(env, "acct_b", "played", 200, "u", b);
    const [err, a, bRow] = rows(env);
    assert.equal(err.payload_sha256, null);
    assert.equal(readRawPayload(env, err), null);
    assert.equal(snapshots(env), 2, "same bytes, other account: its own snapshot");
    assert.equal(readRawPayload(env, a), b);
    assert.equal(readRawPayload(env, bRow), b);
  });
});

describe("compactRawBatch", () => {
  it("converts legacy inline rows losslessly, in batches, and is idempotent", () => {
    // A database as production has it today: rows written before 0009.
    const env = freshEnv("0008_artists.sql");
    const ins = env.DB.prepare(
      `INSERT INTO raw_spotify (account_id, collector, fetched_at, http_status, request_url, payload) VALUES (?, 'played', ?, 200, 'u', ?)`
    );
    const texts = [body(["a"]), body(["a"]), body(["b"]), body(["a"]), null];
    texts.forEach((t, i) => ins.run("acct_a", `2026-11-0${i + 1}T00:00:00Z`, t));
    applyFrom(env, "0009");

    const first = compactRawBatch(env, 2);
    assert.equal(first.rows, 2);
    assert.equal(first.new_snapshots, 1, "rows 1 and 2 share a body");
    let n = first.rows;
    for (let r = compactRawBatch(env, 2); r.rows > 0; r = compactRawBatch(env, 2)) n += r.rows;
    assert.equal(n, 4, "the body-less row is left alone");
    assert.equal(snapshots(env), 2);
    assert.deepEqual(rows(env).map((r) => readRawPayload(env, r)), texts);
    assert.equal(compactRawBatch(env).rows, 0, "nothing left on a second pass");

    const seen = env.DB.prepare(`SELECT first_seen_at FROM raw_payloads ORDER BY first_seen_at`).pluck().all();
    assert.deepEqual(seen, ["2026-11-01T00:00:00Z", "2026-11-03T00:00:00Z"], "dated by the call, not the compaction");
  });
});

describe("purgeRawRows with snapshots", () => {
  it("drops orphaned snapshots, keeps one an unpurged row still shares", () => {
    const env = freshEnv();
    const shared = body(["shared"]);
    const old = body(["old-only"]);
    const ins = env.DB.prepare(
      `INSERT INTO raw_spotify (account_id, collector, fetched_at, http_status, request_url, payload_sha256) VALUES ('acct_a', 'played', ?, 200, 'u', ?)`
    );
    insertRaw(env, "acct_a", "played", 200, "u", shared);
    insertRaw(env, "acct_a", "played", 200, "u", old);
    const [s, o] = rows(env).map((r) => r.payload_sha256);
    // Age the two rows, then add a recent call that returned the shared body.
    env.DB.prepare(`UPDATE raw_spotify SET fetched_at = '2020-01-01T00:00:00Z'`).run();
    ins.run(new Date().toISOString(), s);

    assert.equal(purgeRawRows(env, 30), 2);
    const left = env.DB.prepare(`SELECT sha256 FROM raw_payloads`).pluck().all();
    assert.deepEqual(left, [s], `orphan ${o} swept, shared snapshot kept`);
    assert.equal(readRawPayload(env, rows(env)[0]), shared);
  });
});
