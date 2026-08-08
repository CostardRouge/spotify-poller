import { getEnv } from "@/lib/server/runtime";
import { getActiveAccountId, listPlaybackSessions } from "@/lib/server/db";
import { GLOBAL_SCOPE } from "@/lib/server/types";
import { formatTimestamp } from "@/lib/format";

type Session = {
  id: string;
  title: string | null;
  subtitle: string | null;
  started_at: string;
  ended_at: string | null;
  completion_ratio: number | null;
  skipped: number | null;
  device_name: string | null;
  close_reason: string | null;
};

export default async function PlaybackPage({
  searchParams,
}: {
  searchParams: Promise<{ offset?: string; account?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();

  if (!env.PLAYBACK_ENABLED) {
    return (
      <div>
        <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Playback</h1>
        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Off by default. Set <code>PLAYBACK_ENABLED=1</code> to poll <code>/me/player</code> and record device,
          volume and skip/finish detail on top of the `played` collector.
        </p>
      </div>
    );
  }

  const scope = sp.account || getActiveAccountId(env) || GLOBAL_SCOPE;
  const limit = 50;
  const offset = Math.max(0, Number(sp.offset) || 0);
  const result = listPlaybackSessions(env, scope, { limit, offset });
  const items = result.items as Session[];

  return (
    <div>
      <h1 className="font-[family-name:var(--serif)] text-2xl text-[color:var(--text)]">Playback</h1>
      <p className="mt-1 text-sm text-[color:var(--muted)]">{result.total.toLocaleString()} session(s) recorded.</p>

      <div className="mt-4 overflow-x-auto rounded-lg border border-[color:var(--line)]">
        <table className="w-full text-left text-sm">
          <thead className="bg-[color:var(--panel-2)] text-xs uppercase tracking-wide text-[color:var(--muted)]">
            <tr>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Title</th>
              <th className="px-3 py-2">Device</th>
              <th className="px-3 py-2">Completion</th>
              <th className="px-3 py-2">Ended by</th>
            </tr>
          </thead>
          <tbody>
            {items.map((s) => (
              <tr key={s.id} className="border-t border-[color:var(--line-soft)]">
                <td className="whitespace-nowrap px-3 py-2 text-[color:var(--muted)]">
                  {formatTimestamp(s.started_at, env.TIMEZONE)}
                </td>
                <td className="px-3 py-2 text-[color:var(--text)]">
                  {s.title ?? "—"}
                  {s.subtitle && <span className="text-[color:var(--muted)]"> — {s.subtitle}</span>}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted)]">{s.device_name ?? "—"}</td>
                <td className="px-3 py-2">
                  {s.completion_ratio != null ? `${Math.round(s.completion_ratio * 100)}%` : "—"}
                  {s.skipped === 1 && <span className="ml-1 text-xs text-[color:var(--warn)]">skipped</span>}
                </td>
                <td className="px-3 py-2 text-[color:var(--muted)]">{s.close_reason ?? "in progress"}</td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-[color:var(--muted)]">
                  No playback sessions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex items-center gap-3 text-sm">
        <a href={`?offset=${Math.max(0, offset - limit)}`} className="btn sm" aria-disabled={offset === 0}>
          ← Previous
        </a>
        <a href={`?offset=${offset + limit}`} className="btn sm" aria-disabled={offset + limit >= result.total}>
          Next →
        </a>
      </div>
    </div>
  );
}
