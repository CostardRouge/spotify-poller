# Architecture

Read before touching the app structure, routing, where server logic lives, the CLI scripts or the build configuration.

## The server logic is not Next.js code, and that is on purpose (2026-08-20)

**Decision**: the poller's business logic — collectors, scheduler, rate-limit handling, backup/export, notifications, lifecycle — lives in `lib/server/`, as plain TypeScript modules with no Next.js import. The App Router routes under `app/api/*` are thin callers. **Why**: the same modules are driven by three different entry points — HTTP routes, the in-process scheduler (`instrumentation.ts`), and the standalone CLI scripts under `scripts/` — and only the first of those is a Next.js runtime. Anything that reaches for `next/*` inside `lib/server/` immediately breaks `tsx scripts/run-once.ts`, which is what the systemd timers and every `make run-*` target call. **How to apply**: new collection or maintenance behaviour goes in `lib/server/`, exposed as a function; the route handler and the script both call it.

## Not `output: "standalone"` (2026-08-20)

**Decision**: `next.config.mjs` deliberately does not set `output: "standalone"`, unlike the sibling Spotify Calendar project. **Why**: standalone traces only what `next start` itself touches, and this image also ships `scripts/*.ts` run through `tsx`, which need the full production dependency tree. That is also why `tsx` and `better-sqlite3` are regular `dependencies`, not `devDependencies` — they must survive `npm prune --omit=dev` in the Dockerfile's `prod-deps` stage. **How to apply**: do not "optimise" the image by switching to standalone or by moving `tsx` to devDependencies; both break the CLI scripts inside the container, and the failure only appears at `make prod-migrate` time.

## `serverExternalPackages: ["better-sqlite3"]` (2026-08-20)

`better-sqlite3` is a native addon and must not be bundled by Next's server compiler — it is listed in `serverExternalPackages` (`next.config.mjs`). Removing it produces a runtime resolution failure, not a build error.

## Route layout and the legacy OAuth aliases (2026-08-20)

The dashboard pages live under the `(dashboard)` route group, whose `layout.tsx` is the sidebar app shell; `/login` sits outside it. `app/auth/login/route.ts` and `app/auth/callback/route.ts` are **aliases** of the `/api/spotify/*` handlers, kept because an already-registered Spotify Redirect URI cannot be changed retroactively without breaking a live install (restored in `8233de1`). Do not delete them as dead code — see `docs/memory/auth.md`.

## `proxy.ts`, not `middleware.ts` (2026-08-20)

The single auth gate for pages and admin API routes is `proxy.ts` at the repo root. It is the one place that decides "is this an authenticated operator", so a page and the route handlers it calls can never disagree. Its `PUBLIC_PATHS` list is deliberately short and each entry has a stated reason in the file. Adding a public route means editing that list and saying why.

## Scripts are the operational surface (2026-08-20)

`scripts/*.ts` run through `tsx` against the TypeScript source, with no build step, so the same command works on bare metal, in Docker and in CI. `scripts/migrate.ts` is idempotent and runs at every container boot from the `CMD`. `scripts/get-refresh-token.mjs` is the pre-`accounts`-table fallback path and is no longer the normal way to connect — the OAuth flow in the UI is (`README.md`).

## Path alias (2026-08-20)

`tsconfig.json` maps `@/*` to the repo root. Prefer it over deep relative chains in `app/` and `components/`; `lib/server/` modules import each other relatively.

## The listening aggregation is one temp table, and must stay synchronous (2026-08-21)

**Decision**: `lib/server/listening.ts` extracts the filtered rows once into `temp.ls`, with the local-clock parts already computed, then runs ~20 aggregates against it and drops it in a `finally`. **Why**: the expensive step is the pass over the history plus the JSON payload parsing; doing it per aggregate would multiply it by twenty. **The constraint that comes with it**: the better-sqlite3 connection is a process-wide singleton (`runtime.ts`), so the temp table is shared state — the function is safe only because it never `await`s, and nothing else can run between its CREATE and its DROP. An `await` added anywhere inside would let two page loads overwrite each other's scope. Cost is O(history): ~650 ms over 30k events unfiltered, ~200 ms with a year's date range, which is why nothing calls it from the Overview.

## Local clock in SQL comes from a CASE over DST segments (2026-08-21)

**Decision**: `lib/server/localtime.ts` probes `Intl` once per day of the range, bisects each offset change to the minute, and hands SQL a `CASE` expression over those few boundaries; comparisons run on `substr(ts, 1, 19)`. **Why**: SQLite has no IANA database (`datetime(ts, 'localtime')` reads the *server* zone, UTC in a container), a `db.function()` UDF would cross into JS once per row on the connection that also serves collection, and a materialised local column would go stale the day `TIMEZONE` changes. **The `substr` matters**: `played_at` carries milliseconds and `added_at` does not, and `'…:00.123Z' < '…:00Z'` is true as a string — cutting both sides to whole seconds is what makes the boundary test mean what it reads.
