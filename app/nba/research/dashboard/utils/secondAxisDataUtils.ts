/**
 * Second axis data processing utilities
 * 
 * This file contains the logic for calculating second axis data from filtered chart data
 * to display on the chart's secondary Y-axis (e.g., minutes, FG%, pace, usage rate, DvP rank).
 */

import { parseMinutes } from './playerUtils';
import { AdvancedStats } from '../types';

export interface SecondAxisDataItem {
  gameId: string;
  gameDate: string;
  value: number | null;
}

import { FilteredChartDataItem } from './filteredChartDataUtils';

export interface SecondAxisDataParams {
  filteredChartData: FilteredChartDataItem[];
  selectedFilterForAxis: string | null;
  propsMode: 'player' | 'team';
  advancedStatsPerGame: Record<number, AdvancedStats>;
  dvpRanksPerGame: Record<string, number | null>;
}

/**
 * Calculates second axis data from filtered chart data for display on secondary Y-axis
 */
export function processSecondAxisData({
  filteredChartData,
  selectedFilterForAxis,
  propsMode,
  advancedStatsPerGame,
  dvpRanksPerGame,
}: SecondAxisDataParams): SecondAxisDataItem[] | null {
  if (!selectedFilterForAxis || propsMode !== 'player' || !filteredChartData.length) {
    return null;
  }

  let debugCount = 0;
  const result = filteredChartData.map((game: any) => {
    const numericGameId = typeof game.game?.id === 'number' ? game.game.id : 
                          typeof game.stats?.game?.id === 'number' ? game.stats.game.id : null;
    const gameIdStr = game.xKey || String(numericGameId || '');
    const gameDate = game.date || game.stats?.game?.date || '';
    let value: number | null = null;
    const stats = game.stats;

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
        // Try multiple gameId formats for lookup
        const rank1 = dvpRanksPerGame[gameIdStr];
        const rank2 = numericGameId ? dvpRanksPerGame[String(numericGameId)] : null;
        value = rank1 ?? rank2 ?? null;
        
        // Debug first few lookups
        if (debugCount < 3) {
          console.log('[secondAxisData] DvP rank lookup:', {
            gameIdStr,
            numericGameId,
            rank1,
            rank2,
            finalValue: value,
            availableKeys: Object.keys(dvpRanksPerGame).slice(0, 5),
            totalKeys: Object.keys(dvpRanksPerGame).length
          });
          debugCount++;
        }
        break;
      default:
        value = null;
    }

    return {
      gameId: gameIdStr,
      gameDate: String(gameDate),
      value,
    };
  });
  
  // Debug summary for DvP rank
  if (selectedFilterForAxis === 'dvp_rank') {
    const valuesWithRanks = result.filter(item => item.value !== null && item.value !== undefined);
    const allGameIdsInResult = result.map(item => item.gameId);
    const allKeysInDvpRanks = Object.keys(dvpRanksPerGame);
    const matchingKeys = allGameIdsInResult.filter(id => allKeysInDvpRanks.includes(id));
    
    // Get sample entries with their values
    const sampleEntries = Object.entries(dvpRanksPerGame).slice(0, 5).map(([key, value]) => ({
      key,
      value,
      valueType: typeof value
    }));
    
    console.log('[secondAxisData] DvP rank summary:', {
      totalGames: result.length,
      gamesWithRanks: valuesWithRanks.length,
      sampleGameIdsInResult: allGameIdsInResult.slice(0, 5),
      sampleKeysInDvpRanks: allKeysInDvpRanks.slice(0, 5),
      sampleEntriesWithValues: sampleEntries,
      matchingKeys: matchingKeys.slice(0, 5),
      totalKeysInDvpRanks: allKeysInDvpRanks.length,
      nonNullValues: Object.entries(dvpRanksPerGame).filter(([_, v]) => v !== null && v !== undefined).length
    });
  }
  
  return result;
}

