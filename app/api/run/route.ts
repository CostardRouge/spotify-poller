import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { COLLECTOR_IDS, parseCollectorId } from "@/lib/server/types";
import { runCollector } from "@/lib/server/run-core";

export async function POST(req: NextRequest) {
  const env = getEnv();
  // 'A'/'B' still resolve (parseCollectorId) so an old bookmark or script does
  // not break, but the documented names are the explicit ones.
  const collector = parseCollectorId(req.nextUrl.searchParams.get("collector"));
  if (collector === "playback" && !env.PLAYBACK_ENABLED) {
    return NextResponse.json({ error: "playback collector is off — set PLAYBACK_ENABLED=1" }, { status: 400 });
  }
  if (collector === null) {
    return NextResponse.json({ error: `collector must be one of: ${COLLECTOR_IDS.join(", ")}` }, { status: 400 });
  }
  const result = await runCollector(collector, "manual", env);
  return NextResponse.json(result, { status: result.status === "error" ? 500 : 200 });
}
