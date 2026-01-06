/**
 * All games second axis data processing utilities
 * 
 * This file contains the logic for calculating second axis data from ALL player stats
 * (before any timeframe filtering) to enable filtering by slider range.
 */

import { parseMinutes } from './playerUtils';
import { BallDontLieStats, AdvancedStats } from '../types';

export interface AllGamesSecondAxisDataItem {
  gameId: string;
  value: number | null;
  gameDate: string;
}

export interface AllGamesSecondAxisDataParams {
  playerStats: BallDontLieStats[];
  selectedFilterForAxis: string | null;
  selectedTimeframe: string;
  advancedStatsPerGame: Record<number, AdvancedStats>;
  dvpRanksPerGame: Record<string, number | null>;
  propsMode: 'player' | 'team';
}

/**
 * Calculates second axis data from ALL player stats (before timeframe filtering)
 * This allows filtering by slider range from all available games
 */
export function processAllGamesSecondAxisData({
  playerStats,
  selectedFilterForAxis,
  selectedTimeframe,
  advancedStatsPerGame,
  dvpRanksPerGame,
  propsMode,
}: AllGamesSecondAxisDataParams): AllGamesSecondAxisDataItem[] | null {
  if (!selectedFilterForAxis || propsMode !== 'player' || !playerStats.length) {
    return null;
  }

  // Calculate from ALL playerStats (before any timeframe filtering)
  const result = playerStats
    .filter(stats => {
      // Only include games where player played (same filter as baseGameData)
      const minutes = parseMinutes(stats.min);
      const shouldIncludeZeroMinutes = selectedTimeframe === 'lastseason';
      if (shouldIncludeZeroMinutes) return true;
      return minutes > 0;
    })
    .map((stats: any) => {
      const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
      const gameIdStr = String(numericGameId || '');
      const gameDate = stats?.game?.date || '';
      let value: number | null = null;

      switch (selectedFilterForAxis) {
        case 'minutes':
          if (stats?.min) {
            value = parseMinutes(stats.min);
          }
          break;
        case 'fg_pct':
          if (stats?.fg_pct !== null && stats?.fg_pct !== undefined) {
            value = stats.fg_pct * 100;
          }
          break;
        case 'pace':
          if (numericGameId && advancedStatsPerGame[numericGameId]?.pace !== undefined) {
            value = advancedStatsPerGame[numericGameId].pace!;
          }
          break;
        case 'usage_rate':
          if (numericGameId && advancedStatsPerGame[numericGameId]?.usage_percentage !== undefined) {
            value = advancedStatsPerGame[numericGameId].usage_percentage! * 100;
          }
          break;
        case 'dvp_rank':
          value = dvpRanksPerGame[gameIdStr] ?? null;
          break;
        default:
          value = null;
      }

      return {
        gameId: gameIdStr,
        value,
        gameDate,
      };
    });

  return result;
}


