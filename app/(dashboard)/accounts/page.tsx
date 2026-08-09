import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount } from "@/lib/server/db";
import { authStatus } from "@/lib/server/spotify/auth";
import { formatTimestamp } from "@/lib/format";
import AccountActions from "@/components/AccountActions";
import Icon from "@/components/Icon";
import StatusPill from "@/components/StatusPill";

export default function AccountsPage() {
  const env = getEnv();
  const auth = authStatus(env);
  const counts = eventCountsByAccount(env);

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <a href="/api/spotify/login" className="btn primary">
          <Icon name="link" className="h-4 w-4" />
          Connect a Spotify account
        </a>
      </div>

      {auth.legacy_token_pending && (
        <div role="status" className="alert warn mt-4">
          <span className="icon">
            <Icon name="info" className="h-4 w-4" />
          </span>
          <p>A legacy refresh token is pending adoption — it will be claimed on the next collector run.</p>
        </div>
      )}

      <div className="panel mt-4">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-wide text-[color:var(--ink-2)]">
              <tr>
                <th className="px-3 py-2">Account</th>
                <th className="px-3 py-2">Events</th>
                <th className="px-3 py-2">Connected</th>
                <th className="px-3 py-2">Last seen</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2">Scope</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {auth.accounts.map((a) => {
                const isActive = a.id === auth.active_account_id;
                const bad = a.status !== "ok";
                return (
                  <tr key={a.id} className="border-t border-[color:var(--line)]">
                    <td className="px-3 py-2">
                      <div className="text-[color:var(--ink)]">{a.display_name ?? a.id}</div>
                      <div className="font-[family-name:var(--mono)] text-xs text-[color:var(--ink-3)]">{a.id}</div>
                    </td>
                    <td className="px-3 py-2">{(counts[a.id] ?? 0).toLocaleString()}</td>
                    <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                      {formatTimestamp(a.connected_at, env.TIMEZONE)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                      {a.last_seen_at ? formatTimestamp(a.last_seen_at, env.TIMEZONE) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-1.5">
                        <span aria-hidden className={`dot ${bad ? "bad" : "ok"}`} />
                        {a.status}
                      </span>
                      {isActive && <span className="block text-xs text-[color:var(--ink-2)]">collected</span>}
                    </td>
                    <td className="px-3 py-2">
                      {a.scope_state === "ok" && <StatusPill tone="ok">ok</StatusPill>}
                      {a.scope_state === "missing" && (
                        <StatusPill tone="warn">missing {a.scopes_missing.join(", ")}</StatusPill>
                      )}
                      {a.scope_state === "unknown" && <StatusPill tone="neutral">unknown</StatusPill>}
                    </td>
                    <td className="px-3 py-2">
                      <AccountActions id={a.id} isActive={isActive} />
                    </td>
                  </tr>
                );
              })}
              {auth.accounts.length === 0 && (
                <tr>
                  <td colSpan={7}>
                    <div className="empty">
                      <Icon name="accounts" className="h-6 w-6" />
                      <h3>No account connected</h3>
                      <p>Connecting stores a refresh token in the database and starts collection on the next run.</p>
                      <a href="/api/spotify/login" className="btn sm primary">
                        Connect Spotify
                      </a>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-3 text-sm text-[color:var(--ink-2)]">
        Each connected account owns its data, its cursors and its token, so connecting another one never overwrites
        the previous. Exactly one account is <em>collected</em> at a time; the selector in the sidebar only changes
        what you are <em>looking at</em>.
      </p>
    </div>
  );
}
