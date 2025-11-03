'use client';

import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <TrackedBetsProvider>
        <ErrorBoundary>
          {children}
        </ErrorBoundary>
      </TrackedBetsProvider>
    </ThemeProvider>
  );
}
