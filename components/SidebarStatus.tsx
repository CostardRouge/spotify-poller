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
  collector_played_last_success: string | null;
  playback: { enabled: boolean; now_playing: NowPlaying | null };
}

const POLL_MS = 20_000;
const STALE_MS = 45 * 60 * 1000; // 30 min cadence + margin
const DEAD_MS = STALE_MS * 3;

function healthOf(lastSuccess: string | null): { tone: string; word: string } {
  if (!lastSuccess) return { tone: "var(--danger)", word: "no collection yet" };
  const age = Date.now() - Date.parse(lastSuccess);
  const mins = Math.floor(age / 60_000);
  const label = mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ago`;
  if (age <= STALE_MS) return { tone: "var(--ok)", word: `healthy · ${label}` };
  if (age <= DEAD_MS) return { tone: "var(--warn)", word: `stale · ${label}` };
  return { tone: "var(--danger)", word: `silent · ${label}` };
}

/**
 * The health chip and the now-playing widget from the old sidebar. One poll
 * serves both. Status is never color alone: the dot always ships with a word.
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

  if (!status) return null;
  const health = healthOf(status.collector_played_last_success);
  const np = status.playback.enabled ? status.playback.now_playing : null;
  const pct = np ? Math.min(100, Math.round((np.completion_ratio ?? 0) * 100)) : 0;
  const meta = np
    ? [
        `${pct}%`,
        np.device_name,
        np.volume_last == null ? null : `vol ${np.volume_last}%`,
        np.last_is_playing ? null : "paused",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
        <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ background: health.tone }} />
        {health.word}
      </p>

      {np && (
        <div className="rounded-md border border-[color:var(--line-soft)] bg-[color:var(--panel-2)] p-2.5">
          <p className="truncate text-xs font-medium text-[color:var(--text)]">{np.title ?? np.item_id}</p>
          {np.subtitle && <p className="mt-0.5 truncate text-xs text-[color:var(--muted)]">{np.subtitle}</p>}
          <div aria-hidden className="mt-1.5 h-1 overflow-hidden rounded-full bg-[color:var(--line-soft)]">
            <div className="h-full bg-[color:var(--accent)]" style={{ width: `${pct}%` }} />
          </div>
          <p className="mt-1 truncate text-[10px] text-[color:var(--faint)]">{meta}</p>
        </div>
      )}
    </div>
  );
}
