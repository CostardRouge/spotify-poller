# Poller Spotify — déploiement homelab (OptiPlex)

Même logique que `spec-poller-spotify.md` v1.0. Ce qui change vis-à-vis de la
version Cloudflare Workers : D1 → SQLite (`better-sqlite3`), Cron Triggers →
systemd timers, secrets Worker → fichier `.env`.

**Ce qui NE change PAS et reste critique** : le watchdog externe (§9).
L'onduleur protège une chose précise — la perte d'alimentation électrique de
l'OptiPlex, de la box et du routeur. Il ne protège pas contre :
- une panne côté FAI (le courant est là, le lien internet non)
- un reboot suite à mise à jour système sans réactivation propre du timer
- un disque plein, un crash silencieux du process Node
- toi qui débranches accidentellement un câble

Le watchdog (healthchecks.io) reste la seule protection contre ces cas — et
sur self-host, ils sont plus nombreux qu'en serverless. Ne pas le sauter.

## Prérequis sur l'OptiPlex

```bash
# Node 20 LTS minimum (better-sqlite3 a besoin d'un binding natif à jour)
node --version

# Outils de compilation natifs (better-sqlite3 compile au install)
sudo apt install -y build-essential python3
```

## Installation

```bash
sudo mkdir -p /opt/spotify-poller/data
sudo useradd --system --home /opt/spotify-poller --shell /usr/sbin/nologin poller
sudo chown -R poller:poller /opt/spotify-poller

# Copier ce projet dans /opt/spotify-poller (sans node_modules/dist)
cd /opt/spotify-poller
npm install
npm run build
```

### Secrets

```bash
cp .env.example .env
chmod 600 .env          # lecture réservée au propriétaire
sudo chown poller:poller .env
```

Remplir `.env` :
- `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` : app créée sur developer.spotify.com
  (séparée de l'app calendrier existante)
- `SPOTIFY_REFRESH_TOKEN` : via le script jetable (§7 de la spec, inchangé) :
  ```bash
  SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/get-refresh-token.mjs
  ```
- `WATCHDOG_URL` : créer un check sur healthchecks.io, période **30 min**, grâce **2 h**
- `ADMIN_TOKEN` : `openssl rand -hex 32`

### Base de données

```bash
sudo -u poller npm run migrate
```

## Systemd

```bash
sudo cp systemd/*.service systemd/*.timer /etc/systemd/system/
sudo systemctl daemon-reload

sudo systemctl enable --now spotify-poller-a.timer
sudo systemctl enable --now spotify-poller-b.timer
sudo systemctl enable --now spotify-poller-api.service
```

Vérifier :
```bash
systemctl list-timers | grep spotify-poller
sudo systemctl status spotify-poller-api.service
```

### Test d'idempotence (critère d'acceptation, inchangé)

```bash
curl -X POST "http://127.0.0.1:8787/run?collector=A" \
  -H "Authorization: Bearer $(grep ADMIN_TOKEN /opt/spotify-poller/.env | cut -d= -f2)"
# -> inserted > 0

# Rejouer immédiatement :
curl -X POST "http://127.0.0.1:8787/run?collector=A" -H "Authorization: Bearer ..."
# -> inserted: 0   (invariant I2)
```

### Test du watchdog (critère de sortie §9 — ne pas sauter)

```bash
sudo systemctl stop spotify-poller-a.timer
# attendre 2 h, confirmer la réception de l'alerte healthchecks.io
sudo systemctl start spotify-poller-a.timer
```

### Test de résilience réelle (spécifique au self-host)

Ce test remplace le test Workers, il vérifie que l'auto-hébergement encaisse
bien les pannes qu'on vient de citer :
```bash
sudo reboot
# après redémarrage :
systemctl list-timers | grep spotify-poller   # doivent réapparaître actifs
journalctl -u spotify-poller-a.service --since "10 min ago"
```
`Persistent=true` sur les timers garantit qu'un passage manqué pendant le
redémarrage est rattrapé dès que la machine revient, plutôt qu'attendre le
prochain créneau de 30 min.

## Backfill des likes

```bash
curl -X POST "http://127.0.0.1:8787/run?collector=B" -H "Authorization: Bearer ..."
```
Relancer jusqu'à `note: "backfill terminé"`, ou laisser le timer quotidien finir.

## Les 5 tests empiriques

`docs/findings.md` — inchangé, indépendant de l'infra. Le test 2 (hors-ligne)
reste le plus important.

## Endpoints

| Route | Auth | Rôle |
|---|---|---|
| `GET /health` | — | dernier succès par collecteur, événements par type |
| `POST /run?collector=A\|B` | Bearer ADMIN_TOKEN | déclenchement manuel (idempotent) |
| `GET /stats` | Bearer ADMIN_TOKEN | volumétrie, trous, 20 dernières exécutions |

Le serveur écoute en `127.0.0.1` par défaut — pas exposé au réseau local ni à
internet. Pour un accès depuis ton téléphone plus tard, passer par un reverse
proxy (Caddy/Nginx) avec TLS plutôt que d'ouvrir ce process directement.

## Sécurité — spécifique au self-host

- Service system dédié (`poller`), sans privilèges, sans shell
- `ProtectSystem=strict` + `ReadWritePaths` restreint : le process ne peut
  écrire que dans `data/`, même compromis
- `.env` en `600`, jamais commité
- Si tu ouvres un accès distant un jour : TLS obligatoire, pas de `.env` sur
  un volume synchronisé (cloud, NAS partagé) sans chiffrement

## Sauvegarde

Contrairement à D1 (géré par Cloudflare), la base est maintenant un fichier
sur ton disque. Un backup simple :
```bash
sqlite3 /opt/spotify-poller/data/life-events.db ".backup /opt/spotify-poller/data/backup-$(date +%F).db"
```
À automatiser en timer systemd séparé une fois le reste stable — pas urgent
au démarrage, mais à ne pas oublier avant que le fichier contienne des mois
d'historique irremplaçable.

## Hors périmètre (inchangé, §14 de la spec)

UI, photos, GPX, corrélation, import de l'export RGPD, purge de `raw_spotify`.

---

**Pense-bête indépendant de l'infra** : demander l'export RGPD
« Extended streaming history » sur spotify.com/account/privacy (~30 jours de délai).
