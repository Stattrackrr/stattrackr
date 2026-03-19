// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import RootLayoutClient from "./layout-client";
import MetaPixel from "@/components/MetaPixel";
import TikTokPixel from "../components/TikTokPixel";

export const metadata: Metadata = {
  title: "StatTrackr - Advanced Sports Statistic Dashboard",
  description: "Advanced sports statistic dashboard for NBA and AFL. Analyze player statistics, team trends, game props, and matchup data with fast, data-driven tools.",
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
  icons: {
    icon: [
      { url: "/images/transparent-photo.png?v=20260302", sizes: "48x48", type: "image/png" },
      { url: "/images/transparent-photo.png?v=20260302", sizes: "192x192", type: "image/png" },
      { url: "/images/transparent-photo.png?v=20260302", sizes: "512x512", type: "image/png" },
    ],
    shortcut: [
      { url: "/images/transparent-photo.png?v=20260302", type: "image/png" },
    ],
    apple: [
      { url: "/images/transparent-photo.png?v=20260302", sizes: "180x180", type: "image/png" },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StatTrackr",
  },
  openGraph: {
    title: "StatTrackr - Advanced Sports Statistic Dashboard",
    description: "Analyze NBA and AFL player stats, team trends, and game props with an advanced, fast sports statistic dashboard.",
    type: "website",
    siteName: "StatTrackr",
    images: [
      {
        url: "/images/stattrackr-icon.png?v=20260302",
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
  themeColor: "#0b1221",
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
