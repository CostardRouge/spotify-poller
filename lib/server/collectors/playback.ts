import { PLAYBACK_SCOPE, getAccessToken, scopeStatus } from "../spotify/auth";
import {
  PlaybackSampleRow,
  PlaybackSessionRow,
  closePlaybackSession,
  getLastPlaybackSample,
  getOpenPlaybackSession,
  insertPlaybackSample,
  insertPlaybackSession,
  insertRaw,
  setState,
  updatePlaybackSession,
} from "../db";
import { spotifyGet } from "../spotify/api";
import { Account, AuthError, CollectorResult, Env, TransientError, nowIso } from "../types";

/**
 * Playback collector — GET /v1/me/player, scope `user-read-playback-state`.
 * Opt-in (PLAYBACK_ENABLED=1), driven by the in-process ticker only.
 *
 * A COMPLEMENT to 'played', never a replacement: it observes only while the
 * process is up, whereas recently-played back-fills across downtime. What it
 * adds is everything recently-played cannot tell you — which device, what
 * volume, from which playlist, and whether the track was finished or skipped.
 *
 * Two deliberate departures from the other collectors, both for cost:
 *
 *  1. It passes logRaw:false to spotifyGet and writes its own raw_spotify row
 *     only on state CHANGES and on errors. Polling every 15 s would otherwise
 *     mean ~5760 JSON blobs a day. Invariant I3's intent — evidence recorded
 *     before interpretation — is kept for every transition, which is what the
 *     derived data is actually built from.
 *  2. Likewise a playback_samples row is written only on a transition. The open
 *     session's aggregates are UPDATEd on every tick, so nothing is lost.
 *
 * "Was the track played in full?" is not a field Spotify exposes. It is
 * inferred from sampled progress, so it is an estimate accurate to roughly the
 * polling interval. Seeking makes progress_ms non-monotonic, which is why
 * completion is computed from the MAX progress observed, never the last value.
 */

const URL_PLAYER = "https://api.spotify.com/v1/me/player?additional_types=track,episode";

/** A progress jump further than this from wall-clock time is a seek, not playback. */
const SEEK_TOLERANCE_MS = 5_000;
/** Below this, progress counts as "back at the very beginning". */
const RESTART_PROGRESS_MS = 5_000;
/** Fraction of a track that counts as having reached the end. */
const NEAR_END_RATIO = 0.9;
/** Below this completion, a track cut short by the NEXT one counts as skipped. */
const SKIP_RATIO = 0.9;
/** An open session with no fresh observation for this long is stale (we were down). */
const STALE_MS = 10 * 60 * 1000;

interface PlayerItem {
  id?: string | null;
  name?: string;
  duration_ms?: number;
  artists?: { name: string }[];
  show?: { name?: string };
}

interface PlayerState {
  timestamp?: number;
  progress_ms?: number | null;
  is_playing?: boolean;
  currently_playing_type?: string;
  shuffle_state?: boolean;
  repeat_state?: string;
  context?: { uri?: string } | null;
  device?: {
    id?: string | null;
    name?: string;
    type?: string;
    volume_percent?: number | null;
    is_private_session?: boolean;
  } | null;
  item?: PlayerItem | null;
}

function bool01(v: boolean | null | undefined): number | null {
  return v == null ? null : v ? 1 : 0;
}

function ratioOf(progressMs: number | null, durationMs: number | null): number | null {
  if (!durationMs || durationMs <= 0 || progressMs == null) return null;
  return Math.min(1, progressMs / durationMs);
}

function subtitleOf(item: PlayerItem): string | null {
  if (item.artists?.length) return item.artists.map((a) => a.name).join(", ");
  return item.show?.name ?? null;
}

export async function collectPlayback(env: Env, account: Account): Promise<CollectorResult> {
  // Fail with something actionable rather than hammering 403s. When the grant
  // was never recorded (an account adopted from a legacy token) `missing` is
  // empty and we try the call — the 403 branch below then says the same thing.
  if (scopeStatus(env, account.scope).missing.includes(PLAYBACK_SCOPE)) {
    throw new AuthError(
      `scope ${PLAYBACK_SCOPE} not granted — reconnect the account from the UI (/auth/login)`
    );
  }

  const token = await getAccessToken(env, account);
  let r = await spotifyGet(env, account.id, "playback", URL_PLAYER, token, { logRaw: false });
  if (r.status === 401) {
    // Isolated 401: one refresh, one retry (§10) — same as 'played'.
    const retryToken = await getAccessToken(env, account);
    r = await spotifyGet(env, account.id, "playback", URL_PLAYER, retryToken, { logRaw: false });
  }

  if (r.status === 403) {
    insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText);
    throw new AuthError(
      `403 on /me/player — scope ${PLAYBACK_SCOPE} not granted. Reconnect the account from the UI (/auth/login).`
    );
  }
  if (r.status >= 500) {
    insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText);
    return { status: "partial", fetched: 0, inserted: 0, note: `spotify ${r.status}` };
  }
  // 204 = nothing playing. Any other non-2xx is unexpected.
  if (r.status !== 204 && (r.status < 200 || r.status >= 300)) {
    insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText);
    throw new TransientError(`unexpected ${r.status}: ${r.bodyText.slice(0, 200)}`);
  }

  const observedAt = nowIso();
  let p: PlayerState | null = null;
  if (r.status === 200 && r.bodyText.trim()) {
    try {
      p = JSON.parse(r.bodyText) as PlayerState;
    } catch {
      insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText);
      throw new TransientError("unparseable /me/player body");
    }
  }

  const item = p?.item ?? null;
  // No item also covers ads and unknown content: whatever was playing has ended.
  const idle = !p || !item?.id;

  const obs: PlaybackSampleRow = {
    observed_at: observedAt,
    spotify_ts: p?.timestamp ?? null,
    item_id: idle ? null : item!.id!,
    item_type: p?.currently_playing_type ?? null,
    progress_ms: idle ? null : p!.progress_ms ?? null,
    duration_ms: idle ? null : item!.duration_ms ?? null,
    is_playing: !idle && p!.is_playing ? 1 : 0,
    device_id: p?.device?.id ?? null,
    device_name: p?.device?.name ?? null,
    device_type: p?.device?.type ?? null,
    volume_percent: p?.device?.volume_percent ?? null,
    is_private_session: bool01(p?.device?.is_private_session),
    shuffle_state: idle ? null : bool01(p!.shuffle_state),
    repeat_state: idle ? null : p!.repeat_state ?? null,
    context_uri: idle ? null : p!.context?.uri ?? null,
  };

  const last = getLastPlaybackSample(env, account.id);
  let open = getOpenPlaybackSession(env, account.id);

  // We were down (or the session was never closed): end it at the last moment
  // we actually observed, not now — claiming playback we did not see would be
  // a lie of exactly the kind the gaps table exists to avoid.
  if (open && Date.now() - Date.parse(open.updated_at) > STALE_MS) {
    closePlaybackSession(env, account.id, open.id, open.updated_at, "stale", 0);
    open = null;
  }

  // ---------- nothing playing ----------
  if (idle) {
    if (open) {
      closePlaybackSession(env, account.id, open.id, observedAt, "idle", 0);
      open = null;
    }
    // Idle after idle is the overnight case: it must cost zero writes.
    const changed = !last || last.item_id !== null || last.device_id !== obs.device_id;
    if (changed) {
      insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText || null);
      insertPlaybackSample(env, account.id, obs);
    }
    setState(env, account.id, "playback.last_success_at", observedAt);
    return { status: "ok", fetched: 0, inserted: changed ? 1 : 0, note: "nothing playing" };
  }

  // ---------- something is playing ----------
  const itemId = item!.id!;
  const progress = obs.progress_ms ?? 0;
  let startedNew = false;
  let seek = false;

  if (open && open.item_id === itemId) {
    const wentBack = progress < (open.last_progress_ms ?? 0) - SEEK_TOLERANCE_MS;
    const nearEnd = open.duration_ms
      ? (open.max_progress_ms ?? 0) >= open.duration_ms * NEAR_END_RATIO
      : false;

    if (wentBack && progress <= RESTART_PROGRESS_MS && nearEnd) {
      // Reached the end, then back to zero: a genuine replay. Without the
      // near-end test this would be indistinguishable from seeking to 0, and
      // every rewind would fabricate a second listen.
      closePlaybackSession(env, account.id, open.id, observedAt, "replay", 0);
      open = null;
    } else if (wentBack) {
      seek = true;
    } else {
      const wallMs = Math.max(0, Date.parse(observedAt) - Date.parse(open.updated_at));
      if (progress - (open.last_progress_ms ?? 0) > wallMs + SEEK_TOLERANCE_MS) seek = true;
    }
  } else if (open) {
    // A different track started: the previous one was cut short unless it had
    // essentially reached its end.
    const ratio = open.completion_ratio ?? 0;
    closePlaybackSession(env, account.id, open.id, observedAt, "track_change", ratio < SKIP_RATIO ? 1 : 0);
    open = null;
  }

  if (!open) {
    startedNew = true;
    open = {
      id: `spotify:play:${itemId}:${observedAt}`,
      item_id: itemId,
      item_type: p!.currently_playing_type ?? "unknown",
      title: item!.name ?? null,
      subtitle: subtitleOf(item!),
      started_at: observedAt,
      ended_at: null,
      duration_ms: obs.duration_ms,
      // May be mid-track: we join wherever playback already was.
      first_progress_ms: progress,
      max_progress_ms: progress,
      last_progress_ms: progress,
      listened_ms: 0,
      completion_ratio: ratioOf(progress, obs.duration_ms),
      skipped: null,
      close_reason: null,
      sample_count: 1,
      pause_count: 0,
      paused_ms: 0,
      device_id: obs.device_id,
      device_name: obs.device_name,
      device_type: obs.device_type,
      volume_min: obs.volume_percent,
      volume_max: obs.volume_percent,
      volume_last: obs.volume_percent,
      shuffle_state: obs.shuffle_state,
      repeat_state: obs.repeat_state,
      context_uri: obs.context_uri,
      is_private_session: obs.is_private_session,
      last_is_playing: obs.is_playing,
      event_id: null,
      closed: 0,
      updated_at: observedAt,
    };
    insertPlaybackSession(env, account.id, open);
  } else {
    const wallMs = Math.max(0, Date.parse(observedAt) - Date.parse(open.updated_at));
    const delta = progress - (open.last_progress_ms ?? 0);
    // Only forward movement that matches elapsed time is listening; a seek is not.
    const listened = open.listened_ms + (delta > 0 && delta <= wallMs + SEEK_TOLERANCE_MS ? delta : 0);
    const maxProgress = Math.max(open.max_progress_ms ?? 0, progress);
    const stillPaused = open.last_is_playing === 0 && obs.is_playing === 0;

    const updated: PlaybackSessionRow = {
      ...open,
      max_progress_ms: maxProgress,
      last_progress_ms: progress,
      listened_ms: listened,
      completion_ratio: ratioOf(maxProgress, open.duration_ms),
      sample_count: open.sample_count + 1,
      pause_count: open.pause_count + (open.last_is_playing === 1 && obs.is_playing === 0 ? 1 : 0),
      paused_ms: open.paused_ms + (stillPaused ? wallMs : 0),
      device_id: obs.device_id,
      device_name: obs.device_name,
      device_type: obs.device_type,
      volume_min: minOf(open.volume_min, obs.volume_percent),
      volume_max: maxOf(open.volume_max, obs.volume_percent),
      volume_last: obs.volume_percent ?? open.volume_last,
      shuffle_state: obs.shuffle_state,
      repeat_state: obs.repeat_state,
      context_uri: obs.context_uri ?? open.context_uri,
      is_private_session: obs.is_private_session,
      last_is_playing: obs.is_playing,
      updated_at: observedAt,
    };
    updatePlaybackSession(env, account.id, updated);
    open = updated;
  }

  // The cost lever: write only when something observable actually moved.
  const changed =
    startedNew ||
    seek ||
    !last ||
    last.item_id !== obs.item_id ||
    last.is_playing !== obs.is_playing ||
    last.device_id !== obs.device_id ||
    last.volume_percent !== obs.volume_percent ||
    last.shuffle_state !== obs.shuffle_state ||
    last.repeat_state !== obs.repeat_state ||
    last.context_uri !== obs.context_uri;

  if (changed) {
    insertRaw(env, account.id, "playback", r.status, URL_PLAYER, r.bodyText || null);
    insertPlaybackSample(env, account.id, obs);
  }
  setState(env, account.id, "playback.last_success_at", observedAt);

  return {
    status: "ok",
    fetched: 1,
    inserted: changed ? 1 : 0,
    note: changed ? `${open.title ?? itemId}` : "no change",
  };
}

function minOf(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.min(a, b);
}

function maxOf(a: number | null, b: number | null): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return Math.max(a, b);
}
