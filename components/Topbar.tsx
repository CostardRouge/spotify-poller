"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";

/** Title + subtitle per section, same copy as the old TABS map. */
const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Overview", sub: "Is collection alive, and did anything go missing" },
  "/events": { title: "Events", sub: "Everything collected, filterable and exportable" },
  "/playback": { title: "Playback", sub: "Reconstructed listening sessions" },
  "/runs": { title: "Runs", sub: "Every collection attempt, successful or not" },
  "/gaps": { title: "Gaps", sub: "Windows the poller knows it did not cover" },
  "/accounts": { title: "Accounts", sub: "Connections, tokens and which one is collected" },
  "/stats": { title: "Stats", sub: "Volumes and the recent run history" },
  "/database": { title: "Database", sub: "What it weighs, what is filling it, and whether it is backed up" },
};

interface StatusPayload {
  collector_played_last_success: string | null;
  auth: { connected: boolean; active_account_id: string | null; accounts: { id: string; status: string }[] };
  rate_limit: { limited: boolean; until: string | null };
  scheduler: { playedEveryMinutes: number } | null;
}

function ago(iso: string | null): string {
  if (!iso) return "never";
  const m = Math.floor((Date.now() - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

/**
 * Overall health verdict — the old topbar chip's decision tree, unchanged:
 * connection problems trump staleness, staleness trumps rate limiting.
 */
function verdict(s: StatusPayload): { tone: "ok" | "warn" | "bad"; text: string; why: string } {
  const active = s.auth.accounts.find((a) => a.id === s.auth.active_account_id);
  const expectedMs = (s.scheduler?.playedEveryMinutes ? s.scheduler.playedEveryMinutes * 3 : 90) * 60_000;
  const last = s.collector_played_last_success;
  const age = last ? Date.now() - Date.parse(last) : null;
  const fresh = age === null ? "none" : age <= expectedMs ? "ok" : age <= expectedMs * 4 ? "warn" : "bad";

  if (!s.auth.connected) return { tone: "bad", text: "Not connected", why: "No Spotify account is connected." };
  if (active?.status === "revoked")
    return { tone: "bad", text: "Token revoked", why: "Spotify revoked the collecting account's token. Reconnect." };
  if (fresh === "none")
    return { tone: "warn", text: "Never collected", why: "The played collector has not succeeded yet." };
  if (fresh === "bad")
    return { tone: "bad", text: "Stale", why: `played last succeeded ${ago(last)}. History may already be lost.` };
  if (s.rate_limit.limited)
    return { tone: "warn", text: "Rate limited", why: `Spotify is rate limiting until ${s.rate_limit.until}.` };
  if (fresh === "warn")
    return { tone: "warn", text: "Behind schedule", why: `played last succeeded ${ago(last)}.` };
  return { tone: "ok", text: "Healthy", why: `played last succeeded ${ago(last)}.` };
}

export default function Topbar() {
  const pathname = usePathname();
  const [status, setStatus] = useState<StatusPayload | null>(null);
  const t = TITLES[pathname] ?? TITLES["/"];

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
    const id = setInterval(poll, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  const h = status ? verdict(status) : null;

  return (
    <header className="flex flex-wrap items-center gap-3 border-b border-[color:var(--line)] bg-[color:var(--bg)] px-4 py-3 sm:px-8">
      <div className="min-w-0">
        <h1 className="text-lg leading-tight text-[color:var(--ink)]">{t.title}</h1>
        <p className="truncate text-xs text-[color:var(--ink-2)]">{t.sub}</p>
      </div>
      <span className="flex-1" />
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-settings"))}
          title={h?.why ?? "Collection health"}
          className={`chip ${h ? (h.tone === "bad" ? "bad" : h.tone === "warn" ? "warn" : "ok") : ""}`}
        >
          <span aria-hidden className={`dot ${h ? (h.tone === "bad" ? "bad" : h.tone === "warn" ? "warn" : "ok") : ""}`} />
          {h?.text ?? "checking…"}
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-palette"))}
          title="Command palette (⌘K)"
          aria-label="Open command palette"
          className="btn ghost icon-only"
        >
          <Icon name="search" className="h-4 w-4" />
        </button>
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-settings"))}
          title="Settings"
          aria-label="Open settings"
          className="btn ghost icon-only"
        >
          <Icon name="settings" className="h-4 w-4" />
        </button>
      </div>
    </header>
  );
}
