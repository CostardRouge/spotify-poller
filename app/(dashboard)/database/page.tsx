import { getEnv } from "@/lib/server/runtime";
import { databaseInfo, integrityCheck, objectBreakdown, DatabaseInfo } from "@/lib/server/dbinfo";
import { formatBytes, formatTimestamp, relativeFromNow } from "@/lib/format";
import Row, { RowTone } from "@/components/Row";
import Icon from "@/components/Icon";

/**
 * Where the database is inspected: what it weighs, what is making it weigh
 * that, whether the disk under it is running out and whether the backups are
 * real. Read-only — nothing here writes, so it is safe to reload while the
 * collectors are running.
 */

/** Free space below this and the disk is a scheduled outage, not a worry. */
const DISK_WARN = 0.85;
const DISK_BAD = 0.95;
/** A WAL this large means checkpoints are not keeping up with the writers. */
const WAL_WARN_BYTES = 64 * 1024 * 1024;
/** Below this share of the file, reclaiming space is not worth a VACUUM. */
const FREELIST_WARN_RATIO = 0.1;

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** "356.9 MB/day" -> what that becomes in a year, which is the number that decides things. */
function projection(bytesPerDay: number | null): string {
  if (bytesPerDay === null || bytesPerDay <= 0) return "not enough history yet to extrapolate";
  return `${formatBytes(bytesPerDay)}/day — about ${formatBytes(bytesPerDay * 365)} a year at this rate`;
}

function diskTone(info: DatabaseInfo): RowTone {
  if (!info.disk) return "none";
  if (info.disk.used_ratio >= DISK_BAD) return "bad";
  if (info.disk.used_ratio >= DISK_WARN) return "warn";
  return "ok";
}

/**
 * How stale the newest backup is allowed to be before it stops counting as a
 * backup: two cadences, so a single missed run is not an alarm but a stopped
 * backup job is.
 */
function backupTone(info: DatabaseInfo): RowTone {
  if (!info.backup_enabled) return "none";
  if (info.backups_error || info.backups.length === 0) return "bad";
  const age = Date.now() - Date.parse(info.backups[0].modified);
  const budget = Number(process.env.BACKUP_EVERY_HOURS ?? "24") * 3_600_000 * 2;
  return age > budget ? "warn" : "ok";
}

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-4">
      <h2 className="text-sm font-medium text-[color:var(--ink)]">{label}</h2>
      <p className="mt-1 font-[family-name:var(--serif)] text-2xl text-[color:var(--ink)]">{value}</p>
      <p className="mt-1 text-xs text-[color:var(--ink-2)]">{sub}</p>
    </div>
  );
}

export default async function DatabasePage({
  searchParams,
}: {
  searchParams: Promise<{ check?: string; breakdown?: string }>;
}) {
  const sp = await searchParams;
  const env = getEnv();
  const info = databaseInfo(env);
  // Both opt-in: each walks every page of the file and blocks collection while
  // it runs, so neither is part of a plain page load (see dbinfo.ts).
  const breakdown = sp.breakdown === "1" ? objectBreakdown(env) : null;
  const integrity = sp.check === "1" ? integrityCheck(env) : null;

  const tz = env.TIMEZONE;
  const freelistRatio = info.file_bytes > 0 ? info.freelist_bytes / info.file_bytes : 0;
  // Only known once the breakdown has been measured — see the retention panel.
  const rawBytes = breakdown?.objects.find((o) => o.name === "raw_spotify")?.bytes ?? null;
  const rawShare = rawBytes === null ? null : pct(rawBytes, info.file_bytes);

  // A schema this size is ~27 objects and all but a handful sit at one page.
  // Listing them in full buries the two rows that answer the question, so the
  // long tail collapses into a single line. The threshold is relative, so a
  // young database — where everything is small — still shows everything.
  const shown = breakdown?.objects.filter((o) => pct(o.bytes, info.file_bytes) >= 0.1) ?? [];
  const collapsed = breakdown?.objects.filter((o) => pct(o.bytes, info.file_bytes) < 0.1) ?? [];
  const collapsedBytes = collapsed.reduce((n, o) => n + o.bytes, 0);
  // Keeps the opted-in panels open across a click on the other one.
  const href = (extra: Record<string, string>) => {
    const q = new URLSearchParams({
      ...(breakdown ? { breakdown: "1" } : {}),
      ...(integrity ? { check: "1" } : {}),
      ...extra,
    });
    return `/database?${q}`;
  };

  return (
    <div className="grid gap-6">
      {/* ---------- the four numbers you came for ---------- */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Database"
          value={formatBytes(info.total_bytes)}
          sub={`${formatBytes(info.file_bytes)} file + ${formatBytes(info.wal_bytes + info.shm_bytes)} WAL/SHM`}
        />
        <Tile
          label="Disk free"
          value={info.disk ? formatBytes(info.disk.free_bytes) : "—"}
          sub={
            info.disk
              ? `${(info.disk.used_ratio * 100).toFixed(0)}% of ${formatBytes(info.disk.total_bytes)} used`
              : "filesystem stats unavailable"
          }
        />
        <Tile
          label="Events"
          value={info.events.total.toLocaleString()}
          sub={
            info.events.oldest
              ? `since ${formatTimestamp(info.events.oldest, tz)}`
              : "nothing collected yet"
          }
        />
        <Tile
          label="Growth"
          value={info.events.bytes_per_day ? `${formatBytes(info.events.bytes_per_day)}/day` : "—"}
          sub={projection(info.events.bytes_per_day)}
        />
      </div>

      {/* ---------- things that need doing, if any ---------- */}
      {info.disk && info.disk.used_ratio >= DISK_WARN && (
        <div className={`alert ${info.disk.used_ratio >= DISK_BAD ? "bad" : "warn"}`}>
          <Icon name="gaps" className="icon h-4 w-4" />
          <p>
            The disk holding the database is {(info.disk.used_ratio * 100).toFixed(0)}% full
            ({formatBytes(info.disk.free_bytes)} left). A full disk stops collection and can corrupt
            a write in progress — the history is irreplaceable, so free space before it gets there.
          </p>
        </div>
      )}
      {info.backups_share_disk === true && (
        <div className="alert warn">
          <Icon name="archive" className="icon h-4 w-4" />
          <p>
            <code className="font-[family-name:var(--mono)]">{info.backup_dir}</code> is on the same
            filesystem as the database. A snapshot stored next to what it protects does not survive
            losing that disk — point BACKUP_DIR at a host bind mount or another device.
          </p>
        </div>
      )}
      {backupTone(info) === "bad" && (
        <div className="alert bad">
          <Icon name="archive" className="icon h-4 w-4" />
          <p>
            {info.backups_error
              ? `BACKUP_DIR is not readable: ${info.backups_error}`
              : "Backups are enabled but there is not a single snapshot in BACKUP_DIR."}{" "}
            Nothing is protecting the history against a disk loss right now.
          </p>
        </div>
      )}
      {info.wal_bytes > WAL_WARN_BYTES && (
        <div className="alert warn">
          <Icon name="info" className="icon h-4 w-4" />
          <p>
            The WAL has grown to {formatBytes(info.wal_bytes)}. It is checkpointed back into the
            database at {info.wal_autocheckpoint} pages, so a WAL this size means a reader is
            holding a snapshot open and blocking the checkpoint.
          </p>
        </div>
      )}

      {/* ---------- storage ---------- */}
      <section className="panel">
        <header>
          <h2>Storage</h2>
          <span className="hint">{info.path}</span>
        </header>
        <div className="rows">
          <Row tone="none" label="Database file" value={formatBytes(info.file_bytes)} sub={`${info.page_count.toLocaleString()} pages of ${formatBytes(info.page_size, 0)}`} />
          <Row tone="none" label="WAL" value={formatBytes(info.wal_bytes)} sub={`checkpoint at ${info.wal_autocheckpoint} pages`} />
          <Row tone="none" label="Shared memory (-shm)" value={formatBytes(info.shm_bytes)} sub="index into the WAL — rebuilt on open, never a leak" />
          <Row
            tone={freelistRatio >= FREELIST_WARN_RATIO ? "warn" : "none"}
            label="Reclaimable"
            value={formatBytes(info.freelist_bytes)}
            sub={
              info.freelist_pages === 0
                ? "no free pages — nothing for VACUUM to return"
                : `${info.freelist_pages.toLocaleString()} free pages (${freelistRatio.toLocaleString(undefined, { style: "percent", maximumFractionDigits: 1 })} of the file), returned to the filesystem by VACUUM`
            }
          />
          <Row
            tone={diskTone(info)}
            label="Filesystem"
            value={info.disk ? `${formatBytes(info.disk.free_bytes)} free` : "unavailable"}
            sub={
              info.disk
                ? `${formatBytes(info.disk.total_bytes - info.disk.free_bytes)} used of ${formatBytes(info.disk.total_bytes)}`
                : "statfs is not available on this platform"
            }
          />
        </div>
      </section>

      {/* ---------- what is taking the space ---------- */}
      <section className="panel">
        <header>
          <h2>What is taking the space</h2>
          <span className="hint">
            {breakdown
              ? breakdown.available
                ? `measured in ${breakdown.ms} ms`
                : "dbstat unavailable"
              : "reads every page — not run automatically"}
          </span>
        </header>
        {!breakdown ? (
          <div className="empty">
            <Icon name="database" className="h-6 w-6" />
            <h3>Attribute the {formatBytes(info.file_bytes)} to a table</h3>
            <p>
              Which table and which index is spending the space. It walks every page of the file, so
              it blocks collection for as long as it runs — a second or so per gigabyte — and is left
              off a plain page load on purpose.
            </p>
            <a href={href({ breakdown: "1" })} className="btn primary">
              Measure
            </a>
          </div>
        ) : breakdown.available ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-[color:var(--surface-2)] text-xs uppercase tracking-wide text-[color:var(--ink-2)]">
                <tr>
                  <th className="px-3 py-2">Object</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2 text-right">Rows</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2 text-right">Per row</th>
                  <th className="w-40 px-3 py-2">Share</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((o) => (
                  <tr key={o.name} className="border-t border-[color:var(--line)]">
                    <td className="px-3 py-2 font-[family-name:var(--mono)]">
                      {o.kind === "index" && <span className="text-[color:var(--ink-3)]">↳ </span>}
                      {o.name}
                    </td>
                    <td className="px-3 py-2 text-[color:var(--ink-2)]">{o.kind}</td>
                    <td className="px-3 py-2 text-right font-[family-name:var(--mono)]">
                      {o.rows === null ? "—" : o.rows.toLocaleString()}
                    </td>
                    <td className="px-3 py-2 text-right font-[family-name:var(--mono)]">
                      {formatBytes(o.bytes)}
                    </td>
                    <td className="px-3 py-2 text-right font-[family-name:var(--mono)] text-[color:var(--ink-2)]">
                      {o.rows && o.rows > 0 ? formatBytes(o.bytes / o.rows, 0) : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex items-center gap-2">
                        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[color:var(--surface-sunk)]">
                          <span
                            className="block h-full rounded-full bg-[color:var(--accent)]"
                            style={{ width: `${Math.max(pct(o.bytes, info.file_bytes), 0.5)}%` }}
                          />
                        </span>
                        <span className="w-10 shrink-0 text-right font-[family-name:var(--mono)] text-xs text-[color:var(--ink-2)]">
                          {pct(o.bytes, info.file_bytes).toFixed(1)}%
                        </span>
                      </span>
                    </td>
                  </tr>
                ))}
                {collapsed.length > 0 && (
                  <tr className="border-t border-[color:var(--line)] text-[color:var(--ink-2)]">
                    <td className="px-3 py-2 italic">
                      {collapsed.length} smaller object{collapsed.length === 1 ? "" : "s"} below 0.1%
                    </td>
                    <td className="px-3 py-2">—</td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2 text-right font-[family-name:var(--mono)]">
                      {formatBytes(collapsedBytes)}
                    </td>
                    <td className="px-3 py-2 text-right">—</td>
                    <td className="px-3 py-2" />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">
            <Icon name="info" className="h-6 w-6" />
            <h3>Per-object sizes unavailable</h3>
            <p>
              This SQLite build has no <code className="font-[family-name:var(--mono)]">dbstat</code>{" "}
              virtual table, so bytes cannot be attributed to a table. The totals above are still exact.
            </p>
          </div>
        )}
      </section>

      {/* ---------- retention ---------- */}
      <section className="panel">
        <header>
          <h2>Retention</h2>
          <span className="hint">what grows, and what ever gets cleaned up</span>
        </header>
        <div className="rows">
          <Row
            tone="none"
            label="events"
            value={`${info.events.total.toLocaleString()} rows`}
            sub={
              info.events.oldest && info.events.newest
                ? `${formatTimestamp(info.events.oldest, tz)} → ${formatTimestamp(info.events.newest, tz)} — kept forever, this is the archive`
                : "nothing collected yet"
            }
          />
          <Row
            tone={rawShare !== null && rawShare > 50 ? "warn" : "none"}
            label="raw_spotify"
            value={`${info.raw.total.toLocaleString()} rows`}
            sub={
              info.raw.total === 0
                ? "no raw responses stored"
                : // The share is only known once the breakdown has been run; the
                  // point stands either way, so the row does not wait for it.
                  `${rawShare === null ? "" : `${rawShare.toFixed(0)}% of the file — `}every API response is kept as evidence (I3) and NOTHING purges it, oldest ${relativeFromNow(info.raw.oldest)}`
            }
          />
          <Row
            tone="none"
            label="playback_samples"
            value={`${info.playback_samples.total.toLocaleString()} rows`}
            sub={
              info.playback_samples.total === 0
                ? "playback collector off, or nothing sampled yet"
                : `oldest ${relativeFromNow(info.playback_samples.oldest)} — purged past PLAYBACK_RETENTION_DAYS (${process.env.PLAYBACK_RETENTION_DAYS ?? "30"} d)`
            }
          />
        </div>
      </section>

      {/* ---------- backups ---------- */}
      <section className="panel">
        <header>
          <h2>Backups</h2>
          <span className="hint">{info.backup_dir}</span>
        </header>
        <div className="rows">
          <Row
            tone={backupTone(info)}
            label="Most recent"
            value={
              info.backups.length > 0
                ? relativeFromNow(info.backups[0].modified)
                : info.backup_enabled
                  ? "never"
                  : "backups disabled"
            }
            sub={
              info.backups_error
                ? `BACKUP_DIR unreadable: ${info.backups_error}`
                : info.backups.length > 0
                  ? `${info.backups[0].name} — ${formatBytes(info.backups[0].bytes)}`
                  : info.backup_enabled
                    ? "BACKUP_DIR holds no snapshot — the scheduler writes one every BACKUP_EVERY_HOURS, or run it now from Settings"
                    : "set BACKUP_ENABLED=1 to snapshot the database on a schedule"
            }
          />
          <Row
            tone="none"
            label="Snapshots kept"
            value={`${info.backups.length} of ${info.backup_keep}`}
            sub={`${formatBytes(info.backups.reduce((n, b) => n + b.bytes, 0))} total — each one holds the Spotify refresh token in clear, keep them as private as .env`}
          />
          <Row
            tone={info.backups_share_disk === true ? "warn" : "none"}
            label="Stored on"
            value={info.backups_share_disk === true ? "the same disk as the database" : "a separate device"}
            sub={
              info.backups_share_disk === null
                ? "could not compare — BACKUP_DIR may not exist"
                : "a snapshot must outlive the disk it protects"
            }
          />
        </div>
      </section>

      {/* ---------- engine ---------- */}
      <section className="panel">
        <header>
          <h2>Engine</h2>
          <span className="hint">SQLite {info.sqlite_version}</span>
        </header>
        <div className="rows">
          <Row tone={info.journal_mode.toLowerCase() === "wal" ? "ok" : "warn"} label="journal_mode" value={info.journal_mode} sub="WAL survives an abrupt shutdown better than rollback mode, and lets readers work during a write" />
          <Row tone="none" label="synchronous" value={info.synchronous} sub="how hard SQLite fsyncs before calling a commit durable" />
          <Row tone="none" label="auto_vacuum" value={info.auto_vacuum} sub={info.auto_vacuum === "none" ? "deleted pages stay in the file until an explicit VACUUM" : "free pages are returned as they appear"} />
          <Row tone="none" label="page_size" value={formatBytes(info.page_size, 0)} sub={`${info.page_count.toLocaleString()} pages allocated`} />
          <Row
            tone="none"
            label="Schema"
            value={`${info.migrations.length} migrations applied`}
            sub={
              info.migrations.length > 0
                ? `latest ${info.migrations[info.migrations.length - 1].name} on ${formatTimestamp(info.migrations[info.migrations.length - 1].applied_at, tz)}`
                : "no migrations recorded"
            }
          />
        </div>
      </section>

      {/* ---------- integrity, on demand ---------- */}
      <section className="panel">
        <header>
          <h2>Integrity</h2>
          <span className="hint">reads every page — run it when you suspect corruption</span>
        </header>
        <div className="rows">
          <Row
            tone={integrity ? (integrity.ok ? "ok" : "bad") : "none"}
            label="quick_check"
            value={integrity ? (integrity.ok ? "ok" : "FAILED") : "not run"}
            sub={
              integrity
                ? integrity.ok
                  ? `no corruption found, checked in ${integrity.ms} ms`
                  : integrity.result
                : "a full verification pass; it blocks collection while it runs, so it is not part of the page load"
            }
            action={
              <a href={href({ check: "1" })} className="btn sm">
                {integrity ? "Run again" : "Run check"}
              </a>
            }
          />
        </div>
      </section>
    </div>
  );
}
