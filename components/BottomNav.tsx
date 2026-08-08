"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useRef, useState } from "react";
import AccountSelect, { AccountOption } from "./AccountSelect";

const PRIMARY = [
  { href: "/", label: "Dashboard" },
  { href: "/events", label: "Events" },
  { href: "/runs", label: "Runs" },
] as const;

const MORE_LINKS = [
  { href: "/gaps", label: "Gaps" },
  { href: "/stats", label: "Stats" },
  { href: "/accounts", label: "Accounts" },
  { href: "/playback", label: "Playback" },
] as const;

/**
 * Phone navigation (PRODUCT.md: phone-complete): the sidebar disappears below
 * md, this bar takes over — three primary sections plus a More sheet with the
 * rest, the collector run actions, the view-scope selector and Settings.
 */
export default function BottomNav({
  accounts,
  activeAccountId,
}: {
  accounts: AccountOption[];
  activeAccountId: string | null;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [runResult, setRunResult] = useState<string | null>(null);

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
    "flex-1 rounded-md px-2 py-2 text-center text-xs " +
    (active ? "bg-[color:var(--accent-wash)] font-medium text-[color:var(--text)]" : "text-[color:var(--muted)]");

  return (
    <>
      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-40 flex gap-1 border-t border-[color:var(--line)] bg-[color:var(--panel)] p-2 md:hidden"
      >
        {PRIMARY.map((item) => (
          <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined} className={itemClass(pathname === item.href)}>
            {item.label}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => {
            setRunResult(null);
            dialogRef.current?.showModal();
          }}
          className={itemClass(MORE_LINKS.some((l) => l.href === pathname))}
        >
          More
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
            <h2 className="font-[family-name:var(--serif)] text-lg">More</h2>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--muted)]"
            >
              Close
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-1">
            {MORE_LINKS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => dialogRef.current?.close()}
                className="rounded-md px-3 py-2 text-sm text-[color:var(--muted)] hover:bg-[color:var(--panel-2)] hover:text-[color:var(--text)]"
              >
                {item.label}
              </Link>
            ))}
          </div>

          <div className="mt-3 border-t border-[color:var(--line-soft)] pt-3">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => run("played")}
                className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm"
              >
                Run played
              </button>
              <button
                type="button"
                onClick={() => run("liked")}
                className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm"
              >
                Run liked
              </button>
              <button
                type="button"
                onClick={() => {
                  dialogRef.current?.close();
                  window.dispatchEvent(new Event("sp:open-settings"));
                }}
                className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm"
              >
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
