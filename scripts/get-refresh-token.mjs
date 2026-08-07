#!/usr/bin/env node
/**
 * THROWAWAY script (spec §7) — obtains the refresh token once, locally.
 * The OAuth flow is NOT implemented in the Worker.
 *
 * Prerequisite on the Spotify dashboard (developer.spotify.com):
 *   the app's Redirect URI = http://127.0.0.1:8888/callback
 *
 * Usage:
 *   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/get-refresh-token.mjs
 *
 * Then:
 *   wrangler secret put SPOTIFY_REFRESH_TOKEN   (paste the printed value)
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
// Keep in sync with ALL_SCOPES in src/auth.ts — this script lives outside the
// TypeScript build, so the list cannot be imported.
const SCOPES = "user-read-recently-played user-library-read user-read-playback-state";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET are required as environment variables.");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");

const authUrl = new URL("https://accounts.spotify.com/authorize");
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("client_id", CLIENT_ID);
authUrl.searchParams.set("scope", SCOPES);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("state", state);

const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1:8888");
  if (url.pathname !== "/callback") {
    res.writeHead(404).end();
    return;
  }
  if (url.searchParams.get("state") !== state) {
    res.writeHead(400).end("state mismatch");
    return;
  }
  const code = url.searchParams.get("code");
  if (!code) {
    res.writeHead(400).end(`error: ${url.searchParams.get("error")}`);
    return;
  }

  const tokenRes = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI,
    }),
  });
  const tokens = await tokenRes.json();

  if (!tokens.refresh_token) {
    console.error("No refresh_token in the response:", tokens);
    res.writeHead(500).end("failed, see the console");
  } else {
    console.log("\n=== REFRESH TOKEN (install it with `wrangler secret put SPOTIFY_REFRESH_TOKEN`) ===\n");
    console.log(tokens.refresh_token);
    console.log("\nGranted scopes:", tokens.scope);
    res.end("OK — refresh token printed in the terminal. You can close this tab.");
  }
  server.close();
});

server.listen(8888, "127.0.0.1", () => {
  console.log("Open this URL in your browser:\n");
  console.log(authUrl.toString());
});
