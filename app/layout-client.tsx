'use client';

import { useEffect } from 'react';
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import NavigationLoader from "@/components/NavigationLoader";

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  // Prefetch player props cache on app load so it's ready when user navigates to player props page
  useEffect(() => {
    const prefetchPlayerPropsCache = async () => {
      // Only run in browser
      if (typeof window === 'undefined') return;

      // Check if we already have fresh cache in sessionStorage
      const CACHE_KEY = 'nba-player-props-cache';
      const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';
      const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes cache TTL

      try {
        const cachedData = sessionStorage.getItem(CACHE_KEY);
        const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp, 10);
          if (age < CACHE_TTL_MS) {
            // Cache is still fresh, no need to prefetch
            console.log('[Prefetch] ✅ Player props cache already fresh in sessionStorage');
            return;
          }
        }

        // Prefetch from API in the background (non-blocking)
        console.log('[Prefetch] 🔄 Prefetching player props cache from Supabase...');
        const response = await fetch('/api/nba/player-props', {
          cache: 'default',
          // Use AbortController with a timeout to prevent hanging
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
            // Store in sessionStorage for instant access when navigating to player props page
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.data));
            sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[Prefetch] ✅ Prefetched ${data.data.length} player props and cached to sessionStorage`);
          } else {
            console.log('[Prefetch] ⚠️ Cache not yet populated, will be available after processing');
          }
        }
      } catch (error) {
        // Silently fail - this is just a prefetch, not critical
        // The page will fetch it normally when needed
        console.log('[Prefetch] ⚠️ Prefetch failed (non-critical):', error instanceof Error ? error.message : 'Unknown error');
      }
    };

    // Prefetch after a short delay to not block initial render
    const timeoutId = setTimeout(prefetchPlayerPropsCache, 500);
    
    return () => clearTimeout(timeoutId);
  }, []);

  return (
    <ThemeProvider>
      <TrackedBetsProvider>
        <ErrorBoundary>
          <NavigationLoader />
          {children}
        </ErrorBoundary>
      </TrackedBetsProvider>
    </ThemeProvider>
  );
}
