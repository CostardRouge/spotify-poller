-- Age queries on the raw archive.
--
-- The 0005 index (account_id, collector, fetched_at) cannot serve a
-- cross-account "older than N days" predicate, so both the retention purge
-- (RAW_RETENTION_DAYS, lib/server/db.ts purgeRawRows) and the Database page's
-- oldest/newest probes would otherwise walk the payload-heavy table itself —
-- exactly the kind of synchronous full pass that stalls the event loop, fails
-- the container HEALTHCHECK, and reads as a 502/404 outage (see PR #8).
CREATE INDEX idx_raw_fetched_at ON raw_spotify(fetched_at);
