"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/runs", label: "Runs" },
  { href: "/gaps", label: "Gaps" },
  { href: "/stats", label: "Stats" },
  { href: "/accounts", label: "Accounts" },
] as const;

export default function Sidebar({ playbackEnabled }: { playbackEnabled: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const items = playbackEnabled ? [...NAV, { href: "/playback", label: "Playback" }] : NAV;

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  return (
    <aside className="flex h-screen w-56 shrink-0 flex-col border-r border-[color:var(--line)] bg-[color:var(--panel)] px-4 py-5">
      <div>
        <p className="font-[family-name:var(--serif)] text-base text-[color:var(--text)]">spotify-poller</p>
        <p className="mt-0.5 text-xs text-[color:var(--muted)]">custody report</p>
      </div>

      <nav className="mt-8 flex flex-1 flex-col gap-1" aria-label="Primary">
        {items.map((item) => {
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

      <div className="flex flex-col gap-3 border-t border-[color:var(--line-soft)] pt-4">
        <ThemeToggle />
        <button
          type="button"
          onClick={logout}
          className="text-left text-xs text-[color:var(--muted)] hover:text-[color:var(--text)]"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
