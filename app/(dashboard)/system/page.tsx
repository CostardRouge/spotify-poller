import Link from "next/link";
import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount } from "@/lib/server/db";
import { databaseInfo } from "@/lib/server/dbinfo";
import { authStatus } from "@/lib/server/spotify/auth";
import { systemChecks } from "@/lib/server/system";
import { formatBytes, relativeFromNow } from "@/lib/format";
import { VERSION } from "@/lib/version";
import Row from "@/components/Row";

/**
 * System (2026-11-27, design lab iteration 2): the instrument itself — who is
 * collected, where it is stored, what watches it. It is the overview of the
 * section whose details are Accounts and Storage (the old Database page), and
 * the one home of the server read-out that the settings dialog and the Now
 * page used to repeat (lib/server/system.ts).
 *
 * Four figures on top, each one that decides something: the database's
 * weight, the disk under it, and the two settings whose absence means a loss
 * nobody would hear about — backups and the watchdog.
 */
function Kpi({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--surface)] px-5 py-4">
      <span className="text-xs text-[color:var(--ink-2)]">{label}</span>
      <span className="flex items-center gap-2">
        {warn && <span aria-hidden className="voyant warn" />}
        <span className={`font-[family-name:var(--display)] text-2xl font-bold tracking-[-0.03em] ${warn ? "tone-warn" : ""}`}>{value}</span>
      </span>
      <span className="font-[family-name:var(--mono)] text-xs leading-snug text-[color:var(--ink-2)]">{sub}</span>
    </div>
  );
}

export default function SystemPage() {
  const env = getEnv();
  const checks = systemChecks(env);
  const info = databaseInfo(env);
  const auth = authStatus(env);
  const counts = eventCountsByAccount(env);
  const backups = checks.find((c) => c.id === "backups")!;
  const watchdog = checks.find((c) => c.id === "watchdog")!;
  const newestBackup = info.backups[0];

  // The share of the file each kind of row takes, for the one bar on the page.
  const rows = Object.fromEntries(info.rows.map((r) => [r.table, r.rows ?? 0]));
  const parts = [
    { label: "events", n: rows.events ?? 0, cls: "bg-[color:var(--ink)]" },
    { label: "raw responses", n: rows.raw_spotify ?? 0, cls: "bg-[color:var(--ink-2)]" },
    { label: "playback samples", n: rows.playback_samples ?? 0, cls: "bg-[color:var(--line-strong)]" },
  ];
  const partsTotal = parts.reduce((s, p) => s + p.n, 0);

  return (
    <div className="@container grid max-w-6xl gap-4 md:gap-5">
      <div className="grid grid-cols-2 gap-3 @3xl:grid-cols-4 md:gap-4">
        <Kpi label="Database" value={formatBytes(info.total_bytes)} sub={info.events.bytes_per_day ? `+${formatBytes(info.events.bytes_per_day)} a day` : `${info.events.total.toLocaleString()} events`} />
        <Kpi
          label="Disk free"
          value={info.disk ? formatBytes(info.disk.free_bytes) : "—"}
          sub={info.disk ? `${(info.disk.used_ratio * 100).toFixed(0)}% of ${formatBytes(info.disk.total_bytes)} used` : "not readable here"}
          warn={!!info.disk && info.disk.used_ratio >= 0.85}
        />
        <Kpi
          label="Backups"
          value={env.BACKUP_ENABLED ? (newestBackup ? relativeFromNow(newestBackup.modified) : "None yet") : "Off"}
          sub={env.BACKUP_ENABLED ? `${info.backups.length} kept in ${env.BACKUP_DIR}` : "BACKUP_ENABLED=1"}
          warn={backups.warn}
        />
        <Kpi label="Watchdog" value={env.WATCHDOG_URL ? "Set" : "Not set"} sub={env.WATCHDOG_URL ? "alerts on silence" : "nothing alerts on silence"} warn={watchdog.warn} />
      </div>

      <div className="grid gap-4 md:gap-5 @4xl:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <section className="panel">
            <header>
              <h2>Accounts</h2>
              <Link href="/accounts" className="hint underline">
                tokens and scopes
              </Link>
            </header>
            <div className="flex flex-col px-4 py-1">
              {auth.accounts.map((a, i) => {
                const collected = a.id === auth.active_account_id;
                const name = a.display_name ?? a.id;
                return (
                  <div key={a.id} className={`flex items-center gap-3 py-2.5 ${i ? "border-t border-[color:var(--line)]" : ""}`}>
                    <span aria-hidden className={"avatar " + (collected ? "" : "muted")}>
                      {(name.trim()[0] ?? "?").toUpperCase()}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-sm font-semibold">{name}</span>
                      <span className="truncate font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                        {(counts[a.id] ?? 0).toLocaleString()} events · token {a.status}
                      </span>
                    </span>
                    <span className={`flex shrink-0 items-center gap-1.5 text-xs font-semibold ${collected ? "tone-ok" : "text-[color:var(--ink-2)]"}`}>
                      {collected && <span aria-hidden className="voyant ok" />}
                      {collected ? "collected" : "view only"}
                    </span>
                  </div>
                );
              })}
              {auth.accounts.length === 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm">
                  <span className="text-[color:var(--ink-2)]">No Spotify account connected yet.</span>
                  <a href="/api/spotify/login" className="btn sm primary">
                    Connect Spotify
                  </a>
                </div>
              )}
            </div>
          </section>

          <section className="panel">
            <header>
              <h2>Storage</h2>
              <Link href="/database" className="hint underline">
                tables, WAL and backups
              </Link>
            </header>
            <div className="flex flex-col gap-3 px-4 py-4">
              {partsTotal > 0 ? (
                <>
                  <div className="flex h-3.5 overflow-hidden rounded-full bg-[color:var(--surface-sunk)]" role="img" aria-label={parts.map((p) => `${p.label} ${p.n.toLocaleString()} rows`).join(", ")}>
                    {parts.map((p) => (p.n ? <span key={p.label} className={p.cls} style={{ width: `${(p.n / partsTotal) * 100}%` }} /> : null))}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[color:var(--ink-2)]">
                    {parts.map((p) => (
                      <span key={p.label} className="flex items-center gap-1.5">
                        <span aria-hidden className={`h-2.5 w-2.5 rounded-[3px] ${p.cls}`} />
                        {p.label} {p.n.toLocaleString()}
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <p className="text-sm text-[color:var(--ink-2)]">Nothing stored yet.</p>
              )}
              <p className="text-xs text-[color:var(--ink-2)]">Rows by table across every account, not bytes: the Storage page weighs each table.</p>
            </div>
          </section>
        </div>

        <section className="panel">
          <header>
            <h2>Server</h2>
            <span className="hint">read from the environment at boot</span>
          </header>
          <div className="rows">
            {checks.map((c) => (
              <Row key={c.id} tone={c.tone} label={c.label} value={c.value} sub={c.sub} />
            ))}
            <Row tone={null} label="Version" value={VERSION} sub="package.json; what each release brought is in CHANGELOG.md." />
          </div>
        </section>
      </div>
    </div>
  );
}
