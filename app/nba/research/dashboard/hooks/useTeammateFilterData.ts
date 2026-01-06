/**
 * Custom hook for fetching teammate game data for filtering
 * 
 * This hook handles fetching and caching teammate game participation data
 * to enable filtering games by whether a specific teammate played.
 */

import { useEffect, useRef } from 'react';
import { currentNbaSeason } from '../utils/playerUtils';
import { BaseGameDataItem } from '../utils/baseGameDataUtils';

export interface UseTeammateFilterDataParams {
  teammateFilterId: number | null;
  baseGameData: BaseGameDataItem[];
  withWithoutMode: 'with' | 'without' | null;
  setTeammatePlayedGameIds: (ids: Set<number>) => void;
  setLoadingTeammateGames: (loading: boolean) => void;
  teammateFetchAbortControllerRef: React.MutableRefObject<AbortController | null>;
  teammateFetchInProgressRef: React.MutableRefObject<Set<number>>;
}

/**
 * Custom hook that fetches teammate game participation data
 * Handles caching, aborting in-flight requests, and managing loading state
 */
export function useTeammateFilterData({
  teammateFilterId,
  baseGameData,
  withWithoutMode,
  setTeammatePlayedGameIds,
  setLoadingTeammateGames,
  teammateFetchAbortControllerRef,
  teammateFetchInProgressRef,
}: UseTeammateFilterDataParams) {
  useEffect(() => {
    const run = async () => {
      if (!teammateFilterId) {
        setTeammatePlayedGameIds(new Set());
        return;
      }
      
      // Cancel any in-flight request for a different teammate
      if (teammateFetchAbortControllerRef.current) {
        teammateFetchAbortControllerRef.current.abort();
      }
      
      // Check if already fetching this teammate
      if (teammateFetchInProgressRef.current.has(teammateFilterId)) {
        console.log(`[Teammate Filter] ⏳ Already fetching games for teammate ${teammateFilterId}, skipping duplicate`);
        return;
      }
      
      try {
        // Get all games from baseGameData to check
        const games = (baseGameData || []).map((g: any) => g?.stats?.game?.id || g?.game?.id).filter(Boolean);
        if (!games.length) {
          setTeammatePlayedGameIds(new Set());
          return;
        }
        
        // Check cache first (30 min TTL)
        const CACHE_KEY = `teammate-games-${teammateFilterId}`;
        const CACHE_TIMESTAMP_KEY = `teammate-games-${teammateFilterId}-timestamp`;
        const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
        
        if (typeof window !== 'undefined') {
          const cachedData = sessionStorage.getItem(CACHE_KEY);
          const cachedTimestamp = sessionStorage.getItem(CACHE_TIMESTAMP_KEY);
          
          if (cachedData && cachedTimestamp) {
            const age = Date.now() - parseInt(cachedTimestamp, 10);
            if (age < CACHE_TTL_MS) {
              try {
                const cachedGameIds = JSON.parse(cachedData);
                if (Array.isArray(cachedGameIds)) {
                  // Use all cached game IDs, not just ones from baseGameData
                  // This ensures we have complete data for all games
                  const allCachedIds = new Set(cachedGameIds);
                  
                  // If cache has very few games (< 10), it might be incomplete (from old logic)
                  // Clear the cache and refetch to ensure we have complete season data
                  if (allCachedIds.size < 10) {
                    console.log(`[Teammate Filter] ⚠️ Cache has only ${allCachedIds.size} games, likely incomplete. Clearing cache and refetching...`);
                    // Clear the stale cache
                    sessionStorage.removeItem(CACHE_KEY);
                    sessionStorage.removeItem(CACHE_TIMESTAMP_KEY);
                    // Continue to fetch fresh data below
                  } else {
                    setTeammatePlayedGameIds(allCachedIds);
                    console.log(`[Teammate Filter] ✅ Using cached data (${allCachedIds.size} total games, ${games.length} in current view, ${Math.round(age / 1000)}s old)`);
                    return; // Use cached data, skip API calls
                  }
                }
              } catch (e) {
                console.warn('[Teammate Filter] ⚠️ Failed to parse cached data, fetching fresh');
              }
            } else {
              console.log(`[Teammate Filter] ⏰ Cache expired (${Math.round(age / 1000)}s old), fetching fresh`);
            }
          }
        }
        
        // Mark as in-progress
        teammateFetchInProgressRef.current.add(teammateFilterId);
        setLoadingTeammateGames(true);
        
        // Create abort controller for this request
        const abortController = new AbortController();
        teammateFetchAbortControllerRef.current = abortController;
        
        // Fetch ALL teammate stats for the current season, not just games in baseGameData
        // This ensures we have complete data regardless of timeframe filter
        const currentSeason = currentNbaSeason();
        const params = new URLSearchParams();
        params.set('endpoint', '/stats');
        params.set('per_page', '100');
        params.set('player_ids[]', String(teammateFilterId));
        params.set('seasons[]', String(currentSeason));
        const url = `/api/balldontlie?${params.toString()}`;
        
        try {
          const res = await fetch(url, { 
            cache: 'no-store',
            signal: abortController.signal 
          }).catch(() => null);
          
          if (abortController.signal.aborted) {
            return;
          }
          
          const json = await res?.json().catch(() => ({})) as any;
          const allStats = Array.isArray(json?.data) ? json.data : [];
        
          // Check if request was aborted
          if (abortController.signal.aborted) {
            return;
          }
          
          const played = new Set<number>();
          
          // Process all results - mark games where teammate played (minutes > 0)
          allStats.forEach((s: any) => {
            const minStr = s?.min || '0:00';
            const [m, sec] = String(minStr).split(':').map((x: any) => parseInt(x || '0', 10));
            const minutes = (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) ? sec : 0) > 0 ? 1 : 0);
            const gid = typeof s?.game?.id === 'number' ? s.game.id : (typeof s?.game_id === 'number' ? s.game_id : null);
            if (minutes > 0 && gid != null) {
              played.add(gid);
            }
          });
          
          console.log(`[Teammate Filter] 📊 Fetched ${allStats.length} total stats, ${played.size} games where teammate played`);
          
          // Cache the results (only if we got a reasonable amount of data)
          // If we got very few stats, the teammate might not have played much, but cache it anyway
          if (typeof window !== 'undefined') {
            try {
              const allPlayedGameIds = Array.from(played);
              sessionStorage.setItem(CACHE_KEY, JSON.stringify(allPlayedGameIds));
              sessionStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
              console.log(`[Teammate Filter] 💾 Cached ${allPlayedGameIds.length} games for teammate ${teammateFilterId} (from ${allStats.length} total stats)`);
            } catch (e) {
              console.warn('[Teammate Filter] ⚠️ Failed to cache results', e);
            }
          }
          
          setTeammatePlayedGameIds(played);
        } catch (e: any) {
          if (e.name !== 'AbortError') {
            console.error('[Teammate Filter] ❌ Error fetching teammate games:', e);
          }
        } finally {
          teammateFetchInProgressRef.current.delete(teammateFilterId);
          setLoadingTeammateGames(false);
        }
      } catch (e: any) {
        if (e.name !== 'AbortError') {
          console.error('[Teammate Filter] ❌ Error in teammate filter logic:', e);
        }
        setTeammatePlayedGameIds(new Set());
      } finally {
        // Cleanup is handled in inner finally
      }
    };
    run();
    
    // Cleanup: abort request if component unmounts or dependencies change
    return () => {
      if (teammateFetchAbortControllerRef.current) {
        teammateFetchAbortControllerRef.current.abort();
      }
    };
  }, [withWithoutMode, teammateFilterId, baseGameData, setTeammatePlayedGameIds, setLoadingTeammateGames, teammateFetchAbortControllerRef, teammateFetchInProgressRef]);
}



