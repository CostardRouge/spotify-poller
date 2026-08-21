/** `2026-08-07T14:39:02.123Z` -> "3m ago" / "in the future" style relative labels. */
export function relativeFromNow(iso: string | null | undefined): string {
  if (!iso) return "never";
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return "unknown";
  if (ms < 0) return "just now";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/**
 * Byte sizes for human eyes: "1.4 GB", "356.9 MB", "512 B".
 *
 * Base 1024 with the SI-looking labels — the convention every disk tool on the
 * host (du, df, docker) already uses, so the numbers on the Database page can
 * be compared against them without a mental conversion.
 */
export function formatBytes(bytes: number | null | undefined, digits = 1): string {
  if (bytes === null || bytes === undefined || !Number.isFinite(bytes)) return "—";
  const sign = bytes < 0 ? "-" : "";
  let n = Math.abs(bytes);
  const units = ["B", "KB", "MB", "GB", "TB"];
  let u = 0;
  while (n >= 1024 && u < units.length - 1) {
    n /= 1024;
    u++;
  }
  // Whole bytes never need a decimal point — and a computed average (bytes per
  // row) must not leak "682.6666666666666 B" into the page.
  return `${sign}${u === 0 ? Math.round(n) : n.toFixed(digits)} ${units[u]}`;
}

/**
 * Durations that span minutes to months: "48 min", "6 h 12 min", "23 d 4 h".
 *
 * Days rather than months or years past a certain size — "2.3 months" invites a
 * comparison the underlying number cannot support (it is a sum of full track
 * lengths, not measured playtime), and days stay countable.
 */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  if (days > 0) return `${days.toLocaleString()} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

export function formatTimestamp(iso: string | null | undefined, timezone: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    })
      .format(new Date(iso))
      .replace(",", "");
  } catch {
    return iso;
  }
}
