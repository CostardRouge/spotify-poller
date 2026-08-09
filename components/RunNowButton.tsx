"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** The per-collector "Run now" action from the old Overview's Collection rows. */
export default function RunNowButton({ collector }: { collector: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await fetch(`/api/run?collector=${collector}`, { method: "POST" });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" disabled={busy} onClick={run} className="btn sm">
      {busy ? "Running…" : "Run now"}
    </button>
  );
}
