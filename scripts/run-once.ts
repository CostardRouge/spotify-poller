#!/usr/bin/env node
/**
 * Single run of a collector, invoked by systemd (see systemd/*.service).
 * The systemd timer decides the cadence, this script only performs one run
 * and exits.
 *
 * Usage: npm run run:played
 *        npm run run:liked
 *        node_modules/.bin/tsx scripts/run-once.ts played
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { COLLECTOR_IDS, loadEnvFromProcess, parseCollectorId } from "../lib/server/types";
import { runCollector } from "../lib/server/run-core";

// 'A'/'B' still resolve: a systemd unit installed before the rename keeps
// working until the units are reinstalled.
const collector = parseCollectorId(process.argv[2]);
if (collector === null) {
  console.error(`usage: run-once.ts ${COLLECTOR_IDS.join("|")}`);
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
