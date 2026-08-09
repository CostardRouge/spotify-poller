import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { buildAuthorizeUrl } from "@/lib/server/spotify/auth";

const STATE_COOKIE = "sp_state";

/** Starts the Spotify account connection flow (spec §7), gated by middleware (admin session required). */
export async function GET() {
  const env = getEnv();
  const state = randomBytes(16).toString("hex");
  const res = NextResponse.redirect(buildAuthorizeUrl(env, state));
  res.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
