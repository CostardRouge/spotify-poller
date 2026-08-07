import {
  adoptLegacyRows,
  countAccounts,
  getAccount,
  getActiveAccountId,
  getGlobalState,
  listAccounts,
  setAccountStatus,
  setActiveAccountId,
  updateAccountToken,
  upsertAccount,
} from "./db";
import { Account, AuthError, Env, PublicAccount, TransientError } from "./types";

/**
 * Authorization Code Flow with client_secret (spec §7):
 * the refresh token is STABLE (no PKCE rotation).
 * The access token lives 1 h — we refresh it on every run, without caching.
 *
 * Tokens are stored PER ACCOUNT in the `accounts` table, keyed by the Spotify
 * user id. Connecting a second account creates a row, it never overwrites the
 * first one — which is exactly what the previous single-key design did.
 *
 * Legacy sources, adopted into `accounts` on first use:
 *  1. poller_state 'auth.refresh_token', written by the pre-multi-account UI;
 *  2. SPOTIFY_REFRESH_TOKEN, from the scripts/get-refresh-token.mjs install.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const ME_URL = "https://api.spotify.com/v1/me";
const SCOPES = "user-read-recently-played user-library-read";
const LEGACY_KEY_REFRESH = "auth.refresh_token";

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
    // convention). It also lets you pick a DIFFERENT account instead of
    // silently reconnecting the one already signed in.
    show_dialog: "true",
  });
  return "https://accounts.spotify.com/authorize?" + params.toString();
}

// ---------- token plumbing ----------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
}

/** Raw refresh call. Bounded network retry; maps Spotify's verdict to our errors. */
async function requestAccessToken(env: Env, refreshToken: string): Promise<TokenResponse> {
  let res: Response | null = null;
  for (let attempt = 0; res === null; attempt++) {
    try {
      res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: {
          Authorization: basicAuthHeader(env),
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }),
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

  const json = (await res.json()) as TokenResponse;
  if (!json.access_token) {
    throw new AuthError("token response missing access_token");
  }
  return json;
}

/**
 * Identifies the account behind an access token. `id` and `display_name` are
 * returned with any valid token — no extra scope needed, so this adds no
 * re-consent step for an already connected account.
 */
export async function fetchProfile(accessToken: string): Promise<{ id: string; display_name: string | null }> {
  let res: Response;
  try {
    res = await fetch(ME_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  } catch (e) {
    throw new TransientError(`/v1/me unreachable: ${String(e)}`);
  }
  if (res.status === 401 || res.status === 403) {
    throw new AuthError(`/v1/me rejected the token (${res.status})`);
  }
  if (!res.ok) {
    throw new TransientError(`/v1/me returned ${res.status}`);
  }
  const json = (await res.json()) as { id?: string; display_name?: string | null };
  if (!json.id) throw new AuthError("/v1/me response missing id");
  return { id: json.id, display_name: json.display_name ?? null };
}

/**
 * Access token for a specific account. On rotation the new refresh token is
 * persisted against THAT account only. On rejection the account is flagged
 * 'revoked' so the UI and /status can say which one needs reconnecting.
 */
export async function getAccessToken(env: Env, account: Account): Promise<string> {
  let json: TokenResponse;
  try {
    json = await requestAccessToken(env, account.refresh_token);
  } catch (e) {
    if (e instanceof AuthError) setAccountStatus(env, account.id, "revoked");
    throw e;
  }
  // Spotify may occasionally return a new refresh token even in the classic
  // code flow: persist it so we never keep going with a stale one.
  if (json.refresh_token) {
    updateAccountToken(env, account.id, json.refresh_token, json.scope ?? null);
    account.refresh_token = json.refresh_token;
  }
  return json.access_token as string;
}

// ---------- connection flow ----------

/**
 * Exchanges the authorization code, identifies the account and stores its
 * token. Returns the account id so the caller can report which one was
 * connected.
 *
 * Note the ordering: we resolve /v1/me BEFORE writing anything, so a profile
 * lookup failure cannot leave a token stored under an unknown identity.
 */
export async function exchangeCode(env: Env, code: string): Promise<string> {
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
  const json = (await res.json()) as TokenResponse;
  if (!json.refresh_token || !json.access_token) {
    throw new AuthError("token response missing refresh_token or access_token");
  }

  const profile = await fetchProfile(json.access_token);
  upsertAccount(env, profile.id, profile.display_name, json.refresh_token, json.scope ?? null);
  setActiveAccountId(env, profile.id);
  return profile.id;
}

/**
 * Turns a legacy refresh token into a proper account row, then claims the rows
 * collected before the migration. Runs at most once per legacy token: after it,
 * everything goes through `accounts`.
 */
async function bootstrapLegacyAccount(env: Env, refreshToken: string, origin: string): Promise<Account> {
  const json = await requestAccessToken(env, refreshToken);
  const profile = await fetchProfile(json.access_token as string);

  upsertAccount(env, profile.id, profile.display_name, json.refresh_token ?? refreshToken, json.scope ?? null);
  setActiveAccountId(env, profile.id);

  const adopted = adoptLegacyRows(env, profile.id);
  console.log(
    `[auth] adopted legacy data (${origin}) into account ${profile.id}:`,
    JSON.stringify(adopted)
  );

  const account = getAccount(env, profile.id);
  if (!account) throw new AuthError("account vanished right after being created");
  return account;
}

/**
 * The account the poller currently collects for. Mono-user by design: exactly
 * one account is active at a time, the others keep their data and their token
 * and can be reactivated without redoing the OAuth flow.
 *
 * Resolution order:
 *  1. the explicitly active account;
 *  2. the only/most recent connected account, if the pointer is stale;
 *  3. a legacy token (poller_state, then env), which gets adopted;
 *  4. nothing — AuthError, loud, because collection cannot proceed.
 */
export async function resolveActiveAccount(env: Env): Promise<Account> {
  const activeId = getActiveAccountId(env);
  if (activeId) {
    const account = getAccount(env, activeId);
    if (account) return account;
  }

  if (countAccounts(env) > 0) {
    const first = listAccounts(env)[0];
    const account = getAccount(env, first.id);
    if (account) {
      setActiveAccountId(env, account.id);
      console.log(`[auth] no active account set — falling back to ${account.id}`);
      return account;
    }
  }

  const legacyDbToken = getGlobalState(env, LEGACY_KEY_REFRESH);
  if (legacyDbToken) return bootstrapLegacyAccount(env, legacyDbToken, "poller_state");
  if (env.SPOTIFY_REFRESH_TOKEN) {
    return bootstrapLegacyAccount(env, env.SPOTIFY_REFRESH_TOKEN, "SPOTIFY_REFRESH_TOKEN");
  }

  // No connected account: collection is dead for good — be loud.
  throw new AuthError(
    "no connected account: connect one through the UI (/auth/login) or set SPOTIFY_REFRESH_TOKEN"
  );
}

/** Non-throwing variant for status endpoints, which must answer even when broken. */
export function authStatus(env: Env): {
  connected: boolean;
  active_account_id: string | null;
  accounts: PublicAccount[];
  legacy_token_pending: boolean;
} {
  const accounts = listAccounts(env);
  const activeId = getActiveAccountId(env);
  const legacyPending =
    accounts.length === 0 && (getGlobalState(env, LEGACY_KEY_REFRESH) !== null || !!env.SPOTIFY_REFRESH_TOKEN);
  return {
    connected: accounts.length > 0 || legacyPending,
    active_account_id: activeId,
    accounts,
    legacy_token_pending: legacyPending,
  };
}
