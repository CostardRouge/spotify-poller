# Authentication, sessions, Spotify OAuth

Read before touching the login flow, the JWT session, `proxy.ts`, the OAuth connect/reconnect path, or scopes.

## Two secrets, deliberately not one (2026-08-20)

**Decision**: `ADMIN_TOKEN` is the login password checked once at `/login`; `JWT_SECRET` (HS256, `jose`) signs the `sp_session` cookie it unlocks, 30-day expiry. **Why**: a leaked session cookie must not also leak — or let you derive — the password. **How to apply**: do not collapse them into one value "for simplicity"; that is the point of the split.

## `AUTH_MODE=proxy` fails loudly, not silently (2026-08-20)

In proxy mode the reverse proxy authenticates (Cloudflare Access, Traefik…) and the sign-in screen is skipped. `PROXY_AUTH_HEADER` must be set so a request reaching the origin **directly**, bypassing the proxy, is still rejected — `isAuthorized` returns `true` unconditionally when it is absent (`lib/auth/session.ts`). Because that is a wide-open configuration, `instrumentation.ts` prints a boxed warning at startup rather than starting quietly. **How to apply**: keep that warning; a misconfiguration that produces no symptom is the failure mode this guards against.

## One gate for pages and API, in `proxy.ts` (2026-08-20)

`proxy.ts` gates everything except a short, individually justified `PUBLIC_PATHS` list: `/login`, `/api/auth/login`, `/api/health` (what the Docker HEALTHCHECK hits), and the two Spotify callback paths. Unauthenticated API requests get `401` JSON; unauthenticated pages redirect to `/login?next=…`. **Why one gate**: a page and the route handlers it calls can never disagree about who is signed in. **How to apply**: adding a public path means editing that list and writing down why.

## The Spotify callback is public but not unprotected (2026-08-20)

`/api/spotify/callback` and its legacy alias `/auth/callback` must be reachable without a session — Spotify redirects there. They are protected by the **state cookie** instead. The `/auth/login` and `/auth/callback` aliases exist because a Redirect URI already registered with Spotify cannot be changed retroactively without breaking a live install (`8233de1`); do not delete them as dead code.

## Reconnecting forces `show_dialog=true` (2026-08-20)

**Decision**: the authorize URL always carries `show_dialog=true`. **Why**: Spotify otherwise keeps honouring an existing grant silently, so a scope added later would never actually be requested and the newly scoped endpoint would just start answering `403` — a failure with no obvious cause. Forcing the consent screen also makes it possible to connect a *different* account deliberately. **How to apply**: reconnecting as the same account overwrites its grant; that is the documented remedy whenever the scope banner appears.

## Scope drift is detected, not assumed (2026-08-20)

The dashboard compares `accounts.scope` (what was actually granted) against what the current configuration requires, and names the missing scope in a banner (`e9d208a`). `unknown` means the grant was never recorded — an account adopted from a legacy `SPOTIFY_REFRESH_TOKEN` — in which case reconnecting is the only way to be certain. **How to apply**: any new Spotify endpoint that needs a scope must be added to the required-scope set, or the operator gets a bare `403` instead of a banner.

## Identity is resolved before anything is written (2026-08-20)

`exchangeCode()` calls `/v1/me` **before** storing anything, so a profile-lookup failure can never leave a token stored under an unknown identity. The account is then upserted and made active; the previous account keeps its token, cursors and events untouched.

## Disconnect keeps the data, and says what it cannot do (2026-08-20)

`POST /api/accounts/disconnect` drops the account row and its token; everything it collected **and its cursors** are kept, so reconnecting the same Spotify id resumes instead of replaying the whole liked backfill. Two things it reports rather than hides: if `SPOTIFY_REFRESH_TOKEN` is still set, the next run re-bootstraps an account from it (`env_fallback_active` in the response); and Spotify has no revocation endpoint, so withdrawing access for good happens at spotify.com/account/apps. **How to apply**: this candour is the house style — surface the caveat in the response, do not paper over it.
