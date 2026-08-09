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

# 1) Install dependencies -----------------------------------------------------
FROM node:24-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json* ./
RUN npm ci || npm install

# 2) Build --------------------------------------------------------------------
FROM node:24-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# 3) Production dependencies only ---------------------------------------------
# Prune the already-compiled node_modules instead of reinstalling: one native
# better-sqlite3 build for the whole image, no toolchain needed here.
FROM node:24-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY --from=deps /app/node_modules ./node_modules
RUN npm prune --omit=dev

# 4) Runtime ------------------------------------------------------------------
FROM node:24-alpine AS runner
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
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/api/health || exit 1

# Migrations are idempotent (scripts/migrate.ts) — safe to run at every boot.
CMD ["sh", "-c", "node_modules/.bin/tsx scripts/migrate.ts && node_modules/.bin/next start -H $API_HOST -p $API_PORT"]
