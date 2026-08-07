-- Collector ids: 'A'/'B' -> 'played'/'liked'.
-- A single explicit vocabulary end to end (URL, CLI, UI, database) replaces the
-- 'A'/'B' letters, which said nothing about what they collect.
--
-- This migration MUST run before the new code touches the database: without it
-- the state keys would look unset and the liked-tracks backfill would restart
-- from offset 0 (harmless for the data thanks to I2, but it would refetch
-- everything). Renames the state keys and relabels the existing history rows.
--
-- Supersedes the key list documented in 0003_state.sql. New keys:
--   'played.last_played_at', 'played.last_success_at',
--   'liked.last_added_at',   'liked.last_success_at',
--   'liked.backfill_done',   'liked.backfill_offset'

UPDATE poller_state SET key = 'played' || substr(key, 2) WHERE key LIKE 'A.%';
UPDATE poller_state SET key = 'liked'  || substr(key, 2) WHERE key LIKE 'B.%';

-- History: relabelled so old and new runs read the same in the debug UI.
UPDATE poller_runs SET collector = 'played' WHERE collector = 'A';
UPDATE poller_runs SET collector = 'liked'  WHERE collector = 'B';

UPDATE gaps SET collector = 'played' WHERE collector = 'A';
UPDATE gaps SET collector = 'liked'  WHERE collector = 'B';

-- Raw layer (I3): only the label column changes — payload, URL and HTTP status,
-- i.e. the actual evidence, are left untouched.
UPDATE raw_spotify SET collector = 'played' WHERE collector = 'recently_played';
UPDATE raw_spotify SET collector = 'liked'  WHERE collector = 'liked_tracks';
