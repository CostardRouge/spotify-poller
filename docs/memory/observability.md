# Observability — health, watchdog, alerts, boot reports

Read before touching `/api/health`, the notification channels, the lifecycle markers, or when asked "why did it restart?".

## Only the watchdog detects silence — nothing else can (2026-08-20)

**Decision**: `WATCHDOG_URL` is pinged after every successful `played` run and is the single non-negotiable piece of monitoring, whatever the deployment mode. **Why**: ntfy is a *push* channel — it can only deliver a message something chose to send, so a dead poller sends nothing and the phone stays quiet. The Docker healthcheck reports but does not act, and dies with the host. Only an external dead-man's switch turns *absence* into an alert: ISP outage, reboot without clean restart, full disk, silent crash, power loss. Works with healthchecks.io or a self-hosted Uptime Kuma "Push" monitor — same contract. **How to apply**: never propose replacing the heartbeat with ntfy or with the healthcheck; they answer different questions (`lib/server/notify.ts`).

## `/api/health` is deliberately almost empty (2026-08-20)

**Decision**: it returns `{status, auth_mode}` and nothing else. **Why**: it used to return collector timestamps and per-type event counters while being **public** — enough to leak listening volume and activity windows to anyone who could reach the port. That detail moved to `/api/status`, behind the session gate. The Docker healthcheck only ever needed liveness. **How to apply**: do not enrich `/api/health`; add to `/api/status` instead.

## ntfy carries what is actionable, throttled (2026-08-20)

Revoked token (high priority, tapping opens the dashboard), failed run, failed backup, detected gap. Each **kind** is throttled to one message per `NTFY_THROTTLE_HOURS` (default 6) through `poller_state`, and an all-clear follows recovery. **Why throttled**: a revoked token would otherwise notify every 30 minutes forever, and an alert channel that cries constantly stops being read. **How to apply**: a new alert picks an existing `NotifyKind` or adds one — it does not bypass `notifyOnce`.

**Non-ASCII trap**: HTTP header values are ByteStrings, so any character above U+00FF makes `fetch()` throw and would silently kill *every* notification — the one failure whose symptom is "no alerts". Titles and tags are therefore RFC 2047 base64-encoded when non-ASCII (`encodeHeader`); the message travels in the body and needs no encoding. Keep that encoding when touching headers.

## Every restart is labelled with how the previous one ended (2026-08-20)

**Decision**: `lib/server/lifecycle.ts` stamps `process.alive_at` (+ RSS) every minute, records signals and crashes in `poller_state`, and at each boot reads the previous run's markers back and announces the verdict in the log and on ntfy. **Why**: from inside the process the three ways to die look nothing alike — a **signal** (docker stop, redeploy, host reboot) is observable and writes a marker; an **exception** is observable for one last synchronous moment; a **SIGKILL** (kernel OOM-killer, `docker kill`, power cut) is observable by nobody, and its only possible trace is the *absence* of the other two markers next to a recent alive stamp. A "random" restart becomes a labelled one. **How to apply**: `reportBoot` is synchronous on purpose — `register()` awaits it during boot, and ntfy delivery must not be able to delay or hang startup; `notify()` never throws.

## Unhandled rejections must not kill the process (2026-08-20)

**Decision** (`0675100`): the process guards log and alert on an unhandled promise rejection instead of letting Node's default post-v15 policy kill the process. **Why**: for an unattended collector, one stray promise otherwise becomes a full outage — dead UI, dead scheduler, container restart, and the 502/404 window that comes with it. **How to apply**: keep serving; do not "restore correct behaviour" by removing the handler.

## A stalled process is as bad as a dead one, and harder to see (2026-08-20)

The `/api/export` incident (`67f6c16`): a synchronous full-table pass inside the process that serves the UI stalled the event loop long enough to burn the healthcheck's retry budget without dying, which the proxy read as death. That is why the export streams in bounded batches, why the raw purge is capped per call, and why migration `0007` adds the index those age queries need. **How to apply**: anything that touches the whole table from inside the server process must be batched — see `docs/memory/data-model.md`.
