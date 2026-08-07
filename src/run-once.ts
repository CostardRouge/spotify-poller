#!/usr/bin/env node
/**
 * Single run of a collector, invoked by systemd (see systemd/*.service).
 * Replaces the Worker's `scheduled` handler: here the systemd timer decides
 * the cadence, this script only performs one run and exits.
 *
 * Usage: node dist/run-once.js A
 *        node dist/run-once.js B
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { loadEnvFromProcess } from "./types";
import { runCollector } from "./run-core";

const collector = process.argv[2];
if (collector !== "A" && collector !== "B") {
  console.error("usage: run-once.js A|B");
  process.exit(2);
}

const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
const db = new Database(dbPath);
db.pragma("journal_mode = WAL"); // survives an abrupt shutdown (kill -9, power cut) better than rollback mode

const env = loadEnvFromProcess(db);

runCollector(collector, "cron", env)
  .then((result) => {
    console.log(`[${new Date().toISOString()}] collector ${collector}:`, result);
    db.close();
    // exit(1) on 'error': the systemd service can then be configured with
    // Restart=on-failure for an immediate retry on top of the timer.
    process.exit(result.status === "error" ? 1 : 0);
  })
  .catch((e) => {
    console.error("uncaught error:", e);
    db.close();
    process.exit(1);
  });
