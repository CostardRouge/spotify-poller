import { NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import { SESSION_COOKIE, SESSION_MAX_AGE_S, signSessionToken } from "@/lib/auth/jwt";
import { sesameClient, sesameSettings } from "@/lib/auth/sesame";
import { SESAME_FLOW_COOKIE, SESAME_FLOW_PATH, type SesameError, originFrom, readFlow } from "@/lib/auth/sesame-flow";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/sesame/callback — Sésame's answer. Public (proxy.ts). The code
 * is exchanged with the verifier this browser's flow cookie kept; openid-client
 * checks the state and the ID token; then the SAME `sp_session` the token
 * used to open. Who may reach this point with a code is Sésame's decision.
 */
export async function GET(req: NextRequest) {
  const here = originFrom(req.headers, req.nextUrl.origin);
  const settings = sesameSettings();
  const secret = process.env.JWT_SECRET;
  const flow = secret ? await readFlow(req.cookies.get(SESAME_FLOW_COOKIE)?.value, secret) : null;
  const done = (to: string) => {
    const res = NextResponse.redirect(new URL(to, here), 303);
    res.cookies.set(SESAME_FLOW_COOKIE, "", { path: SESAME_FLOW_PATH, maxAge: 0 });
    return res;
  };
  const failed = (why: SesameError) => done(`/login?next=${encodeURIComponent(flow?.next ?? "/")}&sesame=${why}`);

  if (process.env.AUTH_MODE !== "sesame" || !settings) return done("/login");
  if (!flow) return failed("expired");
  // An `error` instead of a `code`: Sésame refused this person.
  if (req.nextUrl.searchParams.has("error")) return failed("refused");
  try {
    // The URL as the browser called it: the redirect_uri must match exactly.
    const current = new URL(`${here}${req.nextUrl.pathname}${req.nextUrl.search}`);
    const tokens = await oidc.authorizationCodeGrant(await sesameClient(settings), current, {
      pkceCodeVerifier: flow.verifier,
      expectedState: flow.state,
    });
    if (!tokens.claims()?.sub) return failed("failed");
  } catch {
    return failed("failed");
  }
  const res = done(flow.next);
  res.cookies.set(SESSION_COOKIE, await signSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
