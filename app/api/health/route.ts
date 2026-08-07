import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";

/**
 * Public, deliberately minimal — only what the Docker HEALTHCHECK needs.
 * Everything describing the collection (counters, timestamps, connected
 * account) lives on /api/status, behind auth: an open endpoint leaking
 * listening volume and activity windows would be a privacy leak, not a
 * health check.
 */
export async function GET() {
  const env = getEnv();
  return NextResponse.json({ status: "ok", auth_mode: env.AUTH_MODE });
}
