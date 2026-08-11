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
  // `pull`, NOT `start`: a loop inside `start` runs to completion before the
  // stream is ever read, so the generator's laziness bought nothing — the whole
  // history was encoded into the stream's queue (which applies no backpressure
  // of its own) while the event loop was held. On a few hundred thousand events
  // that is hundreds of MB of RSS and seconds of unresponsiveness: long enough
  // for the container HEALTHCHECK to time out three times over and for whatever
  // sits in front to take the origin out of rotation.
  //
  // With `pull` the batch is only read when the consumer has drained the last
  // one, so memory stays at one batch and a slow client simply slows the query
  // down instead of buffering the difference in the server.
  const batches = iterateEventsNdjson(env, accountId, filter);
  const stream = new ReadableStream({
    pull(controller) {
      const { value, done } = batches.next();
      if (done) controller.close();
      else controller.enqueue(encoder.encode(value));
    },
    cancel() {
      // Client hung up (closed tab, proxy timeout): stop querying immediately.
      batches.return(undefined);
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
