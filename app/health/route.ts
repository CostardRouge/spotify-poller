/**
 * /health — an alias of /api/health, public like it and answering the same
 * minimal `{status, auth_mode}`.
 *
 * Why an alias at all: the Home Lab's Portainer stack overrode the image's
 * HEALTHCHECK with `wget …/health`, a path the app never served. It "passed"
 * for months only because the auth gate redirected a signed-out /health to
 * the local /login page (200), and wget follows redirects. Once AUTH_MODE=sesame
 * sent signed-out visits straight to Sésame (2026-11-27), the same probe ended
 * on Sésame's 400, the container went unhealthy and Traefik answered 404 for
 * the whole site. A health probe must never depend on where the login
 * redirect points, so the conventional path now answers directly.
 * docs/memory/deployment.md keeps the story.
 */
export { GET } from "../api/health/route";
