/**
 * requestOrigin rebuilds the address a link preview must point back to. Wrong
 * here means a preview card with no image (an og:image on localhost) or, worse,
 * a header value echoed into the page; both fail silently in a browser.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { requestOrigin } from "../lib/server/origin";

const from = (headers: Record<string, string>) => (name: string) => headers[name] ?? null;

describe("requestOrigin", () => {
  it("uses the Host header when no proxy is involved", () => {
    assert.equal(requestOrigin(from({ host: "optiplex:3000" }))?.origin, "http://optiplex:3000");
  });

  it("prefers the forwarded host and scheme a reverse proxy sets", () => {
    const origin = requestOrigin(
      from({ host: "127.0.0.1:3000", "x-forwarded-host": "poller.example.org", "x-forwarded-proto": "https" })
    );
    assert.equal(origin?.origin, "https://poller.example.org");
  });

  it("takes the first, client-facing entry of a proxy chain", () => {
    const origin = requestOrigin(
      from({ "x-forwarded-host": "poller.example.org, internal:3000", "x-forwarded-proto": "https,http" })
    );
    assert.equal(origin?.origin, "https://poller.example.org");
  });

  it("accepts a bracketed IPv6 host", () => {
    assert.equal(requestOrigin(from({ host: "[::1]:3000" }))?.origin, "http://[::1]:3000");
  });

  it("falls back to http for an unknown forwarded scheme", () => {
    assert.equal(requestOrigin(from({ host: "nas.lan", "x-forwarded-proto": "javascript" }))?.origin, "http://nas.lan");
  });

  it("refuses a host that is not a hostname", () => {
    for (const host of ['evil.com"><script>', "user@evil.com", "evil.com/path", ""]) {
      assert.equal(requestOrigin(from({ host })), null, JSON.stringify(host));
    }
  });

  it("returns null with no host at all", () => {
    assert.equal(requestOrigin(from({})), null);
  });
});
