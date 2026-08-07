#!/usr/bin/env node
/**
 * CLI wrapper around lib/server/backup.ts: node_modules/.bin/tsx scripts/backup.ts [dir]
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { loadEnvFromProcess } from "../lib/server/types";
import { runBackup } from "../lib/server/backup";

const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
db.pragma("journal_mode = WAL");
const env = loadEnvFromProcess(db);

runBackup(env, process.argv[2] || env.BACKUP_DIR)
  .then((r) => {
    const mb = (r.bytes / 1024 / 1024).toFixed(1);
    console.log(`backup written: ${r.file} (${mb} MB in ${r.ms} ms)`);
    if (r.pruned.length) console.log(`rotated out: ${r.pruned.join(", ")}`);
    console.log("REMINDER: this file contains the Spotify refresh token — treat it like .env.");
    db.close();
  })
  .catch((e) => {
    console.error("backup failed:", e);
    db.close();
    process.exit(1);
  });
