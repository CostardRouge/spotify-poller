/**
 * Answers ONE question that the 502/404 reports keep raising and the logs
 * cannot: when the container turns out to have restarted, WHAT killed it?
 *
 * From inside the process, the three ways to die look nothing alike:
 *
 *  - a SIGNAL (docker stop, a Watchtower redeploy, a host reboot) is
 *    observable — we get to write a marker before Next.js shuts down;
 *  - an EXCEPTION escaping every handler is observable for one last synchronous
 *    moment — enough to persist its message;
 *  - a SIGKILL — which is what the kernel OOM-killer sends, and what
 *    `docker kill` and a power cut amount to — is observable by NOBODY. The
 *    only trace it can leave is the absence of the other two markers next to a
 *    recent "still alive" stamp.
 *
 * So the process stamps `process.alive_at` (+ its RSS) every minute, records
 * signals and crashes in poller_state, and on every boot reads the previous
 * run's markers back and says — in the log and on ntfy — which of the three it
 * was. A "random" restart becomes a labelled one.
 *
 * Also owned here, because it is the same concern: Node's default policy since
 * v15 is to KILL the process on any unhandled promise rejection. For an
 * unattended collector that converts one stray promise into a full outage —
 * dead UI, dead scheduler, a container restart and the 502/404 window that
 * comes with it. We log it loudly and alert instead, and keep serving.
 */
import { deleteState, getGlobalState, setGlobalState } from "./db";
import { notify, notifyOnce } from "./notify";
import { Env, GLOBAL_SCOPE, nowIso } from "./types";

const KEY_STARTED = "process.started_at";
const KEY_ALIVE = "process.alive_at";
const KEY_RSS = "process.rss_mb";
/** Written on SIGTERM/SIGINT — its presence next boot means the stop was ordered. */
const KEY_STOP = "process.stop";
/** Written by the uncaughtException handler — the crash's own last words. */
const KEY_CRASH = "process.crash";

const ALIVE_EVERY_MS = 60_000;

declare global {
  var __pollerLifecycleInstalled: boolean | undefined;
}

const rssMb = (): number => Math.round(process.memoryUsage.rss() / 1024 / 1024);

/**
 * Classifies the previous run's end from its markers, announces it (console
 * always, ntfy when configured), then re-arms the markers for this run.
 *
 * Synchronous on purpose: register() awaits this during server boot, and the
 * ntfy delivery must not be able to delay — or worse, hang — startup. The
 * notification is fire-and-forget (notify() never throws).
 */
export function reportBoot(env: Env): void {
  const crash = getGlobalState(env, KEY_CRASH);
  const stop = getGlobalState(env, KEY_STOP);
  const alive = getGlobalState(env, KEY_ALIVE);
  const rss = getGlobalState(env, KEY_RSS);

  let note: string;
  let ordinary = false; // clean stops and first starts alert at 'min' priority
  if (crash) {
    note = `Restarted after a crash — ${crash}`;
  } else if (stop) {
    note = `Restarted after a clean stop (${stop}) — docker stop, redeploy, or host shutdown.`;
    ordinary = true;
  } else if (alive) {
    // No signal seen, no exception recorded, yet a previous run existed: the
    // process was killed without notice. OOM-killer, SIGKILL, or power loss —
    // the kernel's OOM verdict lives in the HOST's `dmesg`, not in our logs.
    note =
      `Restarted after an UNCLEAN exit: no stop signal, no crash recorded — ` +
      `OOM-kill, SIGKILL, or power loss. Last alive ${alive}` +
      (rss ? ` (rss ${rss} MB)` : "") +
      `. Check the host: dmesg -T | grep -i 'killed process'.`;
  } else {
    note = "First start on this database.";
    ordinary = true;
  }

  console.log(`[lifecycle] ${note}`);
  void notify(env, {
    title: "Spotify poller — started",
    message: note,
    priority: ordinary ? "min" : "default",
    tags: ordinary ? ["arrow_forward"] : ["arrow_forward", "warning"],
  });

  deleteState(env, GLOBAL_SCOPE, KEY_CRASH);
  deleteState(env, GLOBAL_SCOPE, KEY_STOP);
  setGlobalState(env, KEY_STARTED, nowIso());
  setGlobalState(env, KEY_ALIVE, nowIso());
  setGlobalState(env, KEY_RSS, String(rssMb()));

  // unref()'d: the stamp must never be what keeps a stopping process alive.
  setInterval(() => {
    try {
      setGlobalState(env, KEY_ALIVE, nowIso());
      setGlobalState(env, KEY_RSS, String(rssMb()));
    } catch (e) {
      console.error("[lifecycle] alive stamp failed:", e);
    }
  }, ALIVE_EVERY_MS).unref();
}

/** Installs the signal/rejection/exception hooks. Idempotent across dev reloads. */
export function installProcessGuards(env: Env): void {
  if (globalThis.__pollerLifecycleInstalled) return;
  globalThis.__pollerLifecycleInstalled = true;

  for (const sig of ["SIGTERM", "SIGINT"] as const) {
    process.on(sig, () => {
      try {
        setGlobalState(env, KEY_STOP, `${sig} @ ${nowIso()}`);
      } catch {
        /* a failed marker must not get in the way of stopping */
      }
      console.log(`[lifecycle] ${sig} received — shutting down`);
      // Next.js registers its own handler and exits once its shutdown is done;
      // this one only writes the marker. The timer is a failsafe for the case
      // where nothing else exits (unref()'d so it cannot itself keep us alive).
      setTimeout(() => process.exit(0), 10_000).unref();
    });
  }

  process.on("unhandledRejection", (reason) => {
    const msg =
      reason instanceof Error ? `${reason.name}: ${reason.message}\n${reason.stack ?? ""}` : String(reason);
    console.error("[lifecycle] UNHANDLED REJECTION (kept alive):", msg);
    void notifyOnce(env, "process", {
      title: "Spotify poller — unhandled rejection",
      message:
        `${msg.slice(0, 1500)}\n\n` +
        `The process was kept alive (collection and UI continue) — but this is a bug worth reporting.`,
      priority: "default",
      tags: ["warning"],
    }).catch(() => {});
  });

  process.on("uncaughtException", (e) => {
    const msg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    // Persist FIRST and synchronously: this is the only stage of dying where
    // the process still gets to say what happened.
    try {
      setGlobalState(env, KEY_CRASH, `${msg} @ ${nowIso()}`);
    } catch {
      /* the database may be the thing that broke */
    }
    console.error("[lifecycle] UNCAUGHT EXCEPTION — exiting:", e);
    // Unknown state mid-anything: restarting is safer than continuing. The
    // container's restart policy brings us back; the boot report explains.
    // Give the crash alert one bounded chance to leave the machine first.
    const alert = notify(env, {
      title: "Spotify poller — crashed",
      message: `${msg.slice(0, 1500)}\n\nThe container is restarting; details in the startup report.`,
      priority: "high",
      tags: ["rotating_light"],
    });
    void Promise.race([alert, new Promise((r) => setTimeout(r, 3000))]).finally(() => process.exit(1));
  });
}
