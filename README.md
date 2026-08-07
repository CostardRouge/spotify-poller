# Spotify Poller — continuous listening-history collection

Continuously and unattended, collects the listening history (and likes) of a
personal Spotify account into a local SQLite database. See the spec for the
why; the gist: the Spotify API only exposes the **last 50 tracks**, so any
period not collected in time is lost forever.

**What stays critical whatever the deployment mode**: the external heartbeat
(`WATCHDOG_URL`). The UPS protects against power loss, nothing else. ISP
outage, reboot without a clean restart, full disk, silent process crash: only a
watchdog that alerts on *silence* makes those loud.

Two things it is worth being precise about, because both are easy to
over-trust:

- **the Docker `HEALTHCHECK` does not restart anything.** Under plain Compose
  (as opposed to Swarm), an `unhealthy` container just stays `unhealthy` — the
  status is reported, not acted upon. It is a diagnosis, not a cure; add a
  companion `autoheal` container if you want the cure.
- **ntfy cannot replace the heartbeat.** It is a push channel: it only delivers
  messages something chose to send, so a dead poller sends nothing and your
  phone stays quiet. ntfy carries what is *actionable* (see below); detecting
  silence is a different job. See `src/notify.ts`.

## The two collectors

Named after what they collect — the same id is used in the URL, the CLI, the
Makefile, the UI buttons and every database row:

| id | Source | Cadence | Role |
|---|---|---|---|
| `played` | `GET /v1/me/player/recently-played` | every 30 min | the critical one: Spotify only keeps the **last 50** tracks, and this is the only collector that pings the watchdog |
| `liked` | `GET /v1/me/tracks` | daily (hourly while the backfill is running) | liked tracks, plus the paginated initial backfill |

```bash
curl -X POST "http://127.0.0.1:8787/run?collector=played" -H "Authorization: Bearer $ADMIN_TOKEN"
make run-played        # same thing through the dev container
```

These ids replace the former `A` (= `played`) and `B` (= `liked`). The old
letters are still accepted by `/run` and `run-once.js` so an already-installed
systemd unit keeps working, but everything now displays and documents the
explicit names. Existing databases are converted by
`migrations/0004_collector_names.sql` — run `make migrate` (or `make
prod-migrate`) **before** starting the new version, otherwise the likes
backfill restarts from zero.

## Recommended deployment: Docker (Spotify Calendar conventions)

```bash
make init          # creates .env from .env.example + builds the dev image
# edit .env: SPOTIFY_CLIENT_ID/SECRET, SPOTIFY_REDIRECT_URI, ADMIN_TOKEN, WATCHDOG_URL
make up            # starts the dev stack (http://127.0.0.1:8787)
make logs
```

Then open http://127.0.0.1:8787, paste the `ADMIN_TOKEN` (top right) and click
**"Connect Spotify"**: the refresh token is stored in the database
(`accounts` table, on the data volume), so the throwaway script is no longer
needed. The `SPOTIFY_REFRESH_TOKEN` fallback in `.env` is still supported
(`scripts/get-refresh-token.mjs`) and is adopted into `accounts` on first use.

Connecting a **different** Spotify account later is safe: it creates a new
scope and never overwrites the first one's data, cursors or token. See
`docs/accounts.md`.

### Home Lab (OptiPlex)

The image is built and published to GHCR by
`.github/workflows/docker-build.yml` on every push to `main` — same scheme as
the Spotify Calendar (moving `main`/`latest` tags + immutable `sha-<short>`
for rollback, optional Watchtower redeployment).

```bash
make prod-pull && make prod-up     # or: make prod-deploy
make prod-logs
make prod-run-played               # manual run of the 'played' collector
```

Non-negotiable points, wired into `docker-compose.prod.yml`:

- **the SQLite database lives on the named volume `spotify-poller-data`** —
  never in the container's writable layer: the data is irreplaceable and must
  be included in the host's backups;
- **no secret in the image** — everything comes from `.env` via `env_file` at
  launch time;
- **container-internal scheduling** (`SCHEDULE_ENABLED=1`): `played` every
  30 min, `liked` daily. Decision and alternatives: `docs/scheduling.md`;
- Docker healthcheck on `/health`, complementing the external watchdog.

### Makefile targets

`make help` lists everything — same conventions as the Spotify Calendar
(`build/up/down/logs/shell`, `prod-*`), plus the poller operations:
`migrate`, `run-played`, `run-liked`, `backup`, `export`, `import` (and their `prod-`
variants).

## Debug UI

Served on `/` by the server (no dependencies, a single `public/index.html`
file). Minimal, designed to verify collection:

- health status: last `played`/`liked` success, connected account, ongoing
  rate limit;
- Spotify account connection (Authorization Code flow, spec §7 — stable token
  stored in the `accounts` table);
- browsing of **all** collected events: type filters / title-artist search /
  date bounds, sorting, pagination, expandable JSON payload;
- run log (`poller_runs`), declared gaps (`gaps`), stats;
- manual triggering of the `played` and `liked` collectors (idempotent — I2).

In the default mode the UI asks for the `ADMIN_TOKEN` (stored in the browser's
localStorage). Behind an authenticating reverse proxy, set `AUTH_MODE=proxy` and
the token field disappears — see **Authentication** below.

## Endpoints

| Route | Auth | Role |
|---|---|---|
| `GET /` | — | debug UI (contains no data) |
| `GET /health` | — | liveness only: `{status, auth_mode}` |
| `GET /status` | yes | last success, counters, accounts, rate limit, scheduler |
| `GET /auth/login` | yes | starts the OAuth connection flow |
| `GET /auth/callback` | state cookie | Spotify return, stores the refresh token |
| `POST /run?collector=played\|liked` | yes | manual trigger (idempotent) |
| `GET /stats` | yes | volumes, gaps, last 20 runs |
| `GET /api/events` | yes | pagination + `type`, `q`, `from`, `to`, `order` filters |
| `GET /api/runs`, `GET /api/gaps` | yes | paginated logs |
| `GET /api/accounts` | yes | connected accounts (never their tokens) |
| `POST /api/accounts/activate?id=` | yes | choose which account is collected |
| `GET /export` | yes | NDJSON export of the events — no secret inside |
| `POST /backup` | yes | writes a `.db` snapshot to `BACKUP_DIR` (not downloadable) |

Every read endpoint accepts `?account=<spotify-user-id>` and defaults to the
active account.

`GET /health` is deliberately almost empty. It used to return the collector
timestamps and the per-type event counters while being public — enough to leak
listening volume and activity windows to anyone who could reach the port. That
detail moved to `/status`, behind auth; the Docker healthcheck only ever needed
liveness.

### Authentication

`AUTH_MODE=token` (default) — `ADMIN_TOKEN` on every admin route, as a `Bearer`
header or `?token=` for browser navigations.

`AUTH_MODE=proxy` — your reverse proxy authenticates (Cloudflare Access,
Traefik basic auth…) and the UI stops asking for a token. Set
`PROXY_AUTH_HEADER` (e.g. `Cf-Access-Authenticated-User-Email`) so a request
that reaches the origin **directly**, bypassing the proxy, is still rejected;
without it every request that reaches the process is trusted, and the server
says so loudly at startup. A valid `ADMIN_TOKEN` keeps working either way, which
is handy for local `curl`.

## Notifications

Two channels, deliberately separate (`src/notify.ts`):

- **`WATCHDOG_URL`** — the dead man's switch, pinged after every successful A
  run. Alerts on silence. Works with healthchecks.io, or with an **Uptime Kuma
  "Push" monitor** for a fully self-hosted setup: same contract, and Kuma can
  then notify your own ntfy.
- **`NTFY_URL`** — actionable alerts: revoked token (*reconnect the account*,
  high priority, tapping the notification opens the UI), failed run, failed
  backup, detected gap. Each kind is throttled to one message per
  `NTFY_THROTTLE_HOURS` (default 6) — a revoked token would otherwise notify
  every 30 minutes — and an all-clear follows the recovery.

## Backup and export

`make backups-dir` once, then `BACKUP_ENABLED=1` for a daily snapshot.

- **`.db` snapshot** (`make prod-backup`, `POST /backup`): the whole database,
  taken through SQLite's online backup API — consistent in WAL mode, no service
  interruption. Lands on the `./backups` host bind mount, outside the data
  volume. **It contains the Spotify refresh token in clear**, so it is never
  downloadable over HTTP.
- **NDJSON export** (`make prod-export`, `GET /export`): the events only, no
  secret, restorable with `make prod-import FILE=…`.

Full rationale, restore procedures and off-site advice: `docs/backup.md`.

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
sudo systemctl enable --now spotify-poller-played.timer
sudo systemctl enable --now spotify-poller-liked.timer
sudo systemctl enable --now spotify-poller-api.service
```

Upgrading an install that predates the collector rename: the units were called
`spotify-poller-a.*` / `spotify-poller-b.*`. Disable them before enabling the
new ones, otherwise both fire and collection runs twice (harmless for the data
thanks to I2, just wasted API calls):

```bash
sudo systemctl disable --now spotify-poller-a.timer spotify-poller-b.timer
sudo rm /etc/systemd/system/spotify-poller-[ab].{service,timer}
sudo systemctl daemon-reload
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

## Acceptance tests

```bash
# Idempotence (I2): replay 'played' twice in a row
curl -X POST "http://127.0.0.1:8787/run?collector=played" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> inserted > 0, then replay: inserted: 0

# Heartbeat: stop the service, wait 2 h, confirm the alert fires
make down   # (or systemctl stop spotify-poller-played.timer)

# Reboot resilience: sudo reboot, then check
docker ps            # restart: unless-stopped must have brought the container back
make prod-logs       # first 'played' run ~15 s after startup

# No overwrite when switching account: note the counts, connect a SECOND
# Spotify account from the UI, then check the first one is intact
curl -s "http://127.0.0.1:8787/api/accounts" -H "Authorization: Bearer $ADMIN_TOKEN"
# -> both accounts listed, each with its own event count

# Backup / restore round-trip
make prod-backup
make prod-export > /tmp/events.ndjson
grep -c refresh /tmp/events.ndjson    # -> 0: the export carries no secret
make prod-import FILE=/tmp/events.ndjson
# -> "0 inserted, N already present": the import is idempotent
```

## Likes backfill

The UI's "Run liked" button (or `make run-liked`), to be re-run until
`note: "backfill complete"` — or just let the daily cadence finish (while the
backfill is in progress, the scheduler runs `liked` every hour in bounded
batches).

## The 5 empirical tests

`docs/findings.md` — unchanged, independent of the infrastructure. Test 2
(offline) remains the most important.

## Out of scope (unchanged, §14 of the spec)

Correlation, photos, GPX, audio analysis, GDPR export import, `raw_spotify`
purge.

---

**Infrastructure-independent reminder**: request the GDPR
"Extended streaming history" export at spotify.com/account/privacy (~30-day delay).
