# Authentication, sessions, Spotify OAuth

Read before touching the login flow, the JWT session, `proxy.ts`, the OAuth connect/reconnect path, or scopes.

## Two secrets, deliberately not one (2026-08-20)

**Decision**: `ADMIN_TOKEN` is the login password checked once at `/login`; `JWT_SECRET` (HS256, `jose`) signs the `sp_session` cookie it unlocks, 30-day expiry. **Why**: a leaked session cookie must not also leak — or let you derive — the password. **How to apply**: do not collapse them into one value "for simplicity"; that is the point of the split.

## `AUTH_MODE=sesame`: Sésame opens the session, no token (2026-11-16)

**Decision**: a third mode, asked by the owner so his internal tools sign in through Sésame (`costardrouge/sesame`, his OpenID Connect provider with passkeys) and the admin token disappears. `/api/auth/sesame/login` sends the browser to Sésame with PKCE (S256) and a state; `/api/auth/sesame/callback` exchanges the code (openid-client, OpenID Certified — never hand-written protocol) and mints the SAME `sp_session` the token did, so the gate, the cookie and the 30 days are unchanged. The round trip's state travels in `sp_sesame` (path `/api/auth/sesame`, ten minutes), a `jose` HS256 token keyed from JWT_SECRET with a derivation and a `typ`, so a session cookie can never pass for a flow nor the reverse. **Who may enter is Sésame's decision**: membership of the app `spotify-poller` there; a removed person is refused by Sésame and never returns with a code. **Why not Cloudflare Access instead**: the owner wanted no double sign-in, so one gate per app, and Sésame directly here. In this mode `/api/auth/login` answers 404 and `ADMIN_TOKEN` is not read. **How to apply**: the four variables (`SESAME_ISSUER`, `SESAME_CLIENT_ID`, `SESAME_CLIENT_SECRET`, `JWT_SECRET`) are required at boot in this mode; the callback rebuilds its URL from the forwarded Host so `redirect_uri` matches behind Traefik.

## In sesame mode a signed-out visit goes straight to Sésame (2026-11-26)

**Decision** (the owner, after comparing with winnow: « go straight to sesame »): Sésame is the only door in this mode, so the app's own /login was a card with one button. `proxy.ts` now sends a signed-out page visit to `/api/auth/sesame/login?next=…` and `/login` itself redirects there (`lib/auth/login-target.ts`, `tests/login-target.test.ts`); API calls still get 401. **Why winnow differs**: there Sésame is a second door beside the password (linked by `sub`), so its /login keeps the form and an "or" button — not a different Sésame integration, a different door count. **The two stops /login still renders for**: `?sesame=…` (a refusal or failure — redirecting again would loop on a refusal and hide why) and `?signed_out=1`, which Settings' sign-out now navigates to: Sésame keeps its own session, so a bare /login after sign-out would hand a code straight back and sign the user in again without a click. **How to apply**: any new sign-out path or "back to login" link in sesame mode must carry `?signed_out=1` (or a `sesame` error); token and proxy modes are unchanged.

## `AUTH_MODE=proxy` fails loudly, not silently (2026-08-20)

In proxy mode the reverse proxy authenticates (Cloudflare Access, Traefik…) and the sign-in screen is skipped. `PROXY_AUTH_HEADER` must be set so a request reaching the origin **directly**, bypassing the proxy, is still rejected — `isAuthorized` returns `true` unconditionally when it is absent (`lib/auth/session.ts`). Because that is a wide-open configuration, `instrumentation.ts` prints a boxed warning at startup rather than starting quietly. **How to apply**: keep that warning; a misconfiguration that produces no symptom is the failure mode this guards against.

## One gate for pages and API, in `proxy.ts` (2026-08-20)

`proxy.ts` gates everything except a short, individually justified `PUBLIC_PATHS` list: `/login`, `/api/auth/login`, `/api/health` (what the Docker HEALTHCHECK hits) and its alias `/health` (2026-11-27, `deployment.md`), and the two Spotify callback paths. Unauthenticated API requests get `401` JSON; unauthenticated pages redirect to `/login?next=…`. **Why one gate**: a page and the route handlers it calls can never disagree about who is signed in. **How to apply**: adding a public path means editing that list and writing down why. **The matcher leaves out the static assets a browser fetches with no session** (2026-10-19): `/icons/*` and `/manifest.webmanifest`, beside Next's own `_next/static` and `_next/image`. A manifest is fetched without the session cookie and a phone asks for the touch icon before anyone has signed in, so behind the gate both came back as a redirect to `/login` — an installed app with no icon, and a manifest Chrome refused. They reveal nothing but a drawing and a name the public repository already shows. **2026-11-26**: the same exemption for `/sw.js` (a worker script answered with a login redirect fails to register), `/offline.html` (cached at install, possibly before sign-in), `/robots.txt` (a crawler served the login page reads "allow everything") and `/og.png` (a preview fetcher never signs in) — all static files in `public/` naming no account; `tests/pwa.test.ts` checks the matcher both ways (these out, every page and API route in). Nothing else leaves the gate this way.

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
