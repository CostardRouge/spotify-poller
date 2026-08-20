-- Artist reference cache — what makes a "genre" question answerable at all.
--
-- `events` stores the artist NAMES (denormalised in `subtitle`) and the artist
-- IDS (payload.artist_ids), but nothing about the artists themselves. Spotify
-- attaches genres to the ARTIST object, never to a track or a play, so the
-- listening history alone can never say what kind of music was playing. This
-- table is where GET /v1/artists lands so that it can.
--
-- Deliberately NOT partitioned by account_id, unlike every collected table
-- (migration 0005). The rule there protects COLLECTED HISTORY: two people's
-- plays must never mix. This is not history — it is public reference data about
-- a Spotify object, identical for every account, and the id is globally unique.
-- Partitioning it would mean refetching the same artist once per connected
-- account for no gain. Nothing here is derived from, or reveals, a particular
-- account's listening.
--
-- Consequence: disconnecting an account does not (and must not) delete from
-- this table — its rows belong to no one.
CREATE TABLE artists (
  id          TEXT PRIMARY KEY,             -- Spotify artist id
  name        TEXT,                         -- NULL when Spotify returned no object for the id
  -- JSON array of genre strings, exactly as Spotify sends them, lowercase and
  -- free-form ("indie soul", "chamber pop"). An EMPTY array is a real answer:
  -- Spotify knows plenty of artists it has no genre for, and that must be
  -- distinguishable from "not fetched yet" — which is the absence of the row.
  genres      TEXT NOT NULL DEFAULT '[]',
  popularity  INTEGER,                      -- 0-100, Spotify's own, snapshot at fetch time
  followers   INTEGER,
  fetched_at  TEXT NOT NULL
);

-- The enrichment collector walks the oldest rows first when it refreshes, and
-- the Database page reports the age of the cache.
CREATE INDEX idx_artists_fetched_at ON artists(fetched_at);
