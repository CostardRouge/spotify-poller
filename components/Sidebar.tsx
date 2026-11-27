"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AccountSidebarButton, type AccountOption } from "./AccountMenu";
import SidebarStatus from "./SidebarStatus";
import Icon from "./Icon";
import Mark from "./Mark";
import { useStatus, verdictOf } from "./useStatus";
import { ago } from "@/lib/verdict";
import { GROUPS, SECTIONS, sectionOf } from "@/lib/nav";

/**
 * The desk's only chrome (2026-11-27, design lab iteration 2): the mark, the
 * voyant with its word, a "Jump to…" field for ⌘K, the five places in three
 * groups (lib/nav.ts), and the account button. There is no top bar on a desk
 * any more — its health chip, search and gear each had a twin here or in the
 * settings dialog — so the voyant lives under the mark, on every page.
 */
function Health() {
  const status = useStatus();
  const v = status ? verdictOf(status) : null;
  return (
    <p className="flex min-w-0 items-center gap-2 px-3 text-[13px]" title={v?.why} role="status">
      <span aria-hidden className={`voyant ${v?.tone ?? ""}`} />
      <span className={`font-semibold ${v ? `tone-${v.tone}` : "text-[color:var(--ink-2)]"}`}>{v?.text ?? "Checking…"}</span>
      {status?.collector_played_last_success && (
        <span className="truncate font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
          · polled {ago(status.collector_played_last_success, status.fetched_at)}
        </span>
      )}
    </p>
  );
}

function NavList({
  activeAccountId,
  eventsByAccount,
  gapsByAccount,
  toCheck,
}: {
  activeAccountId: string | null;
  eventsByAccount: Record<string, number>;
  gapsByAccount: Record<string, number>;
  toCheck: number;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewing = searchParams.get("account") || activeAccountId || "";
  const current = sectionOf(pathname);
  const gaps = gapsByAccount[viewing] ?? 0;
  const events = eventsByAccount[viewing];

  // Each count says what it counts, in words or a familiar mark: "1 gap" with
  // the dashed amber stroke, the library's size, what System wants looked at.
  const extra: Record<string, React.ReactNode> = {
    journal: gaps ? (
      <span className="ml-auto flex items-center gap-1.5 font-[family-name:var(--mono)] text-xs text-[color:var(--warn-text)]">
        <span aria-hidden className="gap-dash sm" />
        {gaps} gap{gaps === 1 ? "" : "s"}
      </span>
    ) : null,
    library: events ? (
      <span className="ml-auto font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">{events.toLocaleString()}</span>
    ) : null,
    system: toCheck ? (
      <span className="ml-auto font-[family-name:var(--mono)] text-xs text-[color:var(--warn-text)]">{toCheck} to check</span>
    ) : null,
  };

  return (
    <nav className="mt-1 flex flex-1 flex-col overflow-y-auto" aria-label="Sections">
      {GROUPS.map((g) => (
        <div key={g} className="flex flex-col gap-0.5">
          <span className="menu-label px-3 pb-1 pt-4">{g}</span>
          {SECTIONS.filter((s) => s.group === g).map((s) => {
            const active = current?.id === s.id;
            return (
              <Link
                key={s.id}
                href={s.href}
                aria-current={active ? "page" : undefined}
                className={
                  "flex h-10 items-center gap-2.5 rounded-[10px] px-3 text-sm transition-colors " +
                  (active
                    ? "bg-[color:var(--accent-soft)] font-semibold text-[color:var(--ink)]"
                    : "text-[color:var(--ink-2)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--ink)]")
                }
              >
                <Icon name={s.icon} className="h-[18px] w-[18px]" />
                {s.label}
                {extra[s.id]}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export default function Sidebar({
  accounts,
  activeAccountId,
  eventsByAccount,
  gapsByAccount,
  toCheck,
}: {
  accounts: AccountOption[];
  activeAccountId: string | null;
  eventsByAccount: Record<string, number>;
  gapsByAccount: Record<string, number>;
  toCheck: number;
}) {
  return (
    <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--surface)] px-3.5 pb-3.5 pt-5 md:flex">
      <div className="flex items-center gap-2.5 px-2">
        {/* The app icon itself, so the sidebar and the home screen show one mark. */}
        <Mark size={30} />
        <span className="font-[family-name:var(--display)] text-2xl font-bold tracking-[-0.03em] text-[color:var(--ink)]">témoin</span>
      </div>

      <div className="mt-4">
        <Health />
      </div>

      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("sp:open-palette"))}
        className="mt-3.5 flex h-10 items-center gap-2.5 rounded-[10px] border border-[color:var(--line)] bg-[color:var(--bg)] px-3 text-left text-sm text-[color:var(--ink-2)] hover:text-[color:var(--ink)]"
      >
        <Icon name="search" className="h-4 w-4" />
        <span className="flex-1">Jump to…</span>
        <kbd className="kbd">⌘K</kbd>
      </button>

      <Suspense>
        <NavList activeAccountId={activeAccountId} eventsByAccount={eventsByAccount} gapsByAccount={gapsByAccount} toCheck={toCheck} />
      </Suspense>

      <div className="flex flex-col gap-3 pt-3">
        <SidebarStatus />
        <AccountSidebarButton accounts={accounts} activeId={activeAccountId} eventsByAccount={eventsByAccount} />
      </div>
    </aside>
  );
}
