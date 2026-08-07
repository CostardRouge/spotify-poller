-- Per-account partitioning.
--
-- Before this migration everything was implicitly single-account: poller_state
-- had a primary key on `key` alone, so connecting a second Spotify account
-- silently overwrote the refresh token and the collector cursors, and its
-- events landed in the same table with no way to tell them apart.
--
-- The discriminator is the Spotify user id (GET /v1/me), resolved at connection
-- time: stable, never reused, and requiring no extra OAuth scope.
--
-- events.id is deliberately NOT rewritten. The primary key becomes
-- (account_id, id), which makes the INSERT OR IGNORE dedup (invariant I2)
-- per-account without touching a single existing identifier.
-- Consequence for downstream consumers: events.id alone is no longer globally
-- unique — the key is the pair.
--
-- Existing rows inherit account_id = '' (unattributed). They are claimed by
-- adoptLegacyRows() in src/db.ts the first time the real Spotify id is
-- resolved, which needs a network call and therefore cannot happen here.
-- '' also stays the permanent scope of app-wide state (the 429 cooldown is
-- computed per client_id, not per user).
--
-- SQLite cannot ALTER a primary key, hence the rename/copy/drop dance. Old
-- indexes follow their renamed table and disappear with it, so the new ones can
-- reuse the same names.

CREATE TABLE accounts (
  id            TEXT PRIMARY KEY,            -- Spotify user id
  display_name  TEXT,
  refresh_token TEXT NOT NULL,               -- SECRET: never leaves the server
  scope         TEXT,
  connected_at  TEXT NOT NULL,
  last_seen_at  TEXT,
  status        TEXT NOT NULL DEFAULT 'ok'   -- 'ok' | 'revoked'
);

-- ---------- events ----------
ALTER TABLE events RENAME TO events_old;

CREATE TABLE events (
  account_id   TEXT    NOT NULL DEFAULT '',
  id           TEXT    NOT NULL,   -- deterministic key, unique WITHIN an account
  ts_utc       TEXT    NOT NULL,
  ts_local     TEXT,
  tz           TEXT,
  type         TEXT    NOT NULL,
  source       TEXT    NOT NULL,
  duration_s   INTEGER,
  lat          REAL,
  lon          REAL,
  title        TEXT,
  subtitle     TEXT,
  payload      TEXT    NOT NULL,
  ingested_at  TEXT    NOT NULL,
  PRIMARY KEY (account_id, id)
);

INSERT INTO events (account_id, id, ts_utc, ts_local, tz, type, source, duration_s,
                    lat, lon, title, subtitle, payload, ingested_at)
SELECT '', id, ts_utc, ts_local, tz, type, source, duration_s,
       lat, lon, title, subtitle, payload, ingested_at
FROM events_old;

DROP TABLE events_old;

CREATE INDEX idx_events_ts      ON events(account_id, ts_utc);
CREATE INDEX idx_events_type_ts ON events(account_id, type, ts_utc);

-- ---------- raw_spotify ----------
ALTER TABLE raw_spotify RENAME TO raw_spotify_old;

CREATE TABLE raw_spotify (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id   TEXT    NOT NULL DEFAULT '',
  collector    TEXT    NOT NULL,
  fetched_at   TEXT    NOT NULL,
  http_status  INTEGER NOT NULL,
  request_url  TEXT    NOT NULL,
  payload      TEXT
);

INSERT INTO raw_spotify (id, account_id, collector, fetched_at, http_status, request_url, payload)
SELECT id, '', collector, fetched_at, http_status, request_url, payload FROM raw_spotify_old;

DROP TABLE raw_spotify_old;

CREATE INDEX idx_raw_fetched ON raw_spotify(account_id, collector, fetched_at);

-- ---------- poller_runs ----------
ALTER TABLE poller_runs RENAME TO poller_runs_old;

CREATE TABLE poller_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id     TEXT    NOT NULL DEFAULT '',
  collector      TEXT    NOT NULL,
  trigger_kind   TEXT    NOT NULL,
  started_at     TEXT    NOT NULL,
  finished_at    TEXT,
  status         TEXT,
  items_fetched  INTEGER DEFAULT 0,
  items_inserted INTEGER DEFAULT 0,
  error          TEXT
);

INSERT INTO poller_runs (id, account_id, collector, trigger_kind, started_at, finished_at,
                         status, items_fetched, items_inserted, error)
SELECT id, '', collector, trigger_kind, started_at, finished_at,
       status, items_fetched, items_inserted, error
FROM poller_runs_old;

DROP TABLE poller_runs_old;

CREATE INDEX idx_runs_collector ON poller_runs(account_id, collector, started_at DESC);

-- ---------- gaps ----------
ALTER TABLE gaps RENAME TO gaps_old;

CREATE TABLE gaps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  TEXT NOT NULL DEFAULT '',
  collector   TEXT NOT NULL,
  from_utc    TEXT NOT NULL,
  to_utc      TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  note        TEXT
);

INSERT INTO gaps (id, account_id, collector, from_utc, to_utc, detected_at, note)
SELECT id, '', collector, from_utc, to_utc, detected_at, note FROM gaps_old;

DROP TABLE gaps_old;

CREATE INDEX idx_gaps_account ON gaps(account_id, detected_at DESC);

-- ---------- poller_state ----------
-- Keys per account: 'played.last_played_at', 'played.last_success_at',
--                   'liked.last_added_at',    'liked.last_success_at',
--                   'liked.backfill_done',    'liked.backfill_offset'
-- (renamed from the A./B. prefixes by 0004_collector_names.sql, which MUST run
--  first — hence the numbering.)
-- Keys kept in the '' scope: 'ratelimit.limited_until', 'accounts.active_id',
--                            'notify.*', 'backup.*'
ALTER TABLE poller_state RENAME TO poller_state_old;

CREATE TABLE poller_state (
  account_id TEXT NOT NULL DEFAULT '',
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (account_id, key)
);

INSERT INTO poller_state (account_id, key, value, updated_at)
SELECT '', key, value, updated_at FROM poller_state_old;

DROP TABLE poller_state_old;
