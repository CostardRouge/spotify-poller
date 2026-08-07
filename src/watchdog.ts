import { Env } from "./types";

/**
 * Dead man's switch (spec §9). The monitoring is EXTERNAL:
 * a watchdog hosted here would go silent at the same time as the Worker.
 *
 * healthchecks.io convention:
 *   GET <url>       -> success ping (the check expects a ping < 2 h)
 *   GET <url>/fail  -> immediate alert
 *
 * Only collector A (the critical one) sends the success ping;
 * errors from both collectors ping /fail.
 */
export async function pingSuccess(env: Env): Promise<void> {
  if (!env.WATCHDOG_URL) return; // local dev only — mandatory in production
  try {
    await fetch(env.WATCHDOG_URL, { method: "GET" });
  } catch {
    // A failed ping must not fail the run: the silence will trigger the
    // alert on the watchdog side, that is its job.
  }
}

export async function pingFailure(env: Env, reason: string): Promise<void> {
  if (!env.WATCHDOG_URL) return;
  try {
    await fetch(`${env.WATCHDOG_URL}/fail`, {
      method: "POST",
      body: reason.slice(0, 1000),
    });
  } catch {
    /* same */
  }
}
