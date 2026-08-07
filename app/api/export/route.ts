import { NextRequest } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { countEvents, iterateEventsNdjson } from "@/lib/server/export";
import { scopeParam } from "@/lib/server/query";

/** NDJSON export of the events — no secret inside. */
export async function GET(req: NextRequest) {
  const env = getEnv();
  const url = req.nextUrl;
  const accountId = scopeParam(env, url.searchParams);
  const filter = {
    type: url.searchParams.get("type") ?? undefined,
    q: url.searchParams.get("q") ?? undefined,
    from: url.searchParams.get("from") ?? undefined,
    to: url.searchParams.get("to") ?? undefined,
    order: url.searchParams.get("order") === "desc" ? ("desc" as const) : ("asc" as const),
  };
  const stamp = new Date().toISOString().slice(0, 10);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const line of iterateEventsNdjson(env, accountId, filter)) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="spotify-events-${stamp}.ndjson"`,
      "X-Event-Count": String(countEvents(env, accountId, filter)),
    },
  });
}
