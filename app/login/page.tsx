import { Login } from "./login-form";

// Read at request time: the mode is the server's environment (AUTH_MODE).
export const dynamic = "force-dynamic";

/** The sign-in screen: the admin token, or « Sign in with Sésame » when AUTH_MODE=sesame. */
export default function LoginPage() {
  return <Login mode={process.env.AUTH_MODE === "sesame" ? "sesame" : "token"} />;
}
