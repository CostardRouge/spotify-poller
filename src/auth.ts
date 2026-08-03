import { AuthError, Env, TransientError } from "./types";

/**
 * Authorization Code Flow avec client_secret (spec §7) :
 * le refresh token est STABLE, vit dans un secret Worker, jamais en base.
 * L'access token vit 1 h — on le rafraîchit à chaque exécution, sans cache.
 */
export async function getAccessToken(env: Env): Promise<string> {
  const basic = btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`);

  let res: Response;
  try {
    res = await fetch("https://accounts.spotify.com/api/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: env.SPOTIFY_REFRESH_TOKEN,
      }),
    });
  } catch (e) {
    // Réseau : transitoire, le prochain cron rattrape.
    throw new TransientError(`token endpoint unreachable: ${String(e)}`);
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

  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) {
    throw new AuthError("token response missing access_token");
  }
  return json.access_token;
}
