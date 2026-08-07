# Decision: scheduling in a containerized environment (spec §13)

## Decision

**Scheduling loop internal to the long-running container** (`src/scheduler.ts`,
enabled by `SCHEDULE_ENABLED=1`): the HTTP server also carries the `played`
(30 min) and `liked` (daily) cadences. This is the default mode of both Docker Compose stacks
in this repo.

`run-once.ts` is kept as-is: it remains the entry point for the systemd timers
on bare metal, and allows manual triggering inside the container
(`make run-played` / `make run-liked`).

## Why this option

Spec §13 required an explicit choice between three options, looking first at
what the **Spotify Calendar** project does:

1. external scheduler (host cron + `docker exec`, or an Ofelia container);
2. **single long-running container with an internal scheduling loop** ← chosen;
3. host systemd timers + container run on demand.

The Spotify Calendar has no periodic scheduling per se, but its operating
scheme is clear and battle-tested: **a single container per application**,
`restart: unless-stopped`, Docker healthcheck, GHCR image re-pulled by
Watchtower. Option 2 is the only one that reproduces that scheme identically:

- a single artifact to deploy and monitor — no host crontab to maintain
  outside the repo (option 1a), no second scheduler container whose death
  would itself be silent (option 1b), no dependency on the host's systemd that
  would put half the deployment back outside Docker (option 3);
- the Docker healthcheck and the external watchdog monitor the same process
  that collects: a dead container = no more pings = alert (I1);
- `restart: unless-stopped` brings the loop back after a host reboot, with no
  manual reactivation of a timer.

## Guardrails specific to this choice

- **Persisted `liked` cadence**: the scheduler does not count "24 h since the
  process started" but reads `liked.last_success_at` from the database —
  container restarts do not make the daily cadence drift. As long as the
  backfill is not finished, `liked` runs at every hourly check to advance it in
  bounded batches.
- **First `played` run ~15 s after startup**: a container crash-loop shows up
  immediately in `poller_runs`, and a restart never costs more than one 30 min
  window.
- **Anti-overlap lock** per collector; a manual trigger (`POST /run`) also
  remains harmless thanks to idempotence (I2).
- **Default = disabled** outside Docker: `SCHEDULE_ENABLED` is only set to `1`
  by the compose files. On bare metal, the systemd timers remain the only
  trigger source — never two schedulers in parallel.
- **The playback ticker exists here and nowhere else.** `PLAYBACK_ENABLED=1`
  polls `/me/player` every 15 s while something is playing; a systemd timer
  cannot fire that often, and one process spawn per tick would be absurd. So it
  is deliberately tied to the in-process scheduler: with `SCHEDULE_ENABLED != 1`
  the server logs that playback stays off rather than failing silently. It is a
  bonus on top of `played`, which keeps working identically either way.
  Unlike the two collectors it re-arms a `setTimeout` after each tick instead of
  using `setInterval` — that is what allows the cadence to drop to 60 s when
  nothing is playing, and it makes overlapping ticks structurally impossible,
  so it needs no anti-overlap lock.

## What does not change

The **external watchdog** (healthchecks.io) remains the only protection
against a fully powered-off host: the Docker healthcheck complements it (local
restart of a stuck process) but does not replace it. See spec §4 and §10.
