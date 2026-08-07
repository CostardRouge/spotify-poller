# Product

## Register

product

## Users

One person: the operator of a self-hosted homelab (Docker on an OptiPlex, or
bare-metal systemd). They are also the only end user of the data. Two distinct
contexts:

- **At the desk**, browsing collected history: filtering months of listens and
  likes, exporting NDJSON, checking a run that looked odd in the logs.
- **Away from the desk, on a phone**, answering one question fast: *is
  collection still alive, and did I lose anything?* Usually triggered by an
  ntfy push or a watchdog alert, often at an awkward hour.

The job to be done is custody of an irreplaceable stream. Spotify exposes only
the last 50 played tracks, so any window not collected in time is gone
permanently. The interface is the custody report.

## Product Purpose

A local dashboard over a SQLite database of a personal Spotify listening
history. It exists to (1) prove collection is running and current, (2) surface
declared gaps rather than let an empty day read as "listened to nothing", (3)
let the operator browse, filter and export what was collected, and (4) manage
Spotify account connections and their OAuth scopes.

Success: the operator can tell healthy from degraded in under two seconds, from
a phone, without reading a log.

## Brand Personality

Precise, unhurried, candid. It speaks like a good status page, not like a
product tour. It states what it knows, marks what it infers, and never rounds a
problem away. No exclamation marks, no celebration of routine success, no
apology copy.

Three words: **instrument, honest, quiet**.

## Anti-references

- **Grafana cosplay**: neon gauges, radial dials, sparkline walls, glowing
  panels. Decoration standing in for signal.
- **Spotify brand cosplay**: green as a background, album-art collages,
  Circular-alike display type. This is an admin tool over Spotify data, not a
  Spotify surface. Green means *healthy*, nothing else.
- **AI-SaaS dashboard**: hero metric cards with gradient accents, identical
  icon-heading-text card grids, an uppercase tracked eyebrow above every
  section.
- **The current UI's failure mode**: a monospace terminal dump where every
  value has the same weight, so nothing is legible at a glance.

## Design Principles

1. **Freshness before features.** The health of collection is the first thing
   on screen and is never more than one glance away, on any viewport.
2. **Looking is not collecting.** The account being *viewed* and the account
   being *collected* are different things; the UI states which is which
   everywhere they can be confused.
3. **Honest about what is inferred.** Completion ratios are sampled, gaps are
   declared, backfills are partial. Where a number is approximate, the
   interface says so instead of implying precision.
4. **Phone-complete.** Every operator action (check health, run a collector,
   reconnect, read a gap) is reachable on a 360px screen. Tables reflow into
   records, not horizontal scroll.
5. **Earned familiarity.** Standard affordances only. Native form controls,
   native dialogs, real focus rings. Nothing invented for flavor.

## Accessibility & Inclusion

- WCAG 2.2 AA: body text ≥4.5:1, large text and non-text UI ≥3:1, in both
  themes. Placeholders held to the body-text ratio.
- Keyboard-complete: every action reachable without a pointer; visible
  `:focus-visible` rings; `Esc` closes every overlay; command palette on ⌘K.
- No state carried by color alone. Every status dot is paired with a word.
- `prefers-reduced-motion: reduce` removes all transforms and shimmer; nothing
  is gated behind an animation, so a suppressed animation never hides content.
- `prefers-color-scheme` honored, with a persisted manual override.
