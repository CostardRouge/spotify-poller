"use client";

import { useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
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
        className="w-full max-w-sm rounded-lg border border-[color:var(--line)] bg-[color:var(--panel)] p-8 shadow-sm"
      >
        <h1 className="font-[family-name:var(--serif)] text-xl text-[color:var(--text)]">spotify-poller</h1>
        <p className="mt-1 text-sm text-[color:var(--muted)]">Custody report — sign in to continue.</p>

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
          className="mt-1 w-full rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-3 py-2 text-[color:var(--text)] outline-none focus-visible:border-[color:var(--accent)]"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm text-[color:var(--danger)]">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || token.length === 0}
          className="mt-6 w-full rounded-md bg-[color:var(--accent)] px-4 py-2 text-sm font-medium text-[color:var(--on-accent)] transition-opacity disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
