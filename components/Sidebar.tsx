"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import AccountSelect, { AccountOption } from "./AccountSelect";
import SidebarStatus from "./SidebarStatus";
import ThemeToggle from "./ThemeToggle";
import Icon, { IconName } from "./Icon";

/** Same sections, order and icons as the old sidebar nav (public/index.html on main). */
export const NAV: { href: string; label: string; icon: IconName; count?: "events" | "gaps" }[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/events", label: "Events", icon: "events", count: "events" },
  { href: "/playback", label: "Playback", icon: "playback" },
  { href: "/runs", label: "Runs", icon: "runs" },
  { href: "/gaps", label: "Gaps", icon: "gaps", count: "gaps" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/database", label: "Database", icon: "database" },
];

function NavList({
  activeAccountId,
  eventsByAccount,
  gapsByAccount,
}: {
  activeAccountId: string | null;
  eventsByAccount: Record<string, number>;
  gapsByAccount: Record<string, number>;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewing = searchParams.get("account") || activeAccountId || "";
  const counts: Record<string, number | undefined> = {
    events: eventsByAccount[viewing],
    gaps: gapsByAccount[viewing],
  };

  return (
    <nav className="mt-6 flex flex-1 flex-col gap-0.5 overflow-y-auto" aria-label="Sections">
      {NAV.map((item) => {
        const active = pathname === item.href;
        const count = item.count ? counts[item.count] : undefined;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors " +
              (active
                ? "bg-[color:var(--accent-soft)] font-medium text-[color:var(--ink)]"
                : "text-[color:var(--ink-2)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--ink)]")
            }
          >
            <Icon name={item.icon} className={"h-4 w-4 " + (active ? "text-[color:var(--accent-text)]" : "")} />
            {item.label}
            {count ? (
              <span
                className={
                  "ml-auto font-[family-name:var(--mono)] text-xs " +
                  (item.count === "gaps" ? "text-[color:var(--warn)]" : "text-[color:var(--ink-3)]")
                }
              >
                {count.toLocaleString()}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}

export default function Sidebar({
  accounts,
  activeAccountId,
  eventsByAccount,
  gapsByAccount,
}: {
  accounts: AccountOption[];
  activeAccountId: string | null;
  eventsByAccount: Record<string, number>;
  gapsByAccount: Record<string, number>;
}) {
  return (
    <aside className="hidden h-screen w-60 shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--surface)] px-4 py-5 md:flex">
      <div className="flex items-center gap-2.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--accent)] text-[color:var(--on-accent)]">
          <Icon name="overview" className="h-4.5 w-4.5" />
        </span>
        <span className="text-base font-semibold text-[color:var(--ink)]">spotify-poller</span>
      </div>

      <div className="mt-5">
        <AccountSelect accounts={accounts} activeId={activeAccountId} />
      </div>

      <Suspense>
        <NavList activeAccountId={activeAccountId} eventsByAccount={eventsByAccount} gapsByAccount={gapsByAccount} />
      </Suspense>

      <div className="flex flex-col gap-3 pt-4">
        <SidebarStatus />
        <ThemeToggle />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-settings"))}
          className="flex items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-[color:var(--ink-2)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--ink)]"
        >
          <Icon name="settings" className="h-4 w-4" />
          Settings
        </button>
      </div>
    </aside>
  );
}
