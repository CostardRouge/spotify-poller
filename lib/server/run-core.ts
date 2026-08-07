import { appBaseUrl, resolveActiveAccount } from "./spotify/auth";
import { collectRecentlyPlayed } from "./collectors/recently-played";
import { collectLikedTracks } from "./collectors/liked-tracks";
import { collectPlayback } from "./collectors/playback";
import { finishRun, lastRunStatus, startRun, touchAccount } from "./db";
import { heartbeat, heartbeatFail, notifyOnce, notifyRecovered } from "./notify";
import { getRateLimit } from "./spotify/api";
import { Account, AuthError, CollectorId, CollectorResult, Env, GLOBAL_SCOPE, TransientError } from "./types";

/**
 * Spec §8, unchanged by the move to self-hosting:
 *  - poller_runs row written at start, completed in a finally (I1)
 *  - AuthError / DB error / unexpected exception -> 'error' + immediate alert
 *  - TransientError -> 'partial', silent: the next run catches up
 *  - collector 'played' success -> heartbeat ping (dead man's switch, §9)
 *
 * The heartbeat matters MORE here than on Workers: there are more causes of
 * silence (reboot, local network outage, full disk, process crash) and the UPS
 * only covers a loss of mains power. ntfy adds actionable alerts on top of it —
 * see notify.ts for why one cannot replace the other.
 *
 * Every run targets ONE account: the active one. Other connected accounts keep
 * their data and their token untouched.
 */
export async function runCollector(
  collector: CollectorId,
  trigger: "cron" | "manual",
  env: Env
): Promise<CollectorResult & { account_id?: string }> {
  let runId: number | null = null;
  let account: Account | null = null;
  let result: CollectorResult = { status: "error", fetched: 0, inserted: 0 };
  let errorMsg: string | null = null;
  let previousStatus: string | null = null;

  try {
    // Resolving the account first means an auth failure is still logged as a
    // run (I1) — under the GLOBAL scope, since we do not know whose it was.
    account = await resolveActiveAccount(env);
    previousStatus = lastRunStatus(env, account.id, collector);
    runId = startRun(env, account.id, collector, trigger);

    // Persisted 429 cooldown (spotify-api.ts): querying during an active ban
    // counts against the app and may extend it — we abstain, the run is still
    // logged (I1) and the next one catches up.
    const rl = getRateLimit(env);
    if (rl.limited) {
      result = { status: "partial", fetched: 0, inserted: 0, note: `rate-limited, resuming after ${rl.until}` };
    } else {
      if (collector === "played") {
        result = await collectRecentlyPlayed(env, account);
      } else if (collector === "liked") {
        result = await collectLikedTracks(env, account);
      } else {
        // 'playback' normally runs from the ticker, which bypasses this wrapper
        // to avoid one poller_runs row every 15 s. Coming through here means a
        // manual POST /run?collector=playback — a single tick, worth logging.
        result = await collectPlayback(env, account);
      }
      touchAccount(env, account.id);
    }
  } catch (e) {
    if (e instanceof TransientError) {
      result = { status: "partial", fetched: 0, inserted: 0, note: e.message };
    } else {
      errorMsg = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      result = { status: "error", fetched: 0, inserted: 0 };
      await heartbeatFail(env, `[${collector}] ${errorMsg}`);
      await alertOnError(env, collector, e, errorMsg, account);
    }
  } finally {
    if (runId === null) {
      // The failure happened before the run row existed (no account resolvable).
      try {
        const orphan = startRun(env, account?.id ?? GLOBAL_SCOPE, collector, trigger);
        finishRun(env, orphan, result.status, 0, 0, errorMsg);
      } catch {
        /* logging must never mask the real result */
      }
    } else {
      try {
        finishRun(env, runId, result.status, result.fetched, result.inserted, errorMsg ?? result.note ?? null);
      } catch {
        // A logging failure must not mask the real result.
      }
    }
  }

  if (result.status === "ok") {
    if (collector === "played") await heartbeat(env);
    if (previousStatus === "error") {
      // Each of these is a no-op unless that kind actually alerted, so a
      // recovery produces one all-clear, not a burst.
      await notifyRecovered(env, "auth", {
        title: "Spotify poller — account reconnected",
        message: `Collection resumed for ${account?.display_name ?? account?.id ?? "the account"}.`,
      });
      await notifyRecovered(env, "run-error", {
        title: `Spotify poller — collector ${collector} recovered`,
        message: `Collector ${collector} is collecting again (${result.inserted} new events).`,
      });
    }
    if (result.gap) {
      // A gap is history lost for good: the API only ever returns the last 50
      // plays, so nothing will bring those back. Worth waking someone up.
      await notifyOnce(env, "gap", {
        title: "Spotify poller — gap in the history",
        message:
          `No collection between ${result.gap.from} and ${result.gap.to}: the 50-track buffer ` +
          `was fully renewed in the meantime, those plays are lost.`,
        priority: "default",
        tags: ["hole"],
        clickUrl: appBaseUrl(env),
      });
    }
  }

  return { ...result, account_id: account?.id };
}

/**
 * A revoked refresh token is the one failure that never fixes itself: the
 * notification has to be actionable, hence the link straight to the UI where
 * the reconnect button lives.
 */
async function alertOnError(
  env: Env,
  collector: CollectorId,
  e: unknown,
  errorMsg: string,
  account: Account | null
): Promise<void> {
  const who = account?.display_name ?? account?.id ?? "no account";
  if (e instanceof AuthError) {
    await notifyOnce(env, "auth", {
      title: "Spotify poller — reconnection required",
      message: `Collection is STOPPED for ${who}.\n${errorMsg}\n\nReconnect the account to resume.`,
      priority: "high",
      tags: ["rotating_light", "musical_note"],
      clickUrl: appBaseUrl(env),
    });
    return;
  }
  await notifyOnce(env, "run-error", {
    title: `Spotify poller — collector ${collector} failed`,
    message: `${errorMsg}\naccount: ${who}`,
    priority: "high",
    tags: ["warning"],
    clickUrl: appBaseUrl(env),
  });
}
