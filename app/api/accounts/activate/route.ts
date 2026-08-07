import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { getAccount, setActiveAccountId } from "@/lib/server/db";

/** Switches which account the poller collects for — a pointer move, no data touched. */
export async function POST(req: NextRequest) {
  const env = getEnv();
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  if (!getAccount(env, id)) return NextResponse.json({ error: "unknown account" }, { status: 404 });
  setActiveAccountId(env, id);
  return NextResponse.json({ active_account_id: id });
}
