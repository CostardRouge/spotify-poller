# Poller Spotify — collecte continue de l'historique d'écoute

Collecte l'historique d'écoute (et les likes) d'un compte Spotify personnel
dans une base SQLite locale, en continu et sans supervision. Voir la spec pour
le pourquoi ; l'essentiel : l'API Spotify n'expose que les **50 derniers
morceaux**, toute période non collectée à temps est perdue pour toujours.

**Ce qui reste critique quel que soit le mode de déploiement** : le watchdog
externe (healthchecks.io). L'onduleur protège la perte d'alimentation, rien
d'autre. Panne FAI, reboot sans relance propre, disque plein, crash silencieux
du process : seul le watchdog les rend bruyants. Le `HEALTHCHECK` Docker le
complète (redémarrage local d'un process coincé) mais ne le remplace jamais —
un hôte éteint ne redémarre rien tout seul.

## Déploiement recommandé : Docker (conventions Spotify Calendar)

```bash
make init          # crée .env depuis .env.example + build de l'image dev
# éditer .env : SPOTIFY_CLIENT_ID/SECRET, SPOTIFY_REDIRECT_URI, ADMIN_TOKEN, WATCHDOG_URL
make up            # démarre la stack dev (http://127.0.0.1:8787)
make logs
```

Puis ouvrir http://127.0.0.1:8787, coller l'`ADMIN_TOKEN` (en haut à droite)
et cliquer **« Connecter Spotify »** : le refresh token est stocké en base
(`poller_state`, sur le volume de données), plus besoin du script jetable.
Le fallback `SPOTIFY_REFRESH_TOKEN` en `.env` reste supporté
(`scripts/get-refresh-token.mjs`).

### Home Lab (OptiPlex)

L'image est construite et publiée sur GHCR par
`.github/workflows/docker-build.yml` à chaque push sur `main` — même schéma
que le Spotify Calendar (tags `main`/`latest` mouvants + `sha-<court>`
immuable pour rollback, redéploiement Watchtower optionnel).

```bash
make prod-pull && make prod-up     # ou : make prod-deploy
make prod-logs
make prod-run-a                    # passage manuel du collecteur A
```

Points non négociables, câblés dans `docker-compose.prod.yml` :

- **la base SQLite vit sur le volume nommé `spotify-poller-data`** — jamais
  dans la couche writable du conteneur : la donnée est irremplaçable, à
  inclure dans les sauvegardes de l'hôte ;
- **aucun secret dans l'image** — tout vient de `.env` via `env_file` au
  lancement ;
- **planification interne au conteneur** (`SCHEDULE_ENABLED=1`) : A toutes
  les 30 min, B quotidien. Décision et alternatives : `docs/scheduling.md` ;
- healthcheck Docker sur `/health`, en complément du watchdog externe.

### Cibles Makefile

`make help` liste tout — mêmes conventions que le Spotify Calendar
(`build/up/down/logs/shell`, `prod-*`), plus les opérations poller :
`migrate`, `run-a`, `run-b` (et leurs variantes `prod-`).

## UI de debug

Servie sur `/` par le serveur (aucune dépendance, un fichier
`public/index.html`). Minimaliste, pensée pour vérifier la collecte :

- état de santé : dernier succès A/B, compte connecté, rate-limit en cours ;
- connexion du compte Spotify (flow Authorization Code, spec §7 — token
  stable stocké dans `poller_state`) ;
- navigation de **tous** les événements collectés : filtres type / recherche
  titre-artiste / bornes de dates, tri, pagination, payload JSON dépliable ;
- journal des exécutions (`poller_runs`), trous déclarés (`gaps`), stats ;
- déclenchement manuel des collecteurs A et B (idempotent — I2).

L'UI demande l'`ADMIN_TOKEN` (stocké dans le localStorage du navigateur).
Le serveur n'est pas fait pour être exposé à internet : réseau local
uniquement, reverse proxy TLS si accès distant un jour.

## Endpoints

| Route | Auth | Rôle |
|---|---|---|
| `GET /` | — | UI de debug |
| `GET /health` | — | dernier succès par collecteur, auth, rate-limit, scheduler |
| `GET /auth/login` | jeton (query) | démarre le flow OAuth de connexion |
| `GET /auth/callback` | state cookie | retour Spotify, stocke le refresh token |
| `POST /run?collector=A\|B` | Bearer/query | déclenchement manuel (idempotent) |
| `GET /stats` | Bearer/query | volumétrie, trous, 20 dernières exécutions |
| `GET /api/events` | Bearer/query | pagination + filtres `type`, `q`, `from`, `to`, `order` |
| `GET /api/runs`, `GET /api/gaps` | Bearer/query | journaux paginés |

## Rate limit & résilience API (repris du Spotify Calendar)

- retry **borné** (backoff exponentiel) sur erreurs réseau et 5xx — tout
  appel se termine en temps fini ;
- `429` : jamais de retry dans la même exécution ; le cooldown `Retry-After`
  est **persisté** (`poller_state`) et les exécutions suivantes s'abstiennent
  tant qu'il court — requêter pendant un ban le prolonge ;
- chaque tentative écrit sa ligne `raw_spotify` avant tout parsing (I3) ;
- `401` isolé : un rafraîchissement de token puis un seul nouvel essai ;
- échec du refresh token : `AuthError`, bruyant, alerte watchdog immédiate.

## Alternative bare-metal : systemd (mode historique)

<details>
<summary>Déploiement direct sur l'OptiPlex sans Docker (déplié)</summary>

### Prérequis

```bash
node --version   # Node 20 LTS minimum
sudo apt install -y build-essential python3   # better-sqlite3 compile au install
```

### Installation

```bash
sudo mkdir -p /opt/spotify-poller/data
sudo useradd --system --home /opt/spotify-poller --shell /usr/sbin/nologin poller
sudo chown -R poller:poller /opt/spotify-poller

cd /opt/spotify-poller
npm install
npm run build

cp .env.example .env
chmod 600 .env
sudo chown poller:poller .env
sudo -u poller npm run migrate
```

### Systemd

```bash
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now spotify-poller-a.timer
sudo systemctl enable --now spotify-poller-b.timer
sudo systemctl enable --now spotify-poller-api.service
```

En bare-metal, laisser `SCHEDULE_ENABLED` non défini : les timers systemd
pilotent `run-once.ts`, jamais deux planificateurs en parallèle
(`docs/scheduling.md`).

`Persistent=true` sur les timers garantit qu'un passage manqué pendant un
redémarrage est rattrapé dès que la machine revient.

### Sécurité self-host

- service system dédié (`poller`), sans privilèges, sans shell ;
- `ProtectSystem=strict` + `ReadWritePaths` restreint à `data/` ;
- `.env` en `600`, jamais commité.

</details>

## Tests d'acceptation (inchangés)

```bash
# Idempotence (I2) : rejouer A deux fois de suite
curl -X POST "http://127.0.0.1:8787/run?collector=A" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> inserted > 0, puis rejouer : inserted: 0

# Watchdog : couper le service, attendre 2 h, confirmer l'alerte healthchecks.io
make down   # (ou systemctl stop spotify-poller-a.timer)

# Résilience au reboot : sudo reboot puis vérifier
docker ps            # restart: unless-stopped doit avoir relancé le conteneur
make prod-logs       # premier passage A ~15 s après le démarrage
```

## Backfill des likes

Bouton « Run B » de l'UI (ou `make run-b`), à relancer jusqu'à
`note: "backfill terminé"` — ou laisser la cadence quotidienne finir
(tant que le backfill est en cours, le scheduler fait tourner B toutes les
heures par tranches bornées).

## Les 5 tests empiriques

`docs/findings.md` — inchangé, indépendant de l'infra. Le test 2 (hors-ligne)
reste le plus important.

## Sauvegarde

La base est un fichier sur le volume `spotify-poller-data`. Backup simple
depuis l'hôte :
```bash
docker compose -f docker-compose.prod.yml exec spotify-poller \
  node -e "require('better-sqlite3')(process.env.DB_PATH).backup('/data/backup-'+new Date().toISOString().slice(0,10)+'.db')"
```
À automatiser (cron hôte ou conteneur dédié) avant que le fichier contienne
des mois d'historique irremplaçable.

## Hors périmètre (inchangé, §14 de la spec)

Corrélation, photos, GPX, analyse audio, import de l'export RGPD, purge de
`raw_spotify`.

---

**Pense-bête indépendant de l'infra** : demander l'export RGPD
« Extended streaming history » sur spotify.com/account/privacy (~30 jours de délai).
