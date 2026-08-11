import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { databaseInfo, integrityCheck, objectBreakdown } from "@/lib/server/dbinfo";

/**
 * What the Database page renders, as JSON — same contract as /api/stats next to
 * /stats, so anything you can see you can also curl or graph.
 *
 * Contains NO secret: file sizes, row counts and pragmas only. The `accounts`
 * table holds the refresh token and is never read here — it appears in the
 * output as a name and a byte count, nothing more.
 *
 * The default response reads no page of the database. The two passes that do
 * are opt-in, for the reason spelled out in dbinfo.ts — each walks the whole
 * file and blocks collection while it runs:
 *
 *   ?breakdown=1  per-table and per-index byte attribution (dbstat)
 *   ?check=1      quick_check integrity pass
 */
export async function GET(req: NextRequest) {
  const env = getEnv();
  const params = req.nextUrl.searchParams;
  return NextResponse.json({
    ...databaseInfo(env),
    breakdown: params.get("breakdown") === "1" ? objectBreakdown(env) : null,
    integrity: params.get("check") === "1" ? integrityCheck(env) : null,
  });
}
