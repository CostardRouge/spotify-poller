"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import Icon from "./Icon";
import { verdict } from "@/lib/verdict";

/** Title + subtitle per section, same copy as the old TABS map. */
const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Now", sub: "Is collection alive, and did anything go missing" },
  "/events": { title: "Events", sub: "Everything collected, filterable and exportable" },
  "/playback": { title: "Playback", sub: "Reconstructed listening sessions" },
  "/runs": { title: "Runs", sub: "Every collection attempt, successful or not" },
  "/gaps": { title: "Gaps", sub: "Windows the poller knows it did not cover" },
  "/accounts": { title: "Accounts", sub: "Connections, tokens and which one is collected" },
  "/stats": { title: "Stats", sub: "Volumes and the recent run history" },
  "/listening": { title: "Listening", sub: "What the collected history says about the listening itself" },
  "/trace": { title: "Trace", sub: "Every day as the pen drew it, gaps declared" },
  "/database": { title: "Database", sub: "What it weighs, what is filling it, and whether it is backed up" },
};

interface StatusPayload {
  collector_played_last_success: string | null;
  auth: { connected: boolean; active_account_id: string | null; accounts: { id: string; status: string }[] };
  rate_limit: { limited: boolean; until: string | null };
  scheduler: { playedEveryMinutes: number } | null;
}

/** The shared decision tree (lib/verdict.ts), fed from the /api/status payload. */
function verdictOf(s: StatusPayload) {
  const active = s.auth.accounts.find((a) => a.id === s.auth.active_account_id);
  return verdict(
    {
      playedLastSuccess: s.collector_played_last_success,
      connected: s.auth.connected,
      activeRevoked: active?.status === "revoked",
      rateLimitedUntil: s.rate_limit.limited ? s.rate_limit.until : null,
      playedEveryMinutes: s.scheduler?.playedEveryMinutes ?? null,
    },
    Date.now()
  );
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

  const h = status ? verdictOf(status) : null;
  const tone = h ? h.tone : null;
  // The Overview states the verdict as its headline, so the bar does not
  // repeat it there; on every other page the chip keeps collection health one
  // glance away (PRODUCT.md, freshness before features).
  const isOverview = pathname === "/";

  return (
    <header
      className={
        "flex flex-wrap items-center gap-3 px-4 pt-4 pb-2 sm:px-8 md:py-3 " +
        (isOverview ? "" : "md:border-b md:border-[color:var(--line)]")
      }
    >
      <span className="font-[family-name:var(--display)] text-xl font-bold tracking-[-0.03em] text-[color:var(--ink)] md:hidden">
        témoin
      </span>
      {!isOverview && (
        <div className="hidden min-w-0 md:block">
          <h1 className="font-[family-name:var(--display)] text-lg leading-tight text-[color:var(--ink)]">{t.title}</h1>
          <p className="truncate text-xs text-[color:var(--ink-2)]">{t.sub}</p>
        </div>
      )}
      <span className="flex-1" />
      <div className="flex items-center gap-1.5">
        {!isOverview && (
          <button
            type="button"
            onClick={() => window.dispatchEvent(new Event("sp:open-settings"))}
            title={h?.why ?? "Collection health"}
            className={`chip ${tone ?? ""}`}
          >
            <span aria-hidden className={`voyant ${tone ?? ""}`} />
            {h?.text ?? "checking…"}
          </button>
        )}
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
      {!isOverview && (
        <div className="w-full min-w-0 md:hidden">
          <h1 className="font-[family-name:var(--display)] text-2xl font-bold leading-tight tracking-[-0.03em] text-[color:var(--ink)]">
            {t.title}
          </h1>
          <p className="text-sm text-[color:var(--ink-2)]">{t.sub}</p>
        </div>
      )}
    </header>
  );
}
