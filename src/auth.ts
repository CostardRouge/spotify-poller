import { getState, setState } from "./db";
import { AuthError, Env, TransientError, nowIso } from "./types";

/**
 * Authorization Code Flow avec client_secret (spec §7) :
 * le refresh token est STABLE (pas de rotation PKCE).
 * L'access token vit 1 h — on le rafraîchit à chaque exécution, sans cache.
 *
 * Deux sources possibles pour le refresh token, dans cet ordre :
 *  1. poller_state (`auth.refresh_token`) — écrit par le flow de connexion de
 *     l'UI (/auth/login → /auth/callback), c'est la voie normale ;
 *  2. SPOTIFY_REFRESH_TOKEN en variable d'environnement — fallback compatible
 *     avec l'installation historique via scripts/get-refresh-token.mjs.
 */

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SCOPES = "user-read-recently-played user-library-read";
const KEY_REFRESH = "auth.refresh_token";
const KEY_SCOPE = "auth.scope";
const KEY_CONNECTED_AT = "auth.connected_at";

const MAX_TOKEN_RETRIES = 2; // réseau uniquement — borné, comme spotify-api.ts

function basicAuthHeader(env: Env): string {
  return "Basic " + Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
}

export function redirectUri(env: Env): string {
  return env.SPOTIFY_REDIRECT_URI ?? "http://127.0.0.1:8787/auth/callback";
}

/**
 * Base publique de l'UI, dérivée du redirect URI — jamais de l'hôte de la
 * requête, qui derrière Docker serait l'hôte interne du conteneur
 * (convention appBaseUrl du Spotify Calendar).
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

/** URL d'autorisation Spotify pour le flow de connexion de l'UI. */
export function buildAuthorizeUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope: SCOPES,
    redirect_uri: redirectUri(env),
    state,
    // Force l'écran de consentement pour qu'un scope ajouté plus tard soit
    // re-approuvé — sans ça, Spotify réutilise silencieusement l'ancien grant
    // et les tokens rafraîchis 401-ent sur les endpoints nouvellement scopés
    // (« scope drift », convention Spotify Calendar).
    show_dialog: "true",
  });
  return "https://accounts.spotify.com/authorize?" + params.toString();
}

/** Échange le code d'autorisation, persiste le refresh token dans poller_state. */
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
    // Pas de compte connecté : la collecte est morte pour de bon — bruyant.
    throw new AuthError("aucun refresh token : connecter le compte via l'UI (/auth/login) ou définir SPOTIFY_REFRESH_TOKEN");
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
      // Réseau : transitoire, le prochain passage rattrape.
      throw new TransientError(`token endpoint unreachable: ${String(e)}`);
    }
  }

  if (res.status === 400 || res.status === 401 || res.status === 403) {
    // Refresh token invalide/révoqué : arrêt définitif de la collecte.
    // Doit être BRUYANT (§8) — AuthError déclenche l'alerte immédiate.
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
  // Spotify peut occasionnellement renvoyer un nouveau refresh token même en
  // code flow classique : le persister quand la source est la base, pour ne
  // jamais continuer sur un token périmé.
  if (json.refresh_token && rt.source === "ui") {
    storeRefreshToken(env, json.refresh_token, json.scope);
  }
  return json.access_token;
}
