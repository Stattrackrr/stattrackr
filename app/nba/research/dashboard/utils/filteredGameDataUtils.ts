/**
 * Filtered game data processing utilities
 * 
 * This file contains the logic for applying advanced filters (minutes, blowouts, back-to-back, teammate)
 * to base game data in player mode.
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from './teamUtils';
import { BaseGameDataItem } from './baseGameDataUtils';
import { BallDontLieStats, NBAPlayer } from '../types';

export interface FilteredGameDataParams {
  propsMode: 'player' | 'team';
  baseGameData: BaseGameDataItem[];
  minMinutesFilter: number;
  maxMinutesFilter: number;
  excludeBlowouts: boolean;
  excludeBackToBack: boolean;
  backToBackGameIds: Set<string | number>;
  withWithoutMode: 'with' | 'without';
  teammateFilterId: number | null;
  teammatePlayedGameIds: Set<string | number>;
  selectedTimeframe: string;
  playerStats: BallDontLieStats[];
  selectedPlayer: { id: number | string; full?: string; firstName?: string; lastName?: string; teamAbbr?: string } | null;
}

/**
 * Parses minutes value (handles both string "MM:SS" format and numeric)
 * Returns integer minutes (rounds up if seconds > 0)
 */
function parseMinutesPlayed(minVal: any): number {
  if (typeof minVal === 'number') return minVal;
  if (!minVal) return 0;
  const s = String(minVal);
  if (s.includes(':')) {
    const [m, sec] = s.split(':').map(x => parseInt(x || '0', 10));
    return (Number.isFinite(m) ? m : 0) + ((Number.isFinite(sec) && sec > 0) ? 1 : 0);
  }
  const n = parseInt(s, 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Applies advanced filters (minutes, blowouts, back-to-back, teammate) to base game data
 * This is used in player mode to filter games based on various criteria
 */
export function processFilteredGameData(params: FilteredGameDataParams): BaseGameDataItem[] {
  const {
    propsMode,
    baseGameData,
    minMinutesFilter,
    maxMinutesFilter,
    excludeBlowouts,
    excludeBackToBack,
    backToBackGameIds,
    withWithoutMode,
    teammateFilterId,
    teammatePlayedGameIds,
    selectedTimeframe,
    playerStats,
    selectedPlayer,
  } = params;

  // For team mode, return baseGameData as-is (no filtering)
  if (propsMode !== 'player') return baseGameData;
  
  // First, apply all filters EXCEPT teammate filter
  let filtered = baseGameData.filter((g: any) => {
    const stats = g?.stats;
    const game = stats?.game;

    // minutes
    const minutes = parseMinutesPlayed(stats?.min);
    
    // WORKAROUND: For last season, if we have 0-minute games that were included via the API data quality workaround,
    // allow them through (they'll show 0 values but at least the games will be visible)
    const isLastSeasonWithApiIssue = selectedTimeframe === 'lastseason' && minutes === 0 && game?.id;
    
    if (minutes === 0 && !isLastSeasonWithApiIssue) return false; // exclude zero-minute games (except last season workaround)
    if (minutes > 0 && (minutes < minMinutesFilter || minutes > maxMinutesFilter)) return false;

    // blowout
    if (excludeBlowouts && game && typeof game.home_team_score === 'number' && typeof game.visitor_team_score === 'number') {
      const diff = Math.abs((game.home_team_score || 0) - (game.visitor_team_score || 0));
      if (diff >= 21) return false;
    }

    // back-to-back (when enabled, only include second game of B2B)
    if (excludeBackToBack) {
      if (!game || !backToBackGameIds.has(game.id)) return false;
    }
    
    return true;
  });
  
  // Apply teammate filter AFTER other filters
  // For "last N" timeframes with teammate filter, we want the last N games WHERE the teammate played/didn't play
  // Not: last N games filtered by teammate (which might only give 1 game)
  // So we need to filter ALL games first, then take the last N
  if (teammateFilterId && selectedTimeframe.startsWith('last')) {
    const n = parseInt(selectedTimeframe.replace('last', ''));
    if (!Number.isNaN(n) && n > 0) {
      // For "last N" with teammate filter, we need to work with ALL games, not just the timeframe slice
      // Get all games from playerStats (before timeframe filter) and apply filters
      // Reuse the same structure as baseGameData for consistency
      const allGamesFromStats: any[] = [];
      (playerStats || []).forEach((stat: any, index: number) => {
        const game = stat?.game;
        if (!game) return;
        
        let playerTeam = stat?.team?.abbreviation || selectedPlayer?.teamAbbr || '';
        const homeTeamId = game?.home_team?.id ?? (game as any)?.home_team_id;
        const visitorTeamId = game?.visitor_team?.id ?? (game as any)?.visitor_team_id;
        const homeTeamAbbr = game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        
        const playerTeamNorm = normalizeAbbr(playerTeam);
        const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
        let opponent = "";
        
        if (playerTeamId && homeTeamId && visitorTeamId) {
          if (playerTeamId === homeTeamId && visitorTeamAbbr) {
            opponent = visitorTeamAbbr;
          } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
            opponent = homeTeamAbbr;
          }
        }
        if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
          const homeNorm = normalizeAbbr(homeTeamAbbr);
          const awayNorm = normalizeAbbr(visitorTeamAbbr);
          if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
          else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
        }
        
        const iso = game?.date;
        const d = iso ? new Date(iso) : null;
        const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
        const gameId = game?.id ?? `${opponent}-${index}`;
        const tickLabel = opponent || "";
        
        allGamesFromStats.push({
          stats: stat,
          opponent,
          gameNumber: index + 1,
          game: opponent ? `vs ${opponent}` : "—",
          date: shortDate,
          xKey: String(gameId),
          tickLabel,
        });
      });
      
      // Apply all filters in a single pass (minutes, blowouts, back-to-back, teammate)
      const allFiltered = allGamesFromStats.filter((g: any) => {
        const stats = g?.stats;
        const game = stats?.game;
        const gid = game?.id;
        
        // Minutes filter
        const minutes = parseMinutesPlayed(stats?.min);
        const isLastSeasonWithApiIssue = selectedTimeframe === 'lastseason' && minutes === 0 && game?.id;
        if (minutes === 0 && !isLastSeasonWithApiIssue) return false;
        if (minutes > 0 && (minutes < minMinutesFilter || minutes > maxMinutesFilter)) return false;
        
        // Blowouts filter
        if (excludeBlowouts && game && typeof game.home_team_score === 'number' && typeof game.visitor_team_score === 'number') {
          const diff = Math.abs((game.home_team_score || 0) - (game.visitor_team_score || 0));
          if (diff >= 21) return false;
        }
        
        // Back-to-back filter
        if (excludeBackToBack) {
          if (!game || !backToBackGameIds.has(game.id)) return false;
        }
        
        // Teammate filter
        if (gid) {
          const didPlay = teammatePlayedGameIds.has(gid);
          if (withWithoutMode === 'with' && !didPlay) return false;
          if (withWithoutMode === 'without' && didPlay) return false;
        }
        
        return true;
      });
      
      const teammateFiltered = allFiltered; // Single filter pass now
      
      // Sort by date (newest first) and take the last N games
      const sortedByDate = [...teammateFiltered].sort((a: any, b: any) => {
        const dateA = a?.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
        const dateB = b?.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
        return dateB - dateA; // Newest first
      });
      
      // Take the first N (most recent) games, then reverse so oldest is on the left
      filtered = sortedByDate.slice(0, n).reverse();
    } else {
      // Not a valid "last N" timeframe, just apply teammate filter normally
      filtered = filtered.filter((g: any) => {
        const game = g?.stats?.game;
        const gid = game?.id;
        if (!gid) return false;
        const didPlay = teammatePlayedGameIds.has(gid);
        if (withWithoutMode === 'with' && !didPlay) return false;
        if (withWithoutMode === 'without' && didPlay) return false;
        return true;
      });
    }
  } else if (teammateFilterId) {
    // Apply teammate filter for non-"last N" timeframes
    const beforeCount = filtered.length;
    filtered = filtered.filter((g: any) => {
      const game = g?.stats?.game;
      const gid = game?.id;
      if (!gid) return false;
      const didPlay = teammatePlayedGameIds.has(gid);
      if (withWithoutMode === 'with' && !didPlay) return false;
      if (withWithoutMode === 'without' && didPlay) return false;
      return true;
    });
  }
  
  return filtered;
}

