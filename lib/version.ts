/**
 * The release this build is, read from the root package.json at build time —
 * the ONE place a version is kept (CLAUDE.md rule 4). CHANGELOG.md says what
 * each version brought; `.github/workflows/release.yml` tags it on `main`.
 *
 * manifest.json used to carry a second copy of the number, which is what the
 * settings dialog showed; two copies drift the first time a release bumps
 * only one of them, so manifest.json no longer has a version at all.
 *
 * A default import rather than `import { version }`: webpack warns on named
 * imports from JSON, and this module is only ever read on the server (the
 * dashboard layout hands the string to the client), so the rest of
 * package.json never reaches a browser bundle.
 */
import pkg from "../package.json";

export const VERSION: string = pkg.version;
