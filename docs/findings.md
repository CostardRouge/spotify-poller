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

## 5. Podcasts

- **Method**: play a podcast episode, check what comes back (presence, payload
  shape, `track` field?).
- **Result**:
- **Does it require a distinct `type`?**:
