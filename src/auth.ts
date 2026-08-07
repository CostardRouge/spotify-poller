import { getState, setState } from "./db";
import { AuthError, Env, TransientError, nowIso } from "./types";

/**
 * Authorization Code Flow with client_secret (spec §7):
 * the refresh token is STABLE (no PKCE rotation).
 * The access token lives 1 h — we refresh it on every run, without caching.
 *
 * Two possible sources for the refresh token, in this order:
 *  1. poller_state (`auth.refresh_token`) — written by the UI connection flow
 *     (/auth/login → /auth/callback), this is the normal path;
 *  2. SPOTIFY_REFRESH_TOKEN as an environment variable — fallback compatible
 *     with the legacy install via scripts/get-refresh-token.mjs.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = "user-read-recently-played user-library-read";
const KEY_REFRESH = "auth.refresh_token";
const KEY_SCOPE = "auth.scope";
const KEY_CONNECTED_AT = "auth.connected_at";

const MAX_TOKEN_RETRIES = 2; // network only — bounded, like spotify-api.ts

function basicAuthHeader(env: Env): string {
  return "Basic " + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

export function redirectUri(env: Env): string {
  return env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8787/auth/callback";
}

/**
 * Public base URL of the UI, derived from the redirect URI — never from the
 * request host, which behind Docker would be the container's internal host
 * (appBaseUrl convention from the Spotify Calendar).
 */
export function appBaseUrl(env: Env): string {
  return redirectUri(env).replace(/\/auth\/callback\/?$/, "");
}

export function getRefreshToken(env: Env): { token: string; source: "ui" | "env" } | null {
  const fromDb = getState(env, KEY_REFRESH);
  if (fromDb) return { token: fromDb, source: "ui" };
  if (env.SPOTIFY_REFRESH_TOKEN) return { token: env.SPOTIFY_REFRESH_TOKEN, source: "env" };
  return null;
}

export function storeRefreshToken(env: Env, token: string, scope: string | undefined): void {
  setState(env, KEY_REFRESH, token);
  if (scope !== undefined) setState(env, KEY_SCOPE, scope);
  setState(env, KEY_CONNECTED_AT, nowIso());
}

export function authStatus(env: Env): {
  connected: boolean;
  source: "ui" | "env" | null;
  scope: string | null;
  connected_at: string | null;
} {
  const rt = getRefreshToken(env);
  return {
    connected: rt !== null,
    source: rt?.source ?? null,
    scope: getState(env, KEY_SCOPE),
    connected_at: getState(env, KEY_CONNECTED_AT),
  };
}

/** Spotify authorization URL for the UI connection flow. */
export function buildAuthorizeUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri(env),
    state,
    // Force the consent screen so that a scope added later gets re-approved —
    // without it, Spotify silently reuses the old grant and refreshed tokens
    // 401 on newly scoped endpoints ("scope drift", Spotify Calendar
    // convention).
    show_dialog: "true",
  });
  return "https://accounts.spotify.com/authorize?" + params.toString();
}

/** Exchanges the authorization code, persists the refresh token in poller_state. */
export async function exchangeCode(env: Env, code: string): Promise<void> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(env),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(env),
    }),
  });
  if (!res.ok) {
    throw new AuthError(`token exchange failed (${res.status}): ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const json = (await res.json()) as { refresh_token?: string; scope?: string };
  if (!json.refresh_token) {
    throw new AuthError("token response missing refresh_token");
  }
  storeRefreshToken(env, json.refresh_token, json.scope);
}

export async function getAccessToken(env: Env): Promise<string> {
  const rt = getRefreshToken(env);
  if (!rt) {
    // No connected account: collection is dead for good — be loud.
    throw new AuthError("no refresh token: connect the account through the UI (/auth/login) or set SPOTIFY_REFRESH_TOKEN");
  }

  let res: Response | null = null;
  for (let attempt = 0; res === null; attempt++) {
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(env),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: rt.token,
        }),
      });
    } catch (e) {
      if (attempt < MAX_TOKEN_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
        continue;
      }
      // Network: transient, the next run catches up.
      throw new TransientError(`token endpoint unreachable: ${String(e)}`);
    }
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Invalid/revoked refresh token: collection stops for good.
    // Must be LOUD (§8) — AuthError triggers the immediate alert.
    const body = await res.text().catch(() => "");
    throw new AuthError(`refresh token rejected (${res.status}): ${body.slice(0, 300)}`);
  }
  if (!res.ok) {
    throw new TransientError(`token endpoint ${res.status}`);
  }

  const json = (await res.json()) as { access_token?: string; refresh_token?: string; scope?: string };
  if (!json.access_token) {
    throw new AuthError("token response missing access_token");
  }
  // Spotify may occasionally return a new refresh token even in the classic
  // code flow: persist it when the source is the database, so we never keep
  // going with a stale token.
  if (json.refresh_token && rt.source === "ui") {
    storeRefreshToken(env, json.refresh_token, json.scope);
  }
  return json.access_token;
}
