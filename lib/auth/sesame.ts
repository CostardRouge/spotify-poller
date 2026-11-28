/**
 * Sign-in through Sésame (`AUTH_MODE=sesame`): openid-client (OpenID
 * Certified) does the protocol — discovery, PKCE, the code exchange, the ID
 * token's signature, issuer, audience and expiry. Who may enter is Sésame's
 * decision (membership of the app `temoin` there); this side only
 * turns a successful round trip into the same `sp_session` the token opened.
 */
import * as oidc from "openid-client";

export type SesameSettings = { issuer: string; clientId: string; clientSecret: string };

declare global {
   
  var __spotifyPollerSesame: { key: string; client: Promise<oidc.Configuration> } | undefined;
}

export function sesameSettings(): SesameSettings | null {
  const issuer = process.env.SESAME_ISSUER;
  const clientId = process.env.SESAME_CLIENT_ID;
  const clientSecret = process.env.SESAME_CLIENT_SECRET;
  return issuer && clientId && clientSecret ? { issuer, clientId, clientSecret } : null;
}

/** Discovered once per issuer + id; a failure is not cached (Sésame may be restarting). */
export function sesameClient(s: SesameSettings): Promise<oidc.Configuration> {
  const cacheKey = `${s.issuer}|${s.clientId}`;
  const cached = globalThis.__spotifyPollerSesame;
  if (cached?.key === cacheKey) return cached.client;
  const issuer = new URL(s.issuer);
  const client = oidc
    .discovery(
      issuer,
      s.clientId,
      s.clientSecret,
      oidc.ClientSecretBasic(s.clientSecret),
      issuer.protocol === "http:" ? { execute: [oidc.allowInsecureRequests] } : undefined,
    )
    .catch((error) => {
      globalThis.__spotifyPollerSesame = undefined;
      throw error;
    });
  globalThis.__spotifyPollerSesame = { key: cacheKey, client };
  return client;
}
