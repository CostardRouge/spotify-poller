import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount } from "@/lib/server/db";
import { authStatus } from "@/lib/server/spotify/auth";
import StatusPill from "@/components/StatusPill";
import AccountActions from "@/components/AccountActions";

export default function AccountsPage() {
  const env = getEnv();
  const auth = authStatus(env);
  const counts = eventCountsByAccount(env);

  return (
    <div>
      <div className="flex items-center justify-between">
        <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Accounts</h1>
        <a
          href="/api/spotify/login"
          className="rounded-md bg-[color:var(--accent)] px-3 py-1.5 text-sm text-[color:var(--on-accent)]"
        >
          Connect Spotify
        </a>
      </div>
      <p className="mt-1 text-sm text-[color:var(--muted)]">
        Exactly one account is collected at a time. Connecting a different account never overwrites another
        one&apos;s data — reconnect (show_dialog) re-approves scopes on an existing account.
      </p>

      {auth.legacy_token_pending && (
        <div className="mt-4 rounded-md border border-[color:var(--warn)]/40 bg-[color:var(--panel)] p-3 text-sm text-[color:var(--text)]">
          A legacy refresh token is pending adoption — it will be claimed on the next collector run.
        </div>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Account</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Events</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {auth.accounts.map((a) => {
              const isActive = a.id === auth.active_account_id;
              return (
                <tr key={a.id} className="border-t border-[color:var(--line-soft)]">
                  <td className="px-3 py-2">
                    <div className="text-[color:var(--text)]">{a.display_name ?? a.id}</div>
                    <div className="text-xs text-[color:var(--faint)]">{a.id}</div>
                  </td>
                  <td className="px-3 py-2">
                    {isActive && <StatusPill tone="ok">active</StatusPill>}
                    {!isActive && a.status === "revoked" && <StatusPill tone="danger">revoked</StatusPill>}
                    {!isActive && a.status === "ok" && <StatusPill tone="neutral">idle</StatusPill>}
                  </td>
                  <td className="px-3 py-2">
                    {a.scope_state === "ok" && <StatusPill tone="ok">ok</StatusPill>}
                    {a.scope_state === "missing" && <StatusPill tone="warn">missing {a.scopes_missing.join(", ")}</StatusPill>}
                    {a.scope_state === "unknown" && <StatusPill tone="neutral">unknown</StatusPill>}
                  </td>
                  <td className="px-3 py-2 text-[color:var(--muted)]">{(counts[a.id] ?? 0).toLocaleString()}</td>
                  <td className="px-3 py-2">
                    <AccountActions id={a.id} isActive={isActive} />
                  </td>
                </tr>
              );
            })}
            {auth.accounts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No account connected yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
