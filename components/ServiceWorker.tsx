"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js, whose whole job is the offline page: when the phone
 * cannot reach the server, an installed app shows "cannot reach the poller"
 * instead of a blank white screen or Safari's error page. It caches nothing
 * else — see the file for why.
 *
 * Production only: in `next dev` a worker outlives every reload and keeps
 * serving whatever version it installed first, which makes "is my change in?"
 * a question about the worker instead of the code.
 */
export default function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // A reverse proxy that authenticates (AUTH_MODE=proxy) may answer
      // /sw.js with its own login page: the app then simply works online-only.
    });
  }, []);
  return null;
}
