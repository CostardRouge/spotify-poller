import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { listGaps } from "@/lib/server/db";
import { intParam, scopeParam } from "@/lib/server/query";

export async function GET(req: NextRequest) {
  const env = getEnv();
  const url = req.nextUrl;
  return NextResponse.json(
    listGaps(
      env,
      scopeParam(env, url.searchParams),
      intParam(url.searchParams, "limit", 50, 200),
      intParam(url.searchParams, "offset", 0, Number.MAX_SAFE_INTEGER)
    )
  );
}
