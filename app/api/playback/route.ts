import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { listPlaybackSessions } from "@/lib/server/db";
import { intParam, scopeParam } from "@/lib/server/query";

export async function GET(req: NextRequest) {
  const env = getEnv();
  const url = req.nextUrl;
  if (!env.PLAYBACK_ENABLED) {
    return NextResponse.json({ enabled: false, total: 0, limit: 0, offset: 0, items: [] });
  }
  return NextResponse.json({
    enabled: true,
    ...listPlaybackSessions(env, scopeParam(env, url.searchParams), {
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      limit: intParam(url.searchParams, "limit", 50, 200),
      offset: intParam(url.searchParams, "offset", 0, Number.MAX_SAFE_INTEGER),
    }),
  });
}
