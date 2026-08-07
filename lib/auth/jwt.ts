/**
 * Admin session tokens (JWT, HS256, via `jose` — Edge- and Node-compatible so
 * the same code verifies a session in `proxy.ts` and in a route handler).
 *
 * This is a SEPARATE secret from ADMIN_TOKEN: ADMIN_TOKEN is the login
 * password (compared once, at /api/auth/login); JWT_SECRET signs the session
 * that password unlocks. Reusing one secret for both would mean a leaked
 * session cookie and a leaked login password compromise the same key.
 */
import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "sp_session";
const SESSION_TTL_S = 60 * 60 * 24 * 30; // 30 days — this is a single-operator homelab tool, not a bank

function secretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("missing environment variable: JWT_SECRET");
  return new TextEncoder().encode(secret);
}

export async function signSessionToken(): Promise<string> {
  return new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_S}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, secretKey());
    return payload.sub === "admin";
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE_S = SESSION_TTL_S;
