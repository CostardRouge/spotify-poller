// Where a signed-out visit goes, and when /login shows itself at all.
// Client-safe and import-free: read by proxy.ts and app/login/page.tsx.

/**
 * The address a signed-out page visit is sent to. In `sesame` mode Sésame is
 * the only door, so the app's own /login would be a page with one button on
 * it: the visit goes straight to the round trip instead, and the user sees
 * Sésame's sign-in (or nothing at all, when Sésame still has a session and
 * hands a code straight back). The other modes keep /login, the token form.
 */
export function signInPath(mode: "token" | "proxy" | "sesame", next: string): string {
  const base = mode === "sesame" ? "/api/auth/sesame/login" : "/login";
  return `${base}?next=${encodeURIComponent(next)}`;
}

/**
 * Whether /login, in `sesame` mode, should hand over to Sésame at once rather
 * than render. It renders in exactly two cases, both a stop the user must see:
 *  - `?sesame=…`: the last round trip ended badly (refused, expired, failed) —
 *    bouncing again would loop on a refusal or hide why it failed;
 *  - `?signed_out=1`: the user just signed out. Sésame keeps its own session,
 *    so going straight back would sign them in again without a click, and
 *    "Sign out" would look broken.
 */
export function sesameShouldRedirect(params: { sesame?: string | string[]; signed_out?: string | string[] }): boolean {
  return params.sesame === undefined && params.signed_out === undefined;
}
