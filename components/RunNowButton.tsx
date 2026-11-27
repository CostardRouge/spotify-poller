"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Runs one collector on demand. The small "Run now" of the collector rows by
 * default; the Overview's verdict card uses it as its main action too, with its
 * own label and weight (`variant`).
 */
const VARIANT = { sm: "btn sm", primary: "btn primary lg", outline: "btn outline lg" } as const;

export default function RunNowButton({
  collector,
  label = "Run now",
  variant = "sm",
}: {
  collector: string;
  label?: string;
  variant?: keyof typeof VARIANT;
}) {
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
    <button type="button" disabled={busy} onClick={run} className={VARIANT[variant]}>
      {busy ? "Running…" : label}
    </button>
  );
}
