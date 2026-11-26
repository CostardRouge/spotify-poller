/*
 * spotify-poller's service worker. One job: an offline page for navigations.
 *
 * What it deliberately does NOT do is cache the app. Every page here is a
 * report on live state — "played last succeeded 7 min ago" — and a cached copy
 * served when the server is unreachable would show a stale "Healthy" exactly
 * when something is wrong: the dishonesty PRODUCT.md rules out. So pages, API
 * calls and assets all go to the network as if no worker existed; only when a
 * page load fails outright (no network, server down, VPN off) does the worker
 * answer, with offline.html, which says it cannot know the state.
 *
 * Only GET navigations are touched. Everything else — fetch() from the pages,
 * the login POST, _next/static — is not intercepted at all, so the browser
 * handles it natively. Redirects (the auth gate, the Sésame and Spotify round
 * trips) pass through untouched: a navigation's fetch returns the redirect
 * itself, which the browser then follows.
 *
 * Bump VERSION when offline.html changes, so the new copy replaces the old.
 */
const VERSION = "v1";
const CACHE = `sp-offline-${VERSION}`;
const OFFLINE_URL = new URL("offline.html", self.registration.scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("sp-offline-") && k !== CACHE).map((k) => caches.delete(k)));
      // Navigation preload: the page request starts while the worker boots, so
      // intercepting navigations costs no extra latency on a cold start.
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;
  event.respondWith(
    (async () => {
      try {
        const preloaded = await event.preloadResponse;
        if (preloaded) return preloaded;
        return await fetch(request);
      } catch {
        // fetch() rejects only when no response came back at all; a 500 or a
        // 502 from a proxy is a response and is shown as such.
        return (await caches.match(OFFLINE_URL)) ?? Response.error();
      }
    })()
  );
});
