# Collectors and the Spotify API

Read before touching `played` / `liked` / `playback`, Spotify API calls, rate limiting, idempotence or the likes backfill.

## Four collectors, one of which is the critical one (2026-08-20)

| id | Endpoint | Cadence | Role |
|---|---|---|---|
| `played` | `/v1/me/player/recently-played` | 30 min | authoritative history; the **only** one that pings the watchdog |
| `liked` | `/v1/me/tracks` | daily (hourly while backfilling) | liked tracks + paginated initial backfill |
| `playback` | `/v1/me/player` | 15 s playing / 60 s idle | opt-in, adds device/volume/context/completion |
| `artists` | `/v1/artists` | daily (hourly while a backlog remains) | enrichment only: artist genres for the already-collected history |

`played` is authoritative because it reads Spotify's 50-track buffer and therefore **back-fills across downtime**. `playback` only sees what happens while the process is up, so it complements `played` and can never replace it (`lib/server/collectors/playback.ts`).

## `artists` is an enrichment collector, and the distinction is load-bearing (2026-08-20)

**Decision**: `lib/server/collectors/artists.ts` fetches `GET /v1/artists` for the artist ids already present in `events.payload.artist_ids` and caches them in `artists` (migration `0008`). It writes **no** `events` row, never pings the watchdog, and its failure is cosmetic. **Why it exists at all**: Spotify attaches genres to the **artist** object — a play carries track, album and artist ids, never a genre — so no amount of collected history can answer "what kind of music" without this second call. **How to apply**: keep it last in the startup stagger and bounded to 1000 artists per run (20 requests × 50 ids, Spotify's cap); the rate limit is per app, so an enrichment run that eats it costs `played` the window that actually matters. It needs no OAuth scope — `/v1/artists` is public catalogue data — so it never triggers the reconnection banner.

**Ids Spotify answers `null` for get a cache row anyway**, with `name` NULL. Without that placeholder the id is forever "not fetched yet" and every run re-requests it: a backlog that cannot drain. Same reasoning as any negative cache — the absence of a row means "unknown", never "unknowable".

## Collector ids are `played`/`liked`, and `A`/`B` still resolve (2026-08-20)

**Decision** (`2266734`): the collectors were renamed from `A`/`B` to what they collect, and the same id is used in the URL, the CLI, the Makefile, the UI and every database row. The old letters are still accepted by `/api/run` and `run-once.ts`, and `SCHEDULE_A_MINUTES`/`SCHEDULE_B_HOURS` are still read as fallbacks in `lib/server/scheduler.ts`. **Why the fallbacks stay**: an already-installed systemd unit or a `.env` written before the rename must not silently fall back to defaults. **How to apply**: do not remove the aliases as dead code; the maintainer's own install is the thing they protect.

## No `after` parameter on recently-played — deliberate (2026-08-20)

**Decision**: `collectRecentlyPlayed` refetches the last 50 on every run and lets `INSERT OR IGNORE` sort it out; `played.last_played_at` is used **only** for gap detection, never to build the request (`lib/server/collectors/recently-played.ts`, spec §5). **Why**: a cursor that drifts or is corrupted silently stops collecting, and the data it would skip is unrecoverable. Refetching is cheap and idempotent (invariant I2). **How to apply**: an optimisation that passes `after=` to reduce payload size trades an unrecoverable failure mode for a negligible saving — do not propose it again.

## 429 is never retried in the same run (2026-08-20)

**Decision**: on a `429`, the `Retry-After` cooldown is **persisted** to `poller_state` and the run aborts; subsequent runs check the cooldown before any call (`lib/server/spotify/api.ts`). Network errors and 5xx get a **bounded** back-off (3 retries) so every call terminates in finite time. **Why persisted rather than in-process**: the poller is driven by short repeated runs, not a long-lived request loop, so a memory-only cooldown dies with the process. Querying during an active ban counts against the app and can extend it. `noteRateLimit` never shortens a cooldown already in progress. An isolated `401` gets exactly one token refresh and one retry; a refresh-token failure raises `AuthError` — loud, immediate, watchdog-alerting.

## The raw layer is written before parsing — except in playback (2026-08-20)

Invariant I3: every attempt writes its `raw_spotify` row before anything is parsed, so the evidence survives a parsing bug. The `playback` collector deliberately departs: it passes `logRaw:false` and writes a raw row only on **state changes** and errors, because polling every 15 s would otherwise mean ~5760 blobs a day. I3's intent is preserved — every transition is recorded, and the derived data is built from transitions. Same reasoning for `playback_samples` rows; the open session's aggregates are `UPDATE`d on every tick, so nothing is lost.

## "Played in full" is inferred, not reported (2026-08-20)

Spotify exposes no completion field. It is estimated by sampling `progress_ms`, accurate to about one polling interval. Seeking makes progress non-monotonic, so completion is computed from the **furthest point reached**, never the last value read. A return to ~0 counts as a replay only when the previous maximum had passed `NEAR_END_RATIO`, so a rewind does not fabricate a second listen. `SEEK_TOLERANCE_MS` (5 s) separates a seek from ordinary playback. **How to apply**: anywhere this number surfaces in the UI it must be marked as an estimate (`PRODUCT.md`: honest about what is inferred). Whether the heuristic actually holds is open test 7 in `docs/findings.md`.

## Playback sessions are never written into `events` (2026-08-20)

**Decision**: results land in `playback_sessions` and `playback_samples`; no `events` row is created or mutated. **Why**: `played` writes its own listen rows up to 30 min later keyed on `played_at`, and whether `played_at` marks the start or the end of a track is still unanswered (`docs/findings.md`, test 1). Writing both would risk double-counting an irreplaceable history. A session carries a best-effort `event_id` link, filled in after a `played` run; `NULL` is a **normal** outcome, not a bug.

## Playback requires the in-process scheduler (2026-08-20)

`PLAYBACK_ENABLED=1` does nothing without `SCHEDULE_ENABLED=1`: sub-minute polling cannot be driven by a systemd timer, and one process spawn per tick would be absurd. The server logs that playback stays off rather than failing silently (`instrumentation.ts`). The ticker re-arms a `setTimeout` after each tick instead of using `setInterval` — that is what lets the cadence drop to 60 s when idle, and it makes overlapping ticks structurally impossible, so unlike the two collectors it needs no anti-overlap lock. It also needs the `user-read-playback-state` scope; enabling it raises the scope banner until the account is reconnected (`docs/memory/auth.md`).

## Cadences are read from the database, not from process uptime (2026-08-20)

The scheduler reads `liked.last_success_at` rather than counting hours since boot, so a container that restarts often does not make the daily cadence drift. While the backfill is unfinished, `liked` runs at **every** hourly check to advance it in bounded batches. `played`'s first run is ~15 s after startup, so a crash-loop shows up immediately in `poller_runs` and a restart never costs more than one 30-minute window. Details in `docs/scheduling.md`.
