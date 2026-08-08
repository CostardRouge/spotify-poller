"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

export interface AccountOption {
  id: string;
  display_name: string | null;
}

/**
 * The view-scope selector from the old sidebar. Looking is not collecting
 * (PRODUCT.md): this switches which account's data the pages SHOW, via the
 * ?account= param every read endpoint accepts — the collected account is
 * untouched, and the hint says so whenever the two differ.
 */
function Selector({ accounts, activeId }: { accounts: AccountOption[]; activeId: string | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const viewing = searchParams.get("account") || activeId || "";

  function onChange(id: string) {
    const params = new URLSearchParams(searchParams);
    params.delete("offset");
    if (!id || id === activeId) params.delete("account");
    else params.set("account", id);
    router.push(`${pathname}${params.size ? `?${params}` : ""}`);
  }

  if (accounts.length === 0) return null;
  const viewingOther = viewing !== "" && activeId !== null && viewing !== activeId;

  return (
    <div>
      <label htmlFor="account-select" className="sr-only">
        Account being viewed
      </label>
      <select
        id="account-select"
        value={viewing}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[color:var(--line)] bg-[color:var(--panel-2)] px-2 py-1.5 text-xs text-[color:var(--text)]"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {(a.display_name ?? a.id) + (a.id === activeId ? " (collecting)" : "")}
          </option>
        ))}
      </select>
      {viewingOther && (
        <p className="mt-1 text-[10px] leading-snug text-[color:var(--warn)]">
          viewing only — collection targets {activeId}
        </p>
      )}
    </div>
  );
}

export default function AccountSelect(props: { accounts: AccountOption[]; activeId: string | null }) {
  // useSearchParams needs a Suspense boundary in a client component.
  return (
    <Suspense>
      <Selector {...props} />
    </Suspense>
  );
}
