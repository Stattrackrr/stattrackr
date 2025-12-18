'use client';

import { useEffect } from 'react';
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import NavigationLoader from "@/components/NavigationLoader";

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  // Prefetch player props cache on app load so it's ready when user navigates to player props page
  // Always fetches from API to warm up server cache, regardless of sessionStorage
  useEffect(() => {
    const prefetchPlayerPropsCache = async () => {
      // Only run in browser
      if (typeof window === 'undefined') return;

      const CACHE_KEY = 'nba-player-props-cache';
      const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';

      try {
        // Always fetch from API to warm up server-side cache (in-memory and Supabase)
        // This ensures the cache is ready no matter what screen the user is on
        console.log('[Prefetch] 🔄 Prefetching player props cache from API (warming server cache)...');
        const response = await fetch('/api/nba/player-props', {
          cache: 'default',
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
            // Store in sessionStorage for instant access when navigating to player props page
            sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.data));
            sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
            console.log(`[Prefetch] ✅ Prefetched ${data.data.length} player props (server cache warmed, client cache updated)`);
          } else {
            console.log('[Prefetch] ⚠️ Cache not yet populated, will be available after processing');
          }
        } else {
          console.log('[Prefetch] ⚠️ API returned non-OK status, cache may not be ready yet');
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
