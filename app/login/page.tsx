import { redirect } from "next/navigation";
import { sesameShouldRedirect } from "@/lib/auth/login-target";
import { safeNext } from "@/lib/auth/sesame-flow";
import { Login } from "./login-form";

// Read at request time: the mode is the server's environment (AUTH_MODE).
export const dynamic = "force-dynamic";

/**
 * The sign-in screen: the admin token form, or, when AUTH_MODE=sesame, nothing
 * at all most of the time — Sésame is then the only door, so /login hands
 * straight over to it and renders only to say why the last round trip failed
 * or that the user signed out (lib/auth/login-target.ts).
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; sesame?: string; signed_out?: string }>;
}) {
  const params = await searchParams;
  const mode = process.env.AUTH_MODE === "sesame" ? "sesame" : "token";
  if (mode === "sesame" && sesameShouldRedirect(params)) {
    redirect(`/api/auth/sesame/login?next=${encodeURIComponent(safeNext(params.next))}`);
  }
  return <Login mode={mode} />;
}
