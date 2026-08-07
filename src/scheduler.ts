import { getState } from "./db";
import { runCollector } from "./run-core";
import { Env } from "./types";

/**
 * Container-internal scheduling (decision §13, documented in
 * docs/scheduling.md): the long-running server carries the scheduling loop,
 * just as the Spotify Calendar carries everything in a single
 * `restart: unless-stopped` container.
 *
 *  - Collector A: every SCHEDULE_A_MINUTES (30 by default), first run shortly
 *    after startup — so a restart never loses more than one window.
 *  - Collector B: cadence driven by the PERSISTED clock
 *    (`B.last_success_at`), checked every hour — the daily cadence does not
 *    drift across container restarts.
 *    Exception: as long as the backfill is not finished, B runs at every
 *    hourly check to advance the backfill in bounded batches.
 *
 * Disabled by default (SCHEDULE_ENABLED=1 to turn it on): on bare metal the
 * systemd timers drive run-once.ts, and the API must not collect twice — even
 * though idempotence (I2) would make that duplicate harmless for the data.
 */

export interface SchedulerOptions {
  aEveryMinutes: number;
  bEveryHours: number;
}

export function schedulerOptionsFromProcess(): SchedulerOptions {
  return {
    aEveryMinutes: Number(process.env.SCHEDULE_A_MINUTES ?? "30"),
    bEveryHours: Number(process.env.SCHEDULE_B_HOURS ?? "24"),
  };
}

export function schedulerEnabled(): boolean {
  return process.env.SCHEDULE_ENABLED === "1";
}

export function startScheduler(env: Env, opts: SchedulerOptions): void {
  // Anti-overlap lock: a run still in progress is never doubled up.
  const running: Record<"A" | "B", boolean> = { A: false, B: false };

  const tick = async (collector: "A" | "B"): Promise<void> => {
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

  const bDue = (): boolean => {
    if (getState(env, "B.backfill_done") !== "1") return true;
    const last = getState(env, "B.last_success_at");
    return !last || Date.now() - Date.parse(last) >= opts.bEveryHours * 3_600_000;
  };

  setTimeout(() => void tick("A"), 15_000);
  setInterval(() => void tick("A"), opts.aEveryMinutes * 60_000);

  setTimeout(() => {
    if (bDue()) void tick("B");
  }, 60_000);
  setInterval(() => {
    if (bDue()) void tick("B");
  }, 3_600_000);

  console.log(
    `[scheduler] active — A every ${opts.aEveryMinutes} min, B every ${opts.bEveryHours} h (hourly check)`
  );
}
