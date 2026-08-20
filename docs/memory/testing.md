# Verification, CI, the showcase pipeline

Read before relying on "the tests", touching a workflow under `.github/workflows/`, or the showcase.

## There is no automated test suite (2026-08-20)

Stated plainly because it is the thing an agent is most likely to assume wrong: `package.json` has no `test` script, there is no runner, and no CI job runs `lint` or `typecheck`. **What verification actually means here**: `npm run lint`, `npm run typecheck`, `npm run build`, plus — for collector or database work — the manual curl round-trips in `README.md`: idempotence (replay `played` twice, second run inserts 0), the backup/export/import round-trip (`grep -c refresh` on the NDJSON must return 0), and account isolation after connecting a second account. **How to apply**: run those three commands before calling a task finished, and never claim a change is "tested".

## `next lint` no longer exists (2026-08-20)

Next 16 removed it, so ESLint is invoked directly (`npm run lint` → `eslint .`) with a flat config that spreads `eslint-config-next` (`eslint.config.mjs`). The `ignores` block there also covers `site/` and `showcase/`, which are output and hand-written static HTML respectively.

## The only merge-gating CI is the image build (2026-08-20)

`.github/workflows/docker-build.yml` runs on push to `main` and builds/pushes the GHCR image; `.github/workflows/pages.yml` builds the showcase. Both run **after** merge, not on pull requests — nothing blocks a merge, so a lint or type error reaches `main` and is only caught when the Docker build fails at `npm run build`. **Inferred from the two workflow files and the absence of any other; unconfirmed with the maintainer** whether that is deliberate.

## The showcase runs the real app against fixture data (2026-08-20)

**Decision**: `pages.yml` builds the app, migrates, seeds `scripts/seed-demo.ts`, starts the server, drives it with Playwright (`scripts/showcase-screenshots.mjs`) and publishes real screenshots to GitHub Pages. **Why**: the screenshots are of the actual UI, so they cannot drift from it — and no real Spotify credentials are involved (the workflow sets throwaway `SPOTIFY_CLIENT_ID=demo`, `ADMIN_TOKEN=showcase-demo-token`, etc. as plain env, which is safe precisely because they unlock nothing). One-time repo setup: Settings → Pages → Source "GitHub Actions".

**The trap** (`1fc6f95`): the screenshot script waits on **UI copy** — `page.waitForSelector("text=Run now")`, `getByLabel("Admin token")`, `getByRole("button", { name: "Payload" })`. Renaming a button or a label silently breaks the Pages deploy, and the failure appears in a workflow nobody was looking at. **How to apply**: when you rename visible control text, grep `scripts/showcase-screenshots.mjs` for the old string in the same change.

The script is runnable locally against a seeded instance (invocation in its header comment), and honours `CHROMIUM_PATH` so an environment with a pre-installed browser can skip `playwright install`.
