# Deployment, containers, CI

Read before touching the Dockerfiles, the compose stacks, the GHCR pipeline, scheduling, the systemd units, or when investigating a 502/404.

## The Node base image is pinned to an exact version (2026-08-20)

**Decision** (`b3b01b7`): `Dockerfile` and `Dockerfile.dev` both pin `node:24.18.0-alpine`, not `node:24-alpine`. **Why**: the floating tag moved to 24.19.0 on 2026-08-03, whose new `node::ObjectWrap` cleanup hooks (nodejs/node#63642) make NAN-style native addons — `better-sqlite3` among them — abort the process at random with `Assertion failed: (env) != nullptr`. Every CI rebuild after that date shipped the regression, and in production it looked like the server "randomly crashing": a native abort minutes-to-hours in, then a restart loop. **How to apply**: a base image is a dependency like any other. Do not bump or re-float it as a side effect of another change; both files move together, and only after confirming nodejs/node#63642 is fixed in the target release.

**The diagnostic signature**, worth recognising: an `Assertion failed: … ----- Native stack trace -----` block in `docker logs` just above the next boot's startup lines means Node itself or a native addon died below JavaScript. No JS handler can catch it, so the boot report files it under *unclean exit* — indistinguishable from an OOM-kill unless you read the log.

## `exec` in the container CMD is load-bearing (2026-08-20)

**Decision** (`7d803b7`): the `CMD` is `sh -c "…migrate && exec …next start …"`. **Why**: without `exec`, `sh` stays PID 1 for the container's whole life and does not forward signals, so `docker stop`'s SIGTERM stops at `sh`, the server never hears it, the 10 s grace expires, and the whole container is SIGKILLed. Every ordered stop then ends in a hard kill — no graceful shutdown, and indistinguishable from an OOM-kill to the lifecycle boot report. **How to apply**: keep `exec` in both Dockerfiles; a rewritten `CMD` that loses it reintroduces a failure mode that is invisible until you try to explain a restart.

## The healthcheck is tuned for a single-instance origin (2026-08-20)

**Decision**: `--interval=30s --timeout=10s --start-period=60s --retries=5`, identical in `Dockerfile` and `docker-compose.prod.yml` (compose overrides the image's). **Why**: a reverse proxy that honours container health (Traefik's docker provider does) pulls an unhealthy container out of rotation — and with no second instance to fail over to, **eviction is the outage**. So the probe tolerates a 10 s stall and needs ~2.5 min of consecutive failures before declaring death, while a genuinely dead process still fails instantly on connection refused. **How to apply**: if you change one, change both, and do not "tighten" the retries — the loose setting is the fix (`0675100`), not laxity.

**The Docker HEALTHCHECK does not restart anything.** Under plain Compose (as opposed to Swarm) an unhealthy container just stays unhealthy: it is a diagnosis, not a cure. An `autoheal` companion is what would act on it.

## The 502-then-404-then-recovery signature (2026-08-20)

That exact sequence means the container left the proxy's rotation: 502 while the router still points at a dead or stalled origin, 404 once the proxy drops the unhealthy container entirely, recovery once a probe succeeds. Three distinct causes, and the boot report tells them apart: the process **died** (clean stop / crash / unclean exit — for an OOM verdict the evidence is on the host, `dmesg -T | grep -i 'killed process'`), the process **stalled** long enough to burn the retry budget without dying (the `/api/export` case, `67f6c16`), or the process was **aborted from below JavaScript** (the Node pin above). Long form in `README.md`.

## Memory is capped well below what the host would miss (2026-08-20)

`NODE_OPTIONS="--max-old-space-size=512"` in the runtime stage. Steady-state RSS is ~110 MB and the heaviest legitimate operation (the NDJSON export) peaks ~150 MB. **Why cap at all**: a real leak now dies fast with a V8 "heap out of memory" message in `docker logs`, instead of growing for hours until the kernel OOM-killer SIGKILLs the container at a random later moment, unlogged from inside and indistinguishable from a crash.

## Scheduling lives inside the container (2026-08-20)

**Decision**: a scheduling loop internal to the long-running container (`SCHEDULE_ENABLED=1`), started from `instrumentation.ts`. **Rejected**: host cron + `docker exec`, an Ofelia scheduler container, and host systemd timers driving on-demand runs. **Why**: it is the only option that reproduces the sibling Spotify Calendar's battle-tested scheme — one container per application, `restart: unless-stopped`, healthcheck, GHCR image re-pulled by Watchtower — with a single artefact to deploy and monitor, no host crontab living outside the repo, and no second scheduler whose own death would be silent. It also means the healthcheck and the watchdog monitor the *same* process that collects. Full comparison in `docs/scheduling.md`.

**Never two schedulers at once**: `SCHEDULE_ENABLED` is set to `1` only by the compose files. On bare metal it stays unset and the systemd timers are the sole trigger source (`Persistent=true` catches up a run missed during a restart).

## Data lives on a named volume, backups on a host bind mount (2026-08-20)

`spotify-poller-data:/data` for the database — never the container's writable layer — and `./backups:/backups` on the host, deliberately outside that volume. `make clean` intentionally keeps the prod data volume and says so. `make backups-dir` must run once on the host because the container runs as uid 1001 and cannot write into a root-owned directory. No secret is baked into the image: everything arrives from `.env` via `env_file` at launch.

## The image is built by CI, not on the host (2026-08-20)

`.github/workflows/docker-build.yml` builds and pushes to GHCR on every push to `main`: moving `main`/`latest` tags plus an immutable `sha-<short>` to pin a rollback. `docker-compose.prod.yml` pulls rather than builds. The Watchtower redeploy step is optional — with `DEPLOY_WEBHOOK_URL` unset the build still publishes and only the redeploy is skipped.
