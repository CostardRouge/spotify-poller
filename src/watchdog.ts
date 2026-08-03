import { Env } from "./types";

/**
 * Dead man's switch (spec §9). La surveillance est EXTERNE :
 * un watchdog hébergé ici se tairait en même temps que le Worker.
 *
 * Convention healthchecks.io :
 *   GET <url>       -> ping de succès (le check attend un ping < 2 h)
 *   GET <url>/fail  -> alerte immédiate
 *
 * Seul le collecteur A (critique) envoie le ping de succès ;
 * les erreurs des deux collecteurs pingent /fail.
 */
export async function pingSuccess(env: Env): Promise<void> {
  if (!env.WATCHDOG_URL) return; // dev local uniquement — obligatoire en prod
  try {
    await fetch(env.WATCHDOG_URL, { method: "GET" });
  } catch {
    // Un échec de ping ne doit pas faire échouer l'exécution :
    // le silence déclenchera l'alerte côté watchdog, c'est son rôle.
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
    /* idem */
  }
}
