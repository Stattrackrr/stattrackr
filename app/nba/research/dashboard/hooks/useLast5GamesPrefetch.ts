import { useEffect } from 'react';

export interface UseLast5GamesPrefetchParams {
  selectedTeam: string;
  propsMode: 'player' | 'team';
}

/**
 * Custom hook to prefetch Last 5 Games tracking stats data in the background
 */
export function useLast5GamesPrefetch({
  selectedTeam,
  propsMode,
}: UseLast5GamesPrefetchParams) {
  useEffect(() => {
    if (!selectedTeam || selectedTeam === 'N/A' || propsMode !== 'player') return;
    
    const prefetchLast5Games = async () => {
      const season = 2025;
      const cacheKeyPassing = `tracking_stats_${selectedTeam}_${season}_passing_last5`;
      const cacheKeyRebounding = `tracking_stats_${selectedTeam}_${season}_rebounding_last5`;
      
      // Check if already cached and fresh (30 minutes TTL)
      try {
        const cachedPassing = sessionStorage.getItem(cacheKeyPassing);
        const cachedRebounding = sessionStorage.getItem(cacheKeyRebounding);
        
        if (cachedPassing && cachedRebounding) {
          try {
            const passingData = JSON.parse(cachedPassing);
            const reboundingData = JSON.parse(cachedRebounding);
            const cacheTimestamp = passingData.__timestamp || 0;
            const cacheAge = Date.now() - cacheTimestamp;
            const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
            
            if (cacheAge < CACHE_TTL_MS) {
              return; // Already cached and fresh
            }
          } catch (e) {
            // Invalid cache, continue to prefetch
          }
        }
      } catch (e) {
        // Ignore storage errors
      }
      
      // Prefetch in background (non-blocking)
      const baseParams = `team=${encodeURIComponent(selectedTeam)}&season=${season}&lastNGames=5`;
      
      Promise.all([
        fetch(`/api/tracking-stats/team?${baseParams}&category=passing`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/tracking-stats/team?${baseParams}&category=rebounding`).then(r => r.ok ? r.json() : null).catch(() => null)
      ]).then(([passingResult, reboundingResult]) => {
        if (passingResult && reboundingResult && !passingResult.error && !reboundingResult.error) {
          try {
            sessionStorage.setItem(cacheKeyPassing, JSON.stringify({
              players: passingResult.players || [],
              __timestamp: Date.now()
            }));
            sessionStorage.setItem(cacheKeyRebounding, JSON.stringify({
              players: reboundingResult.players || [],
              __timestamp: Date.now()
            }));
          } catch (e) {
            // Ignore storage errors
          }
        }
      }).catch(() => {
        // Ignore errors
      });
    };
    
    // Small delay to not block initial render
    const timer = setTimeout(prefetchLast5Games, 1000);
    return () => clearTimeout(timer);
  }, [selectedTeam, propsMode]);
}


