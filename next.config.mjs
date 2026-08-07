/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deliberately NOT output:"standalone" (unlike the Spotify Calendar): this
  // app also ships CLI scripts (migrate/backup/export/import, run via tsx)
  // that need the full dependency tree at runtime, not just what `next start`
  // itself touches — see Dockerfile.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
