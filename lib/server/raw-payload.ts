import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import type { Env } from "./types";
import { nowIso } from "./types";

/**
 * Content-addressed storage of raw response bodies (migration 0009).
 *
 * A body is stored once per (account, SHA-256 of its exact text), gzipped.
 * The raw_spotify row of each call carries only the hash. Identical answers —
 * the `played` buffer overnight, the daily liked page that did not move — cost
 * a 64-character hash instead of a 150-300 KB blob, and every body that is
 * kept is ~10-20x smaller: Spotify's JSON repeats itself (album objects,
 * image arrays, `available_markets`) within a single response.
 *
 * gzip rather than brotli: this runs synchronously on the event loop of the
 * process that serves the UI. gzip at level 9 compresses a 300 KB response in
 * a few milliseconds; brotli at the quality that would beat it by a margin
 * worth having takes tens to hundreds. The ratio is already decisive.
 *
 * Nothing here alters a body: gunzip gives back the exact text that was
 * received, which is what invariant I3 is for (replaying a parser bug).
 */

export const RAW_ENCODING = "gzip";

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function encodeBody(text: string): Buffer {
  return gzipSync(Buffer.from(text, "utf8"), { level: 9 });
}

export function decodeBody(encoding: string, body: Buffer): string {
  if (encoding !== RAW_ENCODING) throw new Error(`unknown raw payload encoding: ${encoding}`);
  return gunzipSync(body).toString("utf8");
}

/**
 * Stores `text` as a snapshot if this account does not have it yet and
 * returns its hash. INSERT OR IGNORE: a body seen before costs nothing more
 * than computing its hash (the compression is skipped too).
 */
export function storeRawPayload(env: Env, accountId: string, text: string): string {
  const sha = sha256Hex(text);
  const exists = env.DB.prepare(`SELECT 1 FROM raw_payloads WHERE account_id = ? AND sha256 = ?`).get(
    accountId,
    sha
  );
  if (!exists) {
    env.DB.prepare(
      `INSERT OR IGNORE INTO raw_payloads (account_id, sha256, encoding, body, bytes, first_seen_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(accountId, sha, RAW_ENCODING, encodeBody(text), Buffer.byteLength(text, "utf8"), nowIso());
  }
  return sha;
}

export interface RawRowRef {
  account_id: string;
  payload: string | null;
  payload_sha256: string | null;
}

/**
 * The body of one raw_spotify row, whichever of the three shapes it has
 * (see the header of migrations/0009_raw_payloads.sql). NULL means the call
 * got no body at all. Throws if a row points at a snapshot that does not
 * exist — that would be a broken archive, never a normal outcome.
 */
export function readRawPayload(env: Env, row: RawRowRef): string | null {
  if (row.payload !== null) return row.payload;
  if (row.payload_sha256 === null) return null;
  const snap = env.DB.prepare(
    `SELECT encoding, body FROM raw_payloads WHERE account_id = ? AND sha256 = ?`
  ).get(row.account_id, row.payload_sha256) as { encoding: string; body: Buffer } | undefined;
  if (!snap) throw new Error(`raw payload ${row.payload_sha256} missing for account '${row.account_id}'`);
  return decodeBody(snap.encoding, snap.body);
}

export interface CompactBatchResult {
  /** raw_spotify rows converted in this batch. */
  rows: number;
  /** Inline bytes those rows held before. */
  inline_bytes: number;
  /** Snapshots this batch had to create (the rest already existed). */
  new_snapshots: number;
  /** Compressed bytes of those new snapshots. */
  snapshot_bytes: number;
}

/**
 * Converts up to `limit` legacy rows (body inline) to the snapshot form, in
 * one transaction, oldest first. Returns rows = 0 once nothing is left.
 *
 * Bounded for the same reason as purgeRawRows: it may run while the server is
 * up, and one transaction over the whole archive would hold the write lock —
 * and the collectors — for minutes. The conversion is lossless and
 * idempotent: a row is only cleared after its snapshot is written in the same
 * transaction, and an interrupted run just resumes where it stopped.
 */
export function compactRawBatch(env: Env, limit = 200): CompactBatchResult {
  const select = env.DB.prepare(
    `SELECT id, account_id, payload FROM raw_spotify WHERE payload IS NOT NULL ORDER BY id LIMIT ?`
  );
  const has = env.DB.prepare(`SELECT 1 FROM raw_payloads WHERE account_id = ? AND sha256 = ?`);
  const insert = env.DB.prepare(
    `INSERT INTO raw_payloads (account_id, sha256, encoding, body, bytes, first_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const clear = env.DB.prepare(`UPDATE raw_spotify SET payload = NULL, payload_sha256 = ? WHERE id = ?`);
  const firstSeen = env.DB.prepare(`SELECT fetched_at FROM raw_spotify WHERE id = ?`).pluck();

  const tx = env.DB.transaction((): CompactBatchResult => {
    const rows = select.all(limit) as { id: number; account_id: string; payload: string }[];
    const out: CompactBatchResult = { rows: 0, inline_bytes: 0, new_snapshots: 0, snapshot_bytes: 0 };
    for (const r of rows) {
      const sha = sha256Hex(r.payload);
      if (!has.get(r.account_id, sha)) {
        const body = encodeBody(r.payload);
        // first_seen_at is the call's own time, not the compaction's: the
        // snapshot then says when Spotify first answered this.
        insert.run(r.account_id, sha, RAW_ENCODING, body, Buffer.byteLength(r.payload, "utf8"), firstSeen.get(r.id));
        out.new_snapshots++;
        out.snapshot_bytes += body.length;
      }
      clear.run(sha, r.id);
      out.rows++;
      out.inline_bytes += Buffer.byteLength(r.payload, "utf8");
    }
    return out;
  });
  return tx();
}

/**
 * Deletes snapshots no raw_spotify row points at any more — what a retention
 * purge leaves behind. Bounded like the purge itself.
 */
export function purgeOrphanPayloads(env: Env, maxRows = 5000): number {
  return env.DB.prepare(
    `DELETE FROM raw_payloads WHERE rowid IN (
       SELECT p.rowid FROM raw_payloads p
       WHERE NOT EXISTS (
         SELECT 1 FROM raw_spotify r WHERE r.account_id = p.account_id AND r.payload_sha256 = p.sha256
       )
       LIMIT ?)`
  ).run(maxRows).changes;
}
