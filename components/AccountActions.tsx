"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "./Icon";

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
        <button type="button" disabled={busy} onClick={activate} className="btn sm">
          <Icon name="check" className="h-3.5 w-3.5" />
          Activate
        </button>
      )}
      {/* Reconnect = the same authorize flow; show_dialog re-shows the consent
          screen so a scope added later actually gets granted (scope drift). */}
      <a href="/api/spotify/login" className="btn sm">
        <Icon name="link" className="h-3.5 w-3.5" />
        Reconnect
      </a>
      <a href={`/events?account=${encodeURIComponent(id)}`} className="btn sm">
        <Icon name="events" className="h-3.5 w-3.5" />
        View events
      </a>
      <button type="button" disabled={busy} onClick={disconnect} className="btn sm danger">
        <Icon name="x" className="h-3.5 w-3.5" />
        Disconnect
      </button>
    </div>
  );
}
