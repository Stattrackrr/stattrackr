import { useEffect, useRef } from 'react';
import { getSavedSession } from '../utils/storageUtils';

export interface UseTimeframeRestorationParams {
  playerStats: any[];
  selectedTimeframe: string;
  setSelectedTimeframe: (timeframe: string) => void;
}

/**
 * Custom hook to restore timeframe from session storage when playerStats loads
 * Only runs once when playerStats first loads, not on every timeframe change
 * NOTE: This should NOT override URL parameters - URL params are set immediately in initial useEffect
 */
export function useTimeframeRestoration({
  playerStats,
  selectedTimeframe,
  setSelectedTimeframe,
}: UseTimeframeRestorationParams) {
  const hasRestoredTimeframeRef = useRef(false);

  useEffect(() => {
    // Only restore if:
    // 1. Stats are loaded
    // 2. We haven't restored yet
    // 3. We're still on the default timeframe (last10) - meaning no URL param or manual selection happened
    // 4. There's a saved timeframe that's different from the default
    // ALWAYS force "last10" if we see "thisseason" anywhere
    if (playerStats.length > 0 && !hasRestoredTimeframeRef.current) {
      const url = typeof window !== 'undefined' ? new URL(window.location.href) : null;
      const urlTimeframe = url?.searchParams.get('tf');
      
      // If URL has "thisseason", force it to "last10"
      if (urlTimeframe === 'thisseason' || selectedTimeframe === 'thisseason') {
        console.log('[Dashboard] 🔄 FORCING timeframe from "thisseason" to "last10" in restore logic');
        setSelectedTimeframe('last10');
        if (typeof window !== 'undefined') {
          const newUrl = new URL(window.location.href);
          newUrl.searchParams.set('tf', 'last10');
          window.history.replaceState({}, '', newUrl.toString());
        }
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Check if URL has a timeframe param - respect other values
      if (urlTimeframe && urlTimeframe !== 'thisseason') {
        console.log('[Dashboard] ⚠️ Skipping timeframe restore - URL has timeframe param:', urlTimeframe);
        hasRestoredTimeframeRef.current = true;
        return;
      }
      
      // Only restore if we're still on default timeframe (last10)
      // This means we haven't manually selected a timeframe yet
      try {
        const saved = getSavedSession();
        if (saved && typeof saved === 'string') {
          const parsed = JSON.parse(saved);
          if (parsed?.selectedTimeframe && parsed.selectedTimeframe !== 'last10') {
            console.log(`[Dashboard] 🔄 Restoring timeframe from session: "${parsed.selectedTimeframe}"`);
            setSelectedTimeframe(parsed.selectedTimeframe);
          }
        }
      } catch {}
      hasRestoredTimeframeRef.current = true;
    }
  }, [playerStats.length, selectedTimeframe, setSelectedTimeframe]);
}

