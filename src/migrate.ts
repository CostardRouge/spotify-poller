#!/usr/bin/env node
/**
 * Applique les migrations 0001..000N dans l'ordre, sur une base neuve ou existante.
 * Idempotent au sens large : ne réapplique pas une migration déjà marquée appliquée.
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
    console.log(`déjà appliquée : ${file}`);
    continue;
  }
  console.log(`application : ${file}`);
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

console.log(`OK — base à jour : ${dbPath}`);
db.close();
