-- Raw layer: the JSON exactly as received, written BEFORE any parsing (invariant I3).
CREATE TABLE raw_spotify (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  collector    TEXT    NOT NULL,   -- 'recently_played' | 'liked_tracks'
  fetched_at   TEXT    NOT NULL,   -- ISO8601 UTC, time of the call
  http_status  INTEGER NOT NULL,   -- 0 on network error (no response)
  request_url  TEXT    NOT NULL,
  payload      TEXT                -- full body, NULL on network error
);

CREATE INDEX idx_raw_fetched ON raw_spotify(collector, fetched_at);
