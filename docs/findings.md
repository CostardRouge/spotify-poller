# Empirical checks — spec §12

To be completed BEFORE building anything on top of the poller.
Each test challenges an assumption made in the spec.

## 1. Is `played_at` the start or the end of playback?

- **Method**: play a track at a precisely noted time; compare `played_at` and
  `played_at − duration_ms` against the actual start time.
- **Result**:
- **Conclusion for fine-grained correlation**:

## 2. Offline listening (THE critical test — bike rides)

- **Method**: airplane mode, play 3 tracks at noted times, reconnect, trigger
  `POST /run?collector=played`, observe the `played_at` values.
- **Result**:
- **Do the timestamps reflect actual listening or the sync?**:

## 3. Minimum duration threshold

- **Method**: start a track, skip after ~5 s; check whether it appears in the
  API response.
- **Result**:

## 4. Private session

- **Method**: enable the private session, play a track, check.
- **Result**:
- **Note**: with the playback collector on (`PLAYBACK_ENABLED=1`) this is now
  directly observable — `/me/player` returns `device.is_private_session`, which
  is persisted on every sample and session. Comparing a private-session listen
  in `playback_sessions` against what `recently-played` reports for the same
  moment answers this test on its own.

## 5. Podcasts

- **Method**: play a podcast episode, check what comes back (presence, payload
  shape, `track` field?).
- **Result**:
- **Does it require a distinct `type`?**:

## 6. Is `progress_ms` trustworthy over Spotify Connect?

Opened by the playback collector, which infers "finished or skipped" from
sampled progress.

- **Method**: play on a *remote* device (speaker, TV, phone controlled from the
  desktop app), let a track finish, and compare `completion_ratio` in
  `playback_sessions` against reality. Repeat on the local device.
- **Question**: does a remote device report progress with a lag, and is that lag
  big enough to make a finished track look skipped?
- **Result**:

## 7. Does the replay heuristic hold?

A track going back to ~0 is either a replay or a seek to the start. The
collector calls it a replay only when the previous maximum had reached ~90 % of
the track (`NEAR_END_RATIO` in `lib/server/collectors/playback.ts`).

- **Method**: (a) let a track finish then replay it; (b) play halfway, seek back
  to 0. Check that (a) produces two sessions and (b) exactly one.
- **Result**:
