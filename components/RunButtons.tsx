"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const COLLECTORS = ["played", "liked"] as const;

export default function RunButtons({ playbackEnabled }: { playbackEnabled: boolean }) {
  const router = useRouter();
  const [running, setRunning] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function run(collector: string) {
    setRunning(collector);
    setResult(null);
    try {
      const res = await fetch(`/api/run?collector=${collector}`, { method: "POST" });
      const body = await res.json();
      setResult(
        res.ok
          ? `${collector}: ${body.status} — fetched ${body.fetched}, inserted ${body.inserted}${body.note ? ` (${body.note})` : ""}`
          : `${collector}: ${body.error ?? "failed"}`
      );
      router.refresh();
    } finally {
      setRunning(null);
    }
  }

  const collectors = playbackEnabled ? [...COLLECTORS, "playback" as const] : COLLECTORS;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {collectors.map((c) => (
          <button
            key={c}
            type="button"
            disabled={running !== null}
            onClick={() => run(c)}
            className="rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-1.5 text-sm text-[color:var(--text)] transition-opacity hover:bg-[color:var(--accent-wash)] disabled:opacity-50"
          >
            {running === c ? `Running ${c}…` : `Run ${c}`}
          </button>
        ))}
      </div>
      {result && <p className="mt-2 text-sm text-[color:var(--muted)]">{result}</p>}
    </div>
  );
}
