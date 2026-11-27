-- Content-addressed snapshots for the raw archive.
--
-- raw_spotify kept every response body verbatim in its own row (I3). The
-- `played` collector refetches the same 50-track buffer every 30 minutes, so
-- the same — or almost the same — 150-300 KB JSON was stored ~48 times a day,
-- uncompressed. On the maintainer's install that made raw_spotify nearly the
-- whole ~1 GB file (2026-11-27), for an archive whose only job is to let a
-- parsing bug be replayed.
--
-- From this migration on, a body is stored ONCE per account and per distinct
-- content, gzip-compressed, in raw_payloads, keyed by the SHA-256 of its exact
-- text. raw_spotify keeps one row per call — time, status, URL — and points at
-- the snapshot through payload_sha256. I3 still holds: every call has its row,
-- every distinct body is kept byte for byte (gunzip gives back the exact text).
--
-- How to read a raw_spotify row after this migration:
--   payload NOT NULL                    legacy row, body inline (not compacted yet)
--   payload NULL, payload_sha256 set    body in raw_payloads (account_id, sha256)
--   payload NULL, payload_sha256 NULL   no body at all (network error, status 0)
-- lib/server/raw-payload.ts readRawPayload() hides the difference.
--
-- Schema only, on purpose: this file runs at every container boot, and
-- rewriting ~1 GB of existing rows here would hold the start-up for minutes
-- (the healthcheck lesson, docs/memory/deployment.md). Existing rows are
-- converted by the separate, hand-run `npm run compact:raw`, in bounded batches.
--
-- Partitioned by account_id like every collected table (0005): two accounts
-- never share a snapshot row, even when Spotify sent both the same bytes, so
-- nothing about one account's archive is reachable through the other's.
CREATE TABLE raw_payloads (
  account_id    TEXT    NOT NULL DEFAULT '',
  sha256        TEXT    NOT NULL,             -- hex SHA-256 of the UTF-8 body text
  encoding      TEXT    NOT NULL,             -- 'gzip' (the only value written today)
  body          BLOB    NOT NULL,
  bytes         INTEGER NOT NULL,             -- uncompressed length, for the Database page
  first_seen_at TEXT    NOT NULL,
  PRIMARY KEY (account_id, sha256)
);

ALTER TABLE raw_spotify ADD COLUMN payload_sha256 TEXT;

-- Serves the orphan sweep after a retention purge (NOT EXISTS per snapshot)
-- and any "which calls returned this body" question.
CREATE INDEX idx_raw_payload_sha ON raw_spotify(account_id, payload_sha256);
