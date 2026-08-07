#!/usr/bin/env node
/**
 * Applies migrations 0001..000N in order, on a fresh or existing database.
 * Idempotent in the broad sense: does not re-apply a migration already marked
 * as applied.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
const migrationsDir = join(__dirname, "..", "migrations");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`);

const applied = new Set(
  (db.prepare(`SELECT name FROM _migrations`).all() as { name: string }[]).map((r) => r.name)
);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();

for (const file of files) {
  if (applied.has(file)) {
    console.log(`already applied: ${file}`);
    continue;
  }
  console.log(`applying: ${file}`);
  const sql = readFileSync(join(migrationsDir, file), "utf8");
  const tx = db.transaction(() => {
    db.exec(sql);
    db.prepare(`INSERT INTO _migrations (name, applied_at) VALUES (?, ?)`).run(
      file,
      new Date().toISOString()
    );
  });
  tx();
}

console.log(`OK — database up to date: ${dbPath}`);
db.close();
