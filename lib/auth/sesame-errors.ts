// What /login says when the round trip to Sésame ends badly (?sesame=…).
// Client-safe: no import, read by the login form and lib/auth/sesame-flow.ts.
export const SESAME_ERRORS = {
  expired: "The sign-in through Sésame took too long or started elsewhere. Try again.",
  refused: "Sésame did not let you in: ask for access to spotify-poller in Sésame.",
  failed: "Sésame's answer could not be checked. Try again.",
} as const;
export type SesameError = keyof typeof SESAME_ERRORS;
