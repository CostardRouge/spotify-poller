# Spotify Poller — continuous listening-history collection

Continuously and unattended, collects the listening history (and likes) of a
personal Spotify account into a local SQLite database. See the spec for the
why; the gist: the Spotify API only exposes the **last 50 tracks**, so any
period not collected in time is lost forever.

**What stays critical whatever the deployment mode**: the external watchdog
(healthchecks.io). The UPS protects against power loss, nothing else. ISP
outage, reboot without a clean restart, full disk, silent process crash: only
the watchdog makes those loud. The Docker `HEALTHCHECK` complements it (local
restart of a stuck process) but never replaces it — a powered-off host
restarts nothing on its own.

## Recommended deployment: Docker (Spotify Calendar conventions)

```bash
make init          # creates .env from .env.example + builds the dev image
# edit .env: SPOTIFY_CLIENT_ID/SECRET, SPOTIFY_REDIRECT_URI, ADMIN_TOKEN, WATCHDOG_URL
make up            # starts the dev stack (http://127.0.0.1:8787)
make logs
```

Then open http://127.0.0.1:8787, paste the `ADMIN_TOKEN` (top right) and click
**"Connect Spotify"**: the refresh token is stored in the database
(`poller_state`, on the data volume), so the throwaway script is no longer
needed. The `SPOTIFY_REFRESH_TOKEN` fallback in `.env` is still supported
(`scripts/get-refresh-token.mjs`).

### Home Lab (OptiPlex)

The image is built and published to GHCR by
`.github/workflows/docker-build.yml` on every push to `main` — same scheme as
the Spotify Calendar (moving `main`/`latest` tags + immutable `sha-<short>`
for rollback, optional Watchtower redeployment).

```bash
make prod-pull && make prod-up     # or: make prod-deploy
make prod-logs
make prod-run-a                    # manual run of collector A
```

Non-negotiable points, wired into `docker-compose.prod.yml`:

- **the SQLite database lives on the named volume `spotify-poller-data`** —
  never in the container's writable layer: the data is irreplaceable and must
  be included in the host's backups;
- **no secret in the image** — everything comes from `.env` via `env_file` at
  launch time;
- **container-internal scheduling** (`SCHEDULE_ENABLED=1`): A every 30 min, B
  daily. Decision and alternatives: `docs/scheduling.md`;
- Docker healthcheck on `/health`, complementing the external watchdog.

### Makefile targets

`make help` lists everything — same conventions as the Spotify Calendar
(`build/up/down/logs/shell`, `prod-*`), plus the poller operations:
`migrate`, `run-a`, `run-b` (and their `prod-` variants).

## Debug UI

Served on `/` by the server (no dependencies, a single `public/index.html`
file). Minimal, designed to verify collection:

- health status: last A/B success, connected account, ongoing rate limit;
- Spotify account connection (Authorization Code flow, spec §7 — stable token
  stored in `poller_state`);
- browsing of **all** collected events: type filters / title-artist search /
  date bounds, sorting, pagination, expandable JSON payload;
- run log (`poller_runs`), declared gaps (`gaps`), stats;
- manual triggering of collectors A and B (idempotent — I2).

The UI asks for the `ADMIN_TOKEN` (stored in the browser's localStorage). The
server is not meant to be exposed to the internet: local network only, TLS
reverse proxy if remote access is ever needed.

## Endpoints

| Route | Auth | Role |
|---|---|---|
| `GET /` | — | debug UI |
| `GET /health` | — | last success per collector, auth, rate limit, scheduler |
| `GET /auth/login` | token (query) | starts the OAuth connection flow |
| `GET /auth/callback` | state cookie | Spotify return, stores the refresh token |
| `POST /run?collector=A\|B` | Bearer/query | manual trigger (idempotent) |
| `GET /stats` | Bearer/query | volumes, gaps, last 20 runs |
| `GET /api/events` | Bearer/query | pagination + `type`, `q`, `from`, `to`, `order` filters |
| `GET /api/runs`, `GET /api/gaps` | Bearer/query | paginated logs |

## Rate limit & API resilience (carried over from the Spotify Calendar)

- **bounded** retry (exponential backoff) on network errors and 5xx — every
  call terminates in finite time;
- `429`: never retried within the same run; the `Retry-After` cooldown is
  **persisted** (`poller_state`) and subsequent runs abstain while it lasts —
  querying during a ban extends it;
- every attempt writes its `raw_spotify` row before any parsing (I3);
- isolated `401`: one token refresh, then a single retry;
- refresh-token failure: `AuthError`, loud, immediate watchdog alert.

## Bare-metal alternative: systemd (legacy mode)

<details>
<summary>Deploying directly on the OptiPlex without Docker (expanded)</summary>

### Prerequisites

```bash
node --version   # Node 20 LTS minimum
sudo apt install -y build-essential python3   # better-sqlite3 compiles at install time
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

On bare metal, leave `SCHEDULE_ENABLED` unset: the systemd timers drive
`run-once.ts`, never two schedulers in parallel (`docs/scheduling.md`).

`Persistent=true` on the timers guarantees that a run missed during a restart
is caught up as soon as the machine comes back.

### Self-host security

- dedicated system service (`poller`), unprivileged, no shell;
- `ProtectSystem=strict` + `ReadWritePaths` restricted to `data/`;
- `.env` at `600`, never committed.

</details>

## Acceptance tests (unchanged)

```bash
# Idempotence (I2): replay A twice in a row
curl -X POST "http://127.0.0.1:8787/run?collector=A" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> inserted > 0, then replay: inserted: 0

# Watchdog: stop the service, wait 2 h, confirm the healthchecks.io alert
make down   # (or systemctl stop spotify-poller-a.timer)

# Reboot resilience: sudo reboot, then check
docker ps            # restart: unless-stopped must have brought the container back
make prod-logs       # first A run ~15 s after startup
```

## Likes backfill

The UI's "Run B" button (or `make run-b`), to be re-run until
`note: "backfill complete"` — or just let the daily cadence finish (while the
backfill is in progress, the scheduler runs B every hour in bounded batches).

## The 5 empirical tests

`docs/findings.md` — unchanged, independent of the infrastructure. Test 2
(offline) remains the most important.

## Backup

The database is a file on the `spotify-poller-data` volume. Simple backup from
the host:
```bash
docker compose -f docker-compose.prod.yml exec spotify-poller \
  node -e "require('better-sqlite3')(process.env.DB_PATH).backup('/data/backup-'+new Date().toISOString().slice(0,10)+'.db')"
```
To be automated (host cron or dedicated container) before the file holds
months of irreplaceable history.

## Out of scope (unchanged, §14 of the spec)

Correlation, photos, GPX, audio analysis, GDPR export import, `raw_spotify`
purge.

---

**Infrastructure-independent reminder**: request the GDPR
"Extended streaming history" export at spotify.com/account/privacy (~30-day delay).
