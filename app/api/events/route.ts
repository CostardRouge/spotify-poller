import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { listEvents } from "@/lib/server/db";
import { intParam, scopeParam } from "@/lib/server/query";

export async function GET(req: NextRequest) {
  const env = getEnv();
  const url = req.nextUrl;
  return NextResponse.json(
    listEvents(env, scopeParam(env, url.searchParams), {
      type: url.searchParams.get("type") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
      from: url.searchParams.get("from") ?? undefined,
      to: url.searchParams.get("to") ?? undefined,
      order: url.searchParams.get("order") === "asc" ? "asc" : "desc",
      limit: intParam(url.searchParams, "limit", 50, 200),
      offset: intParam(url.searchParams, "offset", 0, Number.MAX_SAFE_INTEGER),
    })
  );
}
