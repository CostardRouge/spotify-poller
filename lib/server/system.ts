/**
 * The server read-out (2026-11-27, design lab iteration 2): how this instance
 * is configured, as rows the System page draws and the shell counts.
 *
 * Before, the same seven rows were written twice — in the settings dialog and
 * in the Now page's "Server" panel — and drifted (one knew about Sésame, the
 * other did not). They now exist once, here; `warn` marks what the operator
 * should act on, and its count is the "N to check" beside System in the
 * sidebar and the account menu.
 */
import type { Env } from "./types";
import { schedulerEnabled, schedulerOptionsFromProcess } from "./scheduler";

export interface SystemCheck {
  id: string;
  label: string;
  value: string;
  sub: string;
  /** ok: configured and working as meant; warn: something to set up; null: a fact, no judgement. */
  tone: "ok" | "warn" | null;
  warn: boolean;
}

export function systemChecks(env: Env): SystemCheck[] {
  const sched = schedulerEnabled() ? schedulerOptionsFromProcess() : null;
  const playback = env.PLAYBACK_ENABLED;
  const rows: Omit<SystemCheck, "warn">[] = [
    {
      id: "scheduler",
      label: "Scheduler",
      value: sched ? "In-process" : "External (systemd)",
      sub: sched
        ? `played every ${sched.playedEveryMinutes} min · liked every ${sched.likedEveryHours} h · backup every ${sched.backupEveryHours} h`
        : "Collection is driven by systemd timers, outside this process.",
      tone: sched ? "ok" : null,
    },
    {
      id: "playback",
      label: "Playback collector",
      value: playback ? "On" : "Off",
      sub: playback
        ? "Samples /me/player every 15 s while something plays: device, volume, skips."
        : "Opt-in: PLAYBACK_ENABLED=1 with the in-process scheduler.",
      tone: playback ? "ok" : null,
    },
    {
      id: "backups",
      label: "Backups",
      value: env.BACKUP_ENABLED ? "Enabled" : "Disabled",
      sub: env.BACKUP_ENABLED
        ? `${env.BACKUP_DIR} · keep ${env.BACKUP_KEEP}. A snapshot holds the refresh token: never downloadable from here.`
        : "Set BACKUP_ENABLED=1 to snapshot the database.",
      tone: env.BACKUP_ENABLED ? "ok" : "warn",
    },
    {
      id: "watchdog",
      label: "Watchdog",
      value: env.WATCHDOG_URL ? "Configured" : "Not configured",
      sub: env.WATCHDOG_URL
        ? "Alerts on silence, the only thing that catches a dead poller."
        : "Without WATCHDOG_URL nothing alerts you when the poller goes quiet.",
      tone: env.WATCHDOG_URL ? "ok" : "warn",
    },
    {
      id: "ntfy",
      label: "ntfy",
      value: env.NTFY_URL ? "Configured" : "Not configured",
      sub: "Push channel for actionable events. It cannot detect silence.",
      tone: env.NTFY_URL ? "ok" : null,
    },
    {
      id: "auth",
      label: "Auth mode",
      value: env.AUTH_MODE,
      sub:
        env.AUTH_MODE === "proxy"
          ? "A reverse proxy authenticates requests."
          : env.AUTH_MODE === "sesame"
            ? "Sésame opens the session."
            : "JWT session unlocked by ADMIN_TOKEN.",
      tone: null,
    },
    { id: "timezone", label: "Timezone", value: env.TIMEZONE, sub: "Display only; every timestamp is stored in UTC.", tone: null },
  ];
  return rows.map((r) => ({ ...r, warn: r.tone === "warn" }));
}
