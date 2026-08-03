#!/usr/bin/env node
/**
 * Exécution unique d'un collecteur, invoquée par systemd (voir systemd/*.service).
 * Remplace le handler `scheduled` du Worker : ici, c'est le timer systemd qui
 * décide de la cadence, ce script ne fait qu'exécuter un passage et sortir.
 *
 * Usage : node dist/run-once.js A
 *         node dist/run-once.js B
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
db.pragma("journal_mode = WAL"); // tolère mieux une coupure brutale (kill -9, panne) qu'en mode rollback

const env = loadEnvFromProcess(db);

runCollector(collector, "cron", env)
  .then((result) => {
    console.log(`[${new Date().toISOString()}] collecteur ${collector} :`, result);
    db.close();
    // exit(1) sur 'error' : le systemd service peut alors être configuré en
    // Restart=on-failure si on veut une relance immédiate en plus du timer.
    process.exit(result.status === "error" ? 1 : 0);
  })
  .catch((e) => {
    console.error("erreur non capturée :", e);
    db.close();
    process.exit(1);
  });
