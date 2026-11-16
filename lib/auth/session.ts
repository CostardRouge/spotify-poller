import type { NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "./jwt";

export type AuthMode = "token" | "proxy" | "sesame";

export function authMode(): AuthMode {
  const mode = process.env.AUTH_MODE;
  return mode === "proxy" || mode === "sesame" ? mode : "token";
}

/**
 * Mirrors the previous ADMIN_TOKEN gate (spotify-poller pre-Next.js), now on
 * top of a signed session instead of a bearer header:
 *
 *  - 'token' (default): a valid `sp_session` JWT cookie, minted by
 *    /api/auth/login after checking ADMIN_TOKEN.
 *  - 'sesame': the same cookie, minted by /api/auth/sesame/callback after a
 *    round trip to Sésame (lib/auth/sesame.ts); no token at all.
 *  - 'proxy': the reverse proxy authenticates (Cloudflare Access, Traefik…).
 *    PROXY_AUTH_HEADER must be present so a request that reaches the origin
 *    directly — bypassing the proxy — is still rejected; without it, every
 *    request that reaches the process is trusted (warned about at startup).
 */
export async function isAuthorized(req: NextRequest): Promise<boolean> {
  if (authMode() === "proxy") {
    const header = process.env.PROXY_AUTH_HEADER;
    if (!header) return true;
    const value = req.headers.get(header);
    return !!value && value.length > 0;
  }
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  return verifySessionToken(token);
}
