/**
 * Everything the Database page reports, gathered in one place.
 *
 * This is a DEBUG surface for a database that is the whole point of the
 * project (spec §1: the collected history is irreplaceable), so it answers the
 * three questions you actually have when you go looking:
 *
 *   1. how big is it, and what is making it big;
 *   2. is the disk it lives on going to run out;
 *   3. is it actually being backed up, somewhere that survives losing the disk.
 *
 * Cost matters here, and it decides the shape of this file. Every read below is
 * synchronous — better-sqlite3 blocks the event loop, and this process also
 * serves the UI and drives the collectors, so anything that walks the whole
 * file stalls collection for as long as it runs. Worse, a stall long enough to
 * miss three container HEALTHCHECKs takes the origin out of rotation, which is
 * a 502/404 on a server that never crashed.
 *
 * So the two full-file passes are BOTH opt-in, and the page loads without them:
 *
 *   - `databaseInfo()` — what the page always shows. Pragmas and `statSync` are
 *     free, and the row counts are index scans (~25 ms per table at 300k rows).
 *     The total on-disk size comes from the filesystem, so "how big is it" is
 *     answered without reading a single page.
 *   - `objectBreakdown()` — per-table and per-index byte attribution, via
 *     `dbstat`. The only way to get it is to walk every page: ~300 ms on a
 *     600 MB database with a warm cache, ~2.4 s cold, and it grows with the
 *     file. On demand, and it reports its own `ms` so the cost is visible.
 *   - `integrityCheck()` — a full verification pass, same reasoning, and a
 *     question you only ask when you already suspect corruption.
 */
import { statSync, statfsSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Env } from "./types";

export interface TableSize {
  name: string;
  kind: "table" | "index";
  /** Which table this belongs to — an index is grouped under its table. */
  table: string;
  bytes: number;
  rows: number | null;
}

export interface BackupFile {
  name: string;
  bytes: number;
  modified: string;
}

export interface DatabaseInfo {
  path: string;
  /** Bytes of the .db file itself, and of the WAL/SHM sidecars beside it. */
  file_bytes: number;
  wal_bytes: number;
  shm_bytes: number;
  total_bytes: number;

  page_size: number;
  page_count: number;
  /** Pages freed by deletes and not yet returned to the filesystem. */
  freelist_pages: number;
  freelist_bytes: number;

  journal_mode: string;
  auto_vacuum: string;
  synchronous: string;
  /** Pages the WAL is allowed to reach before SQLite checkpoints it. */
  wal_autocheckpoint: number;
  sqlite_version: string;

  disk: { total_bytes: number; free_bytes: number; used_ratio: number } | null;
  /** True when BACKUP_DIR sits on the same filesystem as the database. */
  backups_share_disk: boolean | null;

  /** Row counts per table — index scans, cheap enough for every page load. */
  rows: { table: string; rows: number | null }[];

  migrations: { name: string; applied_at: string }[];

  events: {
    total: number;
    oldest: string | null;
    newest: string | null;
    /** Bytes of database per day of history, from the span above. */
    bytes_per_day: number | null;
  };
  raw: { total: number; oldest: string | null; newest: string | null };
  playback_samples: { total: number; oldest: string | null };

  backup_dir: string;
  backup_keep: number;
  backup_enabled: boolean;
  backups: BackupFile[];
  backups_error: string | null;
}

/** A pragma that may be absent on an old SQLite build must not take the page down. */
function pragma(env: Env, name: string): unknown {
  try {
    return env.DB.pragma(name, { simple: true });
  } catch {
    return null;
  }
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

/** 0/1/2 and 0/1/2/3 are how SQLite reports these — the names are what you want to read. */
const AUTO_VACUUM = ["none", "full", "incremental"];
const SYNCHRONOUS = ["off", "normal", "full", "extra"];

function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return 0; // -wal and -shm only exist while the database is open in WAL mode
  }
}

/** The project's own tables, in schema order — sqlite_* internals excluded. */
function userTables(env: Env): string[] {
  return (
    env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    ).all() as { name: string }[]
  ).map((r) => r.name);
}

function countRows(env: Env, table: string): number | null {
  try {
    // The table name comes from sqlite_master, never from user input — it
    // cannot be a bind parameter, and there is nothing here to inject.
    return (env.DB.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n: number }).n;
  } catch {
    return null;
  }
}

function minMax(env: Env, table: string, column: string): { oldest: string | null; newest: string | null } {
  try {
    const r = env.DB.prepare(`SELECT MIN("${column}") AS lo, MAX("${column}") AS hi FROM "${table}"`).get() as {
      lo: string | null;
      hi: string | null;
    };
    return { oldest: r.lo, newest: r.hi };
  } catch {
    return { oldest: null, newest: null };
  }
}

/** Same device = a disk failure takes the database and its backups together. */
function sameFilesystem(a: string, b: string): boolean | null {
  try {
    return statSync(a).dev === statSync(b).dev;
  } catch {
    return null;
  }
}

function listBackups(dir: string): { files: BackupFile[]; error: string | null } {
  try {
    const files = readdirSync(dir)
      .filter((f) => f.startsWith("life-events-") && f.endsWith(".db"))
      .map((name) => {
        const s = statSync(join(dir, name));
        return { name, bytes: s.size, modified: new Date(s.mtimeMs).toISOString() };
      })
      // Newest first: the only one whose age you care about is the last one.
      .sort((a, b) => b.modified.localeCompare(a.modified));
    return { files, error: null };
  } catch (e) {
    // A missing or unreadable BACKUP_DIR is itself the finding — the page says
    // so rather than rendering an empty list that looks like "no backups yet".
    return { files: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export function databaseInfo(env: Env): DatabaseInfo {
  const path = resolve(process.env.DB_PATH ?? "./data/life-events.db");

  const pageSize = num(pragma(env, "page_size"), 4096);
  const pageCount = num(pragma(env, "page_count"));
  const freelist = num(pragma(env, "freelist_count"));

  const fileBytes = sizeOf(path);
  const walBytes = sizeOf(`${path}-wal`);
  const shmBytes = sizeOf(`${path}-shm`);

  let disk: DatabaseInfo["disk"] = null;
  try {
    const fs = statfsSync(dirname(path));
    const total = fs.blocks * fs.bsize;
    // bavail, not bfree: the reserved blocks are not ours to write into.
    const free = fs.bavail * fs.bsize;
    disk = { total_bytes: total, free_bytes: free, used_ratio: total > 0 ? 1 - free / total : 0 };
  } catch {
    disk = null;
  }

  const eventSpan = minMax(env, "events", "ts_utc");
  const eventTotal = countRows(env, "events") ?? 0;
  let bytesPerDay: number | null = null;
  if (eventSpan.oldest && eventSpan.newest) {
    const days = (Date.parse(eventSpan.newest) - Date.parse(eventSpan.oldest)) / 86_400_000;
    // Under a day of history says nothing about a yearly trend.
    if (days >= 1) bytesPerDay = fileBytes / days;
  }

  const rawSpan = minMax(env, "raw_spotify", "fetched_at");
  const playbackSpan = minMax(env, "playback_samples", "observed_at");

  const backupDir = resolve(env.BACKUP_DIR);
  const backups = listBackups(backupDir);

  return {
    path,
    file_bytes: fileBytes,
    wal_bytes: walBytes,
    shm_bytes: shmBytes,
    total_bytes: fileBytes + walBytes + shmBytes,

    page_size: pageSize,
    page_count: pageCount,
    freelist_pages: freelist,
    freelist_bytes: freelist * pageSize,

    journal_mode: String(pragma(env, "journal_mode") ?? "unknown"),
    auto_vacuum: AUTO_VACUUM[num(pragma(env, "auto_vacuum"))] ?? "unknown",
    synchronous: SYNCHRONOUS[num(pragma(env, "synchronous"))] ?? "unknown",
    wal_autocheckpoint: num(pragma(env, "wal_autocheckpoint")),
    sqlite_version: String(
      (env.DB.prepare(`SELECT sqlite_version() AS v`).get() as { v: string }).v
    ),

    disk,
    backups_share_disk: sameFilesystem(dirname(path), backupDir),

    rows: userTables(env).map((table) => ({ table, rows: countRows(env, table) })),

    migrations: env.DB.prepare(`SELECT name, applied_at FROM _migrations ORDER BY name`).all() as {
      name: string;
      applied_at: string;
    }[],

    events: {
      total: eventTotal,
      oldest: eventSpan.oldest,
      newest: eventSpan.newest,
      bytes_per_day: bytesPerDay,
    },
    raw: { total: countRows(env, "raw_spotify") ?? 0, oldest: rawSpan.oldest, newest: rawSpan.newest },
    playback_samples: { total: countRows(env, "playback_samples") ?? 0, oldest: playbackSpan.oldest },

    backup_dir: backupDir,
    backup_keep: env.BACKUP_KEEP,
    backup_enabled: env.BACKUP_ENABLED,
    backups: backups.files,
    backups_error: backups.error,
  };
}

export interface ObjectBreakdown {
  objects: TableSize[];
  /** Wall-clock cost of the pass, so the page can own up to what it just spent. */
  ms: number;
  /** false when this SQLite build has no dbstat — sizes are then unavailable. */
  available: boolean;
}

/**
 * Per-object byte attribution, via the dbstat virtual table. On demand only —
 * it walks every page of the file (see the note at the top).
 *
 * dbstat is a compile-time option (SQLITE_ENABLE_DBSTAT_VTAB), on in the SQLite
 * better-sqlite3 bundles. A system SQLite built without it degrades the panel
 * instead of breaking the page.
 */
export function objectBreakdown(env: Env): ObjectBreakdown {
  const started = Date.now();

  const owner = new Map<string, { kind: "table" | "index"; table: string }>();
  const schema = env.DB.prepare(
    `SELECT name, type, tbl_name FROM sqlite_master WHERE type IN ('table', 'index')`
  ).all() as { name: string; type: "table" | "index"; tbl_name: string }[];
  for (const o of schema) owner.set(o.name, { kind: o.type, table: o.tbl_name });

  let sizes: { name: string; bytes: number }[];
  try {
    sizes = env.DB.prepare(`SELECT name, SUM(pgsize) AS bytes FROM dbstat GROUP BY name`).all() as {
      name: string;
      bytes: number;
    }[];
  } catch {
    return { objects: [], ms: Date.now() - started, available: false };
  }

  const objects = sizes.map((s) => {
    const meta = owner.get(s.name) ?? { kind: "table" as const, table: s.name };
    return {
      name: s.name,
      kind: meta.kind,
      table: meta.table,
      bytes: num(s.bytes),
      // What turns a byte count into something you can act on: "2 KB a row" is
      // a payload decision, "2 GB of something" is a mystery. Tables only.
      rows: meta.kind === "table" && !s.name.startsWith("sqlite_") ? countRows(env, s.name) : null,
    };
  });
  objects.sort((a, b) => b.bytes - a.bytes);

  return { objects, ms: Date.now() - started, available: true };
}

/**
 * Full structural verification. Deliberately NOT in databaseInfo: it reads
 * every page and validates every index, so its cost grows with the file and it
 * blocks collection while it runs. On demand only.
 *
 * `quick_check` rather than `integrity_check`: it skips the (expensive)
 * index-content cross-check but still catches the corruption that actually
 * happens to a home-lab SQLite file — a torn write from a power cut, a bad
 * sector. Returns "ok" when the database is sound.
 */
export function integrityCheck(env: Env): { ok: boolean; result: string; ms: number } {
  const started = Date.now();
  const raw = env.DB.pragma("quick_check", { simple: true });
  const result = String(raw);
  return { ok: result === "ok", result, ms: Date.now() - started };
}
