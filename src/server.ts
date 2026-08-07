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
 * Two authentication modes (AUTH_MODE, see types.ts):
 *  - 'token'  : ADMIN_TOKEN on every admin route. Default, works anywhere.
 *  - 'proxy'  : the reverse proxy authenticates (Cloudflare Access, Traefik…).
 *               Set PROXY_AUTH_HEADER so a request that reaches the origin
 *               directly, bypassing the proxy, is still rejected.
 *
 * Listens on localhost by default. Exposed remotely, it belongs behind TLS and
 * an authenticating proxy — never bare on the internet.
 */
import "dotenv/config";
import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import Database from "better-sqlite3";
import { COLLECTOR_IDS, Env, GLOBAL_SCOPE, loadEnvFromProcess, parseCollectorId } from "./types";
import {
  getAccount,
  getActiveAccountId,
  eventCountsByAccount,
  healthSnapshot,
  listAccounts,
  listEvents,
  listGaps,
  listRuns,
  setActiveAccountId,
  statsSnapshot,
} from "./db";
import { appBaseUrl, authStatus, buildAuthorizeUrl, exchangeCode } from "./auth";
import { countEvents, iterateEventsNdjson } from "./export";
import { runBackup } from "./backup";
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
 * In 'token' mode: Bearer header (curl/scripts) or ?token= (browser links such
 * as /auth/login, which is a navigation and cannot carry a header).
 *
 * In 'proxy' mode: the proxy already authenticated. A configured
 * PROXY_AUTH_HEADER must still be present — that is what distinguishes a
 * request that came through Cloudflare Access from one that reached the origin
 * directly. A valid ADMIN_TOKEN is still accepted, so local curl keeps working.
 */
function isAuthorized(req: IncomingMessage, url: URL): boolean {
  if (env.ADMIN_TOKEN.length > 0) {
    const h = req.headers.authorization ?? "";
    if (h.startsWith("Bearer ") && safeEqual(h.slice(7), env.ADMIN_TOKEN)) return true;
    const q = url.searchParams.get("token");
    if (q !== null && safeEqual(q, env.ADMIN_TOKEN)) return true;
  }
  if (env.AUTH_MODE !== "proxy") return false;
  if (!env.PROXY_AUTH_HEADER) return true; // trusting the network — warned about at startup
  const value = req.headers[env.PROXY_AUTH_HEADER.toLowerCase()];
  return typeof value === "string" ? value.length > 0 : Array.isArray(value) && value.length > 0;
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

/**
 * Which account's data is being browsed. Defaults to the collected one;
 * `?account=` lets you look at a previously connected account without making
 * it active. Looking is not collecting.
 */
function scopeParam(url: URL): string {
  const requested = url.searchParams.get("account");
  if (requested !== null) return requested;
  return getActiveAccountId(env) ?? GLOBAL_SCOPE;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const unauthorized = () => json(res, { error: "unauthorized" }, 401);

  try {
    // ---------- UI ----------
    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(uiHtml);
    }

    // ---------- health (public, deliberately minimal) ----------
    // Only what the Docker HEALTHCHECK needs. Everything that describes the
    // collection — counters, timestamps, connected account — is on /status,
    // behind auth: an open endpoint leaking listening volume and activity
    // windows is a privacy leak, not a health check.
    if (req.method === "GET" && url.pathname === "/health") {
      return json(res, { status: "ok", auth_mode: env.AUTH_MODE });
    }

    // ---------- detailed status (authenticated) ----------
    if (req.method === "GET" && url.pathname === "/status") {
      if (!isAuthorized(req, url)) return unauthorized();
      const auth = authStatus(env);
      return json(res, {
        ...healthSnapshot(env, scopeParam(url)),
        scope: scopeParam(url),
        auth,
        events_by_account: eventCountsByAccount(env),
        rate_limit: getRateLimit(env),
        scheduler: schedulerEnabled() ? schedulerOptionsFromProcess() : null,
        backup: { enabled: env.BACKUP_ENABLED, dir: env.BACKUP_DIR, keep: env.BACKUP_KEEP },
        notifications: { ntfy: !!env.NTFY_URL, heartbeat: !!env.WATCHDOG_URL },
      });
    }

    // ---------- Spotify account connection (flow §7, via the UI) ----------
    if (req.method === "GET" && url.pathname === "/auth/login") {
      if (!isAuthorized(req, url)) return unauthorized();
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
        const accountId = await exchangeCode(env, code);
        return redirect(res, `${base}/?connected=${encodeURIComponent(accountId)}`, [clearState]);
      } catch (e) {
        console.error("OAuth code exchange failed:", e);
        return redirect(res, `${base}/?auth_error=exchange_failed`, [clearState]);
      }
    }

    // ---------- accounts ----------
    if (req.method === "GET" && url.pathname === "/api/accounts") {
      if (!isAuthorized(req, url)) return unauthorized();
      return json(res, {
        active_account_id: getActiveAccountId(env),
        events_by_account: eventCountsByAccount(env),
        items: listAccounts(env),
      });
    }

    // Switches which account the poller collects for. Purely a pointer move:
    // no data is touched, and the previous account keeps its token and cursors.
    if (req.method === "POST" && url.pathname === "/api/accounts/activate") {
      if (!isAuthorized(req, url)) return unauthorized();
      const id = url.searchParams.get("id");
      if (!id) return json(res, { error: "missing id" }, 400);
      if (!getAccount(env, id)) return json(res, { error: "unknown account" }, 404);
      setActiveAccountId(env, id);
      return json(res, { active_account_id: id });
    }

    // ---------- administration ----------
    if (req.method === "POST" && url.pathname === "/run") {
      if (!isAuthorized(req, url)) return unauthorized();
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
      if (!isAuthorized(req, url)) return unauthorized();
      return json(res, statsSnapshot(env, scopeParam(url)));
    }

    // Writes a full .db snapshot to BACKUP_DIR (a host bind mount). The file
    // itself is NOT downloadable: it holds the Spotify refresh token in clear.
    if (req.method === "POST" && url.pathname === "/backup") {
      if (!isAuthorized(req, url)) return unauthorized();
      const r = await runBackup(env);
      return json(res, { ...r, note: "contains the refresh token — keep it as private as .env" });
    }

    // ---------- NDJSON export (no secret: events only) ----------
    if (req.method === "GET" && url.pathname === "/export") {
      if (!isAuthorized(req, url)) return unauthorized();
      const accountId = scopeParam(url);
      const filter = {
        type: url.searchParams.get("type") ?? undefined,
        q: url.searchParams.get("q") ?? undefined,
        from: url.searchParams.get("from") ?? undefined,
        to: url.searchParams.get("to") ?? undefined,
        order: url.searchParams.get("order") === "desc" ? ("desc" as const) : ("asc" as const),
      };
      const stamp = new Date().toISOString().slice(0, 10);
      res.writeHead(200, {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Content-Disposition": `attachment; filename="spotify-events-${stamp}.ndjson"`,
        "X-Event-Count": String(countEvents(env, accountId, filter)),
      });
      // Readable.from applies backpressure — months of history must never be
      // buffered into a single string.
      return Readable.from(iterateEventsNdjson(env, accountId, filter)).pipe(res);
    }

    // ---------- JSON browsing API (debug UI) ----------
    if (req.method === "GET" && url.pathname === "/api/events") {
      if (!isAuthorized(req, url)) return unauthorized();
      return json(
        res,
        listEvents(env, scopeParam(url), {
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
      if (!isAuthorized(req, url)) return unauthorized();
      return json(
        res,
        listRuns(env, scopeParam(url), intParam(url, "limit", 50, 200), intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER))
      );
    }

    if (req.method === "GET" && url.pathname === "/api/gaps") {
      if (!isAuthorized(req, url)) return unauthorized();
      return json(
        res,
        listGaps(env, scopeParam(url), intParam(url, "limit", 50, 200), intParam(url, "offset", 0, Number.MAX_SAFE_INTEGER))
      );
    }

    json(res, { error: "not found" }, 404);
  } catch (e) {
    console.error("server error:", e);
    if (!res.headersSent) json(res, { error: "internal error" }, 500);
    else res.destroy();
  }
});

/** Refuses to start silently wide open — a misconfiguration must be visible. */
function warnAboutExposure(env: Env): void {
  if (env.AUTH_MODE === "token") return;
  if (env.PROXY_AUTH_HEADER) {
    console.log(`[auth] proxy mode — requiring header '${env.PROXY_AUTH_HEADER}' on admin routes`);
    return;
  }
  console.warn(
    "[auth] ############################################################\n" +
      "[auth] AUTH_MODE=proxy with no PROXY_AUTH_HEADER: every request that\n" +
      "[auth] reaches this process is trusted. Safe ONLY if the origin is\n" +
      "[auth] unreachable except through your authenticating proxy.\n" +
      "[auth] ############################################################"
  );
}

server.listen(port, host, () => {
  console.log(`Poller API on http://${host}:${port} (db: ${dbPath})`);
  warnAboutExposure(env);
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
