/**
 * Going straight to Sésame (AUTH_MODE=sesame): the two ways it goes wrong are
 * a loop (a refusal bouncing back to Sésame forever) and a sign-out that signs
 * you back in (Sésame keeps its own session). Both are decided here.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sesameShouldRedirect, signInPath } from "../lib/auth/login-target";

describe("signInPath", () => {
  it("sends a signed-out visit straight to Sésame in sesame mode", () => {
    assert.equal(signInPath("sesame", "/listening"), "/api/auth/sesame/login?next=%2Flistening");
  });

  it("keeps the token form in the other modes", () => {
    assert.equal(signInPath("token", "/events"), "/login?next=%2Fevents");
    assert.equal(signInPath("proxy", "/"), "/login?next=%2F");
  });
});

describe("sesameShouldRedirect", () => {
  it("hands a plain /login over to Sésame", () => {
    assert.equal(sesameShouldRedirect({}), true);
  });

  it("stays to show why the last round trip failed, never looping on a refusal", () => {
    for (const sesame of ["refused", "expired", "failed", "anything"]) {
      assert.equal(sesameShouldRedirect({ sesame }), false, sesame);
    }
  });

  it("stays after a sign-out, so Sésame's own session cannot sign the user straight back in", () => {
    assert.equal(sesameShouldRedirect({ signed_out: "1" }), false);
  });
});
