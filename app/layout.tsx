// app/layout.tsx
import type { Metadata } from "next";
import "./globals.css";
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";

export const metadata: Metadata = {
  title: "StatTrackr",
  description: "Track results. Master your game.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* Devtools disabled */}
      </head>
      <body className="min-h-screen antialiased bg-[var(--brand-bg)] text-[var(--brand-fg)]">
        <TrackedBetsProvider>
          <ErrorBoundary>
            {children}
          </ErrorBoundary>
        </TrackedBetsProvider>
      </body>
    </html>
  );
}
