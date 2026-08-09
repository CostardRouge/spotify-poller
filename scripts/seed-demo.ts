#!/usr/bin/env node
/**
 * Seeds a handful of fixture rows so the showcase screenshots (GitHub Pages,
 * see .github/workflows/pages.yml) have something to show without real
 * Spotify credentials or listening history. Never run against a real
 * database — it is only ever invoked in CI, against a throwaway DB_PATH.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { insertEvents, insertGap, logRun, setActiveAccountId, setState, upsertAccount } from "../lib/server/db";
import { loadEnvFromProcess, nowIso } from "../lib/server/types";

const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
db.pragma("journal_mode = WAL");
const env = loadEnvFromProcess(db);

const ACCOUNT_ID = "demo_user";
upsertAccount(env, ACCOUNT_ID, "Demo Listener", "demo-refresh-token", "user-read-recently-played user-library-read");
setActiveAccountId(env, ACCOUNT_ID);

const TRACKS = [
  { title: "Weather Report", artist: "The Long Halls", duration: 214 },
  { title: "Coastal Static", artist: "Marin & the Tide", duration: 187 },
  { title: "Nine Rooms", artist: "Aubrey West", duration: 261 },
  { title: "Low Winter Sun", artist: "The Long Halls", duration: 198 },
  { title: "Paper Lanterns", artist: "Ochre Fields", duration: 233 },
];

const now = Date.now();
const events = TRACKS.map((t, i) => ({
  id: `spotify:listen:demo-${i}`,
  ts_utc: new Date(now - i * 45 * 60_000).toISOString(),
  type: "listen",
  source: "spotify",
  duration_s: t.duration,
  title: t.title,
  subtitle: t.artist,
  payload: JSON.stringify({ track_id: `demo-${i}`, uri: `spotify:track:demo-${i}` }),
}));
insertEvents(env, ACCOUNT_ID, events);
insertEvents(env, ACCOUNT_ID, [
  {
    id: "spotify:like:demo-0",
    ts_utc: new Date(now - 3 * 3_600_000).toISOString(),
    type: "like",
    source: "spotify",
    duration_s: null,
    title: TRACKS[0].title,
    subtitle: TRACKS[0].artist,
    payload: JSON.stringify({ track_id: "demo-0" }),
  },
]);

setState(env, ACCOUNT_ID, "played.last_success_at", new Date(now - 5 * 60_000).toISOString());
setState(env, ACCOUNT_ID, "liked.last_success_at", new Date(now - 4 * 3_600_000).toISOString());
setState(env, ACCOUNT_ID, "liked.backfill_done", "1");

logRun(env, ACCOUNT_ID, "played", "cron", new Date(now - 5 * 60_000).toISOString(), "ok", 50, 1, null);
logRun(env, ACCOUNT_ID, "liked", "cron", new Date(now - 4 * 3_600_000).toISOString(), "ok", 12, 0, null);
insertGap(
  env,
  ACCOUNT_ID,
  "played",
  new Date(now - 30 * 3_600_000).toISOString(),
  new Date(now - 27 * 3_600_000).toISOString(),
  "buffer fully renewed between two runs (demo fixture)"
);

console.log("demo data seeded");
db.close();
