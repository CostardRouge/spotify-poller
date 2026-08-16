# ---------------------------------------------------------------------------
# Production / Home Lab image (Dell OptiPlex).
# Multi-stage build producing a minimal Node + Next.js runtime image.
# better-sqlite3 compiles a native binding on musl, hence the build toolchain
# in the dependency stages (absent from the runtime stage).
#
# Deliberately NOT `next build`'s standalone output: this app also ships CLI
# scripts (migrate/backup/export/import, run via tsx — see scripts/) that need
# the full dependency tree at runtime, not just what `next start` itself
# touches. tsx and better-sqlite3 are regular `dependencies` for exactly this
# reason — they must survive `npm prune --omit=dev`.
# ---------------------------------------------------------------------------

# Node is PINNED to an exact version, deliberately. The floating node:24-alpine
# tag silently moved to 24.19.0 (2026-08-03), whose new node::ObjectWrap
# cleanup hooks (nodejs/node#63642) make NAN-style native addons — better-
# sqlite3 among them, v12 included — abort the process at random with
#   Assertion failed: (env) != nullptr  (RemoveEnvironmentCleanupHook)
# Every CI rebuild after that date shipped the regression, and in production it
# looked like the server "randomly crashing": a native abort minutes-to-hours
# in, then a restart loop. A base image is a dependency like any other — it
# gets a version, and bumping it is a reviewed change, not a side effect of
# rebuilding. Before bumping past 24.18.0, check that nodejs/node#63642 is
# fixed in the target release.
# 1) Install dependencies -----------------------------------------------------
FROM node:24.18.0-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 2) Build --------------------------------------------------------------------
FROM node:24.18.0-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3) Production dependencies only ---------------------------------------------
# Prune the already-compiled node_modules instead of reinstalling: one native
# better-sqlite3 build for the whole image, no toolchain needed here.
FROM node:24.18.0-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

# 4) Runtime ------------------------------------------------------------------
FROM node:24.18.0-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV API_HOST=0.0.0.0
ENV API_PORT=3000
# The SQLite database lives on /data — ALWAYS a mounted volume (compose), never
# the container's writable layer: the collected data is irreplaceable (§1).
ENV DB_PATH=/data/life-events.db
# Snapshots go to /backups — a HOST bind mount in docker-compose.prod.yml, so a
# lost data volume does not take the backups with it.
ENV BACKUP_DIR=/backups
# Bound the V8 heap well below anything the host would miss. Steady-state RSS
# is ~110 MB and the heaviest legitimate operation (the NDJSON export) peaks
# ~150 MB, so 512 MB is generous headroom — while an actual leak now dies FAST,
# with a V8 "heap out of memory" message in `docker logs`, instead of growing
# for hours until the kernel OOM-killer SIGKILLs the container at some random
# later moment, unlogged from inside and indistinguishable from a crash.
ENV NODE_OPTIONS="--max-old-space-size=512"

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 poller

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/migrations ./migrations
COPY --from=builder /app/next.config.mjs ./next.config.mjs
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/instrumentation.ts ./instrumentation.ts
COPY package.json ./

RUN mkdir -p /data /backups && chown poller:nodejs /data /backups
VOLUME /data

USER poller
EXPOSE 3000

# Container-level healthcheck hits /api/health. Complements — never replaces —
# the external watchdog (healthchecks.io), the only guard against a dead host.
#
# Tuned for a SINGLE-instance origin: a reverse proxy that honours container
# health (Traefik's docker provider does) pulls an unhealthy container out of
# rotation, and with no second instance to fail over to, that eviction turns
# "slow for a minute" into a hard 502/404 outage. So the probe tolerates a 10 s
# stall and needs ~2.5 min of CONSECUTIVE failures (5 × 30 s) before declaring
# death — while a genuinely dead process still fails instantly (connection
# refused) and a start-up (migrations included) gets 60 s of grace, during
# which one successful probe flips the container healthy immediately.
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=5 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Migrations are idempotent (scripts/migrate.ts) — safe to run at every boot.
#
# The `exec` is load-bearing. Without it, sh stays PID 1 for the container's
# whole life, and `docker stop`'s SIGTERM stops AT sh — sh does not forward
# signals to its children — so the server never hears it, the 10 s grace
# period expires, and the entire container is SIGKILLed. Every ordered stop
# (docker stop, a redeploy, a Watchtower update) then ends in a hard kill:
# no graceful shutdown, and indistinguishable from an OOM-kill to the
# lifecycle boot report. With `exec`, sh replaces itself with the server once
# migrations finish; the server is PID 1, receives SIGTERM directly, writes
# its stop marker and exits promptly instead of eating the full grace period.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && exec node_modules/.bin/next start -H $API_HOST -p $API_PORT"]
