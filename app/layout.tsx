// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import RootLayoutClient from "./layout-client";
import MetaPixel from "@/components/MetaPixel";
import TikTokPixel from "../components/TikTokPixel";

export const metadata: Metadata = {
  metadataBase: new URL("https://stattrackr.co"),
  title: "StatTrackr - Advanced Sports Statistic Dashboard",
  description: "Advanced multi-sport statistics dashboard covering NBA, AFL, soccer and more. Analyze player statistics, team trends, game props, and matchup data with fast, data-driven tools.",
  keywords: [
    "sports analytics",
    "multi-sport research",
    "multi-sport analytics",
    "NBA statistics",
    "AFL statistics",
    "AFL analytics",
    "data analysis",
    "sports data",
    "basketball analytics",
    "AFL player stats",
    "player statistics",
    "team analytics",
    "sports metrics",
    "statistical analysis",
    "sports research",
    "data visualization",
    "performance analytics"
  ],
  manifest: "/manifest.json",
  other: {
    "mobile-web-app-capable": "yes",
    "apple-mobile-web-app-capable": "yes",
    "application-name": "StatTrackr",
    "apple-mobile-web-app-title": "StatTrackr",
  },
  icons: {
    icon: [
      { url: "/images/favicon-32.png?v=20260802", sizes: "32x32", type: "image/png" },
      { url: "/images/favicon-48.png?v=20260802", sizes: "48x48", type: "image/png" },
      { url: "/images/stattrackr-logo-512.webp?v=20260802", sizes: "512x512", type: "image/webp" },
    ],
    shortcut: [
      { url: "/images/favicon-32.png?v=20260802", type: "image/png" },
    ],
    apple: [
      { url: "/images/apple-touch-icon.png?v=20260802", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StatTrackr",
  },
  openGraph: {
    title: "StatTrackr - Advanced Sports Statistic Dashboard",
    description: "Analyze multi-sport player stats, team trends, and game props with an advanced, fast sports statistic dashboard.",
    type: "website",
    siteName: "StatTrackr",
    images: [
      {
        url: "/images/stattrackr-icon-512.webp?v=20260802",
        width: 512,
        height: 512,
        alt: "StatTrackr logo",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
  category: "Sports Analytics",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#050d1a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Devtools disabled */}
      </head>
      <body className="min-h-screen antialiased bg-[var(--brand-bg)] text-[var(--brand-fg)]">
        <TikTokPixel />
        <MetaPixel />
        {/* Capture password-reset hash before React so it survives; runs on first paint */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var p='/auth/update-password';if(location.pathname===p&&location.hash&&location.hash.indexOf('access_token')!==-1){try{sessionStorage.setItem('sb_recovery',location.hash.slice(1));location.replace(p+location.search);}catch(e){}}}());`,
          }}
        />
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
