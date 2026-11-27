#!/usr/bin/env node
/**
 * Converts the legacy raw archive (one inline JSON body per call) to the
 * content-addressed snapshots of migration 0009, then optionally VACUUMs.
 *
 *   npm run compact:raw                 # dry run: READ-ONLY, measures and prints what it would save
 *   npm run compact:raw -- --apply      # converts, in bounded batches (server may keep running)
 *   npm run compact:raw -- --vacuum     # VACUUM only — stop the container first (see below)
 *
 * Hand-run on purpose, never from a migration: migrations run at every boot,
 * and rewriting ~1 GB there would hold the start-up past the healthcheck.
 *
 * --apply is lossless: each row is cleared only after its snapshot is written,
 * in the same transaction, and gunzip gives back the exact received text.
 * Still — the database is irreplaceable — take a `.db` backup first
 * (`npm run backup`) and keep it until the result has been checked.
 *
 * Why the VACUUM is a separate step: SQLite never gives freed pages back to
 * the file system on its own (auto_vacuum is off), so after --apply the file
 * is just as big, mostly free pages. VACUUM rewrites the whole file: it needs
 * up to twice the database size free on the disk, holds an exclusive lock for
 * the whole pass, and must therefore run with the poller stopped.
 */
import "dotenv/config";
import { statSync } from "node:fs";
import Database from "better-sqlite3";
import { compactRawBatch, encodeBody, sha256Hex } from "../lib/server/raw-payload";
import type { Env } from "../lib/server/types";

const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const vacuum = args.has("--vacuum");

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
const fileSize = () => {
  let n = 0;
  for (const f of [dbPath, `${dbPath}-wal`]) {
    try {
      n += statSync(f).size;
    } catch {
      /* no WAL file is fine */
    }
  }
  return n;
};

function dryRun(): void {
  // readonly: this mode must be safe to run against production while it runs.
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  const hasColumn = (db.prepare(`SELECT COUNT(*) FROM pragma_table_info('raw_spotify') WHERE name = 'payload_sha256'`).pluck().get() as number) > 0;
  console.log(`database: ${dbPath} (${mb(fileSize())} on disk)`);
  if (!hasColumn) console.log("note: migration 0009 not applied yet — measuring anyway, --apply will need it");

  type Acc = { rows: number; inline: number; distinct: Set<string>; gz: number };
  const per = new Map<string, Acc>();
  const seen = new Set<string>();
  const total: Acc = { rows: 0, inline: 0, distinct: new Set(), gz: 0 };

  // iterate(): one row in memory at a time — the archive can be gigabytes.
  const it = db
    .prepare(`SELECT account_id, collector, payload FROM raw_spotify WHERE payload IS NOT NULL ORDER BY id`)
    .iterate() as Iterable<{ account_id: string; collector: string; payload: string }>;
  for (const r of it) {
    const a = per.get(r.collector) ?? { rows: 0, inline: 0, distinct: new Set<string>(), gz: 0 };
    per.set(r.collector, a);
    const bytes = Buffer.byteLength(r.payload, "utf8");
    const key = `${r.account_id}\u0000${sha256Hex(r.payload)}`;
    a.rows++;
    a.inline += bytes;
    total.rows++;
    total.inline += bytes;
    if (!seen.has(key)) {
      seen.add(key);
      const gz = encodeBody(r.payload).length;
      a.distinct.add(key);
      a.gz += gz;
      total.distinct.add(key);
      total.gz += gz;
    }
    if (total.rows % 5000 === 0) console.log(`  … ${total.rows} rows read`);
  }

  const line = (name: string, a: Acc) =>
    `${name.padEnd(10)} ${String(a.rows).padStart(8)} rows  ${String(a.distinct.size).padStart(8)} distinct  ` +
    `${mb(a.inline).padStart(10)} inline  →  ${mb(a.gz).padStart(9)} as snapshots`;
  console.log("\ncollector      rows  distinct bodies     today            after --apply");
  for (const [name, a] of [...per.entries()].sort()) console.log(line(name, a));
  console.log(line("TOTAL", total));
  console.log(
    `\nestimated saving: ${mb(total.inline - total.gz)} of payload, reclaimed on disk only after --vacuum.`
  );
  db.close();
}

function applyCompaction(): void {
  const db = new Database(dbPath, { fileMustExist: true });
  db.pragma("journal_mode = WAL");
  // The server may be writing at the same time: wait for its short
  // transactions instead of failing on SQLITE_BUSY.
  db.pragma("busy_timeout = 5000");
  const env = { DB: db } as unknown as Env;
  const ready = db.prepare(`SELECT COUNT(*) FROM sqlite_master WHERE name = 'raw_payloads'`).pluck().get() as number;
  if (!ready) {
    console.error("migration 0009 is not applied: run `npm run migrate` (or restart the container) first.");
    db.close();
    process.exit(1);
  }

  const before = fileSize();
  let rows = 0;
  let inline = 0;
  let snaps = 0;
  let snapBytes = 0;
  for (;;) {
    const r = compactRawBatch(env, 200);
    if (r.rows === 0) break;
    rows += r.rows;
    inline += r.inline_bytes;
    snaps += r.new_snapshots;
    snapBytes += r.snapshot_bytes;
    if (rows % 2000 === 0) console.log(`  … ${rows} rows converted`);
  }
  db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(
    `converted ${rows} rows (${mb(inline)} inline) into ${snaps} new snapshots (${mb(snapBytes)}). ` +
      `File: ${mb(before)} → ${mb(fileSize())} — run --vacuum with the poller stopped to give the space back.`
  );
  db.close();
}

function runVacuum(): void {
  const db = new Database(dbPath, { fileMustExist: true });
  const before = fileSize();
  console.log(`VACUUM ${dbPath} (${mb(before)}) — needs up to that much free space again on the disk…`);
  db.exec("VACUUM");
  db.pragma("wal_checkpoint(TRUNCATE)");
  console.log(`done: ${mb(before)} → ${mb(fileSize())}`);
  db.close();
}

if (!apply && !vacuum) dryRun();
if (apply) applyCompaction();
if (vacuum) runVacuum();
