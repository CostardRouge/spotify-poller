import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { appBaseUrl, exchangeCode } from "@/lib/server/spotify/auth";

const STATE_COOKIE = "sp_state";

export async function GET(req: NextRequest) {
  const env = getEnv();
  const clearState = { name: STATE_COOKIE, value: "", path: "/", maxAge: 0 } as const;
  const base = appBaseUrl(env);
  const url = req.nextUrl;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get(STATE_COOKIE)?.value ?? null;

  if (error) {
    const res = NextResponse.redirect(`${base}/?auth_error=${encodeURIComponent(error)}`);
    res.cookies.set(clearState);
    return res;
  }
  if (!code || !state || state !== cookieState) {
    const res = NextResponse.redirect(`${base}/?auth_error=state_mismatch`);
    res.cookies.set(clearState);
    return res;
  }

  try {
    const accountId = await exchangeCode(env, code);
    const res = NextResponse.redirect(`${base}/?connected=${encodeURIComponent(accountId)}`);
    res.cookies.set(clearState);
    return res;
  } catch (e) {
    console.error("OAuth code exchange failed:", e);
    const res = NextResponse.redirect(`${base}/?auth_error=exchange_failed`);
    res.cookies.set(clearState);
    return res;
  }
}
