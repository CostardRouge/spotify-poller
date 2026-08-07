import { NextResponse } from "next/server";
import { getEnv } from "@/lib/server/runtime";
import { runBackup } from "@/lib/server/backup";

/** Writes a full .db snapshot to BACKUP_DIR. NOT downloadable: holds the Spotify refresh token in clear. */
export async function POST() {
  const env = getEnv();
  const r = await runBackup(env);
  return NextResponse.json({ ...r, note: "contains the refresh token — keep it as private as .env" });
}
