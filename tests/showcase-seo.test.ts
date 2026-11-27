/**
 * The showcase as search and answer engines read it: its structured data and
 * its link-preview card, held to the canonical address and to what pages.yml
 * actually copies. A moved address or a dropped copy step fails here instead
 * of in a preview nobody looks at.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const PAGE = readFileSync(join(ROOT, "showcase", "index.html"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");
const CANONICAL = /<link rel="canonical" href="([^"]+)"/.exec(PAGE)?.[1] ?? "";

describe("showcase metadata", () => {
  it("carries one JSON-LD block that parses and names the canonical address", () => {
    const blocks = [...PAGE.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    assert.equal(blocks.length, 1);
    const data = JSON.parse(blocks[0][1]) as Record<string, unknown>;
    assert.equal(data["@context"], "https://schema.org");
    assert.equal(data["@type"], "SoftwareApplication");
    assert.equal(data.url, CANONICAL);
    assert.equal(data.image, `${CANONICAL}og.png`);
    assert.equal(data.codeRepository, "https://github.com/CostardRouge/spotify-poller");
  });

  it("previews with the card pages.yml copies, at the size it declares", () => {
    const og = /<meta property="og:image" content="([^"]+)"/.exec(PAGE)?.[1];
    const tw = /<meta name="twitter:image" content="([^"]+)"/.exec(PAGE)?.[1];
    assert.equal(og, `${CANONICAL}og.png`);
    assert.equal(tw, og);
    assert.match(PAGE, /<meta property="og:image:width" content="1200" \/>/);
    assert.match(PAGE, /<meta property="og:image:height" content="630" \/>/);
    assert.match(WORKFLOW, /cp public\/og\.png site\/og\.png/);
  });
});
