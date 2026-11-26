/**
 * The installed-app and link-preview surface (2026-11-26): what fails silently
 * in a desktop browser and only shows on a phone or in a chat — a shortcut to a
 * missing icon, a preview card of the wrong size, a static file the auth gate
 * turns into a login redirect, a worker that starts caching pages. Read from
 * the files themselves, no server needed.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const PUBLIC = join(ROOT, "public");

/** Width, height and colour type from a PNG's IHDR chunk. */
function ihdr(path: string) {
  const bytes = readFileSync(path);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("installed app", () => {
  const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
    shortcuts: { name: string; url: string; icons: { src: string }[] }[];
  };

  it("points every shortcut at a dashboard section and an icon that exists, relative to the manifest", () => {
    assert.ok(manifest.shortcuts.length > 0 && manifest.shortcuts.length <= 4, "Android shows four at most");
    for (const s of manifest.shortcuts) {
      assert.ok(!s.url.startsWith("/"), `${s.name}: relative, like start_url`);
      assert.ok(existsSync(join(ROOT, "app", "(dashboard)", s.url, "page.tsx")), `${s.name}: /${s.url} is a page`);
      for (const icon of s.icons) assert.ok(existsSync(join(PUBLIC, icon.src)), `${icon.src} exists`);
    }
  });

  it("ships a 1200×630 opaque link-preview card", () => {
    const og = ihdr(join(PUBLIC, "og.png"));
    assert.deepEqual([og.width, og.height], [1200, 630]);
    assert.ok(![4, 6].includes(og.colourType), "no alpha: a dark chat theme would show it as black");
  });

  it("keeps the files fetched without a session outside the auth gate, and nothing else", () => {
    const source = readFileSync(join(ROOT, "proxy.ts"), "utf8");
    const pattern = /matcher:\s*\["([^"]+)"\]/.exec(source)?.[1];
    assert.ok(pattern, "proxy.ts declares one matcher");
    const gated = (path: string) => new RegExp(`^${pattern}$`).test(path);
    for (const path of ["/sw.js", "/offline.html", "/robots.txt", "/og.png", "/manifest.webmanifest", "/icons/icon-192.png"]) {
      assert.equal(gated(path), false, `${path} is served without a session`);
      assert.ok(existsSync(join(PUBLIC, path)), `${path} is a static file in public/`);
    }
    for (const path of ["/", "/events", "/gaps", "/api/status", "/api/export"]) {
      assert.equal(gated(path), true, `${path} stays behind the gate`);
    }
  });

  it("has a worker that caches the offline page and nothing else", () => {
    const sw = readFileSync(join(PUBLIC, "sw.js"), "utf8");
    assert.match(sw, /offline\.html/);
    assert.doesNotMatch(sw, /\.put\(|addAll\(/, "a cached report would show a stale verdict when the server is down");
    assert.match(sw, /request\.mode !== "navigate"/, "only page loads are intercepted");
  });

  it("asks crawlers to stay out of a private instance", () => {
    assert.match(readFileSync(join(PUBLIC, "robots.txt"), "utf8"), /^User-agent: \*\nDisallow: \/$/m);
  });
});
