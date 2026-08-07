import { collectRecentlyPlayed } from "./collectors/recently-played";
import { collectLikedTracks } from "./collectors/liked-tracks";
import { finishRun, startRun } from "./db";
import { getRateLimit } from "./spotify-api";
import { AuthError, CollectorId, CollectorResult, Env, TransientError } from "./types";
import { pingFailure, pingSuccess } from "./watchdog";

/**
 * Spec §8, unchanged by the move to self-hosting:
 *  - poller_runs row written at start, completed in a finally (I1)
 *  - AuthError / DB error / unexpected exception -> 'error' + immediate alert
 *  - TransientError -> 'partial', silent: the next run catches up
 *  - collector 'played' success -> watchdog ping (dead man's switch, §9)
 *
 * The watchdog matters MORE here than on Workers: there are more causes of
 * silence (reboot, local network outage, full disk, process crash) and the UPS
 * only covers a loss of mains power.
 */
export async function runCollector(collector: CollectorId, trigger: "cron" | "manual", env: Env): Promise<CollectorResult> {
  let runId: number | null = null;
  let result: CollectorResult = { status: "error", fetched: 0, inserted: 0 };
  let errorMsg: string | null = null;

  try {
    runId = startRun(env, collector, trigger);
    // Persisted 429 cooldown (spotify-api.ts): querying during an active ban
    // counts against the app and may extend it — we abstain, the run is still
    // logged (I1) and the next one catches up.
    const rl = getRateLimit(env);
    if (rl.limited) {
      result = { status: "partial", fetched: 0, inserted: 0, note: `rate-limited, resuming after ${rl.until}` };
    } else {
      result = collector === "played" ? await collectRecentlyPlayed(env) : await collectLikedTracks(env);
    }
  } catch (e) {
    if (e instanceof TransientError) {
      result = { status: "partial", fetched: 0, inserted: 0, note: e.message };
    } else {
      errorMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      result = { status: "error", fetched: 0, inserted: 0 };
      await pingFailure(env, `[${collector}] ${errorMsg}`);
    }
  } finally {
    if (runId !== null) {
      try {
        finishRun(env, runId, result.status, result.fetched, result.inserted, errorMsg ?? result.note ?? null);
      } catch {
        // A logging failure must not mask the real result.
      }
    }
  }

  if (collector === "played" && result.status === "ok") {
    await pingSuccess(env);
  }
  return result;
}
