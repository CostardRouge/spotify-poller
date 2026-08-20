# Instructions for LLM agents (Claude Code, Codex, Cursor, etc.)

Agents read this file at the start of every session. These rules override the agent's default behaviour and apply for the whole session, not only the first turn.

## Context

- Self-hosted Spotify listening-history collector: **Next.js 16** (App Router) + **React 19** + **Tailwind CSS 4** on **better-sqlite3**, TypeScript strict, run under Node ≥ 20.9 and pinned to **24.18.0** in both Dockerfiles. Deploys as a single container — image built and pushed to GHCR by `.github/workflows/docker-build.yml` on every push to `main`, pulled by the Home Lab stack (`docker-compose.prod.yml`); a GitHub Pages showcase is built by `.github/workflows/pages.yml`. Package manager: **npm** — the lockfile is `package-lock.json`.
- Verification commands that actually exist: `npm run build` (`next build`), `npm run lint` (ESLint flat config, invoked directly — `next lint` was removed in Next 16), `npm run typecheck` (`tsc --noEmit`). **There is no automated test suite**: the acceptance checks are the curl round-trips in `README.md`, run by hand. Operational scripts run through `tsx` without a build step: `npm run migrate`, `run:played`, `run:liked`, `backup`, `export`, `import`, `seed:demo`. `make help` lists the Docker equivalents.
- Several agent sessions may run **in parallel** on this repo. Git history must stay readable: **one commit = one task**.
- **Local sessions: never `git push`** — the developer tests locally and pushes himself. **Cloud / web sessions (ephemeral container): push the working branch and open a pull request**, it is the only way the code gets out. Never push to `main` either way.

## Rule 1 — Automatic commit at the end of every task (MANDATORY)

As soon as a task requested by the user is finished (feature, fix, refactor, content…), the agent MUST create a commit before handing back. No need to ask permission: it is the expected behaviour.

### Exact procedure

1. **Check the state**: `git status --porcelain` and `git diff --stat`.
2. **Select only the task's files**:
   - Stage file by file with `git add <path>` (never `git add -A`, `git add .` or `git commit -a`).
   - A modified file unrelated to the task (parallel session, tooling noise) stays **unstaged**. Do not touch it, stash it or reset it.
   - If one file holds changes from this task AND another, prefer `git add -p <file>` to stage only the relevant hunks. If inextricable, stage the whole file and say so in the commit body ("also contains …").
   - Never stage: `.env` and any secret file, `.idea/`, `.vscode/`, `.next/`, `data/`, `backups/`, `site/`, `tsconfig.tsbuildinfo`, `node_modules/`, `.DS_Store` — unless the task is explicitly about them. A `.db` snapshot or an `.ndjson` export carries the Spotify refresh token in clear and is as sensitive as `.env`; it never goes near the index. If one of these turns out to be *tracked*, say so: it must be untracked and gitignored, not carefully avoided at every commit.
   - Check with `git diff --cached --stat` before committing.
3. **Commit with a readable message** (format below). Always use a HEREDOC to keep title + body:

   ```bash
   git commit -m "$(cat <<'EOF'
   Imperative title, ≤ 72 characters, no trailing period

   Why this change, what it does concretely, non-obvious decisions.
   One line per idea. Mention the files/areas touched if useful.

   Co-Authored-By: <model name> <noreply@anthropic.com>
   EOF
   )"
   ```

4. Do not push (local sessions). End the reply with a recap: short hash + commit title + the list of files that were modified but deliberately left uncommitted, if any, so the user knows where every change comes from.
5. If a git hook changes or refuses something: read the output, fix, recommit. Never `--no-verify`.

### Commit message format

- Title: English imperative, clear sentence, ≤ 72 chars, no `feat:`-style prefix, no trailing period. Real examples from this repo: `Pin Node to 24.18.0: the floating tag shipped the crash behind the 502s`, `Stop /api/export from starving the server, and stop timers dying silently`.
- Blank line, then a body, mandatory whenever the title is not enough: the why, the how in 2–6 lines, the trade-offs, what remains to do. The body is what lets someone find, weeks later, which feature produced this diff.
- A commit never mixes two tasks. If a session handles several distinct tasks, make several successive commits.
- No empty commit, no "WIP" commit, no commit for an unfinished task. If the task is interrupted, leave the work uncommitted and say so.

### When is a task "finished"?

- The requested code is written and verified — `npm run lint` and `npm run typecheck` green, `npm run build` when the change touches the app, or a visual check in the browser if it is rendering. There is no test suite to lean on: verification is those three commands plus, for collector or database work, the round-trips in `README.md` (idempotence, export/import, account isolation).
- A plain question, an exploration or an explanation produces no commit (nothing to commit).

## Rule 2 — Project memory in `MEMORY.md` + `docs/memory/` (MANDATORY)

The repo carries its own long-term memory, read locally and in the cloud alike:

- `MEMORY.md` at the root — the index, imported below and therefore loaded every session: how to maintain the memory, how the maintainer works, direction and decisions at a glance, open items, and a table of topic files.
- `docs/memory/<topic>.md` — one file per area, loaded on demand. Not imported here on purpose: the split keeps the per-session prompt small.

Obligations:

- Read `MEMORY.md`, then the topic file(s) for the area you are about to touch, before acting — to understand previous choices and not re-propose what was rejected. The table at the bottom of `MEMORY.md` maps areas to files.
- Every task writes to memory by default. At the end of each task (feature, fix, refactor, content, and any exploration that learned something), ask: "what should a future agent know that is neither in the code nor in `git log`?" — decisions and their reasons, rejected options, traps and remedies, working preferences. Write it in the matching topic file (update the existing entry first; delete what became false; add a short dated decision → why → how to apply entry otherwise), and update the index if a cross-cutting decision, an open item or a new topic file is involved. If, exceptionally, there is nothing worth keeping, say so explicitly in the final message ("no memory update: …") — silence is not an option.
- The memory update is part of the task: it is staged in the same commit (rule 1).
- Memory is written in English, dense and factual; no session narration, no duplication of what the code, `git log` or this file already say; each fact stated once, cross-referenced by file name elsewhere.
- The project command `/memorize` (`.claude/commands/memorize.md`) does this consolidation on demand over a whole conversation.

@MEMORY.md

## Verification — trust the disk, not the context

- A tool answering "success" is not proof. Before saying a change is done, prove it through the repo: `git status --porcelain`, `git diff`, `grep` for the expected value, `git show HEAD:<file>` compared to the file on disk.
- What you hold in context (an earlier `Read`, an old `ls`, a summarised conversation) can be stale: it has produced sessions where `Edit` reported success while nothing changed on disk, and where an agent described a tree that had not existed for weeks. Signature: `git status` clean right after an announced change. Re-read from disk before concluding.
- Never state an absence ("this feature is missing", "that file does not exist") without a `git`/`grep` check made in the current turn.

## Other rules

- Never rewrite history (`rebase -i`, `commit --amend`, `reset --hard`, `push --force`, `filter-repo`) without an explicit request.
- Do not modify `.git/config`, the hooks or branch settings.
- **The Node version in `Dockerfile` and `Dockerfile.dev` is pinned on purpose, not by inertia.** node 24.19.0 crashes better-sqlite3 (nodejs/node#63642). Do not bump it, or float it back to `node:24-alpine`, as a side effect of another change; both files must move together, and only after checking that issue is fixed in the target release.
- **The database is irreplaceable.** Spotify only ever returns the last 50 plays. Never write a migration or a code path that drops, rewrites or de-duplicates rows in `events`, `raw_spotify`, `gaps` or `poller_runs` without saying so explicitly and loudly. Schema changes go in a new numbered file under `migrations/` — never by editing an existing one, which has already run on the maintainer's database.
- **Every collected table is partitioned by `account_id`**; the primary key is the pair, not the id alone. A new query, endpoint or table that forgets the account scope silently mixes two people's history — see `docs/memory/data-model.md`.
- Before touching the UI, read `PRODUCT.md`: it fixes the tone (instrument, honest, quiet), the anti-references and the accessibility floor, and it is the standard the maintainer reviews against.
- The `docs/*.md` decision records (`accounts.md`, `scheduling.md`, `backup.md`, `findings.md`) are the long-form rationale behind choices the memory only summarises. Update them when a decision they describe actually changes.

## Related files

- `AGENTS.md`: points to this file for tools that do not read `CLAUDE.md`.
- `MEMORY.md` + `docs/memory/`: project long-term memory (rule 2).
