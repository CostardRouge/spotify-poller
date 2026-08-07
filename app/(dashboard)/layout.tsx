import { getEnv } from "@/lib/server/runtime";
import Sidebar from "@/components/Sidebar";

// Every page under this layout reads live SQLite state (and requires the
// admin session middleware already enforces) — never prerender it statically.
export const dynamic = "force-dynamic";

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const env = getEnv();
  return (
    <div className="flex min-h-screen bg-[color:var(--bg)]">
      <Sidebar playbackEnabled={env.PLAYBACK_ENABLED} />
      <main className="min-w-0 flex-1 overflow-x-hidden px-6 py-6 sm:px-8 sm:py-8">{children}</main>
    </div>
  );
}
