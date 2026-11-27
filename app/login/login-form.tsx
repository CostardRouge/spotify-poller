"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { SESAME_ERRORS, type SesameError } from "@/lib/auth/sesame-errors";
import Mark from "@/components/Mark";

// Same rule as lib/auth/sesame-flow.ts's safeNext, kept here: this file is a
// client component and that one imports jose.
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.startsWith("/\\")) return "/";
  return raw;
}

function LoginForm({ mode }: { mode: "token" | "sesame" }) {
  const router = useRouter();
  const params = useSearchParams();
  const sesameError = params.get("sesame");
  const signedOut = params.has("signed_out");
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "sign-in failed");
        return;
      }
      router.push(params.get("next") || "/");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[color:var(--bg)] px-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-[24px] border border-[color:var(--line)] bg-[color:var(--surface)] p-8"
      >
        <div className="mb-5">
          <Mark size={44} />
        </div>
        <h1 className="font-[family-name:var(--display)] text-3xl font-bold tracking-[-0.04em] text-[color:var(--ink)]">témoin</h1>
        <p className="mt-1 text-sm text-[color:var(--ink-2)]">
          {signedOut ? "Signed out." : "Custody report — sign in to continue."}
        </p>

        {mode === "sesame" ? (
          <>
            <a
              href={`/api/auth/sesame/login?next=${encodeURIComponent(safeNext(params.get("next")))}`}
              className="btn primary lg mt-6 w-full justify-center"
            >
              Sign in with Sésame
            </a>
            {sesameError && sesameError in SESAME_ERRORS && (
              <p role="alert" className="mt-3 text-sm text-[color:var(--danger-text)]">
                {SESAME_ERRORS[sesameError as SesameError]}
              </p>
            )}
          </>
        ) : (
          <>

        <label htmlFor="token" className="mt-6 block text-sm text-[color:var(--muted)]">
          Admin token
        </label>
        <input
          id="token"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          className="field mt-1 w-full"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--danger-text)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || token.length === 0}
          className="btn primary lg mt-6 w-full justify-center"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
          </>
        )}
      </form>
    </div>
  );
}

export function Login({ mode }: { mode: "token" | "sesame" }) {
  return (
    <Suspense>
      <LoginForm mode={mode} />
    </Suspense>
  );
}
