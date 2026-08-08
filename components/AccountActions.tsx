"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const linkClass =
  "rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--text)] hover:bg-[color:var(--accent-wash)]";

export default function AccountActions({ id, isActive }: { id: string; isActive: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function activate() {
    setBusy(true);
    try {
      await fetch(`/api/accounts/activate?id=${encodeURIComponent(id)}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`Disconnect ${id}? Collected data is kept — only the connection is forgotten.`)) return;
    setBusy(true);
    try {
      await fetch(`/api/accounts/disconnect?id=${encodeURIComponent(id)}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {!isActive && (
        <button type="button" disabled={busy} onClick={activate} className={`${linkClass} disabled:opacity-50`}>
          Activate
        </button>
      )}
      {/* Reconnect = the same authorize flow; show_dialog re-shows the consent
          screen so a scope added later actually gets granted (scope drift). */}
      <a href="/api/spotify/login" className={linkClass}>
        Reconnect
      </a>
      <a href={`/events?account=${encodeURIComponent(id)}`} className={linkClass}>
        View events
      </a>
      <button
        type="button"
        disabled={busy}
        onClick={disconnect}
        className="rounded-md border border-[color:var(--line)] px-2.5 py-1 text-xs text-[color:var(--danger)] hover:bg-[color:var(--accent-wash)] disabled:opacity-50"
      >
        Disconnect
      </button>
    </div>
  );
}
