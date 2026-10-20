# Frontend — pages, components, styling

Read before touching a page under `app/(dashboard)/`, a component, `app/globals.css`, the theme, or the keyboard surface.

## `PRODUCT.md` is the review standard, not a mood board (2026-08-20)

Read it before any UI work. It fixes the tone (**instrument, honest, quiet**), the named anti-references (Grafana cosplay, Spotify brand cosplay, AI-SaaS card grids, and the old monospace terminal dump where everything had equal weight), the five design principles, and a WCAG 2.2 AA floor. **How to apply**: the maintainer reviews against it. Two principles bite most often — *freshness before features* (collection health is never more than one glance away, on any viewport) and *phone-complete* (every operator action reachable at 360 px; tables reflow into records, never horizontal scroll).

## Design tokens are OKLCH custom properties, carried over verbatim (2026-08-20)

**Decision** (`1e50407`): `app/globals.css` defines a green-tinted OKLCH palette as CSS custom properties on top of Tailwind 4, copied from the pre-Next.js UI rather than redesigned during the migration. Light by default, dark under `prefers-color-scheme`, both overridden by `[data-theme]` on `<html>` so a manual choice wins **in both directions**. **Why**: the migration was meant to change the framework, not the design — several commits (`1e50407`, `45580c0`, `66705df`) were spent restoring the original look after it drifted. **How to apply**: style through the tokens (`--ink-2`, `--surface-2`, `--ok`, `--warn`…), not with ad-hoc Tailwind colour classes. The `--panel`-style aliases exist for components written against older names; the block above them is the single source of truth.

**Green means healthy, nothing else** — never decoration, and never a Spotify brand cue. `--ink-3` is annotated as ≥18 px or non-text only; `--ink-2` is the AA-safe body secondary. Respect those annotations, they encode the contrast audit.

## No state carried by colour alone (2026-08-20)

Every status dot is paired with a word (`PRODUCT.md`, `components/StatusPill.tsx`, the sidebar health chip). A new indicator that is only a coloured dot will be rejected.

## The keyboard surface is part of the product (2026-08-20)

⌘K command palette, `1`…`7` to jump to a section, `/` focuses the events search, `T` cycles the theme, `R` refreshes, `?` lists shortcuts, `Esc` closes every overlay. Native `<dialog>` is used for overlays (the event payload inspector, settings, shortcuts) — "earned familiarity": standard affordances only, nothing invented for flavour. **How to apply**: adding a section means adding it to the palette and to the numbered jumps, or the surface silently becomes inconsistent.

## The theme read is deliberately deferred past first render (2026-08-20)

`eslint.config.mjs` downgrades `react-hooks/set-state-in-effect` to `warn` for exactly one reason: `ThemeToggle`'s one-time `localStorage` read in a `useEffect`. Reading `localStorage` during render would crash server-side and desync client/server HTML, so the deferred read is the correct pattern — the rule (eslint-plugin-react-hooks v7, pulled in by eslint-config-next 16) has no case for it yet. **How to apply**: do not "fix" the warning by moving the read into render, and do not silence the rule repo-wide beyond this.

## The icon set and the web manifest (2026-10-19)

**Decision** (the portfolio standard, C11): the dashboard ships the whole set under `public/icons/` — three SVG sources (`icon.svg` the rounded tile, `icon-apple.svg` and `icon-maskable.svg` full-bleed) and the PNGs `scripts/gen-icons.mjs` rasterises from them with `sharp`, which is already in `node_modules` as an optional dependency of Next (never a dependency of this project; `npm i --no-save sharp` if it ever goes). `app/layout.tsx` declares them through `metadata.icons`, `metadata.manifest` and `appleWebApp.title`; `public/manifest.webmanifest` is a static file with **relative** paths, `display: standalone` because the state lives on the server (a standalone home-screen launch loses nothing, unlike Atelier's browser-held projects), and `theme_color` / `background_color` set to the light `--bg` as hex, `#f8faf9` — the same value `viewport.themeColor` declares, so the two move together with `app/globals.css`. **Why**: iOS builds a home-screen icon from `apple-touch-icon` alone, a PNG, square and opaque (a transparent corner is composited onto black), and ignores `rel="icon"` whatever its type; the SVG favicon that was the whole set until now gave a phone a screenshot of the login page. **Two choices to know about**: `short_name` and the iOS title are `Poller`, not `spotify-poller` — a launcher cuts a label past about twelve characters, and a truncated name reads as a defect; the owner may prefer the full name and accept the cut. And the auth gate leaves `/icons/*` and `/manifest.webmanifest` out of its matcher (`auth.md`). **How to apply**: edit a source, run the generator, commit the PNGs with it; `tests/icons.test.ts` holds the sizes, the touch icon's missing alpha and the manifest's paths, so a forgotten regeneration fails the gate. The showcase on GitHub Pages reuses the same files (`pages.yml` copies `public/icons`), with the SVG sources as its favicon.

## `allowedDevOrigins` is set for a reason (2026-08-20)

`next.config.mjs` lists `localhost` and `127.0.0.1` (`5c46819`). Next 16 blocks cross-origin dev requests otherwise, which breaks the dev container reached from the host.

## Mobile is a different layout, not a narrower one (2026-08-20)

On phones the sidebar folds into a bottom tab bar with a "More" sheet carrying the remaining sections, the run actions, settings and the account selector — so no operator action is desktop-only. `components/BottomNav.tsx`. This implements the *phone-complete* principle and is the thing to check when adding any action to the sidebar.

## The Listening page: every chart is a link, and no client JavaScript (2026-08-21)

**Decision**: `/listening` renders server-side and cross-filters through the **query string** — every bar, heatmap cell, calendar square and ranked row is an `<a>` whose href is "the current filter, with one thing changed" (`link()` in `app/(dashboard)/listening/page.tsx`), and the only form is a plain `method="get"`. **Why**: the interesting questions are intersections ("Sunday nights", "techno in the morning"), and a link-based filter gives them for free — bookmarkable, reload-proof, back-button-correct, no hydration, no chart library. **How to apply**: a new facet is a field on `ListeningFilter`, a branch in `filterToParams`, a chip in the page's `facets` list and a hidden input in the form (otherwise clicking Apply silently drops it). A 2-D control toggles as a **pair**: toggling each axis separately makes clicking a Sunday cell *unpin* Sunday when Sunday is already selected.

## Volume is drawn in neutral ink, never in the accent (2026-08-21)

**Decision**: bars, heatmap cells and calendar squares scale `color-mix(in oklab, var(--ink) N%, var(--surface-2))`; the accent marks only what is **selected**, and a selected item is additionally underlined. **Why**: `PRODUCT.md` reserves green for *healthy*, so a green heat ramp would be asserting something false about a busy Tuesday, and a Grafana-style ramp is a named anti-reference. The underline is what keeps the selection from being carried by colour alone. **How to apply**: same rule for any future density view.

## Zero-based axes, with the numbers printed under short ones (2026-08-21)

Weekday and month bars sit within a few percent of each other, so the shape says nothing. The fix is `showValues` on `BarChart` (the count under each tick), **not** a cropped axis — truncating the baseline to dramatise a 5% difference is exactly the dishonesty `PRODUCT.md` rules out.

## Section shortcuts are appended, never renumbered (2026-08-21)

`/listening` became jump key **8** rather than taking a lower number matching the sidebar order. The 1…7 mapping predates the Next.js UI and is muscle memory; the sidebar and the jump list have never matched, and reordering costs more than the consistency is worth (`components/CommandPalette.tsx`). Adding a section still means: sidebar `NAV`, `BottomNav` MORE_LINKS, palette `SECTIONS`, the jump array, `ShortcutsDialog`'s range and `Topbar`'s `TITLES`.
