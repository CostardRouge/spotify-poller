// lib/auth/sesame-flow.ts: the signed cookie that carries the round trip to
// Sésame (AUTH_MODE=sesame), the `next` path and the origin behind the proxy.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignJWT } from "jose";
import { originFrom, readFlow, safeNext, signFlow } from "../lib/auth/sesame-flow";

const flow = { state: "s", verifier: "v", next: "/listening" };

test("a flow reads back with the secret that signed it, and not with another", async () => {
  const raw = await signFlow(flow, "secret");
  assert.deepEqual(await readFlow(raw, "secret"), flow);
  assert.equal(await readFlow(raw, "another"), null);
  assert.equal(await readFlow(undefined, "secret"), null);
  assert.equal(await readFlow("nonsense", "secret"), null);
});

test("an expired flow is refused", async () => {
  const raw = await signFlow(flow, "secret", -1);
  assert.equal(await readFlow(raw, "secret"), null);
});

test("a session token, signed with the same secret, is not a flow", async () => {
  // The session cookie is signed with JWT_SECRET itself; a flow with a key
  // derived from it and a `typ`, so one can never pass for the other.
  const session = await new SignJWT({ sub: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode("secret"));
  assert.equal(await readFlow(session, "secret"), null);
});

test("next is a path on this site, nothing else", async () => {
  assert.equal(safeNext("/listening?day=1"), "/listening?day=1");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", null, ""]) {
    assert.equal(safeNext(bad), "/");
  }
  const tampered = await signFlow({ ...flow, next: "//evil.example" }, "k");
  assert.equal((await readFlow(tampered, "k"))?.next, "/");
});

test("the origin is the one the browser used, behind Traefik", () => {
  const h = new Headers({ host: "temoin.steeve.website", "x-forwarded-proto": "https" });
  assert.equal(originFrom(h, "http://0.0.0.0:3000"), "https://temoin.steeve.website");
  assert.equal(originFrom(new Headers({ host: "localhost:3000" }), "http://localhost:3000"), "http://localhost:3000");
});
