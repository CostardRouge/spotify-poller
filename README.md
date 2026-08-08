# Spotify Poller — continuous listening-history collection

**[Showcase / screenshots →](https://costardrouge.github.io/spotify-poller/)**

Continuously and unattended, collects the listening history (and likes) of a
personal Spotify account into a local SQLite database. See the spec for the
why; the gist: the Spotify API only exposes the **last 50 tracks**, so any
period not collected in time is lost forever.

A Next.js dashboard sits on top — the custody report: is collection still
alive, and did I lose anything, answerable in under two seconds, from a
phone (`PRODUCT.md`).

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
  silence is a different job. See `lib/server/notify.ts`.

## Stack

- **Next.js 16** (App Router), API routes under `app/api/*`, route-group
  layouts (`app/(dashboard)/layout.tsx` is the sidebar app shell).
- **Tailwind CSS 4**, on top of a small set of CSS custom properties (paper
  background, one accent, status colour always paired with a word —
  `app/globals.css`, `PRODUCT.md`).
- **JWT sessions** (`jose`, HS256): `/login` checks `ADMIN_TOKEN` once, mints a
  signed `sp_session` cookie; `proxy.ts` gates every page and admin route on it
  (or on the reverse-proxy header, in `AUTH_MODE=proxy`).
- **better-sqlite3**, unchanged from before the migration — the poller's
  business logic (collectors, scheduler, rate-limit handling, backup/export)
  lives in `lib/server/`, organised as nested modules (`lib/server/spotify/`,
  `lib/server/collectors/`) rather than one flat directory.
- Operational CLI scripts (`scripts/migrate.ts`, `run-once.ts`, `backup.ts`,
  `export.ts`, `import.ts`) run directly against the TypeScript source via
  `tsx` — no separate build step, same commands work in Docker, bare metal and
  CI.

## The two collectors

Named after what they collect — the same id is used in the URL, the CLI, the
Makefile, the UI buttons and every database row:

| id | Source | Cadence | Role |
|---|---|---|---|
| `played` | `GET /v1/me/player/recently-played` | every 30 min | the critical one: Spotify only keeps the **last 50** tracks, and this is the only collector that pings the watchdog |
| `liked` | `GET /v1/me/tracks` | daily (hourly while the backfill is running) | liked tracks, plus the paginated initial backfill |

```bash
curl -X POST "http://127.0.0.1:3000/api/run?collector=played" -b "sp_session=<cookie>"
make run-played        # same thing through the dev container
```

These ids replace the former `A` (= `played`) and `B` (= `liked`). The old
letters are still accepted by `/api/run` and `run-once.ts` so an
already-installed systemd unit keeps working, but everything now displays and
documents the explicit names. Existing databases are converted by
`migrations/0004_collector_names.sql` — run `make migrate` (or `make
prod-migrate`) **before** starting the new version, otherwise the likes
backfill restarts from zero.

## Recommended deployment: Docker (Spotify Calendar conventions)

```bash
make init          # creates .env from .env.example + builds the dev image
# edit .env: SPOTIFY_CLIENT_ID/SECRET, SPOTIFY_REDIRECT_URI, ADMIN_TOKEN, JWT_SECRET, WATCHDOG_URL
make up            # starts the dev stack (http://127.0.0.1:3000)
make logs
```

Then open http://127.0.0.1:3000, sign in with the `ADMIN_TOKEN` (`/login`) and,
from **Accounts**, click **"Connect Spotify"**: the refresh token is stored in
the database (`accounts` table, on the data volume), so the throwaway script is
no longer needed. The `SPOTIFY_REFRESH_TOKEN` fallback in `.env` is still
supported (`scripts/get-refresh-token.mjs`) and is adopted into `accounts` on
first use.

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
  30 min, `liked` daily, started from `instrumentation.ts` when the Next.js
  server boots. Decision and alternatives: `docs/scheduling.md`;
- Docker healthcheck on `/api/health`, complementing the external watchdog.

### Makefile targets

`make help` lists everything — same conventions as the Spotify Calendar
(`init/build/up/start/stop/down/restart/reset/logs/shell`, `prod-*`), plus the
poller operations: `migrate`, `run-played`, `run-liked`, `backup`, `export`,
`import` (and their `prod-` variants).

## Dashboard

Served by the Next.js app, behind the JWT session gate (`proxy.ts`). Minimal,
paper-styled, designed to verify collection (`PRODUCT.md` — instrument,
honest, quiet):

- **Dashboard** (`/`) — freshness of `played`/`liked` (and `playback` when
  enabled), the scope banner (missing OAuth scopes), the rate-limit banner,
  manual collector triggers, maintenance actions (backup, export), the five
  most recent runs, event counts by type;
- **Accounts** (`/accounts`) — Spotify account connection (Authorization Code
  flow, spec §7 — stable token stored in the `accounts` table), **Connect**,
  and per-account **Activate**/**Disconnect**;
- **Events** (`/events`) — browsing of all collected events: type filter,
  title/artist search, date bounds, sort order, pagination, filtered NDJSON
  export, and a per-row payload inspector (native dialog);
- **Runs** (`/runs`) — the collector run log (`poller_runs`), status and
  errors;
- **Gaps** (`/gaps`) — declared holes in the history (`gaps`);
- **Stats** (`/stats`) — volumes (events, raw evidence, gaps) and the last
  20 runs;
- **Playback** (`/playback`) — playback sessions; always in the navigation,
  and the page itself explains how to enable the collector when it is off.

Around the pages, the app shell carries the rest of the operator surface:

- a **sidebar** with the account view-scope selector (looking is not
  collecting — a hint appears whenever the viewed account differs from the
  collected one), a health chip (freshness of `played`, dot always paired with
  a word), and a **now-playing widget** (title, progress bar, device, volume)
  while the playback collector observes a listen;
- a **settings dialog** (theme override, backup action, keyboard shortcut
  list, server configuration read-out, sign out);
- a **command palette** on <kbd>⌘K</kbd> — sections and actions, searchable;
  plus global shortcuts: <kbd>1</kbd>…<kbd>7</kbd> jump to a section,
  <kbd>/</kbd> focuses the events search, <kbd>T</kbd> cycles the theme,
  <kbd>R</kbd> refreshes, <kbd>?</kbd> shows the shortcut list, and
  <kbd>Esc</kbd> closes any overlay;
- on phones the sidebar folds into a **bottom tab bar** with a More sheet
  (remaining sections, run actions, settings, account selector) — every
  operator action stays reachable on a 360 px screen (PRODUCT.md).

`AUTH_MODE=token` (default): sign in once at `/login` with `ADMIN_TOKEN`; a
signed JWT cookie (`JWT_SECRET`) carries the session for 30 days. Behind an
authenticating reverse proxy, set `AUTH_MODE=proxy` and the sign-in screen is
skipped — see **Authentication** below.

Every timestamp is stored and queried in UTC (`ts_utc`) — the `TIMEZONE` env
var (IANA name, e.g. `Europe/Paris`, defaults to `UTC`) only controls how the
dashboard *displays* them; it changes nothing in the database.

## Endpoints

| Route | Auth | Role |
|---|---|---|
| `GET /api/health` | — | liveness only: `{status, auth_mode}` |
| `GET /api/status` | session | last success, counters, accounts, rate limit, scheduler, display timezone |
| `GET /api/spotify/login` | session | starts the Spotify OAuth connection flow |
| `GET /api/spotify/callback` | state cookie | Spotify return, stores the refresh token |
| `GET /auth/login`, `GET /auth/callback` | same | pre-Next.js aliases of the two above — an already-registered Redirect URI keeps working |
| `POST /api/run?collector=played\|liked\|playback` | session | manual trigger (idempotent) |
| `GET /api/stats` | session | volumes, gaps, last 20 runs |
| `GET /api/events` | session | pagination + `type`, `q`, `from`, `to`, `order` filters |
| `GET /api/playback` | session | playback sessions, pagination + `from`, `to` |
| `GET /api/runs`, `GET /api/gaps` | session | paginated logs |
| `GET /api/accounts` | session | connected accounts (never their tokens) |
| `POST /api/accounts/activate?id=` | session | choose which account is collected |
| `POST /api/accounts/disconnect?id=` | session | forget an account's token — its data is kept |
| `GET /api/export` | session | NDJSON export of the events — no secret inside |
| `POST /api/backup` | session | writes a `.db` snapshot to `BACKUP_DIR` (not downloadable) |
| `POST /api/auth/login` | — | checks `ADMIN_TOKEN`, mints the JWT session cookie |
| `POST /api/auth/logout` | — | clears the session cookie |

Every read endpoint accepts `?account=<spotify-user-id>` and defaults to the
active account.

### Reconnecting and disconnecting

**Reconnect** is just `/api/spotify/login` again (the **Connect Spotify**
button on `/accounts`): the authorize URL carries `show_dialog=true`, so
Spotify re-shows the consent screen and signing back in as the same account
overwrites its grant. That matters because Spotify otherwise keeps honouring
the existing grant silently — a scope added later would never be requested,
and the newly scoped endpoint would simply start answering `403`.

The dashboard compares the scopes an account actually granted
(`accounts.scope`) against what the current configuration requires, and raises
a banner naming the missing one. `unknown` means the grant was never recorded
— an account adopted from a legacy token — in which case reconnecting is the
only way to be sure.

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

It requires `SCHEDULE_ENABLED=1`: sub-minute polling cannot be driven by a
systemd timer, so bare-metal installs do not get playback (the server logs this
at startup rather than failing silently). It also requires the
`user-read-playback-state` scope — after enabling it, the dashboard raises the
scope banner until you reconnect.

`GET /api/health` is deliberately almost empty. It used to return the collector
timestamps and the per-type event counters while being public — enough to leak
listening volume and activity windows to anyone who could reach the port. That
detail lives on `/api/status`, behind the session gate; the Docker healthcheck
only ever needed liveness.

### Authentication

`AUTH_MODE=token` (default) — sign in once at `/login` with `ADMIN_TOKEN`; a
JWT session cookie (`JWT_SECRET`, HS256, 30-day expiry) then gates every page
and admin route (`proxy.ts`). Deliberately two separate secrets: `ADMIN_TOKEN`
is the login password, `JWT_SECRET` signs the session it unlocks — a leaked
cookie must not also leak (or let you derive) the password.

`AUTH_MODE=proxy` — your reverse proxy authenticates (Cloudflare Access,
Traefik basic auth…) and the sign-in screen is skipped entirely. Set
`PROXY_AUTH_HEADER` (e.g. `Cf-Access-Authenticated-User-Email`) so a request
that reaches the origin **directly**, bypassing the proxy, is still rejected;
without it every request that reaches the process is trusted, and the server
says so loudly at startup.

## Notifications

Two channels, deliberately separate (`lib/server/notify.ts`):

- **`WATCHDOG_URL`** — the dead man's switch, pinged after every successful
  `played` run. Alerts on silence. Works with healthchecks.io, or with an
  **Uptime Kuma "Push" monitor** for a fully self-hosted setup: same contract,
  and Kuma can then notify your own ntfy.
- **`NTFY_URL`** — actionable alerts: revoked token (*reconnect the account*,
  high priority, tapping the notification opens the dashboard), failed run,
  failed backup, detected gap. Each kind is throttled to one message per
  `NTFY_THROTTLE_HOURS` (default 6) — a revoked token would otherwise notify
  every 30 minutes — and an all-clear follows the recovery.

## Backup and export

`make backups-dir` once, then `BACKUP_ENABLED=1` for a daily snapshot.

- **`.db` snapshot** (`make prod-backup`, `POST /api/backup`): the whole
  database, taken through SQLite's online backup API — consistent in WAL mode,
  no service interruption. Lands on the `./backups` host bind mount, outside
  the data volume. **It contains the Spotify refresh token in clear**, so it is
  never downloadable over HTTP.
- **NDJSON export** (`make prod-export`, `GET /api/export`): the events only,
  no secret, restorable with `make prod-import FILE=…`.

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
node --version   # Node 20.9+ (Next.js 16 minimum)
sudo apt install -y build-essential python3   # better-sqlite3 compiles at install time
```

### Installation

```bash
sudo mkdir -p /opt/spotify-poller/data
sudo useradd --system --home /opt/spotify-poller --shell /usr/sbin/nologin poller
sudo chown -R poller:poller /opt/spotify-poller

cd /opt/spotify-poller
npm install
npm run build     # next build — required before the systemd services start

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
`scripts/run-once.ts`, never two schedulers in parallel (`docs/scheduling.md`).

`Persistent=true` on the timers guarantees that a run missed during a restart
is caught up as soon as the machine comes back.

### Self-host security

- dedicated system service (`poller`), unprivileged, no shell;
- `ProtectSystem=strict` + `ReadWritePaths` restricted to `data/`;
- `.env` at `600`, never committed.

</details>

## Acceptance tests

```bash
# Idempotence (I2): replay 'played' twice in a row (through the dashboard's
# session cookie, or curl -b/-c against /api/auth/login)
curl -c cookies.txt -X POST "http://127.0.0.1:3000/api/auth/login" \
  -H "Content-Type: application/json" -d "{\"token\":\"$ADMIN_TOKEN\"}"
curl -b cookies.txt -X POST "http://127.0.0.1:3000/api/run?collector=played"
# -> inserted > 0, then replay: inserted: 0

# Heartbeat: stop the service, wait 2 h, confirm the alert fires
make down   # (or systemctl stop spotify-poller-played.timer)

# Reboot resilience: sudo reboot, then check
docker ps            # restart: unless-stopped must have brought the container back
make prod-logs       # first 'played' run ~15 s after startup

# No overwrite when switching account: note the counts, connect a SECOND
# Spotify account from /accounts, then check the first one is intact
curl -s -b cookies.txt "http://127.0.0.1:3000/api/accounts"
# -> both accounts listed, each with its own event count

# Backup / restore round-trip
make prod-backup
make prod-export > /tmp/events.ndjson
grep -c refresh /tmp/events.ndjson    # -> 0: the export carries no secret
make prod-import FILE=/tmp/events.ndjson
# -> "0 inserted, N already present": the import is idempotent
```

## Likes backfill

The dashboard's "Run liked" button (`/`, or `make run-liked`), to be re-run
until `note: "backfill complete"` — or just let the daily cadence finish (while
the backfill is in progress, the scheduler runs `liked` every hour in bounded
batches).

## The 5 empirical tests

`docs/findings.md` — unchanged, independent of the infrastructure. Test 2
(offline) remains the most important.

## Showcase (GitHub Pages)

`.github/workflows/pages.yml` builds the app, seeds fixture data
(`scripts/seed-demo.ts` — no real Spotify account involved), captures real
screenshots with Playwright (`scripts/showcase-screenshots.mjs`) and deploys
`showcase/index.html` to GitHub Pages on every push to `main`. One-time repo
setup: **Settings → Pages → Source: "GitHub Actions"**.

## Out of scope (unchanged, §14 of the spec)

Correlation, photos, GPX, audio analysis, GDPR export import, `raw_spotify`
purge.

---

**Infrastructure-independent reminder**: request the GDPR
"Extended streaming history" export at spotify.com/account/privacy (~30-day delay).
