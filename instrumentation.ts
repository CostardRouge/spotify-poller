/**
 * Next.js instrumentation hook — runs once when the server process starts.
 * This is where the in-process scheduler used to start from server.ts's
 * `server.listen()` callback: `next start` is still a persistent Node
 * process, so container-internal scheduling (SCHEDULE_ENABLED=1, see
 * docs/scheduling.md) works the same way it did before the migration.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { getEnv } = await import("./lib/server/runtime");
  const {
    playbackEnabled,
    playbackOptionsFromProcess,
    schedulerEnabled,
    schedulerOptionsFromProcess,
    startPlaybackTicker,
    startScheduler,
  } = await import("./lib/server/scheduler");

  const env = getEnv();
  warnAboutExposure(env);

  if (schedulerEnabled()) {
    startScheduler(env, schedulerOptionsFromProcess());
    // Sub-minute polling only makes sense inside this long-running process —
    // systemd timers cannot drive it, so playback is scheduler-only on purpose.
    if (playbackEnabled()) startPlaybackTicker(env, playbackOptionsFromProcess());
  } else {
    console.log("[scheduler] disabled (SCHEDULE_ENABLED != 1) — collection driven by systemd/run-once");
    if (playbackEnabled()) {
      console.log(
        "[playback] PLAYBACK_ENABLED=1 but SCHEDULE_ENABLED != 1 — the ticker needs the in-process scheduler, playback stays off"
      );
    }
  }
}

/** Refuses to start silently wide open — a misconfiguration must be visible. */
function warnAboutExposure(env: { AUTH_MODE: string; PROXY_AUTH_HEADER?: string }): void {
  if (env.AUTH_MODE === "token") return;
  if (env.PROXY_AUTH_HEADER) {
    console.log(`[auth] proxy mode — requiring header '${env.PROXY_AUTH_HEADER}' on admin routes`);
    return;
  }
  console.warn(
    "[auth] ############################################################\n" +
      "[auth] AUTH_MODE=proxy with no PROXY_AUTH_HEADER: every request that\n" +
      "[auth] reaches this process is trusted. Safe ONLY if the origin is\n" +
      "[auth] unreachable except through your authenticating proxy.\n" +
      "[auth] ############################################################"
  );
}
