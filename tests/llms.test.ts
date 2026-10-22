/**
 * showcase/llms.txt (COMMON-PROJECT-SPEC C17, the llmstxt.org format) is a
 * hand-written file beside a hand-written page: nothing generates either, so
 * this suite is what keeps the one from drifting away from the other. Every
 * link it names must land on something the showcase really publishes — the
 * page's canonical address, an anchor the page carries, a screenshot the page
 * shows — or on a file this repository really has; and pages.yml must copy it
 * to the site's root, or crawlers never find it.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const ROOT = join(__dirname, "..");
const LLMS = readFileSync(join(ROOT, "showcase", "llms.txt"), "utf8");
const PAGE = readFileSync(join(ROOT, "showcase", "index.html"), "utf8");
const WORKFLOW = readFileSync(join(ROOT, ".github", "workflows", "pages.yml"), "utf8");

const REPO = "https://github.com/CostardRouge/spotify-poller";

/** The showcase's own address, read from the page rather than repeated here. */
const CANONICAL = /<link rel="canonical" href="([^"]+)"/.exec(PAGE)?.[1];

/** Every `- [Title](url): description` line, the format's only kind of link. */
const links = [...LLMS.matchAll(/^- \[([^\]]+)\]\(([^)]+)\): (.+)$/gm)].map(([, title, url, what]) => ({
  title,
  url,
  what,
}));

describe("showcase llms.txt", () => {
  it("opens with an H1, a one-sentence blockquote and a paragraph", () => {
    const lines = LLMS.split("\n");
    assert.equal(lines[0], "# spotify-poller");
    assert.equal(lines[1], "");
    assert.match(lines[2], /^> \S.*\.$/);
    assert.equal(lines[3], "");
    assert.ok(lines[4].length > 0 && !lines[4].startsWith("#"), "a paragraph follows the summary");
  });

  it("lists every link in the llmstxt.org shape, under an H2", () => {
    const listed = LLMS.split("\n").filter((line) => line.startsWith("- "));
    assert.ok(listed.length > 0);
    assert.equal(listed.length, links.length, "every list item is `- [Title](url): what it is`");
    assert.ok(/^## /m.test(LLMS));
    for (const { url } of links) assert.match(url, /^https:\/\//, `${url} is absolute`);
  });

  it("links the showcase at the page's own canonical address", () => {
    assert.ok(CANONICAL, "index.html declares a canonical address");
    assert.ok(links.some(({ url }) => url === CANONICAL));
  });

  it("names only anchors and files the showcase page really carries", () => {
    for (const { url } of links.filter(({ url }) => CANONICAL && url.startsWith(CANONICAL))) {
      const rest = url.slice((CANONICAL as string).length);
      if (rest === "") continue;
      if (rest.startsWith("#")) {
        assert.ok(PAGE.includes(`id="${rest.slice(1)}"`), `index.html carries the anchor ${rest}`);
      } else {
        assert.ok(PAGE.includes(`src="${rest}"`), `index.html shows ${rest}`);
      }
    }
  });

  it("links the legal notice", () => {
    assert.ok(links.some(({ url }) => url === `${CANONICAL}#legal`));
  });

  it("names only files this repository has, and the repository itself", () => {
    assert.ok(links.some(({ url }) => url === REPO));
    for (const { url } of links.filter(({ url }) => url.startsWith(`${REPO}/blob/main/`))) {
      const file = url.slice(`${REPO}/blob/main/`.length);
      assert.ok(existsSync(join(ROOT, file)), `${file} exists in the repository`);
    }
    for (const { url } of links.filter(({ url }) => url.startsWith("https://github.com/"))) {
      assert.ok(url.startsWith(REPO), `${url} points into this repository`);
    }
  });

  it("is copied to the site's root by pages.yml", () => {
    assert.match(WORKFLOW, /cp showcase\/llms\.txt site\//);
  });
});
