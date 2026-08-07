import { Env, GLOBAL_SCOPE } from "./types";
import { getActiveAccountId } from "./db";

/** An absent param must fall back, not read as 0 — Number(null) is 0. */
export function intParam(searchParams: URLSearchParams, name: string, fallback: number, max: number): number {
  const s = searchParams.get(name);
  if (s === null || s.trim() === "") return fallback;
  const raw = Number(s);
  if (!Number.isFinite(raw) || raw < 0) return fallback;
  return Math.min(Math.floor(raw), max);
}

/**
 * Which account's data is being browsed. Defaults to the collected one;
 * `?account=` lets you look at a previously connected account without making
 * it active. Looking is not collecting.
 */
export function scopeParam(env: Env, searchParams: URLSearchParams): string {
  const requested = searchParams.get("account");
  if (requested !== null) return requested;
  return getActiveAccountId(env) ?? GLOBAL_SCOPE;
}
