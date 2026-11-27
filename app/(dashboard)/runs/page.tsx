import { redirect } from "next/navigation";

/**
 * /runs folded into the Journal on 2026-11-27 (design lab iteration 2): runs,
 * gaps and their counts are one thread now (app/(dashboard)/journal). The
 * route stays so a bookmark or an old link still lands somewhere, with the
 * viewed account kept.
 */
export default async function RunsRedirect({ searchParams }: { searchParams: Promise<{ account?: string }> }) {
  const { account } = await searchParams;
  const p = new URLSearchParams();
  if (account) p.set("account", account);
  const q = p.toString();
  redirect(`/journal${q ? `?${q}` : ""}`);
}
