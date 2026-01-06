/**
 * Matchup info processing utilities
 * 
 * This file contains the logic for determining today's matchup information
 * including tipoff time and home/away status.
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { parseBallDontLieTipoff } from './dateUtils';

export interface MatchupInfo {
  tipoffLocal: string | null;
  tipoffDate: string | null;
  homeAbbr: string;
  awayAbbr: string;
  isSelectedHome: boolean;
}

export interface MatchupInfoParams {
  selectedTeam: string | null;
  opponentTeam: string | null;
  todaysGames: any[];
}

/**
 * Determines today's matchup information from todaysGames
 * Returns tipoff time, home/away status, and team abbreviations
 */
export function calculateMatchupInfo({
  selectedTeam,
  opponentTeam,
  todaysGames,
}: MatchupInfoParams): MatchupInfo | null {
  try {
    const teamA = normalizeAbbr(selectedTeam || '');
    const teamB = normalizeAbbr(opponentTeam || '');
    
    if (!teamA || !teamB || !Array.isArray(todaysGames) || todaysGames.length === 0) {
      return null;
    }
    
    const game = todaysGames.find((g: any) => {
      const home = normalizeAbbr(g?.home_team?.abbreviation || '');
      const away = normalizeAbbr(g?.visitor_team?.abbreviation || '');
      return (home === teamA && away === teamB) || (home === teamB && away === teamA);
    });
    
    if (!game) {
      return null;
    }
    
    const tipoffDate = parseBallDontLieTipoff(game);
    const tipoffLocal = tipoffDate
      ? new Intl.DateTimeFormat(undefined, {
          month: 'short', 
          day: 'numeric', 
          hour: 'numeric', 
          minute: '2-digit'
        }).format(tipoffDate)
      : null;
    
    const homeAbbr = normalizeAbbr(game?.home_team?.abbreviation || '');
    const awayAbbr = normalizeAbbr(game?.visitor_team?.abbreviation || '');
    const isSelectedHome = teamA === homeAbbr;
    
    return { 
      tipoffLocal, 
      tipoffDate: tipoffDate?.toISOString() ?? null, 
      homeAbbr, 
      awayAbbr, 
      isSelectedHome 
    };
  } catch {
    return null;
  }
}

