import { runBackup } from "./backup";
import { getActiveAccountId, getGlobalState, getState, setGlobalState } from "./db";
import { notify, notifyOnce, notifyRecovered } from "./notify";
import { runCollector } from "./run-core";
import { CollectorId, Env, nowIso } from "./types";

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
  };
}

export function schedulerEnabled(): boolean {
  return process.env.SCHEDULE_ENABLED === "1";
}

const KEY_BACKUP_AT = "backup.last_success_at";

export function startScheduler(env: Env, opts: SchedulerOptions): void {
  // Anti-overlap lock: a run still in progress is never doubled up.
  const running: Record<CollectorId, boolean> = { played: false, liked: false };

  const tick = async (collector: CollectorId): Promise<void> => {
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

  const likedDue = (): boolean => {
    // The cadence follows the ACTIVE account's cursor: switching account must
    // not make 'liked' think it already ran today on the newcomer's behalf.
    const accountId = getActiveAccountId(env);
    if (accountId === null) return true; // nothing connected yet: let the run report it
    if (getState(env, accountId, "liked.backfill_done") !== "1") return true;
    const last = getState(env, accountId, "liked.last_success_at");
    return !last || Date.now() - Date.parse(last) >= opts.likedEveryHours * 3_600_000;
  };

  // Backup cadence is persisted like 'liked''s, so restarts do not make it
  // drift and a container that restarts often does not back up on every boot.
  const backupDue = (): boolean => {
    const last = getGlobalState(env, KEY_BACKUP_AT);
    return !last || Date.now() - Date.parse(last) >= opts.backupEveryHours * 3_600_000;
  };

  let backingUp = false;
  const backupTick = async (): Promise<void> => {
    if (backingUp || !backupDue()) return;
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
    if (likedDue()) void tick("liked");
  }, 60_000);
  setInterval(() => {
    if (likedDue()) void tick("liked");
  }, 3_600_000);

  if (env.BACKUP_ENABLED) {
    setTimeout(() => void backupTick(), 120_000);
    setInterval(() => void backupTick(), 3_600_000);
  }

  console.log(
    `[scheduler] active — played every ${opts.playedEveryMinutes} min, ` +
      `liked every ${opts.likedEveryHours} h (hourly check)` +
      (env.BACKUP_ENABLED ? `, backup every ${opts.backupEveryHours} h -> ${env.BACKUP_DIR}` : "")
  );
}

/** One-off notification when the process starts, useful after an unplanned reboot. */
export async function announceStartup(env: Env, note: string): Promise<void> {
  await notify(env, {
    title: "Spotify poller — started",
    message: note,
    priority: "min",
    tags: ["arrow_forward"],
  });
}
