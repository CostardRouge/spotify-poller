# Decision: per-account partitioning

## The problem

Before migration `0005`, everything was implicitly single-account:

- `poller_state` had a primary key on `key` alone, so `auth.refresh_token`,
  `A.last_played_at` and `B.backfill_offset` were **global**;
- `storeRefreshToken()` overwrote that single key;
- `events.id` was `spotify:listen:<played_at>`, with no notion of owner.

Connecting a second Spotify account therefore **silently destroyed** the first
one's token and cursors, and dropped its events into the same table with no way
to tell them apart. The history is irreplaceable (the API only ever returns the
last 50 plays), so a silent overwrite is the worst possible failure mode.

## The decision

**One column, `account_id`, on every collected table**, and a composite primary
key. The discriminator is the **Spotify user id** returned by `GET /v1/me`:
stable, never reused, and available with the scopes we already request
(`id` and `display_name` need no extra scope, so no re-consent).

Deliberately **not** a string prefix on the existing keys: no delimiter to
parse, no collision, and the indexes stay usable.

`events.id` is **not** rewritten. The primary key becomes `(account_id, id)`,
which makes the `INSERT OR IGNORE` dedup (invariant I2) per-account without
touching a single existing identifier.

> **Consequence for downstream consumers** (a website reading this database):
> `events.id` alone is no longer globally unique. The key is the pair
> `(account_id, id)`.

## Still mono-user

This is *not* a multi-tenant poller. Exactly **one account is active** at a
time — the one the scheduler collects for, stored in the global state key
`accounts.active_id`. The others keep their data, their cursors and their
refresh token, and can be reactivated from the UI **without redoing the OAuth
flow**.

Two distinct notions, which the UI keeps separate:

| | what it means | where |
|---|---|---|
| **active account** | the one being *collected* | `accounts.active_id`, `POST /api/accounts/activate` |
| **viewed account** | the one you are *looking at* | `?account=` on every read endpoint |

Looking is not collecting: browsing a dormant account's events changes nothing.

## What stays global

The `''` account scope is reserved for app-wide state. The important one:

- **`ratelimit.limited_until`** — Spotify computes its rate limit per app
  (`client_id`), not per user. Scoping the cooldown per account would let an
  account switch keep querying during a ban, which only extends it.
- `accounts.active_id`, `notify.*` (alert throttling), `backup.*`.

## Adopting a pre-existing database

The migration cannot resolve the Spotify id — that needs a network call. So
existing rows get `account_id = ''` (unattributed), and `adoptLegacyRows()`
claims them the first time the id is known, in a **single transaction**:

1. `resolveActiveAccount()` finds no account but does find a legacy refresh
   token, either in `poller_state` (`auth.refresh_token`) or in
   `SPOTIFY_REFRESH_TOKEN`;
2. it calls `/v1/me`, creates the `accounts` row and makes it active;
3. every `''` row in `events`, `raw_spotify`, `poller_runs` and `gaps` is
   stamped with that id, and the collector cursors move into its scope;
4. the legacy `auth.*` keys are **deleted**, not moved — the refresh token must
   exist in exactly one place, or a later reader could pick up a stale copy.

It runs at most once, is logged (`[auth] adopted legacy data …`), and is a no-op
afterwards. Nothing is deleted and no counter changes: verify with

```sql
SELECT account_id, COUNT(*) FROM events GROUP BY account_id;
```

## Connecting another account

The "Connect Spotify" button forces `show_dialog=true`, so you can pick a
*different* Spotify account rather than silently reconnecting the current one.
On return, `exchangeCode()` resolves `/v1/me` **before** writing anything — a
profile lookup failure can never leave a token stored under an unknown identity
— then upserts the account and makes it active.

The previous account is untouched: same token, same cursors, same events.
