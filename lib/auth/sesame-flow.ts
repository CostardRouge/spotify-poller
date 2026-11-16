/**
 * The round trip to Sésame (the owner's identity provider, OpenID Connect),
 * the pure half: what the way back must match — the PKCE verifier, the state
 * and where to go next — travels in a short cookie signed with JWT_SECRET
 * (`jose`, HS256, ten minutes), so it can be neither forged nor edited. No
 * new secret: JWT_SECRET already signs the session it ends with.
 */
import { SignJWT, jwtVerify } from "jose";

export const SESAME_FLOW_COOKIE = "sp_sesame";
export const SESAME_FLOW_PATH = "/api/auth/sesame";
export const SESAME_CALLBACK_PATH = "/api/auth/sesame/callback";
export const SESAME_FLOW_SECONDS = 600;

export type SesameFlow = { state: string; verifier: string; next: string };

export { SESAME_ERRORS, type SesameError } from "./sesame-errors";

const key = (secret: string) => new TextEncoder().encode(`sesame-flow:${secret}`);

export async function signFlow(flow: SesameFlow, secret: string, seconds = SESAME_FLOW_SECONDS): Promise<string> {
  return new SignJWT({ ...flow, typ: "sesame-flow" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${seconds}s`)
    .sign(key(secret));
}

/** The flow a cookie carries, or null when it is absent, forged, edited or expired. */
export async function readFlow(raw: string | undefined, secret: string): Promise<SesameFlow | null> {
  if (!raw) return null;
  try {
    const { payload } = await jwtVerify(raw, key(secret), { algorithms: ["HS256"] });
    if (payload.typ !== "sesame-flow") return null;
    const { state, verifier, next } = payload as Record<string, unknown>;
    if (typeof state !== "string" || typeof verifier !== "string") return null;
    return { state, verifier, next: safeNext(typeof next === "string" ? next : null) };
  } catch {
    return null;
  }
}

/** Only ever a path on this site: never a full URL, never `//host`. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

/** The origin as the browser used it, behind Traefik and the tunnel. */
export function originFrom(headers: Headers, fallback: string): string {
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host");
  if (!host) return fallback;
  const proto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || new URL(fallback).protocol.replace(":", "");
  return `${proto === "https" ? "https" : "http"}://${host}`;
}
