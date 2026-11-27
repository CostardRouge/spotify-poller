"use client";

import { useEffect, useState } from "react";
import { verdict } from "@/lib/verdict";

/**
 * One poll of /api/status for the whole shell. The sidebar's health line, the
 * phone header's chip and the now-playing card all read the same payload;
 * before 2026-11-27 each ran its own interval, so a page held two or three
 * timers asking the server the same question. Module-level, so every
 * component that subscribes shares one request every POLL_MS.
 */
export interface StatusPayload {
  /** Set here, not by the server: when this answer arrived. Renders read "now" from it, which keeps them pure (react-hooks/purity) and moves every "polled 3 min ago" forward on each poll. */
  fetched_at: number;
  collector_played_last_success: string | null;
  auth: { connected: boolean; active_account_id: string | null; accounts: { id: string; status: string }[] };
  rate_limit: { limited: boolean; until: string | null };
  scheduler: { playedEveryMinutes: number } | null;
  playback: {
    enabled: boolean;
    now_playing: {
      title: string | null;
      subtitle: string | null;
      item_id: string;
      completion_ratio: number | null;
      device_name: string | null;
      volume_last: number | null;
      last_is_playing: number;
    } | null;
  };
}

const POLL_MS = 20_000;
let last: StatusPayload | null = null;
const listeners = new Set<(s: StatusPayload) => void>();
let timer: ReturnType<typeof setInterval> | null = null;

async function poll() {
  try {
    const res = await fetch("/api/status");
    if (!res.ok) return;
    last = { ...((await res.json()) as Omit<StatusPayload, "fetched_at">), fetched_at: Date.now() };
    listeners.forEach((l) => l(last as StatusPayload));
  } catch {
    // Offline or restarting: keep the last answer rather than flashing "checking…".
  }
}

export function useStatus(): StatusPayload | null {
  const [status, setStatus] = useState<StatusPayload | null>(last);
  useEffect(() => {
    listeners.add(setStatus);
    if (!timer) {
      poll();
      timer = setInterval(poll, POLL_MS);
    }
    return () => {
      listeners.delete(setStatus);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  }, []);
  return status;
}

/** The same verdict tree the Now page renders server-side (lib/verdict.ts). */
export function verdictOf(s: StatusPayload) {
  const active = s.auth.accounts.find((a) => a.id === s.auth.active_account_id);
  return verdict(
    {
      playedLastSuccess: s.collector_played_last_success,
      connected: s.auth.connected,
      activeRevoked: active?.status === "revoked",
      rateLimitedUntil: s.rate_limit.limited ? s.rate_limit.until : null,
      playedEveryMinutes: s.scheduler?.playedEveryMinutes ?? null,
    },
    s.fetched_at
  );
}
