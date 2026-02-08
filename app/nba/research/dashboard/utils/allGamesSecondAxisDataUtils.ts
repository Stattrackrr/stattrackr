/**
 * All games second axis data processing utilities
 * 
 * This file contains the logic for calculating second axis data from ALL player stats
 * (before any timeframe filtering) to enable filtering by slider range.
 */

import { parseMinutes } from './playerUtils';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from './teamUtils';
import { BallDontLieStats, AdvancedStats } from '../types';

/** Build a stable game key so DvP lookups match across prefetch and filtering (avoids empty key when game.id is missing). */
export function getStableGameId(stats: any): string {
  const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
  if (numericGameId != null) return String(numericGameId);
  const gameDate = (stats?.game?.date || '').toString().slice(0, 10);
  let playerTeam = stats?.team?.abbreviation || '';
  const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
  const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
  const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
  const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
  const playerTeamNorm = normalizeAbbr(playerTeam);
  const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
  let opponent = '';
  if (playerTeamId && homeTeamId && visitorTeamId) {
    if (playerTeamId === homeTeamId && visitorTeamAbbr) opponent = visitorTeamAbbr;
    else if (playerTeamId === visitorTeamId && homeTeamAbbr) opponent = homeTeamAbbr;
  }
  if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
    const homeNorm = normalizeAbbr(homeTeamAbbr);
    const awayNorm = normalizeAbbr(visitorTeamAbbr);
    if (playerTeamNorm === homeNorm) opponent = awayNorm;
    else if (playerTeamNorm === awayNorm) opponent = homeNorm;
  }
  const datePart = (gameDate || '').toString().slice(0, 10);
  const homeId = homeTeamId ?? (stats?.game as any)?.home_team_id ?? '';
  const visId = visitorTeamId ?? (stats?.game as any)?.visitor_team_id ?? '';
  return opponent && datePart ? `${datePart}-${opponent}` : `${datePart}-${homeId}-${visId}`;
}

export interface AllGamesSecondAxisDataItem {
  gameId: string;
  value: number | null;
  gameDate: string;
  stats: BallDontLieStats; // Include stats for filtering
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
      const gameIdStr = getStableGameId(stats);
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
        stats, // Include stats for filtering
      };
    });

  return result;
}


