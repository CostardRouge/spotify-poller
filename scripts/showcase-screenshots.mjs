#!/usr/bin/env node
/**
 * Captures the showcase screenshots against a running instance of the app,
 * seeded with fixture data (scripts/seed-demo.ts). Used by
 * .github/workflows/pages.yml, and runnable locally:
 *
 *   npm run build && npm run migrate && npm run seed:demo && npm start &
 *   ADMIN_TOKEN=<same as .env> node scripts/showcase-screenshots.mjs [outDir]
 *
 * Env: BASE_URL (default http://127.0.0.1:3000), ADMIN_TOKEN (required)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const OUT = process.argv[2] ?? "site/screenshots";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN) {
  console.error("ADMIN_TOKEN env var is required");
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });

const log = (m) => console.log(`[screenshots] ${m}`);

async function shoot(page, name) {
  await page.waitForTimeout(300); // let the paint settle
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  log(`captured ${name}.png`);
}

// CHROMIUM_PATH lets environments with a pre-installed browser skip
// `playwright install` (CI installs its own matching build).
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
  timezoneId: "UTC",
});

// 1. Login screen.
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await shoot(page, "login");

// 2. Sign in, land on the dashboard.
await page.getByLabel("Admin token").fill(ADMIN_TOKEN);
await page.getByRole("button", { name: /sign in/i }).click();
await page.waitForURL(`${BASE}/`, { timeout: 10_000 });
await page.waitForSelector("text=Manual run", { timeout: 10_000 });
await shoot(page, "dashboard");

// 3. Events browser.
await page.goto(`${BASE}/events`, { waitUntil: "networkidle" });
await shoot(page, "events");

// 4. Accounts.
await page.goto(`${BASE}/accounts`, { waitUntil: "networkidle" });
await shoot(page, "accounts");

// 5. Runs.
await page.goto(`${BASE}/runs`, { waitUntil: "networkidle" });
await shoot(page, "runs");

// 6. Stats.
await page.goto(`${BASE}/stats`, { waitUntil: "networkidle" });
await shoot(page, "stats");

// 7. Payload modal — the event inspector, open on the first row.
await page.goto(`${BASE}/events`, { waitUntil: "networkidle" });
await page.getByRole("button", { name: "Payload" }).first().click();
await page.waitForSelector("dialog[open]");
await shoot(page, "events-payload");

await page.close();
await browser.close();
log(`done -> ${OUT}`);
