import Icon, { IconName } from "./Icon";
import type { AuthStatusView } from "@/lib/server/spotify/auth";

interface AlertItem {
  tone: "warn" | "bad";
  icon: IconName;
  body: React.ReactNode;
  action?: React.ReactNode;
}

/**
 * The contextual alert banners the old UI rendered above every tab: connect,
 * revoked token, scope drift, unknown grant, active rate limit. Server
 * component fed by the layout so every page shows them — a problem with
 * collection must never be more than one glance away (PRODUCT.md).
 */
export default function Alerts({
  auth,
  rateLimit,
  playbackEnabled,
}: {
  auth: AuthStatusView;
  rateLimit: { limited: boolean; until: string | null };
  playbackEnabled: boolean;
}) {
  const active = auth.accounts.find((a) => a.id === auth.active_account_id);
  const items: AlertItem[] = [];
  const connectBtn = (label: string) => (
    <a href="/api/spotify/login" className="btn primary sm">
      {label}
    </a>
  );

  if (!auth.connected) {
    items.push({
      tone: "bad",
      icon: "link",
      body: (
        <>
          No Spotify account is connected, so nothing is being collected. Spotify only keeps the last 50 played
          tracks: every hour without a connection is history you cannot get back.
        </>
      ),
      action: connectBtn("Connect Spotify"),
    });
  } else if (active && active.status === "revoked") {
    items.push({
      tone: "bad",
      icon: "power",
      body: (
        <>
          Spotify revoked the token for <strong>{active.display_name || active.id}</strong>. Collection is stopped
          until you reconnect.
        </>
      ),
      action: connectBtn("Reconnect"),
    });
  }

  // Scope drift: Spotify keeps honouring the OLD grant, so a newly required
  // scope only surfaces as a 403 deep inside a collector. Say it up front.
  if (auth.connected && auth.scope_state === "missing") {
    items.push({
      tone: "warn",
      icon: "gaps",
      body: (
        <>
          The collecting account is missing a Spotify permission:{" "}
          <code className="font-[family-name:var(--mono)]">{auth.scopes_missing.join(", ")}</code>. Collection
          continues without that feature until you reconnect.
        </>
      ),
      action: connectBtn("Reconnect"),
    });
  } else if (auth.connected && auth.scope_state === "unknown" && playbackEnabled) {
    items.push({
      tone: "warn",
      icon: "gaps",
      body: (
        <>
          The grant for the collecting account was never recorded, so we cannot tell whether{" "}
          <code className="font-[family-name:var(--mono)]">user-read-playback-state</code> was given. Reconnect to
          be sure.
        </>
      ),
      action: connectBtn("Reconnect"),
    });
  }

  if (rateLimit.limited) {
    items.push({
      tone: "warn",
      icon: "info",
      body: (
        <>
          Spotify is rate limiting this app until{" "}
          <span className="font-[family-name:var(--mono)]">{rateLimit.until}</span>. Requests are being held back
          automatically.
        </>
      ),
    });
  }

  if (items.length === 0) return null;
  return (
    <div className="grid gap-2 px-4 pt-4 sm:px-8">
      {items.map((a, i) => (
        <div key={i} role="alert" className={`alert ${a.tone}`}>
          <span className="icon">
            <Icon name={a.icon} className="h-4 w-4" />
          </span>
          <p>{a.body}</p>
          {a.action}
        </div>
      ))}
    </div>
  );
}
