import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { eventCountsByAccount, getActiveAccountId, listAccounts } from "@/lib/server/db";

export async function GET() {
  const env = getEnv();
  return NextResponse.json({
    active_account_id: getActiveAccountId(env),
    events_by_account: eventCountsByAccount(env),
    items: listAccounts(env),
  });
}
