import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "spotify-poller";
const description =
  "Custody report for a personal Spotify listening history — proves collection is running, surfaces gaps, and lets the operator browse, filter and export what was collected.";

export const metadata: Metadata = {
  title: {
    default: title,
    template: "%s · spotify-poller",
  },
  description,
  applicationName: title,
  // The whole icon set, not a favicon (COMMON-PROJECT-SPEC, C11): iOS builds a
  // home-screen icon from apple-touch-icon alone and ignores rel="icon"
  // whatever its type; Android reads the manifest. public/icons/ holds the
  // sources and the PNGs scripts/gen-icons.mjs rasterises from them.
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // The label under the icon on an iOS home screen; the manifest's short_name
  // is its Android twin. Twelve characters or so before the launcher cuts it.
  appleWebApp: { title: "Poller" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8faf9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b211d" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        {/* Runs before paint: mirrors the persisted theme choice onto <html> so
            there is no flash of the wrong theme on load. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{var t=localStorage.getItem('sp-theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}",
          }}
        />
        {children}
      </body>
    </html>
  );
}
