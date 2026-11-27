import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount, gapCountsByAccount, getActiveAccountId, listAccounts } from "@/lib/server/db";
import { authStatus } from "@/lib/server/spotify/auth";
import { getRateLimit } from "@/lib/server/spotify/api";
import { VERSION } from "@/lib/version";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import CommandPalette from "@/components/CommandPalette";
import ShortcutsDialog from "@/components/ShortcutsDialog";
import Topbar from "@/components/Topbar";
import Alerts from "@/components/Alerts";
import AccountDialog from "@/components/AccountMenu";
import { systemChecks } from "@/lib/server/system";

// Every page under this layout reads live SQLite state (and requires the
// admin session the proxy already enforces) — never prerender it statically.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const env = getEnv();
  const accounts = listAccounts(env).map((a) => ({ id: a.id, display_name: a.display_name }));
  const activeAccountId = getActiveAccountId(env);
  const eventsByAccount = eventCountsByAccount(env);
  const gapsByAccount = gapCountsByAccount(env);
  const auth = authStatus(env);
  const rateLimit = getRateLimit(env);
  // What System wants looked at, counted once for the sidebar and the menu.
  const toCheck = systemChecks(env).filter((c) => c.warn).length;

  // overflow-x-clip: whatever a page lets overflow sideways, the window never
  // scrolls horizontally. Without it, a card wider than its column (the Now
  // page's status card at mid widths, 2026-11-27) dragged the whole layout
  // left in Safari, so the sidebar lost its left padding and "Viewing" touched
  // the edge. `clip`, not `hidden`: it makes no scroll container, so nothing
  // sticky inside stops sticking.
  return (
    <div className="flex min-h-screen overflow-x-clip bg-[color:var(--bg)]">
      <Sidebar
        accounts={accounts}
        activeAccountId={activeAccountId}
        eventsByAccount={eventsByAccount}
        gapsByAccount={gapsByAccount}
        toCheck={toCheck}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar accounts={accounts} activeAccountId={activeAccountId} />
        <Alerts auth={auth} rateLimit={rateLimit} playbackEnabled={env.PLAYBACK_ENABLED} />
        <main className="tabbar-clearance min-w-0 flex-1 overflow-x-hidden px-4 pt-6 sm:px-8">{children}</main>
      </div>
      <BottomNav activeAccountId={activeAccountId} gapsByAccount={gapsByAccount} />
      <CommandPalette />
      <ShortcutsDialog />
      <AccountDialog
        accounts={accounts}
        activeId={activeAccountId}
        eventsByAccount={eventsByAccount}
        info={{ version: VERSION, backupDir: env.BACKUP_DIR, backupEnabled: env.BACKUP_ENABLED, toCheck }}
      />
    </div>
  );
}
