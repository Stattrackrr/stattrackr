import { useEffect, useRef, useState } from 'react';
import { BallDontLieAPI } from '../api';

export interface UseAdvancedStatsPrefetchParams {
  propsMode: 'player' | 'team';
  playerStats: any[];
  selectedPlayer: any;
  selectedFilterForAxis: string | null;
  adjustedChartData: any[];
  setAdvancedStatsPerGame: (stats: Record<number, { pace?: number; usage_percentage?: number }>) => void;
}

/**
 * Custom hook to handle advanced stats (pace, usage_rate) prefetching and fetching
 */
export function useAdvancedStatsPrefetch({
  propsMode,
  playerStats,
  selectedPlayer,
  selectedFilterForAxis,
  adjustedChartData,
  setAdvancedStatsPerGame,
}: UseAdvancedStatsPrefetchParams) {
  const [prefetchedAdvancedStats, setPrefetchedAdvancedStats] = useState<Record<number, { pace?: number; usage_percentage?: number }>>({});
  const advancedStatsPrefetchRef = useRef<Set<string>>(new Set());

  // Prefetch advanced stats (pace, usage_rate) in background for all games
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats || playerStats.length === 0) {
      return;
    }

    // Get player ID
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    // Clear prefetch ref when player changes to ensure fresh fetch
    const currentPlayerKey = `player_${playerId}`;
    if (!advancedStatsPrefetchRef.current.has(currentPlayerKey)) {
      // New player - clear old prefetch keys
      advancedStatsPrefetchRef.current.clear();
      advancedStatsPrefetchRef.current.add(currentPlayerKey);
    }

    // Extract game IDs from playerStats - include ALL games (don't filter by minutes)
    // This ensures we get usage rate for all games, matching what the chart would show
    const gameIds: number[] = [];
    const seenGameIds = new Set<number>();
    playerStats.forEach((stat: any) => {
      const gameId = stat.game?.id;
      if (gameId && typeof gameId === 'number' && !seenGameIds.has(gameId)) {
        gameIds.push(gameId);
        seenGameIds.add(gameId);
      }
    });

    if (gameIds.length === 0) {
      return;
    }

    // Prefetch in background (don't block UI)
    // Use a ref to track if we've already started prefetching for these game IDs
    const prefetchKey = `advanced_${playerId}_${gameIds.sort().join(',')}`;
    
    if (advancedStatsPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for these games
      console.log('[Usage Rate Prefetch] Already prefetching/prefetched for player', playerId);
      return;
    }

    // Check if we already have prefetched data for all these games
    const missingGameIds = gameIds.filter(id => prefetchedAdvancedStats[id] === undefined);
    if (missingGameIds.length === 0 && gameIds.length > 0) {
      // Already prefetched all games, mark as done
      advancedStatsPrefetchRef.current.add(prefetchKey);
      console.log('[Usage Rate Prefetch] Already have all prefetched data for', gameIds.length, 'games');
      return;
    }
    
    // If we have some but not all, still fetch (will merge with existing)
    if (missingGameIds.length < gameIds.length) {
      console.log('[Usage Rate Prefetch] Have', gameIds.length - missingGameIds.length, 'games, fetching', missingGameIds.length, 'missing');
    }

    // Mark as prefetching
    advancedStatsPrefetchRef.current.add(prefetchKey);
    console.log('[Usage Rate Prefetch] Starting prefetch for player', playerId, 'with', gameIds.length, 'games');
    
    let isMounted = true;
    const prefetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        console.log('[Usage Rate Prefetch] Fetched', Object.keys(statsByGame).length, 'games with usage rate data');
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Prefetch] Error prefetching advanced stats:', error);
      }
    };

    prefetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [playerStats, propsMode, selectedPlayer?.id, prefetchedAdvancedStats]);

  // Use prefetched advanced stats when pace or usage_rate is selected (for chart filtering)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setAdvancedStatsPerGame({});
      return;
    }

    // Only use prefetched data if pace or usage_rate is selected
    if (selectedFilterForAxis === 'pace' || selectedFilterForAxis === 'usage_rate') {
      // Use prefetched data immediately
      setAdvancedStatsPerGame(prefetchedAdvancedStats);
    } else {
      setAdvancedStatsPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, prefetchedAdvancedStats, setAdvancedStatsPerGame]);

  // Legacy fetch (kept for backward compatibility, but should use prefetched data)
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player' || !adjustedChartData.length) {
      return;
    }

    // Only fetch if pace or usage_rate is selected AND we don't have prefetched data
    if (selectedFilterForAxis !== 'pace' && selectedFilterForAxis !== 'usage_rate') {
      return;
    }

    // Check if we already have prefetched data
    const gameIds: number[] = [];
    adjustedChartData.forEach((game: any) => {
      const gameId = game.game?.id || game.stats?.game?.id;
      if (gameId && typeof gameId === 'number') {
        gameIds.push(gameId);
      }
    });

    const hasAllPrefetched = gameIds.length > 0 && gameIds.every(id => prefetchedAdvancedStats[id] !== undefined);
    if (hasAllPrefetched) {
      // Already have prefetched data, skip fetch
      return;
    }

    // Get player ID (convert to number if string)
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      return;
    }

    if (gameIds.length === 0) {
      return;
    }

    // Fetch advanced stats for all games
    let isMounted = true;
    const fetchAdvancedStats = async () => {
      try {
        const stats = await BallDontLieAPI.getAdvancedStatsByGames(gameIds, playerId);
        
        if (!isMounted) return;
        
        // Map stats by game ID
        const statsByGame: Record<number, { pace?: number; usage_percentage?: number }> = {};
        stats.forEach((stat: any) => {
          const gameId = stat.game?.id;
          if (gameId && typeof gameId === 'number') {
            statsByGame[gameId] = {
              pace: stat.pace ?? undefined,
              usage_percentage: stat.usage_percentage ?? undefined,
            };
          }
        });
        
        // Populate both advancedStatsPerGame (for filter) and prefetchedAdvancedStats (for usage rate calculation)
        setAdvancedStatsPerGame(statsByGame);
        setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
      } catch (error) {
        console.error('[Second Axis] Error fetching advanced stats:', error);
        if (isMounted) {
          setAdvancedStatsPerGame({});
        }
      }
    };

    fetchAdvancedStats();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, adjustedChartData, propsMode, selectedPlayer?.id, prefetchedAdvancedStats, setAdvancedStatsPerGame]);

  return { prefetchedAdvancedStats, setPrefetchedAdvancedStats };
}

