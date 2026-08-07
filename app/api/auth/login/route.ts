import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { signSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_S } from "@/lib/auth/jwt";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Checks ADMIN_TOKEN and, on a match, mints a signed session cookie. */
export async function POST(req: NextRequest) {
  const env = getEnv();
  if (!env.ADMIN_TOKEN) {
    return NextResponse.json({ error: "ADMIN_TOKEN is not configured on the server" }, { status: 500 });
  }

  const { token } = (await req.json().catch(() => ({}))) as { token?: string };
  if (!token || !safeEqual(token, env.ADMIN_TOKEN)) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }

  const session = await signSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_S,
  });
  return res;
}
