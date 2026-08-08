"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import AccountSelect, { AccountOption } from "./AccountSelect";
import SidebarStatus from "./SidebarStatus";

export const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/runs", label: "Runs" },
  { href: "/gaps", label: "Gaps" },
  { href: "/stats", label: "Stats" },
  { href: "/accounts", label: "Accounts" },
  // Always listed, enabled or not — the page explains how to turn it on, which
  // beats a feature that is invisible until you already know it exists.
  { href: "/playback", label: "Playback" },
] as const;

export default function Sidebar({
  accounts,
  activeAccountId,
}: {
  accounts: AccountOption[];
  activeAccountId: string | null;
}) {
  const pathname = usePathname();

  return (
    <aside className="hidden h-screen w-56 shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-5 md:flex">
      <div>
        <p className="font-[family-name:var(--serif)] text-base text-[color:var(--text)]">spotify-poller</p>
        <p className="mt-0.5 text-xs text-[color:var(--muted)]">custody report</p>
      </div>

      <div className="mt-4">
        <AccountSelect accounts={accounts} activeId={activeAccountId} />
      </div>

      <nav className="mt-6 flex flex-1 flex-col gap-1 overflow-y-auto" aria-label="Primary">
        {NAV.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={
                "rounded-md px-3 py-2 text-sm transition-colors " +
                (active
                  ? "bg-[color:var(--accent-wash)] text-[color:var(--text)] font-medium"
                  : "text-[color:var(--muted)] hover:bg-[color:var(--panel-2)] hover:text-[color:var(--text)]")
              }
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-4 border-t border-[color:var(--line-soft)] pt-4">
        <SidebarStatus />
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-settings"))}
          className="text-left text-xs text-[color:var(--muted)] hover:text-[color:var(--text)]"
        >
          Settings
        </button>
      </div>
    </aside>
  );
}
