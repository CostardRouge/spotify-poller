# Verification, CI, the showcase pipeline

Read before relying on "the tests", touching a workflow under `.github/workflows/`, or the showcase.

## There is no automated test suite (2026-08-20)

Stated plainly because it is the thing an agent is most likely to assume wrong: `package.json` has no `test` script, there is no runner, and no CI job runs `lint` or `typecheck`. **What verification actually means here**: `npm run lint`, `npm run typecheck`, `npm run build`, plus — for collector or database work — the manual curl round-trips in `README.md`: idempotence (replay `played` twice, second run inserts 0), the backup/export/import round-trip (`grep -c refresh` on the NDJSON must return 0), and account isolation after connecting a second account. **How to apply**: run those three commands before calling a task finished, and never claim a change is "tested".

## `next lint` no longer exists (2026-08-20)

Next 16 removed it, so ESLint is invoked directly (`npm run lint` → `eslint .`) with a flat config that spreads `eslint-config-next` (`eslint.config.mjs`). The `ignores` block there also covers `site/` and `showcase/`, which are output and hand-written static HTML respectively.

## The pull request gate (2026-10-19)

**Decision** (the portfolio standard, C15): `.github/workflows/ci.yml` runs the gate — `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build` — on every pull request and every push to `main`, on the Node of `.nvmrc` (the exact 24.18.0; `deployment.md` says why a floating major would make this very job flaky) and on a named `ubuntu-24.04`. Until then only bookkeeping ran on a pull request — `registry.yml`'s `check` (the Registry block) and `release.yml`'s `check` (`CHANGELOG.md` against `package.json`'s version) — and a lint or type error reached `main`, caught only when `docker-build.yml` failed at `npm run build`, after the merge. **What the gate still does not cover**: the Docker image itself (the native better-sqlite3 build on Alpine — `docker-build.yml`, after the merge), the showcase pipeline (`pages.yml`, after the merge) and anything that needs a Spotify account. **How to apply**: a command `CLAUDE.md` calls part of the gate is in `ci.yml`, or `CLAUDE.md` stops calling it that. `next build` needs no environment variable — it passes with none: only `/login` is prerendered and it opens no database — so the job sets none; a change that makes the build read `.env` would turn the gate red and is the signal to look at, not to paper over with throwaway values like `pages.yml`'s.

## The showcase runs the real app against fixture data (2026-08-20)

**Decision**: `pages.yml` builds the app, migrates, seeds `scripts/seed-demo.ts`, starts the server, drives it with Playwright (`scripts/showcase-screenshots.mjs`) and publishes real screenshots to GitHub Pages. **Why**: the screenshots are of the actual UI, so they cannot drift from it — and no real Spotify credentials are involved (the workflow sets throwaway `SPOTIFY_CLIENT_ID=demo`, `ADMIN_TOKEN=showcase-demo-token`, etc. as plain env, which is safe precisely because they unlock nothing). One-time repo setup: Settings → Pages → Source "GitHub Actions".

**The trap** (`1fc6f95`): the screenshot script waits on **UI copy** — `page.waitForSelector("text=Run now")`, `getByLabel("Admin token")`, `getByRole("button", { name: "Payload" })`. Renaming a button or a label silently breaks the Pages deploy, and the failure appears in a workflow nobody was looking at. **How to apply**: when you rename visible control text, grep `scripts/showcase-screenshots.mjs` for the old string in the same change.

The script is runnable locally against a seeded instance (invocation in its header comment), and honours `CHROMIUM_PATH` so an environment with a pre-installed browser can skip `playwright install`.
