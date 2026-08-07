-- Persistent collector state.
-- Keys: 'A.last_played_at', 'A.last_success_at',
--       'B.last_added_at',  'B.last_success_at',
--       'B.backfill_done',  'B.backfill_offset'
CREATE TABLE poller_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Run log: what makes invariant I1 verifiable.
-- Row written at start, completed in a finally.
CREATE TABLE poller_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  collector      TEXT    NOT NULL,   -- 'A' | 'B'
  trigger_kind   TEXT    NOT NULL,   -- 'cron' | 'manual'
  started_at     TEXT    NOT NULL,
  finished_at    TEXT,
  status         TEXT,               -- 'ok' | 'partial' | 'error'
  items_fetched  INTEGER DEFAULT 0,
  items_inserted INTEGER DEFAULT 0,
  error          TEXT
);

CREATE INDEX idx_runs_collector ON poller_runs(collector, started_at DESC);

-- Declared collection gaps: an honest gap beats a lying zero (§4.4).
CREATE TABLE gaps (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  collector   TEXT NOT NULL,
  from_utc    TEXT NOT NULL,
  to_utc      TEXT NOT NULL,
  detected_at TEXT NOT NULL,
  note        TEXT
);
