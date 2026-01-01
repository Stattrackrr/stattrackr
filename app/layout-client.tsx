'use client';

import { useEffect } from 'react';
import ErrorBoundary from "@/components/ErrorBoundary";
import { TrackedBetsProvider } from "@/contexts/TrackedBetsContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import NavigationLoader from "@/components/NavigationLoader";
import '@/lib/clientLogger'; // Initialize client logger to suppress production logs
import { clientLogger } from '@/lib/clientLogger';

export default function RootLayoutClient({ children }: { children: React.ReactNode }) {
  // Global error handlers to suppress all errors in production
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isProduction) {
        // Completely suppress in production
        event.preventDefault();
        return;
      }
      // In development, log it
      clientLogger.error('Unhandled promise rejection:', event.reason);
    };
    
    // Handle global errors
    const handleError = (event: ErrorEvent) => {
      if (isProduction) {
        // Completely suppress in production
        event.preventDefault();
        return;
      }
      // In development, log it
      clientLogger.error('Global error:', event.error);
    };
    
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    window.addEventListener('error', handleError);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
      window.removeEventListener('error', handleError);
    };
  }, []);
  
  // Prefetch player props cache on app load so it's ready when user navigates to player props page
  // Always fetches from API to warm up server cache (Supabase + in-memory), regardless of sessionStorage
  useEffect(() => {
    const prefetchPlayerPropsCache = async () => {
      // Only run in browser
      if (typeof window === 'undefined') return;

      const CACHE_KEY = 'nba-player-props-cache';
      const CACHE_TIMESTAMP_KEY = 'nba-player-props-cache-timestamp';

      try {
        // Check if we already have fresh data in sessionStorage (less than 5 minutes old)
        const cachedData = sessionStorage.getItem(CACHE_KEY);
        const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
        const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
        
        if (cachedData && cachedTimestamp) {
          const age = Date.now() - parseInt(cachedTimestamp, 10);
          if (age < CACHE_TTL_MS) {
            clientLogger.debug(`[Prefetch] ✅ Already have fresh cache (${Math.round(age / 1000)}s old), skipping prefetch`);
            return; // Already have fresh data, no need to prefetch
          }
        }

        // Always fetch from API to warm up server-side cache (Supabase + in-memory)
        // This ensures the cache is ready no matter what screen the user is on
        // Use 'no-cache' to ensure we hit the server and warm up Supabase cache
        clientLogger.debug('[Prefetch] 🔄 Prefetching player props cache from API...');
        const response = await fetch('/api/nba/player-props', {
          cache: 'no-store', // Force server fetch to warm up Supabase cache
          headers: {
            'Cache-Control': 'no-cache',
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.data && Array.isArray(data.data) && data.data.length > 0) {
            // Store in sessionStorage for instant access when navigating to player props page
            try {
              sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.data));
              sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
              clientLogger.debug(`[Prefetch] ✅ Prefetched ${data.data.length} player props`);
            } catch (e) {
              clientLogger.warn('[Prefetch] ⚠️ Failed to store in sessionStorage:', e);
            }
          } else {
            clientLogger.debug('[Prefetch] ⚠️ Cache not yet populated');
          }
        } else {
          clientLogger.debug('[Prefetch] ⚠️ API returned non-OK status');
        }
      } catch (error) {
        // Silently fail - this is just a prefetch, not critical
        // The page will fetch it normally when needed
        clientLogger.debug('[Prefetch] ⚠️ Prefetch failed (non-critical)');
      }
    };

    // Start prefetch immediately (no delay) - runs in background, doesn't block render
    prefetchPlayerPropsCache();
    
    // Prefetch dashboard games data on app load
    const prefetchDashboardGames = async () => {
      // Only run in browser
      if (typeof window === 'undefined') return;

      try {
        // Fetch games data for today ± 7 days (what dashboard needs)
        const today = new Date();
        const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1).toISOString().split('T')[0];
        const end = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 7).toISOString().split('T')[0];
        
        clientLogger.debug('[Prefetch] 🔄 Prefetching dashboard games data...');
        const response = await fetch(`/api/bdl/games?start_date=${start}&end_date=${end}&per_page=100`, {
          cache: 'default', // Use cache if available
        });

        if (response.ok) {
          const data = await response.json();
          if (data?.data && Array.isArray(data.data) && data.data.length > 0) {
            // Store in sessionStorage for instant access when navigating to dashboard
            const cacheKey = `dashboard-games-${start}-${end}`;
            sessionStorage.setItem(cacheKey, JSON.stringify(data.data));
            sessionStorage.setItem(`${cacheKey}-timestamp`, Date.now().toString());
            clientLogger.debug(`[Prefetch] ✅ Prefetched ${data.data.length} games for dashboard`);
          }
        }
      } catch (error) {
        // Silently fail - this is just a prefetch, not critical
        clientLogger.debug('[Prefetch] ⚠️ Dashboard games prefetch failed (non-critical)');
      }
    };
    
    // Prefetch dashboard games after a short delay (don't block player props prefetch)
    setTimeout(prefetchDashboardGames, 1000);
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
