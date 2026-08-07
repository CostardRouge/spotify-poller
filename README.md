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
  rate limit, and — when the playback collector is on — what is playing right
  now;
- Spotify account connection (Authorization Code flow, spec §7 — stable token
  stored in the `accounts` table), plus **Reconnect** and, per account,
  **disconnect**;
- a **scope banner**: the scopes an account granted are compared with what the
  current configuration requires, so a missing permission is stated up front
  instead of surfacing as an opaque `403` inside a collector;
- browsing of **all** collected events: type filters / title-artist search /
  date bounds, sorting, pagination, expandable JSON payload;
- run log (`poller_runs`), declared gaps (`gaps`), stats, playback sessions;
- manual triggering of the `played` and `liked` collectors (idempotent — I2).

In the default mode the UI asks for the `ADMIN_TOKEN` (stored in the browser's
localStorage). Behind an authenticating reverse proxy, set `AUTH_MODE=proxy` and
the token field disappears — see **Authentication** below.

Every timestamp is stored and queried in UTC (`ts_utc`) — the `TIMEZONE` env
var (IANA name, e.g. `Europe/Paris`, defaults to `UTC`) only controls how the
debug UI *displays* them; it changes nothing in the database.

## Endpoints

| Route | Auth | Role |
|---|---|---|
| `GET /` | — | debug UI (contains no data) |
| `GET /health` | — | liveness only: `{status, auth_mode}` |
| `GET /status` | yes | last success, counters, accounts, rate limit, scheduler, display timezone |
| `GET /auth/login` | yes | starts the OAuth connection flow |
| `GET /auth/callback` | state cookie | Spotify return, stores the refresh token |
| `POST /run?collector=played\|liked\|playback` | yes | manual trigger (idempotent) |
| `GET /stats` | yes | volumes, gaps, last 20 runs |
| `GET /api/events` | yes | pagination + `type`, `q`, `from`, `to`, `order` filters |
| `GET /api/playback` | yes | playback sessions, pagination + `from`, `to` |
| `GET /api/runs`, `GET /api/gaps` | yes | paginated logs |
| `GET /api/accounts` | yes | connected accounts (never their tokens) |
| `POST /api/accounts/activate?id=` | yes | choose which account is collected |
| `POST /api/accounts/disconnect?id=` | yes | forget an account's token — its data is kept |
| `GET /export` | yes | NDJSON export of the events — no secret inside |
| `POST /backup` | yes | writes a `.db` snapshot to `BACKUP_DIR` (not downloadable) |

Every read endpoint accepts `?account=<spotify-user-id>` and defaults to the
active account.

### Reconnecting and disconnecting

**Reconnect** is just `/auth/login` again: the authorize URL carries
`show_dialog=true`, so Spotify re-shows the consent screen and signing back in
as the same account overwrites its grant. That matters because Spotify
otherwise keeps honouring the existing grant silently — a scope added later
would never be requested, and the newly scoped endpoint would simply start
answering `403`.

The UI compares the scopes an account actually granted (`accounts.scope`)
against what the current configuration requires, and raises a banner naming the
missing one. `unknown` means the grant was never recorded — an account adopted
from a legacy token — in which case reconnecting is the only way to be sure.

**Disconnect** (`POST /api/accounts/disconnect?id=`) drops the account row and
its token. Everything it collected is **kept**, and so are its cursors, so
reconnecting the same Spotify id resumes instead of replaying the whole liked
backfill. Two caveats it reports rather than hides:

- if `SPOTIFY_REFRESH_TOKEN` is set, the next run re-bootstraps an account from
  it — the response says so (`env_fallback_active`);
- Spotify has no revocation endpoint. Withdrawing access for good is done by
  the user at [spotify.com/account/apps](https://www.spotify.com/account/apps/).

## Playback collector (opt-in)

Off by default. `PLAYBACK_ENABLED=1` turns on a third collector that polls
`GET /me/player` — adaptively, every 15 s while something plays and every 60 s
once idle.

It **complements** `played`, it does not replace it. `played` remains the
authoritative history: it reads Spotify's 50-track buffer and therefore
back-fills across downtime, whereas the playback ticker only sees what happens
while the process is running. What it adds is everything `recently-played`
cannot tell you: **which device**, **what volume**, which playlist the track
came from, shuffle/repeat state, private-session flag, and whether the track
was **finished or skipped**.

Two things to know about the data:

- *"Played in full"* is not a field Spotify exposes — it is inferred by
  sampling `progress_ms`, so it is an estimate accurate to about one polling
  interval. Seeking makes progress non-monotonic, so completion is computed
  from the **furthest point reached**, never the last value read. A return to
  ~0 counts as a replay only when the previous maximum had reached the end, so
  a rewind does not fabricate a second listen.
- Results land in `playback_sessions` (one row per listen) and
  `playback_samples` (a transition log), both partitioned by `account_id` like
  every other table. They are **not** written into `events`: `played` writes
  its listen rows up to 30 min later keyed on `played_at`, and whether
  `played_at` marks the start or the end of a track is still an open question
  (`docs/findings.md`). A session carries a best-effort `event_id` link
  instead, filled in after a `played` run — `NULL` is a normal outcome, and no
  `events` row is ever mutated.

Two deliberate departures from the usual conventions, both so a bonus feature
stays cheap:

- a `raw_spotify` row and a `playback_samples` row are written only when the
  observable state **changes** (track, play/pause, device, volume, shuffle,
  repeat, context) or on a seek — roughly 100-200 rows a day instead of ~5760.
  Invariant I3's intent, evidence recorded before interpretation, is kept for
  every transition, which is what the derived data is built from. Errors and
  `429`s are always logged in full;
- the ticker writes one `poller_runs` **summary per hour** rather than a row
  per tick, plus a row for every fatal error. It therefore re-implements what
  `run-core` gave it: resolving the active account, the persisted `429` check,
  and always closing a window with a logged row.

It requires `SCHEDULE_ENABLED=1`: sub-minute polling cannot be driven by a
systemd timer, so bare-metal installs do not get playback (the server logs this
at startup rather than failing silently). It also requires the
`user-read-playback-state` scope — after enabling it, the UI raises the scope
banner until you reconnect.

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
