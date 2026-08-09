"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

export interface AccountOption {
  id: string;
  display_name: string | null;
}

/**
 * The "Viewing" scope selector from the old sidebar. Looking is not
 * collecting (PRODUCT.md): this switches which account's data the pages SHOW,
 * via the ?account= param every read endpoint accepts — the collected account
 * is untouched, and the hint says so whenever the two differ. Option labels
 * match the old UI: the collected account reads "name — collected".
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

  const viewingOther = viewing !== "" && activeId !== null && viewing !== activeId;

  return (
    <div>
      <label htmlFor="account-select" className="mb-1 block text-xs text-[color:var(--ink-2)]">
        Viewing
      </label>
      <select
        id="account-select"
        value={viewing}
        disabled={accounts.length === 0}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-[color:var(--line)] bg-[color:var(--surface-2)] px-2 py-1.5 text-xs text-[color:var(--ink)] disabled:opacity-60"
      >
        {accounts.length === 0 && <option value="">No account connected</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {(a.display_name ?? a.id) + (a.id === activeId ? " — collected" : "")}
          </option>
        ))}
      </select>
      {viewingOther && (
        <p className="mt-1 text-[10px] leading-snug text-[color:var(--warn)]">
          You are looking at an account that is not the one being collected.
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
