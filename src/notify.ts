/**
 * Two DISTINCT alerting channels. Conflating them would lose the protection
 * that matters most.
 *
 *  1. Heartbeat (WATCHDOG_URL) — a dead man's switch. It alerts on SILENCE:
 *     the poller pings on every successful A run, and the remote side shouts
 *     when the pings stop. This is the only thing that catches a powered-off
 *     host, a killed container or a full disk. Works with healthchecks.io or,
 *     for a fully self-hosted setup, an Uptime Kuma "Push" monitor — same
 *     contract: an URL to hit periodically.
 *
 *  2. ntfy (NTFY_URL) — a push channel. It can only deliver a message that
 *     something CHOSE to send, so it can never report silence: a dead poller
 *     sends nothing. It carries what is actionable and immediate, above all
 *     "your refresh token was revoked, reconnect the account".
 *
 * ntfy therefore complements the heartbeat, it does not replace it.
 *
 * Anti-spam: a revoked token would otherwise notify every 30 minutes, forever.
 * Each notification kind is throttled through poller_state and reset when the
 * situation recovers, so you get one alert, then one all-clear.
 */
import { getGlobalState, setGlobalState } from "./db";
import { Env, nowIso } from "./types";

export type NotifyKind = "auth" | "run-error" | "backup" | "gap";

/** ntfy priorities: 1 min, 3 default, 5 max. */
export type NotifyPriority = "min" | "low" | "default" | "high" | "urgent";

export interface NotifyOptions {
  title: string;
  message: string;
  priority?: NotifyPriority;
  tags?: string[];
  /** URL opened when the notification is tapped — makes an alert actionable. */
  clickUrl?: string;
}

const throttleKey = (kind: NotifyKind): string => `notify.last.${kind}`;

/**
 * HTTP header values are ByteStrings: any character above U+00FF makes fetch()
 * throw, which would silently kill every notification — the one failure mode
 * you would never notice, since the symptom is "no alerts". ntfy reads RFC 2047
 * encoded-words, so non-ASCII titles and tags go out base64-encoded.
 * The message itself travels in the body and needs no encoding.
 */
function encodeHeader(value: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

/** Fire-and-forget POST to the ntfy topic. Never throws. */
export async function notify(env: Env, opts: NotifyOptions): Promise<void> {
  if (!env.NTFY_URL) return;
  const headers: Record<string, string> = {
    Title: encodeHeader(opts.title),
    Priority: opts.priority ?? "default",
  };
  if (opts.tags?.length) headers.Tags = encodeHeader(opts.tags.join(","));
  if (opts.clickUrl) headers.Click = opts.clickUrl;
  if (env.NTFY_TOKEN) headers.Authorization = `Bearer ${env.NTFY_TOKEN}`;

  try {
    await fetch(env.NTFY_URL, { method: "POST", headers, body: opts.message.slice(0, 4000) });
  } catch (e) {
    // A notification that fails to send must never fail the run it describes.
    console.error("[notify] ntfy delivery failed:", e);
  }
}

/**
 * Sends at most one notification of this kind per NTFY_THROTTLE_HOURS.
 * Returns whether it actually went out.
 */
export async function notifyOnce(env: Env, kind: NotifyKind, opts: NotifyOptions): Promise<boolean> {
  if (!env.NTFY_URL) return false;
  const last = getGlobalState(env, throttleKey(kind));
  const windowMs = env.NTFY_THROTTLE_HOURS * 3_600_000;
  if (last && Date.now() - Date.parse(last) < windowMs) return false;

  setGlobalState(env, throttleKey(kind), nowIso());
  await notify(env, opts);
  return true;
}

/**
 * Clears the throttle for a kind and, if an alert had been sent, announces the
 * recovery. Called when a collector goes back to 'ok'.
 */
export async function notifyRecovered(env: Env, kind: NotifyKind, opts: NotifyOptions): Promise<void> {
  if (!env.NTFY_URL) return;
  if (!getGlobalState(env, throttleKey(kind))) return; // nothing was ever alerted
  setGlobalState(env, throttleKey(kind), "");
  await notify(env, { ...opts, priority: opts.priority ?? "low", tags: opts.tags ?? ["white_check_mark"] });
}

// ---------- heartbeat (dead man's switch, spec §9) ----------

/**
 * healthchecks.io / Uptime Kuma push convention:
 *   GET <url>       -> success ping
 *   GET <url>/fail  -> immediate alert
 */
export async function heartbeat(env: Env): Promise<void> {
  if (!env.WATCHDOG_URL) return; // local dev only — mandatory in production
  try {
    await fetch(env.WATCHDOG_URL, { method: "GET" });
  } catch {
    // A failed ping must not fail the run: the silence will trigger the alert
    // on the watchdog side, that is its job.
  }
}

export async function heartbeatFail(env: Env, reason: string): Promise<void> {
  if (!env.WATCHDOG_URL) return;
  try {
    await fetch(`${env.WATCHDOG_URL}/fail`, { method: "POST", body: reason.slice(0, 1000) });
  } catch {
    /* same */
  }
}
