-- Canonical events table. Photos and activities will be added to it
-- without a schema change (spec §4.2).
CREATE TABLE events (
  id           TEXT PRIMARY KEY,   -- deterministic key (dedup = INSERT OR IGNORE, invariant I2)
  ts_utc       TEXT NOT NULL,      -- ISO8601 with Z, always populated
  ts_local     TEXT,               -- NULL at first, filled in later via the photo oracle (§10)
  tz           TEXT,               -- IANA name, NULL if unknown
  type         TEXT NOT NULL,      -- 'listen' | 'like' | 'photo' | 'activity'
  source       TEXT NOT NULL,      -- 'spotify' | 'photos' | 'strava'
  duration_s   INTEGER,
  lat          REAL,
  lon          REAL,
  title        TEXT,               -- denormalized for the calendar display
  subtitle     TEXT,
  payload      TEXT NOT NULL,      -- source-specific JSON
  ingested_at  TEXT NOT NULL
);

CREATE INDEX idx_events_ts      ON events(ts_utc);
CREATE INDEX idx_events_type_ts ON events(type, ts_utc);
