import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { disconnectAccount, getAccount } from "@/lib/server/db";

/**
 * Forgets an account's connection. Reconnecting does NOT need this:
 * /api/spotify/login already carries show_dialog=true, so it re-shows the
 * consent screen and the new grant overwrites the old. This exists to
 * deliberately drop an account — its collected data stays.
 */
export async function POST(req: NextRequest) {
  const env = getEnv();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (!getAccount(env, id)) return NextResponse.json({ error: "unknown account" }, { status: 404 });

  const { removed, remaining } = disconnectAccount(env, id);
  const envFallback = Boolean(env.SPOTIFY_REFRESH_TOKEN);
  return NextResponse.json({
    disconnected: removed,
    remaining_accounts: remaining,
    env_fallback_active: envFallback,
    note: envFallback
      ? "SPOTIFY_REFRESH_TOKEN is still set: the next run will reconnect an account from it. Remove it from the environment for a real disconnect."
      : "Collected data was kept. Spotify has no revocation endpoint — to withdraw access for good, remove the app at spotify.com/account/apps.",
  });
}
