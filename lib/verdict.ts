/**
 * The overall health verdict — one decision tree for every place that states
 * it: the top bar (client, polling /api/status) and the Overview's headline
 * (server-rendered). Client-safe: no import.
 *
 * Order, unchanged since the old UI's topbar chip: connection problems trump
 * staleness, staleness trumps rate limiting. Each verdict carries a headline,
 * the sentence the Overview leads with — written to be read at an awkward hour
 * on a phone, and never claiming more than the state shows (PRODUCT.md).
 */
export type VerdictTone = "ok" | "warn" | "bad";

export interface VerdictInput {
  playedLastSuccess: string | null;
  connected: boolean;
  activeRevoked: boolean;
  rateLimitedUntil: string | null;
  playedEveryMinutes: number | null;
}

export interface Verdict {
  tone: VerdictTone;
  /** The status word beside the voyant: "Healthy", "Stale"… */
  text: string;
  /** The Overview's headline. */
  headline: string;
  /** One line of why, for a tooltip or a sub-line. */
  why: string;
}

export function ago(iso: string | null, nowMs: number): string {
  if (!iso) return "never";
  const m = Math.floor((nowMs - Date.parse(iso)) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60 ? `${m % 60} min ` : ""}ago`;
  return `${Math.floor(h / 24)} d ago`;
}

export function verdict(s: VerdictInput, nowMs: number): Verdict {
  // Expected freshness: three missed polls of the in-process schedule, or 90
  // minutes when systemd timers drive collection and the cadence is unknown here.
  const expectedMs = (s.playedEveryMinutes ? s.playedEveryMinutes * 3 : 90) * 60_000;
  const last = s.playedLastSuccess;
  const age = last ? nowMs - Date.parse(last) : null;
  const fresh = age === null ? "none" : age <= expectedMs ? "ok" : age <= expectedMs * 4 ? "warn" : "bad";
  const since = ago(last, nowMs);

  if (!s.connected)
    return { tone: "bad", text: "Not connected", headline: "No Spotify account is connected.", why: "Connect one from Accounts." };
  if (s.activeRevoked)
    return {
      tone: "bad",
      text: "Token revoked",
      headline: "Spotify revoked the collecting account's token.",
      why: "Reconnect it from Accounts; nothing is collected until then.",
    };
  if (fresh === "none")
    return { tone: "warn", text: "Never collected", headline: "Nothing has been collected yet.", why: "The played collector has not succeeded yet." };
  if (fresh === "bad")
    return {
      tone: "bad",
      text: "Stale",
      headline: `Played last succeeded ${since}.`,
      why: "Spotify keeps only the last 50 plays: history may already be lost.",
    };
  if (s.rateLimitedUntil)
    return {
      tone: "warn",
      text: "Rate limited",
      headline: "Spotify is rate limiting the poller.",
      why: `Until ${s.rateLimitedUntil}. Played last succeeded ${since}.`,
    };
  if (fresh === "warn")
    return {
      tone: "warn",
      text: "Behind schedule",
      headline: `Played last succeeded ${since}.`,
      why: "Nothing is lost yet: Spotify keeps your last 50 plays.",
    };
  return { tone: "ok", text: "Healthy", headline: "Every play is collected.", why: `Played last succeeded ${since}.` };
}
