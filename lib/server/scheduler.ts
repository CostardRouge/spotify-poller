import { appBaseUrl, resolveActiveAccount } from "./spotify/auth";
import { runBackup } from "./backup";
import { collectPlayback } from "./collectors/playback";
import {
  getActiveAccountId,
  getGlobalState,
  getState,
  logRun,
  purgePlaybackSamples,
  purgeRawRows,
  setGlobalState,
} from "./db";
import { notifyOnce, notifyRecovered } from "./notify";
import { runCollector } from "./run-core";
import { getRateLimit } from "./spotify/api";
import { AuthError, Env, GLOBAL_SCOPE, RunStatus, TransientError, nowIso } from "./types";

/**
 * Container-internal scheduling (decision §13, documented in
 * docs/scheduling.md): the long-running server carries the scheduling loop,
 * just as the Spotify Calendar carries everything in a single
 * `restart: unless-stopped` container.
 *
 *  - Collector 'played': every SCHEDULE_PLAYED_MINUTES (30 by default), first
 *    run shortly after startup — so a restart never loses more than one window.
 *  - Collector 'liked': cadence driven by the PERSISTED clock
 *    (`liked.last_success_at`), checked every hour — the daily cadence does not
 *    drift across container restarts.
 *    Exception: as long as the backfill is not finished, 'liked' runs at every
 *    hourly check to advance the backfill in bounded batches.
 *
 * Disabled by default (SCHEDULE_ENABLED=1 to turn it on): on bare metal the
 * systemd timers drive run-once.ts, and the API must not collect twice — even
 * though idempotence (I2) would make that duplicate harmless for the data.
 */

export interface SchedulerOptions {
  playedEveryMinutes: number;
  likedEveryHours: number;
  backupEveryHours: number;
  artistsEveryHours: number;
}

// SCHEDULE_A_MINUTES / SCHEDULE_B_HOURS stay readable as a fallback: a .env
// written before the rename must not silently fall back to the defaults.
export function schedulerOptionsFromProcess(): SchedulerOptions {
  return {
    playedEveryMinutes: Number(
      process.env.SCHEDULE_PLAYED_MINUTES ?? process.env.SCHEDULE_A_MINUTES ?? "30"
    ),
    likedEveryHours: Number(process.env.SCHEDULE_LIKED_HOURS ?? process.env.SCHEDULE_B_HOURS ?? "24"),
    backupEveryHours: Number(process.env.BACKUP_EVERY_HOURS ?? "24"),
    artistsEveryHours: Number(process.env.SCHEDULE_ARTISTS_HOURS ?? "24"),
  };
}

export function schedulerEnabled(): boolean {
  return process.env.SCHEDULE_ENABLED === "1";
}

const KEY_BACKUP_AT = "backup.last_success_at";

export function startScheduler(env: Env, opts: SchedulerOptions): void {
  // Anti-overlap lock: a run still in progress is never doubled up.
  // 'playback' is not here — it has its own self-rescheduling ticker below.
  const running: Record<"played" | "liked" | "artists", boolean> = {
    played: false,
    liked: false,
    artists: false,
  };

  const tick = async (collector: "played" | "liked" | "artists"): Promise<void> => {
    if (running[collector]) return;
    running[collector] = true;
    try {
      const result = await runCollector(collector, "cron", env);
      console.log(`[scheduler] collector ${collector}:`, JSON.stringify(result));
    } catch (e) {
      // runCollector already catches everything (I1) — this only catches the
      // unexpected.
      console.error(`[scheduler] collector ${collector}: uncaught error`, e);
    } finally {
      running[collector] = false;
    }
  };

  // Every `due` check below reads SQLite SYNCHRONOUSLY from inside a timer
  // callback. An exception there (a locked database, a disk error) would escape
  // the timer entirely — it is not inside any try — and take the scheduler with
  // it: no more ticks, silently, until the process is restarted. So a failed
  // check is answered "not due" and the next tick asks again.
  const dueOrFalse = (name: string, check: () => boolean): boolean => {
    try {
      return check();
    } catch (e) {
      console.error(`[scheduler] ${name}: cadence check failed, skipping this tick`, e);
      return false;
    }
  };

  const likedDue = (): boolean => {
    // The cadence follows the ACTIVE account's cursor: switching account must
    // not make 'liked' think it already ran today on the newcomer's behalf.
    const accountId = getActiveAccountId(env);
    if (accountId === null) return true; // nothing connected yet: let the run report it
    if (getState(env, accountId, "liked.backfill_done") !== "1") return true;
    const last = getState(env, accountId, "liked.last_success_at");
    return !last || Date.now() - Date.parse(last) >= opts.likedEveryHours * 3_600_000;
  };

  /**
   * Same persisted-cursor cadence as 'liked', and the same exception: while a
   * backlog remains ('artists.backlog'), it runs at every hourly check to drain
   * it in bounded batches instead of waiting a day per 1000 artists.
   */
  const artistsDue = (): boolean => {
    const accountId = getActiveAccountId(env);
    if (accountId === null) return false; // nothing connected: nothing to enrich
    if (getState(env, accountId, "artists.backlog") === "1") return true;
    const last = getState(env, accountId, "artists.last_success_at");
    return !last || Date.now() - Date.parse(last) >= opts.artistsEveryHours * 3_600_000;
  };

  // Backup cadence is persisted like 'liked''s, so restarts do not make it
  // drift and a container that restarts often does not back up on every boot.
  const backupDue = (): boolean => {
    const last = getGlobalState(env, KEY_BACKUP_AT);
    return !last || Date.now() - Date.parse(last) >= opts.backupEveryHours * 3_600_000;
  };

  let backingUp = false;
  const backupTick = async (): Promise<void> => {
    if (backingUp || !dueOrFalse("backup", backupDue)) return;
    backingUp = true;
    try {
      const r = await runBackup(env);
      setGlobalState(env, KEY_BACKUP_AT, nowIso());
      console.log(`[scheduler] backup: ${r.file} (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`);
      await notifyRecovered(env, "backup", {
        title: "Spotify poller — backups working again",
        message: `Backup written to ${r.file}.`,
      });
    } catch (e) {
      // A failing backup is silent by nature — nothing breaks until the day you
      // need it. It has to be loud.
      console.error("[scheduler] backup failed:", e);
      await notifyOnce(env, "backup", {
        title: "Spotify poller — backup FAILED",
        message: `${String(e)}\nThe history is no longer protected against a disk loss.`,
        priority: "high",
        tags: ["floppy_disk", "warning"],
      });
    } finally {
      backingUp = false;
    }
  };

  setTimeout(() => void tick("played"), 15_000);
  setInterval(() => void tick("played"), opts.playedEveryMinutes * 60_000);

  setTimeout(() => {
    if (dueOrFalse("liked", likedDue)) void tick("liked");
  }, 60_000);
  setInterval(() => {
    if (dueOrFalse("liked", likedDue)) void tick("liked");
  }, 3_600_000);

  // Enrichment, deliberately last in the startup stagger: it is the only
  // collector that guards nothing, so it yields the first minutes — and the
  // first slice of the app-wide rate limit — to the ones that do. Starting
  // after 'liked' also means a freshly backfilled library is enriched in the
  // same boot rather than a day later.
  setTimeout(() => {
    if (dueOrFalse("artists", artistsDue)) void tick("artists");
  }, 240_000);
  setInterval(() => {
    if (dueOrFalse("artists", artistsDue)) void tick("artists");
  }, 3_600_000);

  if (env.BACKUP_ENABLED) {
    setTimeout(() => void backupTick(), 120_000);
    setInterval(() => void backupTick(), 3_600_000);
  }

  // Retention on the raw request archive (opt-in, RAW_RETENTION_DAYS). Bounded
  // batches so a first enablement over a years-deep archive drains it across
  // hours instead of holding the event loop once for the whole backlog — the
  // /api/export lesson. Same timer-path rule as everything above: a throw here
  // must log and carry on, never take the interval down with it.
  if (env.RAW_RETENTION_DAYS > 0) {
    const rawPurgeTick = (): void => {
      try {
        const purged = purgeRawRows(env, env.RAW_RETENTION_DAYS);
        if (purged > 0) {
          console.log(`[scheduler] raw_spotify: purged ${purged} rows older than ${env.RAW_RETENTION_DAYS} d`);
        }
      } catch (e) {
        console.error("[scheduler] raw_spotify purge failed:", e);
      }
    };
    setTimeout(rawPurgeTick, 180_000);
    setInterval(rawPurgeTick, 3_600_000);
  }

  console.log(
    `[scheduler] active — played every ${opts.playedEveryMinutes} min, ` +
      `liked every ${opts.likedEveryHours} h (hourly check), ` +
      `artists every ${opts.artistsEveryHours} h (hourly check)` +
      (env.BACKUP_ENABLED ? `, backup every ${opts.backupEveryHours} h -> ${env.BACKUP_DIR}` : "") +
      (env.RAW_RETENTION_DAYS > 0 ? `, raw archive kept ${env.RAW_RETENTION_DAYS} d` : "")
  );
}

// ---------- playback ticker (opt-in) ----------

export interface PlaybackOptions {
  pollSeconds: number;
  idlePollSeconds: number;
  idleAfter: number;
  retentionDays: number;
}

export function playbackEnabled(): boolean {
  return process.env.PLAYBACK_ENABLED === "1";
}

export function playbackOptionsFromProcess(): PlaybackOptions {
  return {
    pollSeconds: Number(process.env.PLAYBACK_POLL_SECONDS ?? "15"),
    idlePollSeconds: Number(process.env.PLAYBACK_IDLE_POLL_SECONDS ?? "60"),
    idleAfter: Number(process.env.PLAYBACK_IDLE_AFTER ?? "4"),
    retentionDays: Number(process.env.PLAYBACK_RETENTION_DAYS ?? "30"),
  };
}

const SUMMARY_EVERY_MS = 3_600_000;

/**
 * Polls /me/player on a VARIABLE interval — hence setTimeout re-armed after
 * each tick rather than setInterval. Two consequences that are the whole point:
 * the cadence can drop to idlePollSeconds when nothing is playing, and ticks
 * structurally cannot overlap (the next one is only scheduled once the previous
 * has finished), so no anti-overlap flag is needed.
 *
 * Sub-minute polling is why this exists only inside the long-running server;
 * systemd timers cannot drive it, so bare-metal installs do not get playback.
 *
 * Unlike the other collectors it does NOT go through runCollector: one
 * poller_runs row per tick would be ~5760 rows a day. It writes an hourly
 * summary instead, and re-implements the three things run-core gave it — the
 * account resolution, the persisted 429 check, and always closing a window with
 * a logged row.
 */
export function startPlaybackTicker(env: Env, opts: PlaybackOptions): void {
  let idleStreak = 0;
  let ticks = 0;
  let written = 0;
  let windowErrors = 0;
  let windowStartedAt = nowIso();
  let windowAccountId = GLOBAL_SCOPE;
  let lastSummaryAt = Date.now();
  // Set on a fatal error so we stop hammering. Re-checked on expiry, so
  // reconnecting from the UI revives the ticker without a container restart.
  let pausedUntil = 0;

  // logRun writes to SQLite synchronously, and this is called from the error
  // path AND from the `finally` below — the two places where an exception is
  // most expensive. A failure to LOG a window must never cost us the window
  // itself, let alone the ticker: the counters are reset either way.
  const closeWindow = (status: RunStatus, error: string | null): void => {
    try {
      logRun(env, windowAccountId, "playback", "cron", windowStartedAt, status, ticks, written, error);
    } catch (e) {
      console.error("[playback] could not log the run window:", e);
    }
    ticks = 0;
    written = 0;
    windowErrors = 0;
    windowStartedAt = nowIso();
    lastSummaryAt = Date.now();
  };

  const loop = async (): Promise<void> => {
    let delayS = opts.pollSeconds;
    try {
      if (Date.now() < pausedUntil) {
        delayS = 60;
      } else {
        // Querying during an active ban counts against the app and may extend
        // it — the same abstention run-core applies to the other collectors.
        const rl = getRateLimit(env);
        if (rl.limited) {
          delayS = Math.min(rl.retryAfterS + 1, 300);
        } else {
          const account = await resolveActiveAccount(env);
          windowAccountId = account.id;
          ticks++;
          const result = await collectPlayback(env, account);
          written += result.inserted;
          idleStreak = result.fetched === 0 ? idleStreak + 1 : 0;
          delayS = idleStreak >= opts.idleAfter ? opts.idlePollSeconds : opts.pollSeconds;
        }
      }
    } catch (e) {
      if (e instanceof TransientError) {
        // Silent by design (§8): the next tick catches up. Back off meanwhile.
        windowErrors++;
        delayS = opts.idlePollSeconds;
      } else {
        const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
        console.error("[playback]", msg);
        closeWindow("error", msg);
        // A missing scope or a dead token will not fix itself in 15 s, and the
        // alert must not fire on every tick.
        const fatal = e instanceof AuthError;
        pausedUntil = Date.now() + (fatal ? 3_600_000 : 600_000);
        await notifyOnce(env, fatal ? "auth" : "run-error", {
          title: fatal
            ? "Spotify poller — playback needs a reconnection"
            : "Spotify poller — playback collector failed",
          message: `${msg}\n\nThe 'played' collector is unaffected: it keeps the history.`,
          priority: "default",
          tags: ["musical_note", "warning"],
          clickUrl: appBaseUrl(env),
        }).catch(() => {});
        delayS = 60;
      }
    } finally {
      // Whatever happens above, the LAST thing this block does is re-arm — the
      // ticker is self-rescheduling, so a throw escaping here (the hourly
      // summary and the purge are both synchronous SQLite writes) would stop
      // playback collection for good, with nothing left to restart it short of
      // a container restart. Hence the try around the housekeeping.
      try {
        if (Date.now() - lastSummaryAt >= SUMMARY_EVERY_MS && ticks > 0) {
          closeWindow(
            windowErrors > 0 ? "partial" : "ok",
            windowErrors > 0 ? `${windowErrors} transient error(s)` : null
          );
          const purged = purgePlaybackSamples(env, opts.retentionDays);
          if (purged > 0) {
            console.log(`[playback] purged ${purged} samples older than ${opts.retentionDays} d`);
          }
        }
      } catch (e) {
        console.error("[playback] hourly housekeeping failed:", e);
      }
      setTimeout(() => void loop(), delayS * 1000);
    }
  };

  setTimeout(() => void loop(), 20_000);
  console.log(
    `[playback] ticker active — every ${opts.pollSeconds} s while playing, ` +
      `${opts.idlePollSeconds} s after ${opts.idleAfter} idle polls, ` +
      `samples kept ${opts.retentionDays} d`
  );
}
