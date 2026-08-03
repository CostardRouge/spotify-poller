#!/usr/bin/env node
/**
 * Script JETABLE (spec §7) — obtient le refresh token une seule fois, en local.
 * Le flow OAuth n'est PAS implémenté dans le Worker.
 *
 * Prérequis côté dashboard Spotify (developer.spotify.com) :
 *   Redirect URI de l'app = http://127.0.0.1:8888/callback
 *
 * Usage :
 *   SPOTIFY_CLIENT_ID=xxx SPOTIFY_CLIENT_SECRET=yyy node scripts/get-refresh-token.mjs
 *
 * Puis :
 *   wrangler secret put SPOTIFY_REFRESH_TOKEN   (coller la valeur affichée)
 */
import { createServer } from "node:http";
import { randomBytes } from "node:crypto";

const CLIENT_ID = process.env.SPOTIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SPOTIFY_CLIENT_SECRET;
const REDIRECT_URI = "http://127.0.0.1:8888/callback";
const SCOPES = "user-read-recently-played user-library-read";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("SPOTIFY_CLIENT_ID et SPOTIFY_CLIENT_SECRET requis en variables d'environnement.");
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
    res.writeHead(400).end(`erreur: ${url.searchParams.get("error")}`);
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
    console.error("Pas de refresh_token dans la réponse :", tokens);
    res.writeHead(500).end("échec, voir la console");
  } else {
    console.log("\n=== REFRESH TOKEN (à installer via `wrangler secret put SPOTIFY_REFRESH_TOKEN`) ===\n");
    console.log(tokens.refresh_token);
    console.log("\nScopes accordés :", tokens.scope);
    res.end("OK — refresh token affiché dans le terminal. Tu peux fermer cet onglet.");
  }
  server.close();
});

server.listen(8888, "127.0.0.1", () => {
  console.log("Ouvre cette URL dans ton navigateur :\n");
  console.log(authUrl.toString());
});
