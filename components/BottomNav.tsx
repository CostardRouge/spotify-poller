"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import AccountSelect, { AccountOption } from "./AccountSelect";
import Icon, { IconName } from "./Icon";

// Same four slots as the old mobile tabbar: Overview, Events, Playback, More.
const PRIMARY: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Overview", icon: "overview" },
  { href: "/events", label: "Events", icon: "events" },
  { href: "/playback", label: "Playback", icon: "playback" },
];

const MORE_LINKS: { href: string; label: string; icon: IconName }[] = [
  { href: "/runs", label: "Runs", icon: "runs" },
  { href: "/gaps", label: "Gaps", icon: "gaps" },
  { href: "/stats", label: "Stats", icon: "stats" },
  { href: "/accounts", label: "Accounts", icon: "accounts" },
  { href: "/database", label: "Database", icon: "database" },
];

/**
 * Phone navigation (PRODUCT.md: phone-complete): the sidebar disappears below
 * md, this bar takes over — three primary sections plus a More sheet with the
 * rest, the collector run actions, the view-scope selector and Settings.
 */
export default function BottomNav(props: {
  accounts: AccountOption[];
  activeAccountId: string | null;
  gapsByAccount: Record<string, number>;
}) {
  // useSearchParams (for the viewed account's gaps badge) needs Suspense.
  return (
    <Suspense>
      <BottomNavInner {...props} />
    </Suspense>
  );
}

function BottomNavInner({
  accounts,
  activeAccountId,
  gapsByAccount,
}: {
  accounts: AccountOption[];
  activeAccountId: string | null;
  gapsByAccount: Record<string, number>;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [runResult, setRunResult] = useState<string | null>(null);
  const viewing = searchParams.get("account") || activeAccountId || "";
  const gapCount = gapsByAccount[viewing] ?? 0;

  async function run(collector: string) {
    setRunResult(`running ${collector}…`);
    const res = await fetch(`/api/run?collector=${collector}`, { method: "POST" });
    const body = await res.json().catch(() => ({}));
    setRunResult(
      res.ok ? `${collector}: ${body.status} — ${body.inserted ?? 0} new` : `${collector}: ${body.error ?? "failed"}`
    );
    router.refresh();
  }

  const itemClass = (active: boolean) =>
    "flex flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1.5 text-center text-[11px] " +
    (active ? "bg-[color:var(--accent-soft)] font-medium text-[color:var(--ink)]" : "text-[color:var(--ink-2)]");

  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-[color:var(--line)] bg-[color:var(--surface)] p-2 md:hidden"
      >
        {PRIMARY.map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={itemClass(pathname === item.href)}>
            <Icon name={item.icon} className="h-4 w-4" />
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => {
            setRunResult(null);
            dialogRef.current?.showModal();
          }}
          className={"relative " + itemClass(MORE_LINKS.some((l) => l.href === pathname))}
        >
          <Icon name="more" className="h-4 w-4" />
          More
          {gapCount > 0 && (
            <span
              aria-label={`${gapCount} declared gap(s)`}
              className="absolute right-1/4 top-0 min-w-4 -translate-y-1 rounded-full bg-[color:var(--danger)] px-1 text-center text-[10px] font-bold leading-4 text-[color:var(--on-accent)]"
            >
              {gapCount > 9 ? "9+" : gapCount}
            </span>
          )}
        </button>
      </nav>

      <dialog
        ref={dialogRef}
        onClick={(e) => {
          if (e.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto w-full max-w-sm rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-0 text-[color:var(--text)]"
        aria-label="More"
      >
        <div className="p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg">More</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="btn ghost icon-only"
              aria-label="Close"
            >
              <Icon name="x" className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            {MORE_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dialogRef.current?.close()}
                className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-[color:var(--ink-2)] hover:bg-[color:var(--surface-2)] hover:text-[color:var(--ink)]"
              >
                <Icon name={item.icon} className="h-4 w-4" />
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mt-3 border-t border-[color:var(--line-soft)] pt-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => run("played")}
                className="btn"
              >
                <Icon name="play" className="h-4 w-4" />
                Run played
              </button>
              <button
                type="button"
                onClick={() => run("liked")}
                className="btn"
              >
                <Icon name="play" className="h-4 w-4" />
                Run liked
              </button>
              <button
                type="button"
                onClick={() => {
                  dialogRef.current?.close();
                  window.dispatchEvent(new Event("sp:open-settings"));
                }}
                className="btn"
              >
                <Icon name="settings" className="h-4 w-4" />
                Settings
              </button>
            </div>
            {runResult && <p className="mt-2 text-xs text-[color:var(--muted)]">{runResult}</p>}
          </div>

          {accounts.length > 0 && (
            <div className="mt-3 border-t border-[color:var(--line-soft)] pt-3">
              <AccountSelect accounts={accounts} activeId={activeAccountId} />
            </div>
          )}
        </div>
      </dialog>
    </>
  );
}
