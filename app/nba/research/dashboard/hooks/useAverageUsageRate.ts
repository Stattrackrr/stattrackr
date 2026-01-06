/**
 * Custom hook for calculating average usage rate
 * 
 * This hook calculates the average usage rate from prefetched advanced stats
 * or fetches the data if not available.
 */

import { useEffect } from 'react';
import { BallDontLieAPI } from '../api';
import { parseMinutes } from '../utils/playerUtils';
import { BaseGameDataItem } from '../utils/baseGameDataUtils';
import { NBAPlayer } from '../types';

export interface UseAverageUsageRateParams {
  baseGameData: BaseGameDataItem[];
  propsMode: 'player' | 'team';
  selectedPlayer: NBAPlayer | null;
  prefetchedAdvancedStats: Record<number, { pace?: number; usage_percentage?: number }>;
  setAverageUsageRate: (rate: number | null) => void;
  setPrefetchedAdvancedStats: React.Dispatch<React.SetStateAction<Record<number, { pace?: number; usage_percentage?: number }>>>;
}

/**
 * Custom hook that calculates average usage rate from base game data
 * Uses prefetched stats if available, otherwise fetches them
 */
export function useAverageUsageRate({
  baseGameData,
  propsMode,
  selectedPlayer,
  prefetchedAdvancedStats,
  setAverageUsageRate,
  setPrefetchedAdvancedStats,
}: UseAverageUsageRateParams) {
  useEffect(() => {
    if (!baseGameData || baseGameData.length === 0 || propsMode !== 'player') {
      setAverageUsageRate(null);
      return;
    }

    // Get player ID
    const playerIdRaw = selectedPlayer?.id;
    if (!playerIdRaw) {
      setAverageUsageRate(null);
      return;
    }
    const playerId = typeof playerIdRaw === 'number' ? playerIdRaw : Number(playerIdRaw);
    if (isNaN(playerId)) {
      setAverageUsageRate(null);
      return;
    }

    // Extract game IDs from baseGameData
    const gameIds: number[] = [];
    baseGameData.forEach((game: any) => {
      const stat = game.stats || game;
      const gameId = stat.game?.id || game.game?.id;
      if (gameId && typeof gameId === 'number') {
        gameIds.push(gameId);
      }
    });

    if (gameIds.length === 0) {
      setAverageUsageRate(null);
      return;
    }

    // Check if we have prefetched data for these games
    const missingGameIds = gameIds.filter(id => prefetchedAdvancedStats[id] === undefined);
    const hasAllData = missingGameIds.length === 0;

    // If we don't have all data, fetch it immediately (don't wait for background prefetch)
    if (!hasAllData) {
      let isMounted = true;
      const fetchUsageRate = async () => {
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
          
          // Update prefetched stats
          setPrefetchedAdvancedStats(prev => ({ ...prev, ...statsByGame }));
          
          // Calculate usage rate from the fetched data
          const usageValues: number[] = [];
          baseGameData.forEach((game: any) => {
            const stat = game.stats || game;
            const gameId = stat.game?.id || game.game?.id;
            const minutes = parseMinutes(stat.min);
            
            if (gameId && minutes > 0 && statsByGame[gameId]?.usage_percentage !== undefined) {
              const usage = statsByGame[gameId].usage_percentage;
              if (usage !== null && usage !== undefined && !isNaN(usage) && usage >= 0) {
                usageValues.push(usage);
              }
            }
          });

          if (usageValues.length > 0) {
            const avgUsage = usageValues.reduce((sum, usage) => sum + usage, 0) / usageValues.length;
            setAverageUsageRate(avgUsage * 100);
          }
        } catch (error) {
          console.error('[Usage Rate] Error fetching advanced stats:', error);
        }
      };

      fetchUsageRate();
      return () => {
        isMounted = false;
      };
    }

    // If we have all prefetched data, calculate from it
    const usageValues: number[] = [];
    baseGameData.forEach((game: any) => {
      const stat = game.stats || game;
      const gameId = stat.game?.id || game.game?.id;
      const minutes = parseMinutes(stat.min);
      
      // Only include games where player actually played
      if (gameId && minutes > 0 && prefetchedAdvancedStats[gameId]?.usage_percentage !== undefined) {
        const usage = prefetchedAdvancedStats[gameId].usage_percentage;
        if (usage !== null && usage !== undefined && !isNaN(usage) && usage >= 0) {
          usageValues.push(usage);
        }
      }
    });

    if (usageValues.length === 0) {
      setAverageUsageRate(null);
    } else {
      const avgUsage = usageValues.reduce((sum, usage) => sum + usage, 0) / usageValues.length;
      // Convert to percentage (multiply by 100)
      const usageRate = avgUsage * 100;
      setAverageUsageRate(usageRate);
    }
  }, [prefetchedAdvancedStats, baseGameData, propsMode, selectedPlayer?.id, setAverageUsageRate, setPrefetchedAdvancedStats]);
}

