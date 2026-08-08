import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount, getActiveAccountId, listAccounts } from "@/lib/server/db";
import { schedulerEnabled } from "@/lib/server/scheduler";
import manifest from "@/manifest.json";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import CommandPalette from "@/components/CommandPalette";
import SettingsDialog from "@/components/SettingsDialog";
import ShortcutsDialog from "@/components/ShortcutsDialog";

// Every page under this layout reads live SQLite state (and requires the
// admin session the proxy already enforces) — never prerender it statically.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const env = getEnv();
  const accounts = listAccounts(env).map((a) => ({ id: a.id, display_name: a.display_name }));
  const activeAccountId = getActiveAccountId(env);
  const eventsByAccount = eventCountsByAccount(env);

  return (
    <div className="flex min-h-screen bg-[color:var(--bg)]">
      <Sidebar accounts={accounts} activeAccountId={activeAccountId} eventsByAccount={eventsByAccount} />
      <main className="min-w-0 flex-1 overflow-x-hidden px-4 py-6 pb-24 sm:px-8 sm:py-8 md:pb-8">{children}</main>
      <BottomNav accounts={accounts} activeAccountId={activeAccountId} />
      <CommandPalette />
      <ShortcutsDialog />
      <SettingsDialog
        info={{
          authMode: env.AUTH_MODE,
          timezone: env.TIMEZONE,
          scheduleEnabled: schedulerEnabled(),
          playbackEnabled: env.PLAYBACK_ENABLED,
          backupEnabled: env.BACKUP_ENABLED,
          backupDir: env.BACKUP_DIR,
          backupKeep: env.BACKUP_KEEP,
          watchdogConfigured: !!env.WATCHDOG_URL,
          ntfyConfigured: !!env.NTFY_URL,
          version: manifest.version,
        }}
      />
    </div>
  );
}
