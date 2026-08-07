import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { statsSnapshot } from "@/lib/server/db";
import { scopeParam } from "@/lib/server/query";

export async function GET(req: NextRequest) {
  const env = getEnv();
  return NextResponse.json(statsSnapshot(env, scopeParam(env, req.nextUrl.searchParams)));
}
