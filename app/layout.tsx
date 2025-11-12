// app/layout.tsx
import type { Metadata, Viewport } from "next";
import "./globals.css";
import RootLayoutClient from "./layout-client";

export const metadata: Metadata = {
  title: "StatTrackr",
  description: "Track results. Master your game.",
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
