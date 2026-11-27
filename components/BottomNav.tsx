"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Icon from "./Icon";
import { SECTIONS, sectionOf } from "@/lib/nav";

/**
 * Phone navigation (PRODUCT.md: phone-complete). Since 2026-11-27 (design lab
 * iteration 2): four tabs — Now, Trace, Library, Journal — and no "More"
 * sheet. What that sheet held now has one home each: System is in the account
 * sheet (the round button in the header, components/AccountMenu.tsx), the run
 * actions are on Now, the viewed account and the theme are in the account
 * sheet too. Nothing an operator can do is desk-only.
 */
const TABS = SECTIONS.filter((s) => s.id !== "system");
// Trace, Library, Journal: the order the phone reads in — is it alive, what
// was collected, what happened to the collector.
TABS.sort((a, b) => ["now", "trace", "library", "journal"].indexOf(a.id) - ["now", "trace", "library", "journal"].indexOf(b.id));

export default function BottomNav(props: { activeAccountId: string | null; gapsByAccount: Record<string, number> }) {
  // useSearchParams (for the viewed account's gaps badge) needs Suspense.
  return (
    <Suspense>
      <BottomNavInner {...props} />
    </Suspense>
  );
}

function BottomNavInner({ activeAccountId, gapsByAccount }: { activeAccountId: string | null; gapsByAccount: Record<string, number> }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewing = searchParams.get("account") || activeAccountId || "";
  const gapCount = gapsByAccount[viewing] ?? 0;
  const current = sectionOf(pathname);

  return (
    <nav
      aria-label="Sections"
      className="tabbar fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-[color:var(--line)] bg-[color:var(--surface)] md:hidden"
    >
      {TABS.map((s) => {
        const active = current?.id === s.id;
        return (
          <Link
            key={s.id}
            href={s.href}
            aria-current={active ? "page" : undefined}
            className={
              "relative flex flex-1 flex-col items-center gap-1 rounded-[10px] px-2 py-1.5 text-center text-[11px] " +
              (active ? "font-semibold text-[color:var(--ink)]" : "font-medium text-[color:var(--ink-2)]")
            }
          >
            <Icon name={s.icon} className="h-5 w-5" />
            {s.label}
            {s.id === "journal" && gapCount > 0 && (
              <span
                aria-label={`${gapCount} declared gap${gapCount === 1 ? "" : "s"}`}
                className="absolute right-1/4 top-0 min-w-4 -translate-y-1 rounded-full border border-[color:var(--warn)] bg-[color:var(--warn-soft)] px-1 text-center text-[10px] font-bold leading-4 text-[color:var(--warn-text)]"
              >
                {gapCount > 9 ? "9+" : gapCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
