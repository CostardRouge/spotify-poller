import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { listeningStats, parseListeningFilter } from "@/lib/server/listening";
import { scopeParam } from "@/lib/server/query";

/**
 * The Listening page's numbers, as JSON — same filter vocabulary as the page,
 * so a URL that draws a chart also fetches the data behind it.
 *
 * Deliberately not paginated: this is an aggregate, and the expensive part is
 * the pass over the history, not the response. See `lib/server/listening.ts`
 * for what that pass costs.
 */
export async function GET(req: NextRequest) {
  const env = getEnv();
  const sp = req.nextUrl.searchParams;
  return NextResponse.json(listeningStats(env, scopeParam(env, sp), parseListeningFilter(sp)));
}
