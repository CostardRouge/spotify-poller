/**
 * Legacy alias — the pre-Next.js server started the OAuth flow on /auth/login.
 * Kept so old bookmarks and scripts keep working; still behind the session
 * gate (proxy.ts), exactly like /api/spotify/login.
 */
export { GET } from "../../api/spotify/login/route";
