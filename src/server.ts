#!/usr/bin/env node
/**
 * HTTP server: administration endpoints (spec §11), the account connection
 * OAuth flow, the JSON browsing API and the static debug UI.
 *
 * Two execution modes:
 *  - bare metal: long-running systemd service (spotify-poller-api.service),
 *    the systemd timers drive collection through run-once.ts;
 *  - container: this process ALSO carries the scheduling loop
 *    (SCHEDULE_ENABLED=1, see scheduler.ts and docs/scheduling.md).
 *
 * Listens on localhost by default — no direct exposure to the internet.
 * If remote access is wanted later, put a reverse proxy (Caddy/Nginx) with TLS
 * in front rather than exposing this bare process.
 */
import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import { COLLECTOR_IDS, loadEnvFromProcess, parseCollectorId } from "./types";
import { healthSnapshot, listEvents, listGaps, listRuns, statsSnapshot } from "./db";
import { appBaseUrl, authStatus, buildAuthorizeUrl, exchangeCode } from "./auth";
import { getRateLimit } from "./spotify-api";
import { runCollector } from "./run-core";
import { schedulerEnabled, schedulerOptionsFromProcess, startScheduler } from "./scheduler";

const dbPath = process.env.DB_PATH ?? "./data/life-events.db";
const port = Number(process.env.API_PORT ?? "8787");
const host = process.env.API_HOST ?? "127.0.0.1";

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
const env = loadEnvFromProcess(db);

const STATE_COOKIE = "sp_state";
const uiHtml = readFileSync(join(__dirname, "..", "public", "index.html"));

function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

function redirect(res: ServerResponse, location: string, cookies: string[] = []) {
  const headers: Record<string, string | string[]> = { Location: location };
  if (cookies.length) headers["Set-Cookie"] = cookies;
  res.writeHead(302, headers);
  res.end();
}

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Admin token accepted in a Bearer header (curl/scripts) or as ?token= (UI
 * browser links, e.g. /auth/login). Debug UI on the local network — the token
 * in the query string is only acceptable in that context.
 */
function isAdmin(req: IncomingMessage, url: URL): boolean {
  if (env.ADMIN_TOKEN.length === 0) return false;
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bearer ") && safeEqual(h.slice(7), env.ADMIN_TOKEN)) return true;
  const q = url.searchParams.get("token");
  return q !== null && safeEqual(q, env.ADMIN_TOKEN);
}

function readCookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function intParam(url: URL, name: string, fallback: number, max: number): number {
  const raw = Number(url.searchParams.get(name));
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  try {
    // ---------- UI ----------
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(uiHtml);
    }

    // ---------- health (public, no secret) ----------
    if (req.method === "GET" && url.pathname === "/health") {
      const auth = authStatus(env);
      return json(res, {
        ...healthSnapshot(env),
        auth: { connected: auth.connected, source: auth.source, connected_at: auth.connected_at },
        rate_limit: getRateLimit(env),
        scheduler: schedulerEnabled() ? schedulerOptionsFromProcess() : null,
      });
    }

    // ---------- Spotify account connection (flow §7, via the UI) ----------
    if (req.method === "GET" && url.pathname === "/auth/login") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      const state = randomBytes(16).toString("hex");
      return redirect(res, buildAuthorizeUrl(env, state), [
        `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`,
      ]);
    }

    if (req.method === "GET" && url.pathname === "/auth/callback") {
      const clearState = `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`;
      const base = appBaseUrl(env);
      const error = url.searchParams.get("error");
      const code = url.searchParams.get("code");
      const state = url.searchParams.get("state");
      if (error) return redirect(res, `${base}/?auth_error=${encodeURIComponent(error)}`, [clearState]);
      if (!code || !state || state !== readCookie(req, STATE_COOKIE)) {
        return redirect(res, `${base}/?auth_error=state_mismatch`, [clearState]);
      }
      try {
        await exchangeCode(env, code);
        return redirect(res, `${base}/?connected=1`, [clearState]);
      } catch (e) {
        console.error("OAuth code exchange failed:", e);
        return redirect(res, `${base}/?auth_error=exchange_failed`, [clearState]);
      }
    }

    // ---------- administration ----------
    if (req.method === "POST" && url.pathname === "/run") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      // 'A'/'B' still resolve (parseCollectorId) so an old bookmark or script
      // does not break, but the documented names are the explicit ones.
      const c = parseCollectorId(url.searchParams.get("collector"));
      if (c === null) {
        return json(res, { error: `collector must be one of: ${COLLECTOR_IDS.join(", ")}` }, 400);
      }
      const result = await runCollector(c, "manual", env);
      return json(res, result, result.status === "error" ? 500 : 200);
    }

    if (req.method === "GET" && url.pathname === "/stats") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      return json(res, statsSnapshot(env));
    }

    // ---------- JSON browsing API (debug UI) ----------
    if (req.method === "GET" && url.pathname === "/api/events") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      return json(
        res,
        listEvents(env, {
          type: url.searchParams.get("type") ?? undefined,
          q: url.searchParams.get("q") ?? undefined,
          from: url.searchParams.get("from") ?? undefined,
          to: url.searchParams.get("to") ?? undefined,
          order: url.searchParams.get("order") === "asc" ? "asc" : "desc",
          limit: intParam(url, "limit", 50, 200),
          offset: intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER),
        })
      );
    }

    if (req.method === "GET" && url.pathname === "/api/runs") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      return json(res, listRuns(env, intParam(url, "limit", 50, 200), intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER)));
    }

    if (req.method === "GET" && url.pathname === "/api/gaps") {
      if (!isAdmin(req, url)) return json(res, { error: "unauthorized" }, 401);
      return json(res, listGaps(env, intParam(url, "limit", 50, 200), intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER)));
    }

    json(res, { error: "not found" }, 404);
  } catch (e) {
    console.error("server error:", e);
    json(res, { error: "internal error" }, 500);
  }
});

server.listen(port, host, () => {
  console.log(`Poller API on http://${host}:${port} (db: ${dbPath})`);
  if (schedulerEnabled()) {
    startScheduler(env, schedulerOptionsFromProcess());
  } else {
    console.log("[scheduler] disabled (SCHEDULE_ENABLED != 1) — collection driven by systemd/run-once");
  }
});

process.on("SIGTERM", () => {
  db.close();
  server.close(() => process.exit(0));
});
