import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authMode, isAuthorized } from "./lib/auth/session";
import { signInPath } from "./lib/auth/login-target";

/**
 * Gate on both the admin pages and the admin API routes — the one place that
 * decides "is this an authenticated operator" for the whole app, so a page
 * and the route handlers it calls can never disagree about who is signed in.
 *
 * Left open, deliberately: /login (the sign-in form itself), /api/auth/login
 * (what the form posts to), /api/health (what the Docker HEALTHCHECK hits —
 * public, minimal, see app/api/health/route.ts), Next internals, and the
 * static assets a browser fetches with no session — the icon set and the web
 * manifest (/icons/*, /manifest.webmanifest, through the matcher below). A
 * manifest is fetched without the session cookie and a phone asks for the
 * touch icon before anyone has signed in, so behind the gate they came back as
 * a redirect to /login: an installed app with no icon, and a manifest Chrome
 * refused. They reveal nothing but a drawing and a name the public repository
 * already shows. The same holds for the rest of that list, each fetched
 * before or without a session: /sw.js (a worker script answered with a login
 * redirect fails to register), /offline.html (the worker caches it at install,
 * possibly before sign-in), /robots.txt (a crawler that gets the login page
 * instead reads "allow everything") and /og.png (a link preview's fetcher
 * never signs in). All are static files in public/ that name no account.
 */
// /auth/callback is the legacy alias of /api/spotify/callback — same handler,
// kept public for Spotify's redirect (protected by the state cookie instead).
// /api/auth/sesame is the round trip to Sésame (AUTH_MODE=sesame): its login
// starts there, and its callback is protected by its signed flow cookie.
// /health is /api/health under the conventional name (app/health/route.ts):
// probes written against it must not ride the login redirect.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/sesame", "/api/health", "/health", "/api/spotify/callback", "/auth/callback"];

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
  // In sesame mode a page visit goes straight to Sésame, not to a /login page
  // whose only content would be a button (lib/auth/login-target.ts).
  return NextResponse.redirect(new URL(signInPath(authMode(), pathname), req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons/|manifest.webmanifest|sw.js|offline.html|robots.txt|og.png).*)"],
};
