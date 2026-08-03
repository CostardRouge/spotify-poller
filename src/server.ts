#!/usr/bin/env node
/**
 * Petit serveur HTTP pour les endpoints de la spec §11.
 * À faire tourner en systemd service long-running (spotify-poller-api.service),
 * séparé des timers A/B qui font le travail de fond.
 *
 * Écoute en localhost par défaut — pas d'exposition directe à internet.
 * Si un accès distant est souhaité plus tard, passer par un reverse proxy
 * (Caddy/Nginx) avec TLS, plutôt qu'exposer ce process nu.
 */
import "dotenv/config";
import { createServer } from "node:http";
import Database from "better-sqlite3";
import { loadEnvFromProcess } from "./types";
import { healthSnapshot, statsSnapshot } from "./db";
import { runCollector } from "./run-core";

const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
const port = Number(process.env.API_PORT ?? "8787");
const host = process.env.API_HOST ?? "127.0.0.1";

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
const env = loadEnvFromProcess(db);

function json(res: import("node:http").ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function isAdmin(req: import("node:http").IncomingMessage): boolean {
  const h = req.headers.authorization ?? "";
  return h === `Bearer ${env.ADMIN_TOKEN}` && env.ADMIN_TOKEN.length > 0;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, healthSnapshot(env));
  }

  if (req.method === "POST" && url.pathname === "/run") {
    if (!isAdmin(req)) return json(res, { error: "unauthorized" }, 401);
    const c = url.searchParams.get("collector");
    if (c !== "A" && c !== "B") return json(res, { error: "collector must be A or B" }, 400);
    const result = await runCollector(c, "manual", env);
    return json(res, result, result.status === "error" ? 500 : 200);
  }

  if (req.method === "GET" && url.pathname === "/stats") {
    if (!isAdmin(req)) return json(res, { error: "unauthorized" }, 401);
    return json(res, statsSnapshot(env));
  }

  json(res, { error: "not found" }, 404);
});

server.listen(port, host, () => {
  console.log(`API poller sur http://${host}:${port} (db: ${dbPath})`);
});

process.on("SIGTERM", () => {
  db.close();
  server.close(() => process.exit(0));
});
