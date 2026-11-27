/**
 * /health must answer exactly like /api/health, and without a session: the
 * Home Lab's Portainer stack probes /health, and the day that probe rode the
 * login redirect to Sésame the container went unhealthy and the site went
 * 404 (docs/memory/deployment.md, 2026-11-27).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { GET as apiHealth } from "../app/api/health/route";
import { GET as health } from "../app/health/route";

describe("/health", () => {
  it("is the same handler as /api/health", () => {
    assert.equal(health, apiHealth);
  });

  it("is left open by the auth gate, like /api/health", () => {
    const source = readFileSync(join(__dirname, "..", "proxy.ts"), "utf8");
    const list = /const PUBLIC_PATHS = \[([^\]]+)\]/.exec(source)?.[1] ?? "";
    assert.match(list, /"\/health"/);
    assert.match(list, /"\/api\/health"/);
  });
});
