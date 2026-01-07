// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import RootLayoutClient from "./layout-client";

export const metadata: Metadata = {
  title: "StatTrackr - NBA Sports Analytics & Data Analysis Platform",
  description: "Advanced NBA sports analytics and data analysis platform. Track player statistics, team performance metrics, and defensive analytics. Data-driven insights for sports research and analysis.",
  keywords: [
    "sports analytics",
    "NBA statistics",
    "data analysis",
    "sports data",
    "basketball analytics",
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
      { url: "/stattrackr-icon.png", sizes: "192x192", type: "image/png" },
      { url: "/stattrackr-icon.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/stattrackr-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "StatTrackr",
  },
  openGraph: {
    title: "StatTrackr - NBA Sports Analytics & Data Analysis",
    description: "Advanced NBA sports analytics and data analysis platform for tracking player statistics and team performance metrics.",
    type: "website",
    siteName: "StatTrackr",
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
        <RootLayoutClient>{children}</RootLayoutClient>
      </body>
    </html>
  );
}
