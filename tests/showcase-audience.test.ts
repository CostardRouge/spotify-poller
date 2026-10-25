/**
 * The showcase's audience measurement (2026-10-25) held to its legal notice. showcase/index.html is hand-written and
 * copied as it is by pages.yml, so the Umami loader in its <head> is the one place the website id lives; this suite
 * checks that the loader carries the id, the owner's host and the decline rules, that the page loads nothing else,
 * and that the notice says what the code does — host, what is collected, Do Not Track, Global Privacy Control, the
 * switch and its key. A change to what is measured fails here until the notice says the same.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const PAGE = readFileSync(join(ROOT, "showcase", "index.html"), "utf8");

const WEBSITE_ID = "01ad0e3e-34af-4318-aede-894518182361";
const HOST = "insight.steevepommier.com";

const scripts = [...PAGE.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map(([, attrs, body]) => ({ attrs, body }));
const loader = scripts.find(({ attrs }) => attrs.includes("data-umami-loader"))?.body ?? "";
const toggle = scripts.find(({ attrs }) => attrs.includes("data-umami-switch"))?.body ?? "";

/** The notice's visible text: scripts, styles, comments and tags left out. */
const legal = (/<section class="legal"[\s\S]*?<\/section>/.exec(PAGE)?.[0] ?? "")
  .replace(/<!--[\s\S]*?-->/g, "")
  .replace(/<[^>]+>/g, " ")
  .replace(/\s+/g, " ");

describe("showcase audience measurement", () => {
  it("loads exactly two inline scripts, the loader and the switch, and no other external resource", () => {
    assert.equal(scripts.length, 2);
    assert.ok(loader && toggle, "the loader and the switch are both there");
    for (const { attrs } of scripts) assert.doesNotMatch(attrs, /\bsrc=/, "no script tag loads a file itself");
    // Every external address the page fetches by itself: only the tracker, set by the loader.
    const fetched = [...PAGE.matchAll(/\b(?:src|href)="(https?:\/\/[^"]+)"/g)].map(([, url]) => url);
    for (const url of fetched) {
      assert.ok(!/\.(js|css|woff2?)(\?|$)/.test(url), `${url} is not a resource the page loads`);
    }
    assert.doesNotMatch(PAGE, /<link[^>]+rel="(stylesheet|preload|preconnect|modulepreload)"/);
    assert.doesNotMatch(PAGE, /<iframe\b/);
  });

  it("carries the website id once, the owner's host and its /insight path", () => {
    assert.equal(PAGE.split(WEBSITE_ID).length - 1, 1, "the id lives in one place");
    assert.match(loader, new RegExp(`const WEBSITE_ID = "${WEBSITE_ID}"`));
    assert.match(loader, /const SRC = "https:\/\/insight\.steevepommier\.com\/insight"/);
    assert.doesNotMatch(loader, /script\.js/);
    assert.match(loader, /if \(!WEBSITE_ID\) return;/, "an empty id is the kill switch");
    assert.match(loader, /s\.defer = true/);
  });

  it("loads nothing for a visitor who declines", () => {
    assert.match(loader, /doNotTrack/);
    assert.match(loader, /globalPrivacyControl === true/);
    assert.match(loader, /localStorage\.getItem\("umami\.disabled"\)/);
    assert.ok(
      loader.indexOf("umami.disabled") < loader.indexOf("createElement"),
      "the decline checks run before the tag is made",
    );
  });

  it("asks the tracker to honour Do Not Track, to count only on GitHub Pages and to drop query and fragment", () => {
    assert.match(loader, /"data-do-not-track", "true"/);
    assert.match(loader, /const DOMAINS = "costardrouge\.github\.io"/);
    assert.match(loader, /"data-domains", DOMAINS/);
    assert.match(loader, /"data-exclude-search", "true"/);
    assert.match(loader, /"data-exclude-hash", "true"/);
  });

  it("sends no event and no data beyond the automatic page view", () => {
    assert.doesNotMatch(PAGE, /umami\.track\s*\(|data-umami-event|data-auto-track="false"/);
  });

  it("the switch sets and clears the tracker's own opt-out key, on the hosts the tag lists", () => {
    assert.match(toggle, /const KEY = "umami\.disabled"/);
    assert.match(toggle, /storage\.setItem\(KEY, "1"\)/);
    assert.match(toggle, /storage\.removeItem\(KEY\)/);
    assert.match(toggle, /const DOMAINS = \["costardrouge\.github\.io"\]/);
    assert.match(PAGE, /<button type="button" id="audience-toggle"/);
  });

  it("the legal notice says what the code does", () => {
    assert.ok(legal.includes(HOST), "names the host where the data is gathered");
    assert.match(legal, /Umami/);
    assert.match(legal, /self-hosted/);
    for (const fact of [
      "the page viewed",
      "the referrer",
      "your browser",
      "your operating system",
      "device type",
      "country, derived from your IP address",
      "No event is sent",
      "no cookie is set",
      "no personal data is collected",
      "your IP address is not stored",
      "Do Not Track",
      "Global Privacy Control",
      "umami.disabled",
      "nothing is sent",
      "costardrouge.github.io",
    ]) {
      assert.ok(legal.includes(fact), `the notice says "${fact}"`);
    }
    assert.doesNotMatch(legal, /loads no tracker|nobody counts your visit/);
  });

  it("the footer links to the notice and its switch", () => {
    const footer = /<footer>[\s\S]*?<\/footer>/.exec(PAGE)?.[0] ?? "";
    assert.match(footer, /href="#legal"/);
    assert.match(footer, /href="#audience-switch"/);
  });
});
