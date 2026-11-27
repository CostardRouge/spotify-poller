/**
 * The five places of Témoin (2026-11-27, the design lab's iteration 2 —
 * "Atelier design — spotify-poller", page "Itération 2 — navigation").
 *
 * The ten flat sidebar entries mixed three jobs — watching collection,
 * reading the history back, and configuring the instrument — and several
 * pages repeated each other (Stats was Now's numbers plus Runs' list; the
 * "Server" rows lived on Now AND in the settings dialog). Each job is now a
 * group, each piece of information has one home, and a section owns the
 * routes it absorbed so the sidebar, the tab bar, the top bar and the
 * palette all agree on which place is "current":
 *
 *   Watch       Now · Trace · Journal (runs + gaps + the old Stats)
 *   History     Library (plays /events · sessions /playback · trends /listening)
 *   Instrument  System (server /system · accounts /accounts · storage /database)
 *
 * The old /runs, /gaps and /stats URLs redirect to /journal, so bookmarks and
 * the jump keys people learnt keep landing somewhere sensible.
 */

export type SectionId = "now" | "trace" | "journal" | "library" | "system";

export interface Section {
  id: SectionId;
  label: string;
  href: string;
  icon: string;
  group: "Watch" | "History" | "Instrument";
  /** Every route this section owns; the first is its landing page. */
  routes: string[];
}

export const SECTIONS: Section[] = [
  { id: "now", label: "Now", href: "/", icon: "overview", group: "Watch", routes: ["/"] },
  { id: "trace", label: "Trace", href: "/trace", icon: "trace", group: "Watch", routes: ["/trace"] },
  { id: "journal", label: "Journal", href: "/journal", icon: "journal", group: "Watch", routes: ["/journal", "/runs", "/gaps", "/stats"] },
  { id: "library", label: "Library", href: "/events", icon: "events", group: "History", routes: ["/events", "/playback", "/listening"] },
  { id: "system", label: "System", href: "/system", icon: "system", group: "Instrument", routes: ["/system", "/accounts", "/database"] },
];

export const GROUPS: Section["group"][] = ["Watch", "History", "Instrument"];

/** The section a pathname belongs to, or null for a route outside the five. */
export function sectionOf(pathname: string): Section | null {
  return SECTIONS.find((s) => s.routes.includes(pathname)) ?? null;
}

/** The views inside a section, shown as a segmented row at the top of its pages. */
export const SUBVIEWS: Partial<Record<SectionId, { href: string; label: string }[]>> = {
  library: [
    { href: "/events", label: "Plays" },
    { href: "/playback", label: "Sessions" },
    { href: "/listening", label: "Trends" },
  ],
  system: [
    { href: "/system", label: "Server" },
    { href: "/accounts", label: "Accounts" },
    { href: "/database", label: "Storage" },
  ],
};
