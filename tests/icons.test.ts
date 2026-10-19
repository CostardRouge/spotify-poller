/**
 * The check contract C11 asks for: the icon set exists at the sizes claimed,
 * the touch icon carries no alpha channel, and the manifest points at files
 * that are there. It is the set that fails silently otherwise — every desktop
 * tab looks right while a phone shows a black-framed tile or a screenshot of
 * the page. Read straight from each PNG's IHDR chunk: no image library.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

const PUBLIC = join(__dirname, "..", "public");
const ICONS = join(PUBLIC, "icons");

/** Width, height and colour type from a PNG's IHDR chunk (2 RGB, 6 RGBA, 4 grey + alpha, 0 grey, 3 palette). */
function ihdr(file: string) {
  const bytes = readFileSync(join(ICONS, file));
  assert.equal(bytes.subarray(1, 4).toString("ascii"), "PNG", `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), colourType: bytes[25] };
}

describe("icon set", () => {
  it("ships an opaque 180×180 touch icon", () => {
    const touch = ihdr("apple-touch-icon.png");
    assert.deepEqual([touch.width, touch.height], [180, 180]);
    assert.ok(![4, 6].includes(touch.colourType), "the touch icon must carry no alpha channel");
  });

  for (const [file, size] of [
    ["icon-192.png", 192],
    ["icon-512.png", 512],
    ["icon-maskable-192.png", 192],
    ["icon-maskable-512.png", 512],
    ["favicon-32.png", 32],
    ["favicon-16.png", 16],
  ] as const) {
    it(`ships ${file} at ${size} px`, () => {
      const png = ihdr(file);
      assert.deepEqual([png.width, png.height], [size, size]);
    });
  }

  it("keeps the manifest's icons relative and pointing at files of the size claimed", () => {
    const manifest = JSON.parse(readFileSync(join(PUBLIC, "manifest.webmanifest"), "utf8")) as {
      display: string;
      icons: { src: string; sizes: string; type: string }[];
    };
    assert.equal(manifest.display, "standalone", "the state lives on the server, so a standalone launch loses nothing");
    for (const icon of manifest.icons) {
      assert.ok(!icon.src.startsWith("/"), `${icon.src} must be relative to the manifest's own address`);
      assert.ok(icon.src.startsWith("icons/"), `${icon.src} lives in public/icons`);
      if (icon.type !== "image/png") continue;
      const png = ihdr(icon.src.slice("icons/".length));
      assert.equal(`${png.width}x${png.height}`, icon.sizes, `${icon.src} is the size the manifest claims`);
    }
  });
});
