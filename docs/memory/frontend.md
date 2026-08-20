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

## `allowedDevOrigins` is set for a reason (2026-08-20)

`next.config.mjs` lists `localhost` and `127.0.0.1` (`5c46819`). Next 16 blocks cross-origin dev requests otherwise, which breaks the dev container reached from the host.

## Mobile is a different layout, not a narrower one (2026-08-20)

On phones the sidebar folds into a bottom tab bar with a "More" sheet carrying the remaining sections, the run actions, settings and the account selector — so no operator action is desktop-only. `components/BottomNav.tsx`. This implements the *phone-complete* principle and is the thing to check when adding any action to the sidebar.
