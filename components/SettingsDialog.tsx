"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import ThemeToggle from "./ThemeToggle";
import BackupButton from "./BackupButton";
import Icon from "./Icon";

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

function InfoRow({ tone, label, value, sub }: { tone: "ok" | "warn" | null; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-[color:var(--line)] px-3 py-2 first:border-t-0">
      <div>
        <p className="flex items-center gap-2 text-sm text-[color:var(--ink)]">
          {tone && <span aria-hidden className={`dot ${tone === "ok" ? "ok" : "warn"}`} />}
          {label}
        </p>
        <p className="mt-0.5 text-xs text-[color:var(--ink-2)]">{sub}</p>
      </div>
      <span
        className={
          "shrink-0 text-sm " +
          (tone === "ok"
            ? "text-[color:var(--ok)]"
            : tone === "warn"
              ? "text-[color:var(--warn)]"
              : "text-[color:var(--ink)]")
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

  useEffect(() => {
    const open = () => dialogRef.current?.showModal();
    window.addEventListener("sp:open-settings", open);
    return () => window.removeEventListener("sp:open-settings", open);
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
      id="settings-dialog"
      onClick={(e) => {
        if (e.target === dialogRef.current) dialogRef.current?.close();
      }}
      className="m-auto w-full max-w-lg rounded-lg border border-[color:var(--line)] bg-[color:var(--surface)] p-0 text-[color:var(--ink)]"
      aria-labelledby="settings-title"
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <h2 id="settings-title" className="text-lg">Settings</h2>
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            className="btn ghost icon-only"
            aria-label="Close"
          >
            <Icon name="x" className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--ink-2)]">Theme</h3>
          <div className="mt-2">
            <ThemeToggle />
          </div>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--ink-2)]">Maintenance</h3>
          <div className="mt-2 flex flex-wrap items-start gap-2">
            <BackupButton />
            <a href="/api/export" className="btn" title="NDJSON download of every event — carries no secret">
              <Icon name="download" className="h-4 w-4" />
              Export NDJSON
            </a>
            <button
              type="button"
              onClick={() => {
                dialogRef.current?.close();
                window.dispatchEvent(new Event("sp:open-shortcuts"));
              }}
              className="btn"
            >
              <Icon name="keyboard" className="h-4 w-4" />
              Keyboard shortcuts
            </button>
          </div>
          <p className="mt-2 text-xs text-[color:var(--ink-2)]">
            A backup writes a full <code className="font-[family-name:var(--mono)]">.db</code> snapshot into{" "}
            <code className="font-[family-name:var(--mono)]">{info.backupDir}</code> on the host. It holds the Spotify
            refresh token in clear, so it is never downloadable from here.
          </p>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-medium uppercase tracking-wide text-[color:var(--ink-2)]">Server</h3>
          <div className="mt-2 rounded-lg border border-[color:var(--line)]">
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

        <div className="mt-5 flex items-center justify-between border-t border-[color:var(--line)] pt-4">
          <button type="button" onClick={lock} className="btn danger">
            <Icon name="power" className="h-4 w-4" />
            Sign out &amp; lock
          </button>
          <button type="button" onClick={() => dialogRef.current?.close()} className="btn">
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
