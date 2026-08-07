import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount, healthSnapshot } from "@/lib/server/db";
import { authStatus } from "@/lib/server/spotify/auth";
import { getRateLimit } from "@/lib/server/spotify/api";
import { schedulerEnabled, schedulerOptionsFromProcess } from "@/lib/server/scheduler";
import { scopeParam } from "@/lib/server/query";

export async function GET(req: NextRequest) {
  const env = getEnv();
  const scope = scopeParam(env, req.nextUrl.searchParams);
  return NextResponse.json({
    ...healthSnapshot(env, scope),
    scope,
    auth: authStatus(env),
    events_by_account: eventCountsByAccount(env),
    rate_limit: getRateLimit(env),
    scheduler: schedulerEnabled() ? schedulerOptionsFromProcess() : null,
    backup: { enabled: env.BACKUP_ENABLED, dir: env.BACKUP_DIR, keep: env.BACKUP_KEEP },
    notifications: { ntfy: !!env.NTFY_URL, heartbeat: !!env.WATCHDOG_URL },
    timezone: env.TIMEZONE,
  });
}
