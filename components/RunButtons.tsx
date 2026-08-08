"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import Icon from "./Icon";

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
          <button key={c} type="button" disabled={running !== null} onClick={() => run(c)} className="btn">
            <Icon name="play" className="h-4 w-4" />
            {running === c ? `Running ${c}…` : `Run ${c}`}
          </button>
        ))}
      </div>
      {result && <p className="mt-2 text-sm text-[color:var(--ink-2)]">{result}</p>}
    </div>
  );
}
