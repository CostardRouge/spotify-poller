# Backup and export

The collected history is **irreplaceable**: the Spotify API only ever returns
the last 50 plays, so anything not collected in time is gone, and anything lost
from the database is gone with it. The GDPR "Extended streaming history" export
(spotify.com/account/privacy, ~30-day delay) is the only external safety net,
and it does not cover the days since your last request.

## Two artefacts, one of which is a secret

| | `.db` snapshot | NDJSON export |
|---|---|---|
| Contents | the whole database: `events`, `raw_spotify`, `poller_runs`, `gaps`, `accounts` | `events` only |
| **Holds the Spotify refresh token** | **yes**, in clear | **no** |
| Produced by | `make backup` / `make prod-backup`, `POST /backup` | `make export`, `GET /export` |
| Downloadable over HTTP | **no, by design** | yes |
| Restores | everything | events only |

**The `.db` file is as sensitive as `.env`.** Anyone holding it can refresh your
Spotify token and read your listening history and library. It is deliberately
*not* exposed over HTTP: `POST /backup` writes it to `BACKUP_DIR` on the host
and returns the path, never the bytes. `backups/` and `*.ndjson` are in
`.gitignore`.

## How the snapshot is taken

Through SQLite's online backup API (`db.backup()`), not `cp`: consistent in WAL
mode, no service interruption, no torn file. A plain copy of a WAL database
while the poller is writing can produce an unusable file.

The destination is a **host bind mount** (`./backups` → `/backups`), outside the
`spotify-poller-data` volume. A snapshot stored inside the volume it protects is
not a backup — it dies with the volume.

## Setup

Once, on the host — the container runs as uid 1001 and cannot write into a
root-owned directory:

```bash
make backups-dir      # mkdir + chown 1001:1001 + chmod 700
```

Then in `.env`:

```bash
BACKUP_ENABLED=1      # daily snapshot from the internal scheduler
BACKUP_KEEP=14        # rotation
BACKUP_EVERY_HOURS=24
```

The cadence is persisted (`backup.last_success_at`), so a container that
restarts often does not back up on every boot. A failed backup raises a **high
priority ntfy alert**: a backup that silently stops working is only discovered
the day you need it.

Rotation happens **after** a successful write, never before — a failed backup
must not be the reason a valid older one is deleted.

## Off-site

The bind mount protects against losing the Docker volume, not against losing the
OptiPlex. Add a host-level job (restic, rclone, borg) pushing `./backups`
somewhere else. Since those files carry the refresh token, encrypt them in
transit and at rest — restic and borg do this by default.

## Restoring

**Everything** (preferred — brings back the raw layer and the run log):

```bash
make prod-down
docker run --rm -v spotify-poller_spotify-poller-data:/data -v "$PWD/backups:/b" \
  alpine sh -c "cp /b/life-events-2026-08-07-0300.db /data/life-events.db && rm -f /data/life-events.db-wal /data/life-events.db-shm"
make prod-up
```

Removing the stale `-wal`/`-shm` files matters: leaving them next to a restored
database can corrupt it.

**Events only**, from NDJSON:

```bash
make prod-import FILE=events.ndjson
```

Idempotent (`INSERT OR IGNORE`): re-importing the same file inserts nothing, and
importing into a partially-filled database only tops it up. Each row returns to
the account it was exported from; `--account <id>` grafts it onto another one.

This restores `events` **only** — `raw_spotify`, `poller_runs` and `gaps` live in
the `.db` snapshot.

## Verifying a backup

A backup you have never restored is a hypothesis. Occasionally:

```bash
sqlite3 backups/life-events-2026-08-07-0300.db \
  "PRAGMA integrity_check; SELECT account_id, COUNT(*), MIN(ts_utc), MAX(ts_utc) FROM events GROUP BY account_id;"
```

and compare against `/stats`.
