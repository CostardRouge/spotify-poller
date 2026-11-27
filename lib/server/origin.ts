/**
 * The public origin a request was made to, rebuilt from its headers — for the
 * absolute URLs link previews need (OpenGraph's og:image and og:url must be
 * absolute, and Next's metadataBase is how they become so).
 *
 * Why from the request and not from a setting: the dashboard has no "public
 * URL" variable — it is reached as http://optiplex:3000 on the LAN, through a
 * reverse proxy under a domain, or as localhost in development, often all
 * three for one instance — and a preview built for one address is wrong for
 * the others. Behind a proxy the original scheme and host arrive in
 * X-Forwarded-Proto / X-Forwarded-Host (Next's own server fills them in when
 * nothing upstream did); a proxy chain may list several, comma-separated, and
 * the first is the client-facing one.
 *
 * Trusting a client-supplied header is harmless here: it only shapes the
 * metadata of the response sent back to that same client. The host is still
 * held to hostname characters, so a forged value cannot smuggle markup or a
 * different scheme into the page; anything else yields null and the caller
 * falls back to relative URLs.
 */
export function requestOrigin(get: (name: string) => string | null): URL | null {
  const first = (v: string | null) => v?.split(",")[0]?.trim().toLowerCase() || null;
  const host = first(get("x-forwarded-host")) ?? first(get("host"));
  if (!host || !/^[a-z0-9.-]+(:\d{1,5})?$|^\[[0-9a-f:.]+\](:\d{1,5})?$/.test(host)) return null;
  const proto = first(get("x-forwarded-proto"));
  const scheme = proto === "https" || proto === "http" ? proto : "http";
  try {
    return new URL(`${scheme}://${host}`);
  } catch {
    return null;
  }
}
