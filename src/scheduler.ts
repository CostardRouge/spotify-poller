import { getState } from "./db";
import { runCollector } from "./run-core";
import { Env } from "./types";

/**
 * Planification interne au conteneur (décision §13 documentée dans
 * docs/scheduling.md) : le serveur long-running porte la boucle de
 * planification, comme le Spotify Calendar porte tout dans un unique
 * conteneur `restart: unless-stopped`.
 *
 *  - Collecteur A : toutes les SCHEDULE_A_MINUTES (30 par défaut), premier
 *    passage peu après le démarrage — un redémarrage ne fait donc jamais
 *    perdre plus d'une fenêtre.
 *  - Collecteur B : cadence pilotée par l'horloge PERSISTÉE
 *    (`B.last_success_at`), vérifiée toutes les heures — la cadence
 *    quotidienne ne dérive pas au fil des redémarrages du conteneur.
 *    Exception : tant que le backfill n'est pas terminé, B tourne à chaque
 *    vérification horaire pour avancer le backfill par tranches bornées.
 *
 * Désactivé par défaut (SCHEDULE_ENABLED=1 pour l'activer) : en bare-metal,
 * ce sont les timers systemd qui pilotent run-once.ts, et l'API ne doit pas
 * collecter en double — même si l'idempotence (I2) rendrait ce doublon
 * inoffensif pour les données.
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
  // Verrou anti-chevauchement : un passage encore en cours n'est jamais doublé.
  const running: Record<"A" | "B", boolean> = { A: false, B: false };

  const tick = async (collector: "A" | "B"): Promise<void> => {
    if (running[collector]) return;
    running[collector] = true;
    try {
      const result = await runCollector(collector, "cron", env);
      console.log(`[scheduler] collecteur ${collector} :`, JSON.stringify(result));
    } catch (e) {
      // runCollector capture déjà tout (I1) — ceci n'attrape que l'imprévu.
      console.error(`[scheduler] collecteur ${collector} : erreur non capturée`, e);
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
    `[scheduler] actif — A toutes les ${opts.aEveryMinutes} min, B toutes les ${opts.bEveryHours} h (vérification horaire)`
  );
}
