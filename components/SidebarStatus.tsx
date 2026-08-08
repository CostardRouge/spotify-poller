"use client";

import { useEffect, useState } from "react";

interface NowPlaying {
  title: string | null;
  subtitle: string | null;
  item_id: string;
  completion_ratio: number | null;
  device_name: string | null;
  volume_last: number | null;
  last_is_playing: number;
}

interface StatusPayload {
  playback: { enabled: boolean; now_playing: NowPlaying | null };
}

const POLL_MS = 20_000;

function pct(ratio: number | null): number {
  return Math.min(100, Math.round((ratio ?? 0) * 100));
}

/**
 * The "Now playing" mini player from the old sidebar (np card): live dot +
 * label, title, artist, progress bar, then completion · device · volume, with
 * "paused" appended when playback is stopped mid-track.
 */
export default function SidebarStatus() {
  const [status, setStatus] = useState<StatusPayload | null>(null);

  useEffect(() => {
    let alive = true;
    async function poll() {
      try {
        const res = await fetch("/api/status");
        if (res.ok && alive) setStatus(await res.json());
      } catch {
        /* transient — next poll catches up */
      }
    }
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const np = status?.playback.enabled ? status.playback.now_playing : null;
  if (!np) return null;

  const meta = [
    `${pct(np.completion_ratio)}%`,
    np.device_name,
    np.volume_last == null ? null : `vol ${np.volume_last}%`,
    np.last_is_playing ? null : "paused",
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--surface-2)] p-3">
      <p className="flex items-center gap-1.5 text-xs text-[color:var(--ink-2)]">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: np.last_is_playing ? "var(--ok)" : "var(--warn)" }}
        />
        Now playing
      </p>
      <p className="mt-1 truncate text-sm font-medium text-[color:var(--ink)]">{np.title ?? np.item_id}</p>
      {np.subtitle && <p className="truncate text-xs text-[color:var(--ink-2)]">{np.subtitle}</p>}
      <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-[color:var(--surface-sunk)]">
        <div className="h-full rounded-full bg-[color:var(--accent)]" style={{ width: `${pct(np.completion_ratio)}%` }} />
      </div>
      <p className="mt-1.5 truncate text-[10px] text-[color:var(--ink-3)]">{meta}</p>
    </div>
  );
}
