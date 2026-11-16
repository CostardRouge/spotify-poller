import { NextRequest, NextResponse } from "next/server";
import * as oidc from "openid-client";
import { sesameClient, sesameSettings } from "@/lib/auth/sesame";
import {
  SESAME_CALLBACK_PATH,
  SESAME_FLOW_COOKIE,
  SESAME_FLOW_PATH,
  SESAME_FLOW_SECONDS,
  originFrom,
  safeNext,
  signFlow,
} from "@/lib/auth/sesame-flow";

export const dynamic = "force-dynamic";

/** GET /api/auth/sesame/login?next=/path → Sésame's sign-in, with PKCE and a state. Public. */
export async function GET(req: NextRequest) {
  const here = originFrom(req.headers, req.nextUrl.origin);
  const next = safeNext(req.nextUrl.searchParams.get("next"));
  const settings = sesameSettings();
  const secret = process.env.JWT_SECRET;
  if (process.env.AUTH_MODE !== "sesame" || !settings || !secret) return NextResponse.redirect(new URL("/login", here), 303);
  try {
    const client = await sesameClient(settings);
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const target = oidc.buildAuthorizationUrl(client, {
      redirect_uri: `${here}${SESAME_CALLBACK_PATH}`,
      scope: "openid profile email",
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: "S256",
      state,
    });
    const res = NextResponse.redirect(target, 303);
    res.cookies.set(SESAME_FLOW_COOKIE, await signFlow({ state, verifier, next }, secret), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: SESAME_FLOW_PATH,
      maxAge: SESAME_FLOW_SECONDS,
    });
    return res;
  } catch {
    return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}&sesame=failed`, here), 303);
  }
}
