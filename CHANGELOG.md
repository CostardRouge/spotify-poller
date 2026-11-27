# Changelog

What each release of spotify-poller brings to the person whose listening history it keeps. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html); `.github/workflows/release.yml` turns each section into a
tag and a GitHub Release once it reaches `main` (COMMON-PROJECT-SPEC C13 in `second-brain`). Written in English, like
the code. Codenames are musical tempo markings, in alphabetical order. Versions 1.0.0 to 2.2.0 were given after the
fact to the history's turning points; `package.json` already said 2.0.0 since the move to Next.js, which is where that
major number comes from.

## [Unreleased]

### Changed

- The app is now called **Témoin**, with a new look: warm paper, black ink and a blue pen, a new icon, and the same
  colour rules as before — green only ever means healthy. Install it again on your phone's home screen to get the new
  icon and name.
- The Overview leads with one sentence that says whether every play is being collected, then today's listening drawn
  as a trace; on a computer, a dial of today's polls and the whole week. A declared gap shows as a dashed amber stretch,
  never as an empty one.
- On a phone, the tabs are now Now, Trace, Library and More.

### Added

- A Trace page: each day of the week drawn as the pen recorded it, one line per day, with the declared gaps on it and a
  week-by-week history (shortcut key 9).

- Sign in with Sésame (`AUTH_MODE=sesame`): the login page offers your Sésame account — one passkey for every app —
  instead of the admin token, which is then no longer needed. Who may sign in is decided in Sésame.

- The showcase page counts its visits anonymously with the publisher's self-hosted Umami: no cookie, no personal data.
  Do Not Track and Global Privacy Control are honoured, and a switch in its legal notice turns counting off. The app
  itself still measures nothing.

- The installed app opens on a "Cannot reach the poller" page when the phone gets no answer from the server, instead
  of a blank screen. It says only that the server is unreachable, never whether collection is running, and the app
  still keeps no copy of its pages: you never see an old "Healthy" served from a cache.
- Long-press shortcuts on the app's icon (Android): Gaps, Runs, Events, Listening.
- Links to the app and to the showcase preview as a drawn card (name and purpose, no data from your history).

### Changed

- With Sésame sign-in, opening the app while signed out now goes straight to Sésame instead of first showing a page
  with a single « Sign in with Sésame » button. That page still appears after you sign out (so you are not signed
  straight back in) and when Sésame refuses or fails, to say why.

### Fixed

- A health check that probes `/health` now gets an answer. With Sésame sign-in, such a probe was sent on to Sésame,
  failed, and the reverse proxy took the whole site offline (a 404) although collection kept running.
- On a phone, the Overview no longer runs off the right edge of the screen: the Run now and Review buttons and the
  panel notes were cut off.
- On a computer or tablet window of middle width (roughly 768 to 1280 px), the Now page no longer squeezes its
  status card: the collectors' times no longer break letter by letter, the Run now buttons stay inside the card, the
  page never scrolls sideways (which pushed the sidebar's "Viewing" selector against the left edge), and the panels'
  rows put their label above the value when the panel is narrow.
- On a phone, every table (runs, gaps, events, playback, stats, accounts, database) now shows each row as a card
  with labelled values instead of scrolling sideways.
- In the installed iPhone app, the bottom tab bar sits above the home indicator and clear of the screen's rounded
  corners, and stays clear of the notch in landscape.
- Tapping a search or filter field on a phone no longer zooms the whole page in.

### Security

- The app asks search engines and AI crawlers not to index it (`robots.txt` and a `noindex` tag): an instance
  reachable from the internet no longer invites crawling of its login page.

## [2.3.0] - 2026-10-22 — Andantino

### Added

- Icons for a phone's home screen and a web app manifest: the dashboard installs as an app on iOS and Android, with its
  own icon instead of a screenshot of the login page.
- The showcase page on GitHub Pages carries a legal notice (who publishes it, who hosts it, and that nothing is
  measured), a canonical address and link-preview tags, and the app's icons.
- The showcase publishes an `llms.txt` at its root: a plain-text summary of what spotify-poller is, with links to the
  showcase, its legal notice and the repository, for language models and the tools built on them.

## [2.2.1] - 2026-10-17 — Andante

The first numbered release: the poller as it runs in the Home Lab today.

### Changed

- The settings dialog's Version row reads the release number from `package.json`, the one place a version is kept.

### Fixed

- Artist genres fill again: Spotify removed the bulk artists endpoint, so the poller now asks for each artist in turn,
  about a hundred per run, keeping every answer as it arrives.

## [2.2.0] - 2026-08-21 — Andante
<!-- commit: 1fb580bac6e2331ad6d252b2bf514109ccae6f20 -->

### Added

- A Listening page: when you listen (hour, weekday, week × hour, month, year, a timeline by month and by day), what
  you listen to (top artists, tracks, albums, genres by part of the day), sessions, streaks, first-time artists,
  repetition and likes. Every bar, cell and row is a link that narrows the others, with no JavaScript needed, and
  the same filters answer as JSON at `/api/listening`.
- A fourth collector, `artists`, fetches each artist's genres so the history can say what kind of music it holds.

## [2.1.0] - 2026-08-16 — Allegro
<!-- commit: 98706f8a639bab361653dd2bd7ab5c663687b0e0 -->

### Added

- A Database page: file and WAL sizes, what takes the space table by table, free disk, how old the newest backup is
  and whether it sits on the same disk, the engine's settings and an integrity check on demand.
- Every restart is labelled, in the log and on ntfy: a clean stop, a crash with its message, or an unclean exit
  (OOM-kill, power loss) with the last moment the process was seen alive.
- A drifting, frosted backdrop behind the settings dialog.

### Fixed

- The 502-then-404 outages: an export no longer starves the server, timers no longer die silently, a slow origin is
  no longer evicted by the healthcheck, `docker stop` now stops the server cleanly, and the image is pinned to the
  Node release that does not crash the database driver.

## [2.0.0] - 2026-08-09 — Allegretto
<!-- commit: ffe90c3ee169514b6749177e066c6fe1d40eee29 -->

The interface rebuilt on Next.js, with the same database underneath.

### Added

- A page per view (overview, events, runs, gaps, stats, accounts, playback), each with its own address, instead of
  one single page.
- A showcase of the interface built from demo data, for GitHub Pages.

### Changed

- The interface keeps the old one's look, sidebar, command palette, shortcuts and settings, now on every page.
- **Breaking:** you sign in once on a login page and get a session, instead of sending `ADMIN_TOKEN` as a bearer
  header or query string on every request. Scripts that called the API with the token must log in first, or run
  behind the proxy authentication mode.
- **Breaking:** the server listens on port 3000 instead of 8787.

## [1.0.0] - 2026-08-07 — Adagio
<!-- commit: e4376e97cbebadbbf1ebbda27b997bb9f2c7a953 -->

The first version that ran in production: a container that never misses the 50 plays Spotify keeps.

### Added

- Two collectors, `played` (recently played, every run) and `liked` (liked songs with a one-time backfill), driven by
  a scheduler inside the container, with systemd timers for a bare-metal install.
- A debug interface: connect a Spotify account, browse and filter every collected event, see the runs, the gaps and
  the statistics, and start a collection by hand.
- Several Spotify accounts kept apart: each has its own history, cursors and token, and one is collected at a time.
- Backups, an NDJSON export and an import, ntfy alerts, a watchdog heartbeat, and an authentication mode for a
  reverse proxy.
- Timestamps shown in the timezone of your choice, stored in UTC.
- A warning when an account lacks a scope the configuration needs, with Reconnect and Disconnect.
- An opt-in playback collector that records the device, volume, playlist and whether a track was finished.
