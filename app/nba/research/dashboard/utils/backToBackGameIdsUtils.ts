/**
 * Back-to-back game identification utilities
 * 
 * This file contains the logic for identifying back-to-back games
 * (games played on consecutive days) from player stats.
 */

import { BallDontLieStats } from '../types';

export interface BackToBackGameIdsParams {
  propsMode: 'player' | 'team';
  playerStats: BallDontLieStats[];
}

/**
 * Identifies back-to-back games (games played within 0.5-1.5 days of each other)
 * Returns a Set of game IDs for the second game in each back-to-back pair
 */
export function calculateBackToBackGameIds({
  propsMode,
  playerStats,
}: BackToBackGameIdsParams): Set<string | number> {
  if (propsMode !== 'player' || !playerStats || playerStats.length === 0) {
    return new Set<string | number>();
  }

  const withDates = playerStats.filter((p: any) => !!p?.game?.date);
  const sorted = withDates.slice().sort((a: any, b: any) =>
    new Date(a.game.date).getTime() - new Date(b.game.date).getTime()
  );
  
  const b2b = new Set<string | number>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date((sorted[i - 1] as any)?.game?.date as any);
    const cur = new Date((sorted[i] as any)?.game?.date as any);
    const diffDays = (cur.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24);
    
    if (diffDays >= 0.5 && diffDays <= 1.5) {
      // Only include the second game of the back-to-back
      const curId = sorted[i]?.game?.id ?? `g_${i}`;
      b2b.add(curId);
    }
  }
  
  return b2b;
}





