#!/usr/bin/env node
/**
 * Rasterises the home-screen and favicon PNGs from the three SVG sources in
 * public/icons/, and the result is committed (COMMON-PROJECT-SPEC, C11).
 *
 * Why PNGs at all: an SVG favicon is enough for a desktop tab and for nothing
 * else. iOS builds a home-screen icon from <link rel="apple-touch-icon">
 * alone — a PNG, square, opaque — and ignores rel="icon" whatever its type;
 * with no such link it screenshots the page instead. Android's launcher wants
 * the manifest's 192/512 PNGs, plus a maskable pair so its own shape mask
 * never clips the drawing. A server could rasterise on request; the showcase
 * on GitHub Pages cannot, and one committed set serves both.
 *
 * Also draws public/og.png, the 1200 × 630 link-preview card, from
 * scripts/og-card.svg (see the end of the file).
 *
 * Usage:  node scripts/gen-icons.mjs
 *
 * sharp is an optional dependency of Next.js and is already in node_modules;
 * should that ever change, `npm i --no-save sharp` installs it for one run —
 * deliberately never a dependency of this project, so CI pays no native
 * install for a script run by hand. Re-run after editing a source, and commit
 * the PNGs in the same commit: the SVG is not what ships to a phone.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ICONS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");

/** The tile's own green: what a transparent pixel is painted onto where alpha is dropped. */
const TILE = "#1db954";

/**
 * `flatten` + `removeAlpha` drop the alpha channel, for the touch icon only:
 * iOS composites a transparent pixel onto BLACK, so an icon with rounded
 * corners of its own comes back framed in a dark vignette under Apple's mask.
 * The rounded tile keeps its transparent corners everywhere else.
 *
 * @type {{ src: string; out: string; size: number; opaque?: boolean; why: string }[]}
 */
const JOBS = [
  // Manifest "any" icons — Chrome/Android install, the tab on high-DPI.
  { src: "icon.svg", out: "icon-192.png", size: 192, why: "manifest, any" },
  { src: "icon.svg", out: "icon-512.png", size: 512, why: "manifest, any + splash" },
  // Maskable pair — Android adaptive launcher shapes.
  { src: "icon-maskable.svg", out: "icon-maskable-192.png", size: 192, why: "manifest, maskable" },
  { src: "icon-maskable.svg", out: "icon-maskable-512.png", size: 512, why: "manifest, maskable" },
  // The one iOS reads. 180 is what current iPhones ask for; iOS downsamples
  // for every other slot, so a single size is enough.
  { src: "icon-apple.svg", out: "apple-touch-icon.png", size: 180, opaque: true, why: "iOS home screen" },
  // Raster favicons, for the browsers that still prefer one to the SVG.
  { src: "icon.svg", out: "favicon-32.png", size: 32, why: "tab" },
  { src: "icon.svg", out: "favicon-16.png", size: 16, why: "tab" },
];

for (const job of JOBS) {
  const svg = readFileSync(join(ICONS_DIR, job.src));
  let pipeline = sharp(svg, { density: 384 }).resize(job.size, job.size);
  if (job.opaque) pipeline = pipeline.flatten({ background: TILE }).removeAlpha();
  await pipeline.png().toFile(join(ICONS_DIR, job.out));
  console.log(`✓ ${job.out} (${job.size}×${job.size}) — ${job.why}`);
}

// The link-preview card (OpenGraph / Twitter), 1200 × 630, the size every
// preview fetcher crops to without surprise. Its source sits in scripts/, not
// public/, because only the PNG is served. The app declares it in
// app/layout.tsx; pages.yml copies it beside the showcase, whose og:image it
// also is. Opaque like the touch icon: a preview drawn on a dark chat theme
// would otherwise show the transparent margin as black.
{
  const svg = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "og-card.svg"));
  await sharp(svg, { density: 144 })
    .resize(1200, 630)
    .flatten({ background: "#f8fbf9" })
    .removeAlpha()
    .png({ compressionLevel: 9 })
    .toFile(join(ICONS_DIR, "..", "og.png"));
  console.log("✓ ../og.png (1200×630) — link previews");
}

console.log("Done. Commit the PNGs alongside the SVG you changed.");
