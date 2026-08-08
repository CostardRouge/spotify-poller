"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import BackupButton from "./BackupButton";

export interface ServerInfo {
  authMode: string;
  timezone: string;
  scheduleEnabled: boolean;
  playbackEnabled: boolean;
  backupEnabled: boolean;
  backupDir: string;
  backupKeep: number;
  watchdogConfigured: boolean;
  ntfyConfigured: boolean;
  version: string;
}

const SHORTCUTS: [string, string][] = [
  ["Command palette", "⌘K"],
  ["Jump to section", "1…7"],
  ["Search events", "/"],
  ["Cycle theme", "T"],
  ["Refresh current view", "R"],
  ["Shortcuts (this list)", "?"],
  ["Close any overlay", "Esc"],
];

function InfoRow({ tone, label, value, sub }: { tone: "ok" | "warn" | null; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[color:var(--line-soft)] px-3 py-2 first:border-t-0">
      <div>
        <p className="text-sm text-[color:var(--text)]">{label}</p>
        <p className="mt-0.5 text-xs text-[color:var(--muted)]">{sub}</p>
      </div>
      <span
        className={
          "shrink-0 text-sm " +
          (tone === "ok"
            ? "text-[color:var(--ok)]"
            : tone === "warn"
              ? "text-[color:var(--warn)]"
              : "text-[color:var(--text)]")
        }
      >
        {value}
      </span>
    </div>
  );
}

/**
 * The old debug UI's settings dialog: theme, maintenance actions, keyboard
 * shortcuts and the server configuration read-out. Opened from anywhere via
 * the `sp:open-settings` window event (sidebar, bottom bar, ⌘K palette).
 * "Sign out & lock" replaces the old "Forget token & lock" — the JWT session
 * cookie is cleared instead of a localStorage token.
 */
export default function SettingsDialog({ info }: { info: ServerInfo }) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);

  useEffect(() => {
    const open = () => dialogRef.current?.showModal();
    const openKeys = () => {
      setShowShortcuts(true);
      dialogRef.current?.showModal();
    };
    window.addEventListener("sp:open-settings", open);
    window.addEventListener("sp:open-shortcuts", openKeys);
    return () => {
      window.removeEventListener("sp:open-settings", open);
      window.removeEventListener("sp:open-shortcuts", openKeys);
    };
  }, []);

  async function lock() {
    await fetch("/api/auth/logout", { method: "POST" });
    dialogRef.current?.close();
    router.push("/login");
    router.refresh();
  }

  return (
    <dialog
      ref={dialogRef}
      onClose={() => setShowShortcuts(false)}
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-0 text-[color:var(--text)]"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--serif)] text-lg">Settings</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--muted)] hover:bg-[color:var(--panel-2)]"
          >
            Close (Esc)
          </button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">Theme</h3>
          <div className="mt-2">
            <ThemeToggle />
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">Maintenance</h3>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <BackupButton />
            <button
              type="button"
              onClick={() => setShowShortcuts((v) => !v)}
              className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm text-[color:var(--text)] hover:bg-[color:var(--accent-wash)]"
              aria-expanded={showShortcuts}
            >
              Keyboard shortcuts
            </button>
          </div>
          <p className="mt-2 text-xs text-[color:var(--muted)]">
            A backup writes a full <code>.db</code> snapshot into <code>{info.backupDir}</code> on the host. It holds
            the Spotify refresh token in clear, so it is never downloadable from here.
          </p>
          {showShortcuts && (
            <dl className="mt-3 grid grid-cols-[1fr_auto] gap-y-1.5 rounded-md border border-[color:var(--line-soft)] bg-[color:var(--panel-2)] p-3 text-sm">
              {SHORTCUTS.map(([what, key]) => (
                <div key={what} className="contents">
                  <dt className="text-[color:var(--muted)]">{what}</dt>
                  <dd className="font-[family-name:var(--mono)] text-xs text-[color:var(--text)]">{key}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted)]">Server</h3>
          <div className="mt-2 rounded-md border border-[color:var(--line)]">
            <InfoRow
              tone={info.scheduleEnabled ? "ok" : null}
              label="Scheduler"
              value={info.scheduleEnabled ? "In-process" : "External (systemd)"}
              sub={
                info.scheduleEnabled
                  ? "played every 30 min, liked daily, inside this process"
                  : "collection driven by systemd timers"
              }
            />
            <InfoRow
              tone={info.playbackEnabled ? "ok" : null}
              label="Playback collector"
              value={info.playbackEnabled ? "On" : "Off"}
              sub="opt-in /me/player ticker — device, volume, skip/finish detail"
            />
            <InfoRow
              tone={info.backupEnabled ? "ok" : "warn"}
              label="Backups"
              value={info.backupEnabled ? "Enabled" : "Disabled"}
              sub={
                info.backupEnabled
                  ? `${info.backupDir} · keep ${info.backupKeep}`
                  : "Set BACKUP_ENABLED=1 to snapshot the database."
              }
            />
            <InfoRow
              tone={info.watchdogConfigured ? "ok" : "warn"}
              label="Watchdog"
              value={info.watchdogConfigured ? "Configured" : "Not configured"}
              sub={
                info.watchdogConfigured
                  ? "Alerts on silence — the only thing that catches a dead poller."
                  : "Without WATCHDOG_URL nothing alerts you when the poller goes quiet."
              }
            />
            <InfoRow
              tone={info.ntfyConfigured ? "ok" : null}
              label="ntfy"
              value={info.ntfyConfigured ? "Configured" : "Not configured"}
              sub="Push channel for actionable events. It cannot detect silence."
            />
            <InfoRow
              tone={null}
              label="Auth mode"
              value={info.authMode}
              sub={info.authMode === "proxy" ? "A reverse proxy authenticates requests." : "JWT session unlocked by ADMIN_TOKEN."}
            />
            <InfoRow tone={null} label="Timezone" value={info.timezone} sub="Display only; every timestamp is stored in UTC." />
            <InfoRow tone={null} label="Version" value={info.version} sub="manifest.json" />
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between border-t border-[color:var(--line-soft)] pt-4">
          <button
            type="button"
            onClick={lock}
            className="rounded-md border border-[color:var(--line)] px-3 py-1.5 text-sm text-[color:var(--danger)] hover:bg-[color:var(--accent-wash)]"
          >
            Sign out &amp; lock
          </button>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm text-[color:var(--on-accent)]"
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
