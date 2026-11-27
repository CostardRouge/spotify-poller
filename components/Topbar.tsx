"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import Icon from "./Icon";
import { AccountAvatar, type AccountOption } from "./AccountMenu";
import { useStatus, verdictOf } from "./useStatus";
import { SUBVIEWS, sectionOf } from "@/lib/nav";

const TITLES: Record<string, { title: string; sub: string }> = {
  "/": { title: "Now", sub: "Is collection alive, and did anything go missing" },
  "/trace": { title: "Trace", sub: "Every day as the pen drew it, gaps declared" },
  "/journal": { title: "Journal", sub: "Every collection attempt, and every window the poller knows it missed" },
  "/events": { title: "Library", sub: "Everything collected, filterable and exportable" },
  "/playback": { title: "Library", sub: "Listening sessions, reconstructed from sampled playback" },
  "/listening": { title: "Library", sub: "What the collected history says about the listening itself" },
  "/system": { title: "System", sub: "What runs the instrument, and what is left to set up" },
  "/accounts": { title: "System", sub: "Connections, tokens and which one is collected" },
  "/database": { title: "System", sub: "What it weighs, what is filling it, and whether it is backed up" },
};

/**
 * The page header (2026-11-27, design lab iteration 2). On a desk it is only
 * the page's title and, inside a section with several views, the segmented
 * row of those views: health, search and settings moved into the sidebar
 * (lib/nav.ts, components/AccountMenu.tsx). On a phone it carries the mark,
 * the health chip on every page but Now (which says it in a sentence), the
 * ⌘K palette and the account button that replaced the "More" sheet.
 */
function SubNav({ pathname }: { pathname: string }) {
  const searchParams = useSearchParams();
  const section = sectionOf(pathname);
  const views = section ? SUBVIEWS[section.id] : undefined;
  if (!views) return null;
  // Keep the viewed account across views: ?account= is the scope every page reads.
  const account = searchParams.get("account");
  const q = account ? `?account=${encodeURIComponent(account)}` : "";
  return (
    <nav aria-label={`${section!.label} views`} className="subnav">
      {views.map((v) => (
        <Link key={v.href} href={`${v.href}${q}`} aria-current={pathname === v.href ? "page" : undefined}>
          {v.label}
        </Link>
      ))}
    </nav>
  );
}

export default function Topbar({ accounts, activeAccountId }: { accounts: AccountOption[]; activeAccountId: string | null }) {
  const pathname = usePathname();
  const status = useStatus();
  const t = TITLES[pathname] ?? TITLES["/"];
  const h = status ? verdictOf(status) : null;
  const isNow = pathname === "/";

  return (
    <header className={"flex flex-col gap-3 px-4 pt-4 sm:px-8 md:pt-7 " + (isNow ? "pb-0" : "pb-2")}>
      {/* Phone row: mark, chip, palette, account. */}
      <div className="flex items-center gap-2 md:hidden">
        <span className="font-[family-name:var(--display)] text-xl font-bold tracking-[-0.03em] text-[color:var(--ink)]">témoin</span>
        <span className="flex-1" />
        {!isNow && (
          <Link href="/" title={h?.why ?? "Collection health"} className={`chip ${h?.tone ?? ""}`}>
            <span aria-hidden className={`voyant ${h?.tone ?? ""}`} />
            {h?.text ?? "Checking…"}
          </Link>
        )}
        <button
          type="button"
          onClick={() => window.dispatchEvent(new Event("sp:open-palette"))}
          aria-label="Jump to a section or action"
          className="btn ghost icon-only"
        >
          <Icon name="search" className="h-4 w-4" />
        </button>
        <AccountAvatar accounts={accounts} activeId={activeAccountId} />
      </div>

      {!isNow && (
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <h1 className="font-[family-name:var(--display)] text-2xl font-bold leading-tight tracking-[-0.03em] text-[color:var(--ink)] md:text-[2rem]">
              {t.title}
            </h1>
            <p className="text-sm text-[color:var(--ink-2)]">{t.sub}</p>
          </div>
          <Suspense>
            <SubNav pathname={pathname} />
          </Suspense>
        </div>
      )}
    </header>
  );
}
