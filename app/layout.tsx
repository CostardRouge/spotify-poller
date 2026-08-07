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
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eeece6" },
    { media: "(prefers-color-scheme: dark)", color: "#16150f" },
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
