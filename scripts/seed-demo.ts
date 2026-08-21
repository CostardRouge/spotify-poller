#!/usr/bin/env node
/**
 * Seeds fixture rows so the showcase screenshots (GitHub Pages, see
 * .github/workflows/pages.yml) have something to show without real Spotify
 * credentials or listening history. Never run against a real database — it is
 * only ever invoked in CI, against a throwaway DB_PATH.
 *
 * It seeds fourteen months of synthetic plays, not a handful: the Listening
 * page summarises a history, and a page drawn over five events shows nothing
 * about what it does. The generator is deterministic (a fixed-seed PRNG) so
 * that two CI runs produce the same screenshots, and the shape is deliberate —
 * a commute peak and a late-evening peak, busier weekends, a quiet fortnight —
 * so the charts read as a person rather than as noise.
 */
import "dotenv/config";
import Database from "better-sqlite3";
import {
  type EventRow,
  insertEvents,
  insertGap,
  logRun,
  setActiveAccountId,
  setState,
  upsertAccount,
  upsertArtists,
} from "../lib/server/db";
import { loadEnvFromProcess, nowIso } from "../lib/server/types";

const db = new Database(process.env.DB_PATH ?? "./data/life-events.db");
db.pragma("journal_mode = WAL");
const env = loadEnvFromProcess(db);

const ACCOUNT_ID = "demo_user";
upsertAccount(env, ACCOUNT_ID, "Demo Listener", "demo-refresh-token", "user-read-recently-played user-library-read");
setActiveAccountId(env, ACCOUNT_ID);

const ARTISTS = [
  { id: "demo_ar1", name: "The Long Halls", genres: ["indie rock", "chamber pop"], nocturnal: 0.2 },
  { id: "demo_ar2", name: "Marin & the Tide", genres: ["ambient", "drone"], nocturnal: 0.85 },
  { id: "demo_ar3", name: "Aubrey West", genres: ["vocal jazz", "jazz"], nocturnal: 0.6 },
  { id: "demo_ar4", name: "Ochre Fields", genres: ["shoegaze", "indie rock"], nocturnal: 0.35 },
  { id: "demo_ar5", name: "Kassia Vole", genres: ["minimal techno", "techno"], nocturnal: 0.9 },
  { id: "demo_ar6", name: "Halberd Choir", genres: ["choral", "classical"], nocturnal: 0.1 },
];

const TRACKS = [
  { title: "Weather Report", artist: ARTISTS[0], album: "Field Notes", duration: 214 },
  { title: "Coastal Static", artist: ARTISTS[1], album: "Second Wind", duration: 187 },
  { title: "Nine Rooms", artist: ARTISTS[2], album: "Halls", duration: 261 },
  { title: "Low Winter Sun", artist: ARTISTS[0], album: "Field Notes", duration: 198 },
  { title: "Paper Lanterns", artist: ARTISTS[3], album: "Second Wind", duration: 233 },
  { title: "Iron Gate", artist: ARTISTS[4], album: "Night Shift", duration: 305 },
  { title: "Slow Ferry", artist: ARTISTS[1], album: "Second Wind", duration: 274 },
  { title: "Vespers", artist: ARTISTS[5], album: "Matins", duration: 341 },
  { title: "Copper Wire", artist: ARTISTS[4], album: "Night Shift", duration: 288 },
  { title: "Bright Field", artist: ARTISTS[2], album: "Halls", duration: 226 },
  { title: "Second Wind", artist: ARTISTS[3], album: "Second Wind", duration: 201 },
  { title: "Harbour Lights", artist: ARTISTS[5], album: "Matins", duration: 262 },
];

/** Fixed-seed LCG: the same fixture every run, so screenshots do not churn. */
let seed = 20260820;
const rnd = (): number => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

const now = Date.now();
const DAY = 86_400_000;
const HISTORY_DAYS = 425;

const trackOf = (t: (typeof TRACKS)[number], i: number) => ({
  id: `demo_tr${i}`,
  album_id: `demo_al_${t.album.toLowerCase().replace(/\W+/g, "")}`,
});

const listens: EventRow[] = [];
const likes: EventRow[] = [];

for (let d = HISTORY_DAYS; d >= 0; d--) {
  const dayStart = now - d * DAY;
  const date = new Date(dayStart);
  const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
  // A quiet fortnight, so the calendar and the streak counter have something
  // true to say — and so an empty stretch is visible in the showcase.
  const away = d > 250 && d < 264;
  const count = away ? 0 : Math.round((weekend ? 26 : 17) * (0.55 + rnd() * 0.9));

  for (let i = 0; i < count; i++) {
    const peak = rnd() < 0.45 ? 8 : 21;
    const hour = ((Math.round(peak + (rnd() + rnd() + rnd() - 1.5) * 3) % 24) + 24) % 24;
    const nightness = hour >= 22 || hour < 6 ? 1 : hour < 12 ? 0.1 : 0.5;
    // Pick the track whose artist best fits the hour, with enough slack that
    // the genre-by-daypart panel shows a mix rather than one label per slot.
    const candidates = TRACKS.map((t, idx) => ({
      t,
      idx,
      fit: 1 - Math.abs(t.artist.nocturnal - nightness) + rnd() * 0.6,
    })).sort((a, b) => b.fit - a.fit);
    const { t, idx } = candidates[Math.floor(rnd() * 3)];
    const meta = trackOf(t, idx);

    const ts = new Date(dayStart - (dayStart % DAY) + hour * 3_600_000 + Math.floor(rnd() * 3_540_000));
    const iso = ts.toISOString();
    listens.push({
      id: `spotify:listen:${iso}`,
      ts_utc: iso,
      type: "listen",
      source: "spotify",
      duration_s: t.duration,
      title: t.title,
      subtitle: t.artist.name,
      payload: JSON.stringify({
        track_id: meta.id,
        uri: `spotify:track:${meta.id}`,
        album: t.album,
        album_id: meta.album_id,
        artist_ids: [t.artist.id],
        duration_ms: t.duration * 1000,
        context: rnd() < 0.65 ? { type: "playlist", uri: "spotify:playlist:demo" } : { type: "album", uri: `spotify:album:${meta.album_id}` },
      }),
    });

    if (rnd() < 0.012) {
      const likedAt = new Date(ts.getTime() + 180_000).toISOString();
      likes.push({
        id: `spotify:like:${meta.id}:${likedAt}`,
        ts_utc: likedAt,
        type: "like",
        source: "spotify",
        duration_s: null,
        title: t.title,
        subtitle: t.artist.name,
        payload: JSON.stringify({
          track_id: meta.id,
          uri: `spotify:track:${meta.id}`,
          album: t.album,
          album_id: meta.album_id,
          artist_ids: [t.artist.id],
          duration_ms: t.duration * 1000,
        }),
      });
    }
  }
}

insertEvents(env, ACCOUNT_ID, listens);
insertEvents(env, ACCOUNT_ID, likes);

// The artist cache the 'artists' collector would have filled — without it the
// Listening page's genre panel correctly reports that nothing was looked up.
upsertArtists(
  env,
  ARTISTS.map((a, i) => ({
    id: a.id,
    name: a.name,
    genres: a.genres,
    popularity: 40 + i * 7,
    followers: 12_000 + i * 40_000,
  }))
);

setState(env, ACCOUNT_ID, "played.last_success_at", new Date(now - 5 * 60_000).toISOString());
setState(env, ACCOUNT_ID, "liked.last_success_at", new Date(now - 4 * 3_600_000).toISOString());
setState(env, ACCOUNT_ID, "liked.backfill_done", "1");
setState(env, ACCOUNT_ID, "artists.last_success_at", nowIso());
setState(env, ACCOUNT_ID, "artists.backlog", "0");

logRun(env, ACCOUNT_ID, "played", "cron", new Date(now - 5 * 60_000).toISOString(), "ok", 50, 1, null);
logRun(env, ACCOUNT_ID, "liked", "cron", new Date(now - 4 * 3_600_000).toISOString(), "ok", 12, 0, null);
logRun(env, ACCOUNT_ID, "artists", "cron", new Date(now - 2 * 3_600_000).toISOString(), "ok", 6, 6, null);
insertGap(
  env,
  ACCOUNT_ID,
  "played",
  new Date(now - 30 * 3_600_000).toISOString(),
  new Date(now - 27 * 3_600_000).toISOString(),
  "buffer fully renewed between two runs (demo fixture)"
);

console.log(`demo data seeded: ${listens.length} listens, ${likes.length} likes, ${ARTISTS.length} artists`);
db.close();
