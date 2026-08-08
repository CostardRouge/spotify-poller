import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAuthorized } from "./lib/auth/session";

/**
 * Gate on both the admin pages and the admin API routes — the one place that
 * decides "is this an authenticated operator" for the whole app, so a page
 * and the route handlers it calls can never disagree about who is signed in.
 *
 * Left open, deliberately: /login (the sign-in form itself), /api/auth/login
 * (what the form posts to), /api/health (what the Docker HEALTHCHECK hits —
 * public, minimal, see app/api/health/route.ts), Next internals and static
 * assets.
 */
// /auth/callback is the legacy alias of /api/spotify/callback — same handler,
// kept public for Spotify's redirect (protected by the state cookie instead).
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health", "/api/spotify/callback", "/auth/callback"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const authed = await isAuthorized(req);
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
