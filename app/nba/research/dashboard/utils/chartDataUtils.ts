/**
 * Chart data processing utilities
 * 
 * This file contains the logic for transforming base/filtered game data
 * into chart-ready data with stat values and live game detection.
 */

import { getStatValue } from './statUtils';
import { getGameStatValue } from './statUtils';
import { BaseGameDataItem } from './baseGameDataUtils';

export interface ChartDataItem extends BaseGameDataItem {
  value: number;
  isLive?: boolean;
}

export interface ChartDataParams {
  source: BaseGameDataItem[];
  selectedStat: string;
  propsMode: 'player' | 'team';
  gamePropsTeam?: string;
  todaysGames?: any[];
}

/**
 * Transforms base/filtered game data into chart-ready data with stat values
 * Also detects and marks live games
 */
export function processChartData({
  source,
  selectedStat,
  propsMode,
  gamePropsTeam,
  todaysGames,
}: ChartDataParams): ChartDataItem[] {
  const mapped = source.map(game => {
    const statValue = propsMode === 'team' 
      ? getGameStatValue((game as any).gameData, selectedStat, gamePropsTeam || '') 
      : (game as any).stats ? getStatValue((game as any).stats, selectedStat) : 0;
    
    // For steals/blocks, ensure we return 0 instead of null/undefined
    // This is important because these stats can legitimately be 0
    const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
    
    return {
      ...game,
      value,
    };
  });
  
  // Check if the most recent game (last item) is live
  if (mapped.length > 0) {
    const mostRecentGame = mapped[mapped.length - 1];
    const gameData = propsMode === 'team' ? (mostRecentGame as any).gameData : (mostRecentGame as any).stats?.game;
    
    if (gameData) {
      const rawStatus = String(gameData.status || '');
      const gameStatus = rawStatus.toLowerCase();
      const gameDate = gameData.date ? new Date(gameData.date).getTime() : 0;
      const now = Date.now();
      const threeHoursMs = 3 * 60 * 60 * 1000;
      
      // Check if game is live by looking at tipoff time
      let isLive = false;
      const tipoffTime = Date.parse(rawStatus);
      if (!Number.isNaN(tipoffTime)) {
        const timeSinceTipoff = now - tipoffTime;
        isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
      }
      
      // Also check if game time has passed and game isn't final (fallback)
      const gameStarted = gameDate > 0 && gameDate <= now;
      const timeSinceGameTime = gameDate > 0 ? now - gameDate : 0;
      const isWithinThreeHours = gameStarted && timeSinceGameTime > 0 && timeSinceGameTime < threeHoursMs;
      const isDateStatus = rawStatus.includes('T') || rawStatus.includes('+') || rawStatus.match(/\d{4}-\d{2}-\d{2}/);
      
      // Mark as live if game started within last 3 hours and not final
      const isLiveGame = (isLive || (gameStarted && isWithinThreeHours && !isDateStatus)) 
        && gameStatus !== '' 
        && gameStatus !== 'scheduled' 
        && !gameStatus.includes('final') 
        && !gameStatus.includes('completed');
      
      // Add isLive flag to the most recent game
      if (isLiveGame) {
        const lastItem = mapped[mapped.length - 1];
        (lastItem as any).isLive = true;
      }
    }
  }
  
  return mapped;
}


