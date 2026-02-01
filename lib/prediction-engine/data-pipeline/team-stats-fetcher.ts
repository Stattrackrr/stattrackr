/**
 * Team Stats Fetcher
 * Fetches opponent team stats (pace, defRating, turnoverRate) for matchup models
 * Uses cache first, then falls back to API
 */

import type { TeamStats } from '../types';
import { getNBACache } from '@/lib/nbaCache';
import cache from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';

const LEAGUE_AVG_PACE = 100;
const LEAGUE_AVG_DEF_RATING = 112;
const LEAGUE_AVG_TURNOVER_RATE = 14;

/**
 * Fetch opponent team stats for matchup models
 * Returns defensive rating (pts allowed), pace, turnover rate
 */
export async function fetchOpponentTeamStats(
  teamAbbr: string,
  season?: number
): Promise<TeamStats> {
  const seasonYear = season || currentNbaSeason();
  const normalizedTeam = teamAbbr?.toUpperCase?.()?.trim() || '';

  if (!normalizedTeam) {
    return getDefaultTeamStats(normalizedTeam || 'UNK');
  }

  // Try team-defensive-stats cache (points allowed = def rating proxy)
  const defCacheKey = `team_defensive_stats_bdl:${normalizedTeam}:${seasonYear}:82`;
  let defData: any = cache.get(defCacheKey);
  if (!defData) {
    defData = await getNBACache<any>(defCacheKey);
  }

  // Try team_offensive_totals for pace proxy (we use league avg if missing)
  const offCacheKey = `team_offensive_totals:${normalizedTeam}:${seasonYear}:82`;
  let offData: any = cache.get(offCacheKey);
  if (!offData) {
    offData = await getNBACache<any>(offCacheKey);
  }

  // Build TeamStats
  let defRating = LEAGUE_AVG_DEF_RATING;
  let turnoverRate = LEAGUE_AVG_TURNOVER_RATE;

  if (defData?.success && defData?.perGame) {
    defRating = defData.perGame.pts ?? LEAGUE_AVG_DEF_RATING;
  }

  // BettingPros has team turnovers - check cache
  const dvpCacheKey = 'bettingpros_dvp_data';
  let dvpData: any = cache.get(dvpCacheKey);
  if (!dvpData) {
    dvpData = await getNBACache<any>(dvpCacheKey);
  }
  if (dvpData?.teamStats?.[normalizedTeam]?.TM?.turnovers != null) {
    turnoverRate = dvpData.teamStats[normalizedTeam].TM.turnovers;
  }

  return {
    team: normalizedTeam,
    pace: LEAGUE_AVG_PACE,
    offRating: offData?.perGame?.pts ?? 110,
    defRating,
    turnoverRate,
    reboundRate: 50,
    record: {
      wins: 41,
      losses: 41,
      isPlayoffBubble: false,
      isEliminated: false,
    },
  };
}

function getDefaultTeamStats(team: string): TeamStats {
  return {
    team,
    pace: LEAGUE_AVG_PACE,
    offRating: 110,
    defRating: LEAGUE_AVG_DEF_RATING,
    turnoverRate: LEAGUE_AVG_TURNOVER_RATE,
    reboundRate: 50,
    record: { wins: 41, losses: 41, isPlayoffBubble: false, isEliminated: false },
  };
}
