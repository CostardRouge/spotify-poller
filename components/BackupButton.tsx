"use client";

import { useState } from "react";
import Icon from "./Icon";

export default function BackupButton() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function backup() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/backup", { method: "POST" });
      const body = await res.json();
      setResult(
        res.ok
          ? `snapshot written: ${body.file} (${(body.bytes / 1024 / 1024).toFixed(1)} MB) — contains the refresh token, keep it as private as .env`
          : `backup failed: ${body.error ?? res.status}`
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" disabled={busy} onClick={backup} className="btn">
        <Icon name="archive" className="h-4 w-4" />
        {busy ? "Writing snapshot…" : "Write backup now"}
      </button>
      {result && <p className="mt-2 text-sm text-[color:var(--ink-2)]">{result}</p>}
    </div>
  );
}
