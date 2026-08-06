# Décision : planification en environnement conteneurisé (spec §13)

## Décision

**Boucle de planification interne au conteneur long-running** (`src/scheduler.ts`,
activée par `SCHEDULE_ENABLED=1`) : le serveur HTTP porte aussi les cadences
A (30 min) et B (quotidien). C'est le mode par défaut des deux stacks Docker
Compose de ce repo.

`run-once.ts` est conservé tel quel : il reste le point d'entrée des timers
systemd en bare-metal, et permet un déclenchement manuel dans le conteneur
(`make run-a` / `make run-b`).

## Pourquoi cette option

La spec §13 demandait de trancher explicitement entre trois options, en
regardant d'abord ce que fait le projet **Spotify Calendar** :

1. planificateur externe (cron hôte + `docker exec`, ou conteneur Ofelia) ;
2. **unique conteneur long-running avec boucle de planification interne** ← retenu ;
3. timers systemd hôte + conteneur exécuté à la demande.

Le Spotify Calendar n'a pas de planification périodique à proprement parler,
mais son schéma d'exploitation est clair et éprouvé : **un unique conteneur
par application**, `restart: unless-stopped`, healthcheck Docker, image GHCR
re-tirée par Watchtower. L'option 2 est la seule qui reproduit ce schéma à
l'identique :

- un seul artefact à déployer et à surveiller — pas de crontab hôte à
  maintenir hors du repo (option 1a), pas de second conteneur planificateur
  dont la mort serait elle-même silencieuse (option 1b), pas de dépendance au
  systemd de l'hôte qui remettrait la moitié du déploiement hors de Docker
  (option 3) ;
- le healthcheck Docker et le watchdog externe surveillent le même process
  que celui qui collecte : un conteneur mort = plus de ping = alerte (I1) ;
- `restart: unless-stopped` relance la boucle après reboot de l'hôte, sans
  réactivation manuelle d'un timer.

## Garde-fous propres à ce choix

- **Cadence B persistée** : le scheduler ne compte pas « 24 h depuis le
  démarrage du process » mais lit `B.last_success_at` en base — les
  redémarrages du conteneur ne font pas dériver la cadence quotidienne.
  Tant que le backfill de B n'est pas terminé, B tourne à chaque
  vérification horaire pour l'avancer par tranches bornées.
- **Premier passage de A ~15 s après le démarrage** : un crash-loop du
  conteneur se voit immédiatement dans `poller_runs`, et un redémarrage ne
  coûte jamais plus d'une fenêtre de 30 min.
- **Verrou anti-chevauchement** par collecteur ; un déclenchement manuel
  (`POST /run`) reste par ailleurs sans danger grâce à l'idempotence (I2).
- **Défaut = désactivé** hors Docker : `SCHEDULE_ENABLED` n'est mis à `1`
  que par les fichiers compose. En bare-metal, les timers systemd restent la
  seule source de déclenchement — jamais deux planificateurs en parallèle.

## Ce qui ne change pas

Le **watchdog externe** (healthchecks.io) reste la seule protection contre un
hôte entièrement éteint : le healthcheck Docker le complète (redémarrage local
d'un process coincé) mais ne le remplace pas. Voir spec §4 et §10.
