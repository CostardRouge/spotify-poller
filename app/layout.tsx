import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import ServiceWorker from "@/components/ServiceWorker";
import { requestOrigin } from "@/lib/server/origin";
import "./globals.css";

const title = "spotify-poller";
const description =
  "Custody report for a personal Spotify listening history — proves collection is running, surfaces gaps, and lets the operator browse, filter and export what was collected.";

/**
 * Metadata is built per request for one reason: link previews. og:image must
 * be an absolute URL, and the only trustworthy source for this instance's
 * address is the request itself (lib/server/origin.ts says why there is no
 * setting for it). Every page under this layout is dynamic already — the
 * dashboard reads live SQLite state, /login reads AUTH_MODE — so reading
 * headers here costs no prerendering.
 */
export async function generateMetadata(): Promise<Metadata> {
  const h = await headers();
  const origin = requestOrigin((name) => h.get(name));
  return {
    ...(origin ? { metadataBase: origin } : {}),
    ...metadata,
  };
}

const metadata: Metadata = {
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
  // `capable` is the legacy switch iOS still reads to open a home-screen launch
  // standalone (the manifest's `display` says the same to everyone else).
  // `default` keeps the status bar opaque and its text dark-on-light or
  // light-on-dark with the system: `black-translucent` would lay the page under
  // white status-bar text, unreadable on the light theme this app opens with.
  appleWebApp: { title: "Poller", capable: true, statusBarStyle: "default" },
  // A private instance, never a search result: this is one person's listening
  // history behind a login, and the only page a crawler can reach is that
  // login. public/robots.txt says the same to crawlers that read it first; the
  // public face of the project is the showcase on GitHub Pages.
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  // Link previews (a URL pasted into a chat): a preview fetcher has no session,
  // so it lands on /login and reads this. The card is a drawing of the name and
  // the purpose — never a number, a track or an account: the preview is shown
  // to whoever the link was sent to. public/og.png is outside the auth gate.
  openGraph: {
    type: "website",
    siteName: title,
    title: `${title} — a custody report for a Spotify listening history`,
    description,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "spotify-poller — a custody report for a Spotify listening history." }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${title} — a custody report for a Spotify listening history`,
    description,
    images: ["/og.png"],
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8faf9" },
    { media: "(prefers-color-scheme: dark)", color: "#1b211d" },
  ],
  colorScheme: "light dark",
  // Hands the page the whole screen, notch and rounded corners included, so
  // that env(safe-area-inset-*) reports real values; app/globals.css spends
  // them (body, .tabbar). Without it, an installed app on an iPhone laid its
  // tab bar into the rounded corners with no inset to push it clear.
  viewportFit: "cover",
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
        <ServiceWorker />
      </body>
    </html>
  );
}
