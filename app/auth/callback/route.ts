/**
 * Legacy alias — the pre-Next.js server received the Spotify return on
 * /auth/callback. Kept so a Redirect URI already registered in the Spotify
 * dashboard (and set in .env) keeps working without any dashboard edit:
 * the exchange uses SPOTIFY_REDIRECT_URI verbatim, so whichever path Spotify
 * redirects to must simply route to the same handler.
 */
export { GET } from "../../api/spotify/callback/route";
