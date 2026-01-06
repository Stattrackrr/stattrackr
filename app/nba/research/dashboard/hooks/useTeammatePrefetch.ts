/**
 * Custom hook for prefetching teammate game data
 * 
 * This hook prefetches teammate game participation data in the background
 * to enable faster filtering when a teammate filter is selected.
 */

import { useEffect } from 'react';
import { BaseGameDataItem } from '../utils/baseGameDataUtils';
import { NBAPlayer } from '../types';

export interface UseTeammatePrefetchParams {
  rosterForSelectedTeam: any;
  baseGameData: BaseGameDataItem[];
  propsMode: 'player' | 'team';
  selectedPlayer: NBAPlayer | null;
}

/**
 * Custom hook that prefetches teammate game data in the background
 * Only prefetches first 5 teammates to avoid too many requests
 */
export function useTeammatePrefetch({
  rosterForSelectedTeam,
  baseGameData,
  propsMode,
  selectedPlayer,
}: UseTeammatePrefetchParams) {
  useEffect(() => {
    if (!rosterForSelectedTeam || !baseGameData?.length || propsMode !== 'player') return;
    
    const games = (baseGameData || []).map((g: any) => g?.stats?.game?.id || g?.game?.id).filter(Boolean);
    if (!games.length) return;
    
    // Get all teammate IDs from roster
    const teammateIds: number[] = [];
    Object.values(rosterForSelectedTeam).forEach((pos: any) => {
      const arr = Array.isArray(pos) ? pos : [];
      arr.forEach((p: any) => {
        const id = p?.id || p?.player_id;
        if (id && typeof id === 'number' && String(id) !== String(selectedPlayer?.id || '')) {
          teammateIds.push(id);
        }
      });
    });
    
    if (teammateIds.length === 0) return;
    
    // Prefetch in background (low priority, don't block UI)
    const prefetchTeammateData = async () => {
      // Only prefetch first 5 teammates to avoid too many requests
      const teammatesToPrefetch = teammateIds.slice(0, 5);
      
      for (const teammateId of teammatesToPrefetch) {
        // Check if already cached
        const CACHE_KEY = `teammate-games-${teammateId}`;
        const cachedData = typeof window !== 'undefined' ? sessionStorage.getItem(CACHE_KEY) : null;
        
        if (cachedData) {
          continue; // Already cached, skip
        }
        
        // Prefetch in background (small delay to not interfere with user actions)
        setTimeout(async () => {
          try {
            const chunks: number[][] = [];
            const size = 50;
            for (let i = 0; i < games.length; i += size) chunks.push(games.slice(i, i + size));
            
            // Fetch in parallel but with lower priority
            const fetchPromises = chunks.map(async (chunk) => {
              const params = new URLSearchParams();
              params.set('endpoint', '/stats');
              params.set('per_page', '100');
              params.set('player_ids[]', String(teammateId));
              for (const gid of chunk) params.append('game_ids[]', String(gid));
              const url = `/api/balldontlie?${params.toString()}`;
              const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
              const json = await res?.json().catch(() => ({})) as any;
              return Array.isArray(json?.data) ? json.data : [];
            });
            
            const allResults = await Promise.all(fetchPromises);
            const played = new Set<number>();
            
            allResults.flat().forEach((s: any) => {
              const minStr = s?.min || '0:00';
              const [m, sec] = String(minStr).split(':').map((x: any) => parseInt(x || '0', 10));
              const minutes = (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) ? sec : 0) > 0 ? 1 : 0);
              const gid = typeof s?.game?.id === 'number' ? s.game.id : (typeof s?.game_id === 'number' ? s.game_id : null);
              if (minutes > 0 && gid != null) played.add(gid);
            });
            
            // Cache the prefetched results
            if (typeof window !== 'undefined') {
              try {
                const allPlayedGameIds = Array.from(played);
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(allPlayedGameIds));
                sessionStorage.setItem(`teammate-games-${teammateId}-timestamp`, Date.now().toString());
                console.log(`[Teammate Filter] 📊 Prefetched ${allPlayedGameIds.length} games for teammate ${teammateId}`);
              } catch (e) {
                // Ignore cache errors
              }
            }
          } catch (e) {
            // Silently fail prefetch
          }
        }, 2000); // 2 second delay to not interfere with immediate user actions
      }
    };
    
    prefetchTeammateData();
  }, [rosterForSelectedTeam, baseGameData, propsMode, selectedPlayer?.id]);
}


