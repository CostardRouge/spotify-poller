import { collectRecentlyPlayed } from "./collectors/recently-played";
import { collectLikedTracks } from "./collectors/liked-tracks";
import { finishRun, startRun } from "./db";
import { AuthError, CollectorResult, Env, TransientError } from "./types";
import { pingFailure, pingSuccess } from "./watchdog";

/**
 * Spec §8, inchangée par le passage au self-host :
 *  - ligne poller_runs écrite au démarrage, complétée dans un finally (I1)
 *  - AuthError / erreur DB / exception imprévue -> 'error' + alerte immédiate
 *  - TransientError -> 'partial', silencieux : la prochaine exécution rattrape
 *  - succès du collecteur A -> ping watchdog (dead man's switch, §9)
 *
 * Le watchdog est PLUS important ici qu'sur Workers : les causes de silence
 * sont plus nombreuses (reboot, coupure réseau locale, disque plein, crash
 * process) et l'onduleur ne couvre que la perte d'alimentation électrique.
 */
export async function runCollector(collector: "A" | "B", trigger: "cron" | "manual", env: Env): Promise<CollectorResult> {
  let runId: number | null = null;
  let result: CollectorResult = { status: "error", fetched: 0, inserted: 0 };
  let errorMsg: string | null = null;

  try {
    runId = startRun(env, collector, trigger);
    result = collector === "A" ? await collectRecentlyPlayed(env) : await collectLikedTracks(env);
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
        // L'échec du journal ne doit pas masquer le résultat réel.
      }
    }
  }

  if (collector === "A" && result.status === "ok") {
    await pingSuccess(env);
  }
  return result;
}
