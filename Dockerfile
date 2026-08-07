# ---------------------------------------------------------------------------
# Production / Home Lab image (Dell OptiPlex).
# Multi-stage build producing a minimal Node runtime image.
# better-sqlite3 compiles a native binding on musl, hence the build toolchain
# in the dependency stages (absent from the runtime stage).
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
ENV API_PORT=8787
# The SQLite database lives on /data — ALWAYS a mounted volume (compose), never
# the container's writable layer: the collected data is irreplaceable (§1).
ENV DB_PATH=/data/life-events.db

# Run as an unprivileged user.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 poller

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY migrations ./migrations
COPY public ./public
COPY package.json ./

RUN mkdir -p /data && chown poller:nodejs /data
VOLUME /data

USER poller
EXPOSE 8787

# Container-level healthcheck hits /health. Complements — never replaces — the
# external watchdog (healthchecks.io), the only guard against a dead host.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:8787/health || exit 1

# Migrations are idempotent (dist/migrate.js) — safe to run at every boot.
CMD ["sh", "-c", "node dist/migrate.js && node dist/server.js"]
