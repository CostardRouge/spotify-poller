# Project memory — decisions, reasons, traps

Long-term memory of this repo, read at the start of **every** agent session (imported by `CLAUDE.md`). It holds what the code and `git log` cannot tell you: the choices made and their reasons, what was tried and rejected, the traps that cost time, how the maintainer likes to work.

This file is the **always-loaded index**. The detail lives in `docs/memory/<topic>.md`, one file per area, loaded **on demand**: read the topic file(s) matching the area you are about to touch **before** acting (table at the bottom). Do not `@import` them into `CLAUDE.md` — the split exists to keep the per-session prompt small.

## How to maintain (mandatory — CLAUDE.md rule 2)

- **When**: at the end of every task, before its commit, in the same commit. Writing is the **default**; only skip if there is truly nothing a future agent could use, and say so explicitly in the final message.
- **What**: a design/product decision, a non-obvious technical choice, an explicit rejection ("the maintainer did not want X because Y"), a trap (browser, tooling, framework, hosting) and its remedy, a working preference. Not implementation detail readable in the diff, not what `git log` already says, not history ("this was fixed on…") — once a fix is committed, keep only the rule it taught.
- **Where**: the matching `docs/memory/<topic>.md`; a new file only when no topic fits (kebab-case name, add it to the table below with a "read when"). Cross-cutting rules, working style, decisions-at-a-glance and open items stay in this index.
- **How**: search first and **update** the existing entry rather than adding a near-duplicate; delete what became false. One entry = one short paragraph: *decision → why → how to apply*, dated `YYYY-MM-DD` on first write and on each revision. Say the same thing **once** — cross-reference other files by name instead of repeating.
- **Language**: **English**, dense, factual. No session narration.
- Budget: keep this index under ~200 lines and each topic file under ~150; if one outgrows that, split it.

## Working with Steeve Pommier

<!-- Fill in as you learn: how they validate work, how they phrase requests,
     what they want when an audit finds problems, what annoys them. -->

- 2026-08-20 — Almost all feature work reaches `main` through a Claude session on a `claude/<topic>-<id>` branch, merged by a GitHub pull request; the maintainer's own commits are rarer and mostly setup. Expect to work on a branch and open a PR, not to push to `main`.
- 2026-08-20 — Comments here explain **why**, at length, and are written to be read months later: `Dockerfile`, the compose files, `lib/server/notify.ts` and `eslint.config.mjs` each carry paragraph-long rationale next to the line it justifies. Match that density on non-obvious choices instead of stripping it — a bare value with no reason reads as an accident in this repo.
- 2026-08-20 — Precision about uncertainty is the house style (`PRODUCT.md`: "honest about what is inferred"; `docs/findings.md` keeps empirical questions open with empty **Result** fields rather than guessing). Mark an inference as an inference, and surface a caveat in the response rather than papering over it.
- 2026-08-20 — Failure modes get named and documented, not just fixed: the 502/404 sequence, the three ways a process can die, the Node × better-sqlite3 abort. A fix whose reasoning is not written down anywhere is half-delivered here.

## Direction in five lines

- One product for one person: the operator of a self-hosted homelab, who is also the only end user of the data (`PRODUCT.md`).
- The job is **custody of an irreplaceable stream** — Spotify exposes only the last 50 plays, so an uncollected window is gone permanently.
- The interface is a custody report: prove collection is alive, declare gaps rather than let an empty day read as silence, let the operator browse and export.
- Success criterion: healthy vs degraded, legible in under two seconds, from a phone.
- Tone: instrument, honest, quiet. Not a Grafana pastiche, not a Spotify surface — green means *healthy*, nothing else.

## Decisions at a glance (details in the topic files)

- Business logic lives in `lib/server/`, free of Next.js imports, because HTTP routes, the in-process scheduler and the `tsx` CLI scripts all drive it — `architecture.md`.
- Next is deliberately **not** built with `output: "standalone"`; `tsx` and `better-sqlite3` are runtime dependencies for that reason — `architecture.md`.
- Every collected table is partitioned by `account_id` with a composite primary key; `events.id` was never rewritten — `data-model.md`, long form in `docs/accounts.md`.
- Migrations are append-only and run at every container boot; the database is irreplaceable, so nothing deletes from `events` — `data-model.md`.
- `recently-played` refetches the last 50 every run with no `after` cursor, and `429` is never retried within a run — `collectors.md`.
- Playback is inferred from sampled progress and never writes into `events` — `collectors.md`.
- Scheduling runs **inside** the long-running container (`SCHEDULE_ENABLED=1`); host cron, an Ofelia container and host systemd timers were all considered and rejected — `deployment.md`, long form in `docs/scheduling.md`.
- The Node base image is pinned to an exact version because a floating tag shipped a native-addon regression into production — `deployment.md`.
- The healthcheck is deliberately slack-tuned: for a single-instance origin, eviction from the proxy *is* the outage — `deployment.md`.
- Two secrets, not one: `ADMIN_TOKEN` unlocks the session, `JWT_SECRET` signs it — `auth.md`.
- `/api/health` is liveness-only because it was once public *and* informative; detail moved to the gated `/api/status` — `observability.md`.
- Only the external watchdog can detect silence; ntfy and the Docker healthcheck structurally cannot — `observability.md`.
- The OKLCH design tokens were carried over verbatim from the pre-Next.js UI; the migration was meant to change the framework, not the design — `frontend.md`.
- A fourth collector, `artists`, exists only to enrich: it fetches artist genres, writes no `events` row and guards no history — `collectors.md`, and `artists` is the one table with no `account_id` — `data-model.md`.
- The Listening page cross-filters through the query string — every chart is a link, no client JavaScript — and draws volume in neutral ink because green means *healthy* — `frontend.md`; the aggregation is one temp-table materialisation per request, synchronous end to end — `architecture.md`.

## Open items (dated; remove when done)

- 2026-08-20 — **No automated test suite exists**, and no CI job runs `lint` or `typecheck` — only the post-merge Docker build and the Pages showcase run at all, so nothing gates a merge. Whether to add a runner and a PR check is the maintainer's call (`testing.md`).
- 2026-08-20 — The seven empirical questions in `docs/findings.md` are all still unanswered (every **Result** field empty). Test 2 (offline listening — do timestamps reflect the listen or the sync?) constrains everything built on top of the data; test 1 (is `played_at` the start or the end?) is why playback sessions are kept out of `events`. Only the maintainer can run them: they need a real account and a real phone.
- 2026-08-20 — `.idea/` was untracked in commit `1931dfc` of this branch, although the maintainer had committed it deliberately in `916662a`. The files are untouched on disk. If sharing IDE project structure across machines was the intent, revert that and drop `.idea/` from `.gitignore` — the maintainer's call, not an agent's.

## Topic files — read before touching the area

| File | Read when you touch… |
| --- | --- |
| `docs/memory/architecture.md` | app structure, routing, where server logic lives, the CLI scripts, build config |
| `docs/memory/data-model.md` | SQLite schema, migrations, `events`/`raw_spotify`, account partitioning, backup/export |
| `docs/memory/collectors.md` | `played`/`liked`/`playback`, Spotify API calls, rate limits, idempotence, backfill |
| `docs/memory/deployment.md` | Dockerfiles, compose stacks, GHCR/CI, scheduling, systemd, the 502/404 failure mode |
| `docs/memory/auth.md` | login, JWT session, `proxy.ts`, OAuth connect/reconnect, scopes |
| `docs/memory/frontend.md` | pages, components, styling, theme, keyboard surface, the product bar |
| `docs/memory/observability.md` | `/api/health`, watchdog, ntfy, boot reports, what monitoring does and does not catch |
| `docs/memory/testing.md` | verification commands, CI workflows, the showcase pipeline, what is actually gated |
