"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";
import ThemeToggle from "./ThemeToggle";
import Icon from "./Icon";

/**
 * The account button and the menu it opens (2026-11-27, design lab iteration
 * 2, borrowed from Spotify Calendar's account menu). It replaces three things
 * that each did part of the job: the settings dialog (theme, maintenance,
 * server read-out, lock), the sidebar's "Viewing" select and theme switch,
 * and the phone's "More" sheet. Everything that is a preference or a
 * one-off maintenance gesture lives here; the server read-out moved to
 * System, where it is configuration; the run buttons stay on Now, where the
 * verdict that calls for them is.
 *
 * One <dialog>, opened by the `sp:open-account` window event from either
 * trigger: on a desk it is a menu anchored above the sidebar's account
 * button, on a phone a sheet from the bottom (`.account-dialog` in
 * app/globals.css). showModal gives focus trapping and Esc for free.
 */

/** What the shell knows about each connected account. */
export interface AccountOption {
  id: string;
  display_name: string | null;
}

export interface AccountMenuInfo {
  version: string;
  backupDir: string;
  backupEnabled: boolean;
  /** How many System rows want attention (backups off, no watchdog…). */
  toCheck: number;
}

function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function useViewing(accounts: AccountOption[], activeId: string | null) {
  const searchParams = useSearchParams();
  const id = searchParams.get("account") || activeId || "";
  const account = accounts.find((a) => a.id === id) ?? null;
  return { id, account, name: account ? (account.display_name ?? account.id) : "No account" };
}

const open = () => window.dispatchEvent(new Event("sp:open-account"));

function SidebarButtonInner({
  accounts,
  activeId,
  eventsByAccount,
}: {
  accounts: AccountOption[];
  activeId: string | null;
  eventsByAccount: Record<string, number>;
}) {
  const v = useViewing(accounts, activeId);
  const count = eventsByAccount[v.id];
  const role = !v.account ? "connect one in System" : v.id === activeId ? "collected" : "view only";
  return (
    <button type="button" onClick={open} aria-haspopup="dialog" aria-label={`Account and settings — viewing ${v.name}`} className="account-button">
      <span aria-hidden className="avatar">
        {initial(v.name)}
      </span>
      <span className="flex min-w-0 flex-1 flex-col text-left">
        <span className="truncate text-sm font-semibold text-[color:var(--ink)]">{v.name}</span>
        <span className="truncate text-xs text-[color:var(--ink-2)]">
          {role}
          {count ? ` · ${count.toLocaleString()} plays` : ""}
        </span>
      </span>
      <Icon name="chevron-up" className="h-3.5 w-3.5 shrink-0 text-[color:var(--ink-2)]" />
    </button>
  );
}

/** The sidebar's account button: who is being viewed, and the door to the menu. */
export function AccountSidebarButton(props: {
  accounts: AccountOption[];
  activeId: string | null;
  eventsByAccount: Record<string, number>;
}) {
  // useSearchParams needs a Suspense boundary in a client component.
  return (
    <Suspense>
      <SidebarButtonInner {...props} />
    </Suspense>
  );
}

function AvatarInner({ accounts, activeId }: { accounts: AccountOption[]; activeId: string | null }) {
  const v = useViewing(accounts, activeId);
  return (
    <button type="button" onClick={open} aria-haspopup="dialog" aria-label={`Account and settings — viewing ${v.name}`} className="avatar lg">
      {initial(v.name)}
    </button>
  );
}

/** The phone header's round account button. */
export function AccountAvatar(props: { accounts: AccountOption[]; activeId: string | null }) {
  return (
    <Suspense>
      <AvatarInner {...props} />
    </Suspense>
  );
}

function BackupRow({ info }: { info: AccountMenuInfo }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  async function backup() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      setResult(
        res.ok
          ? `Written: ${body.file} (${(body.bytes / 1024 / 1024).toFixed(1)} MB). It holds the refresh token: keep it as private as .env.`
          : `Backup failed: ${body.error ?? res.status}`
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <button type="button" className="menu-row" disabled={busy} onClick={backup} title={`Full .db snapshot into ${info.backupDir} on the host — never downloadable from here`}>
        <Icon name="archive" className="h-4 w-4" />
        {busy ? "Writing snapshot…" : "Write backup now"}
        <span className="menu-meta">{info.backupEnabled ? "scheduled" : "not scheduled"}</span>
      </button>
      {result && <p className="px-3 pb-1 text-xs leading-snug text-[color:var(--ink-2)]">{result}</p>}
    </>
  );
}

function DialogInner({
  accounts,
  activeId,
  eventsByAccount,
  info,
}: {
  accounts: AccountOption[];
  activeId: string | null;
  eventsByAccount: Record<string, number>;
  info: AccountMenuInfo;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const ref = useRef<HTMLDialogElement>(null);
  const v = useViewing(accounts, activeId);

  useEffect(() => {
    const onOpen = () => ref.current?.showModal();
    window.addEventListener("sp:open-account", onOpen);
    return () => window.removeEventListener("sp:open-account", onOpen);
  }, []);

  const close = () => ref.current?.close();

  // Looking is not collecting (PRODUCT.md): this only changes ?account=, the
  // scope every read endpoint accepts; the collected account is untouched.
  function view(id: string) {
    const params = new URLSearchParams(searchParams);
    params.delete("offset");
    if (!id || id === activeId) params.delete("account");
    else params.set("account", id);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  async function lock() {
    await fetch("/api/auth/logout", { method: "POST" });
    close();
    // ?signed_out=1 keeps /login on screen in sesame mode: a bare /login would
    // hand over to Sésame, whose own session would sign straight back in.
    router.push("/login?signed_out=1");
    router.refresh();
  }

  return (
    <dialog
      ref={ref}
      className="account-dialog"
      aria-label="Account and settings"
      onClick={(e) => {
        if (e.target === ref.current) close();
      }}
    >
      <div className="flex flex-col gap-1 p-2.5">
        <span aria-hidden className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-[color:var(--line-strong)] md:hidden" />
        <div className="flex items-center justify-between px-3 pt-1">
          <span className="menu-label">Viewing</span>
          <button type="button" onClick={close} className="btn ghost icon-only md:hidden" aria-label="Close">
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>
        {accounts.length === 0 ? (
          <Link href="/accounts" onClick={close} className="menu-row">
            <Icon name="accounts" className="h-4 w-4" />
            Connect a Spotify account
          </Link>
        ) : (
          <div role="radiogroup" aria-label="Account shown" className="flex flex-col gap-0.5">
            {accounts.map((a) => {
              const on = a.id === v.id;
              const name = a.display_name ?? a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => view(a.id)}
                  className={"menu-row " + (on ? "on" : "")}
                >
                  <span aria-hidden className={"avatar sm " + (on ? "" : "muted")}>
                    {initial(name)}
                  </span>
                  <span className="min-w-0 truncate">{name}</span>
                  <span className={"menu-meta " + (a.id === activeId ? "ok" : "")}>
                    {a.id === activeId ? "collected" : "view only"}
                    {eventsByAccount[a.id] ? ` · ${eventsByAccount[a.id].toLocaleString()}` : ""}
                  </span>
                  {on && <Icon name="check" className="h-4 w-4 shrink-0" />}
                </button>
              );
            })}
          </div>
        )}
        {accounts.length > 1 && (
          <p className="px-3 pb-1 text-xs leading-snug text-[color:var(--ink-2)]">
            Looking is not collecting: this changes what the pages show, never which account is polled.
          </p>
        )}

        <hr className="menu-sep" />
        <span className="menu-label px-3 pt-1">Theme</span>
        <div className="px-1.5 pb-1">
          <ThemeToggle />
        </div>

        <hr className="menu-sep" />
        <a href="/api/export" className="menu-row" title="NDJSON download of every event — carries no secret">
          <Icon name="download" className="h-4 w-4" />
          Export NDJSON
          <span className="menu-meta">{eventsByAccount[v.id] ? `${eventsByAccount[v.id].toLocaleString()} plays` : ""}</span>
        </a>
        <BackupRow info={info} />
        <button
          type="button"
          className="menu-row desk-only"
          onClick={() => {
            close();
            window.dispatchEvent(new Event("sp:open-shortcuts"));
          }}
        >
          <Icon name="keyboard" className="h-4 w-4" />
          Keyboard shortcuts
          <span className="menu-meta">?</span>
        </button>
        <Link href="/system" onClick={close} className="menu-row">
          <Icon name="system" className="h-4 w-4" />
          System
          <span className={"menu-meta " + (info.toCheck ? "warn" : "")}>
            {info.toCheck ? `${info.toCheck} to check` : "all set"}
          </span>
        </Link>
        <span className="menu-row quiet">
          <Icon name="info" className="h-4 w-4" />
          Témoin
          <span className="menu-meta">v{info.version}</span>
        </span>

        <hr className="menu-sep" />
        <button type="button" onClick={lock} className="menu-row danger">
          <Icon name="power" className="h-4 w-4" />
          Sign out &amp; lock
        </button>
      </div>
    </dialog>
  );
}

/** The menu itself, mounted once in the dashboard layout. */
export default function AccountDialog(props: {
  accounts: AccountOption[];
  activeId: string | null;
  eventsByAccount: Record<string, number>;
  info: AccountMenuInfo;
}) {
  return (
    <Suspense>
      <DialogInner {...props} />
    </Suspense>
  );
}
