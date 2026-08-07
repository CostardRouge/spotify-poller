-- Playback collector (opt-in, PLAYBACK_ENABLED=1) — GET /v1/me/player.
--
-- Complements 'played', never replaces it: this only sees what happens while
-- the process is running, whereas recently-played back-fills across downtime.
-- Nothing here is written when PLAYBACK_ENABLED is 0.
--
-- Partitioned by account_id like every table since 0005_accounts.sql: the
-- poller collects for one active account at a time, and switching accounts must
-- not mix two people's listening. As in `events`, the identifier is unique
-- WITHIN an account, so the primary key is the pair — including the
-- "at most one session is open" invariant, which is per account.

-- Transition log, NOT a dense time series. The ticker polls every ~15 s but
-- only writes a row when the observable state actually CHANGES (track, play
-- /pause, device, volume, shuffle, repeat, context) or when a seek is detected.
-- ~100-200 rows/day instead of ~5760 — the feature is a bonus, it must be cheap.
CREATE TABLE playback_samples (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id         TEXT    NOT NULL DEFAULT '',
  observed_at        TEXT    NOT NULL,  -- ISO8601 UTC, OUR clock
  spotify_ts         INTEGER,           -- response `timestamp`, Spotify's clock
  item_id            TEXT,              -- track/episode id — NULL when idle
  item_type          TEXT,              -- currently_playing_type: track|episode|ad|unknown
  progress_ms        INTEGER,
  duration_ms        INTEGER,
  is_playing         INTEGER NOT NULL DEFAULT 0,
  device_id          TEXT,
  device_name        TEXT,
  device_type        TEXT,              -- computer|smartphone|speaker|tv|...
  volume_percent     INTEGER,
  is_private_session INTEGER,
  shuffle_state      INTEGER,
  repeat_state       TEXT,              -- off|track|context
  context_uri        TEXT               -- playlist/album/artist the track came from
);

CREATE INDEX idx_playback_samples_observed ON playback_samples(account_id, observed_at);
CREATE INDEX idx_playback_samples_item ON playback_samples(account_id, item_id, observed_at);

-- One row per listen. This is the value the feature exists for: which device,
-- what volume, and whether the track was actually finished or skipped.
--
-- Deliberately NOT in `events`: the 'played' collector writes its listen rows
-- up to 30 min later keyed on played_at, and it is still an open question
-- (docs/findings.md) whether played_at is the START or the END of playback.
-- We never mutate an events row; event_id is a best-effort link, filled in
-- opportunistically, and NULL is a perfectly fine outcome.
CREATE TABLE playback_sessions (
  account_id         TEXT    NOT NULL DEFAULT '',
  id                 TEXT    NOT NULL,     -- spotify:play:<item_id>:<started_at>
  item_id            TEXT    NOT NULL,
  item_type          TEXT    NOT NULL,
  title              TEXT,
  subtitle           TEXT,                 -- artists / show, joined
  started_at         TEXT    NOT NULL,
  ended_at           TEXT,
  duration_ms        INTEGER,              -- full length of the track/episode
  first_progress_ms  INTEGER,              -- where we first saw it (mid-track if we joined late)
  max_progress_ms    INTEGER,              -- furthest point reached; seeking makes progress
                                           -- non-monotonic, so completion uses THIS, not the last value
  last_progress_ms   INTEGER,
  listened_ms        INTEGER DEFAULT 0,    -- sum of forward progress that matched wall-clock time
  completion_ratio   REAL,                 -- max_progress_ms / duration_ms, capped at 1
  skipped            INTEGER,              -- 1 only when a track_change cut it short (not when idle)
  close_reason       TEXT,                 -- track_change|replay|idle|stale
  sample_count       INTEGER NOT NULL DEFAULT 0,  -- ticks observed, not rows written
  pause_count        INTEGER DEFAULT 0,
  paused_ms          INTEGER DEFAULT 0,
  device_id          TEXT,
  device_name        TEXT,
  device_type        TEXT,
  volume_min         INTEGER,
  volume_max         INTEGER,
  volume_last        INTEGER,
  shuffle_state      INTEGER,
  repeat_state       TEXT,
  context_uri        TEXT,
  is_private_session INTEGER,
  last_is_playing    INTEGER NOT NULL DEFAULT 1,   -- previous tick, for pause accounting
  event_id           TEXT,                 -- best-effort link to events.id, nullable
  closed             INTEGER NOT NULL DEFAULT 0,   -- at most one row per account with closed = 0
  updated_at         TEXT    NOT NULL,
  PRIMARY KEY (account_id, id)
);

CREATE INDEX idx_playback_sessions_started ON playback_sessions(account_id, started_at DESC);
CREATE INDEX idx_playback_sessions_open ON playback_sessions(account_id, closed);
CREATE INDEX idx_playback_sessions_link ON playback_sessions(account_id, event_id, item_id);
