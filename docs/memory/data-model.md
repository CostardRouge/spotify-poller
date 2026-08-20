# Data model, migrations, backup

Read before touching the SQLite schema, a migration, `events`/`raw_spotify`, account partitioning, or backup/export.

## The database is irreplaceable — this constrains every schema decision (2026-08-20)

Spotify's API only ever returns the **last 50 plays**. Anything not collected in time is gone permanently, and anything lost from the database is gone with it. **How to apply**: no migration and no code path may drop, rewrite or de-duplicate rows in `events`, `raw_spotify`, `gaps` or `poller_runs` without being stated explicitly and loudly. The only deletion in the codebase is the opt-in `raw_spotify` age purge (below), and it is careful never to touch `events`.

## `account_id` on every collected table, composite primary key (2026-08-20)

**Decision**: migration `0005` added `account_id` — the Spotify user id from `GET /v1/me` — to every collected table, with a composite primary key. **Why**: before it, `poller_state` keyed on `key` alone, so connecting a second Spotify account silently destroyed the first one's refresh token and cursors and mixed the two histories with no way to separate them. Given an irreplaceable stream, a silent overwrite is the worst possible failure. `events.id` was deliberately **not** rewritten: the key became `(account_id, id)`, which keeps the `INSERT OR IGNORE` dedup per-account without touching a single existing identifier. A string prefix on the ids was rejected — a delimiter to parse and unusable indexes. **How to apply**: a new query, endpoint or table that forgets the account scope silently mixes two people's history. Full rationale, including the legacy-row adoption transaction, in `docs/accounts.md`.

**Consequence for downstream readers**: `events.id` alone is no longer globally unique.

## The `''` global scope (2026-08-20)

Account id `''` (`GLOBAL_SCOPE` in `lib/server/types.ts`) is reserved for app-wide state. The load-bearing one is `ratelimit.limited_until`: Spotify rate-limits per **app** (`client_id`), not per user, so scoping the cooldown per account would let an account switch keep querying during a ban — which only extends it (`lib/server/spotify/api.ts`). Also global: `accounts.active_id`, `notify.*` throttles, `backup.*`, `process.*` lifecycle markers.

## Active account vs viewed account (2026-08-20)

Two different things, kept separate everywhere: the **active** account is the one being collected (`accounts.active_id`, `POST /api/accounts/activate`); the **viewed** account is the one you are looking at (`?account=` on every read endpoint, defaulting to the active one). Looking is not collecting — browsing a dormant account changes nothing. This is a `PRODUCT.md` design principle, not just an implementation detail, and the UI is required to state which is which wherever they could be confused.

## `raw_spotify` is the table that grows without bound (2026-08-20)

Invariant I3 records every response body verbatim before any parsing. Nothing else ever deletes from it, so on a long-running install it is what fills the disk. `RAW_RETENTION_DAYS` opts into an hourly age purge (`purgeRawRows`, `lib/server/db.ts`), bounded to 5000 rows per call. **Why bounded**: it runs synchronously inside a timer of the process that also serves the UI — an unbounded `DELETE` there stalls the event loop, fails the container healthcheck and reads as a 502/404 outage (the PR #8 lesson, see `docs/memory/deployment.md`). Migration `0007` exists solely so that purge and the Database page's age probes hit `idx_raw_fetched_at` instead of walking the payload-heavy table.

## Migrations are append-only and run at every boot (2026-08-20)

Numbered SQL files in `migrations/`, applied by `scripts/migrate.ts`, which is idempotent and is invoked from the container `CMD` on every start. **How to apply**: a schema change is a **new** numbered file. Never edit an existing one — it has already run against the maintainer's production database, and editing it changes nothing there while silently diverging every fresh install. Migration `0004` (collector rename) must run **before** starting a version that expects the new names, or the likes backfill restarts from zero.

## Two backup artefacts, one of which is a secret (2026-08-20)

The `.db` snapshot contains the Spotify **refresh token in clear** and is therefore never downloadable over HTTP: `POST /api/backup` writes it to `BACKUP_DIR` and returns a path, never bytes. The NDJSON export carries `events` only, no secret, and may travel. Snapshots are taken through SQLite's online backup API, not `cp` — a plain copy of a WAL database while the poller writes can produce an unusable file — and land on a **host bind mount** outside the data volume, because a snapshot stored inside the volume it protects dies with it. Rotation happens only **after** a successful write. Restore procedure, including deleting the stale `-wal`/`-shm` files, is in `docs/backup.md`.

**How to apply**: treat `backups/` and any `*.ndjson` like `.env` — both are gitignored, and a `.db` file must never reach a commit, a log, or an HTTP response body.

## Timestamps are UTC in the database, always (2026-08-20)

`ts_utc` is the stored and queried value. `TIMEZONE` (IANA name, default `UTC`) is **display-only** and changes nothing in the database (`3d02cb0`). Do not convert on write.
