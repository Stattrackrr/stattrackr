/**
 * Filtered chart data processing utilities
 * 
 * This file contains the logic for filtering chart data based on slider range
 * and applying timeframe filters to create the final chart display data.
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from './teamUtils';
import { getStatValue } from './statUtils';
import { getStableGameId } from './allGamesSecondAxisDataUtils';
import { currentNbaSeason } from './playerUtils';
import { BaseGameDataItem } from './baseGameDataUtils';
import { NBAPlayer } from '../types';

export interface FilteredChartDataItem extends BaseGameDataItem {
  value: number;
}

export interface FilteredChartDataParams {
  adjustedChartData: FilteredChartDataItem[];
  selectedFilterForAxis: string | null;
  allGamesSecondAxisData: Array<any> | null; // Items have stats, value, gameDate properties
  sliderRange: { min: number; max: number } | null;
  propsMode: 'player' | 'team';
  selectedStat: string;
  selectedTimeframe: string;
  selectedPlayer: { id: number | string; full?: string; firstName?: string; lastName?: string; teamAbbr?: string } | null;
  opponentTeam: string | null;
}

/**
 * Processes chart data by applying slider range filters and timeframe filters
 * This handles the complex logic of filtering from all games, then applying timeframe constraints
 */
export function processFilteredChartData(params: FilteredChartDataParams): FilteredChartDataItem[] {
  const {
    adjustedChartData,
    selectedFilterForAxis,
    allGamesSecondAxisData,
    sliderRange,
    propsMode,
    selectedStat,
    selectedTimeframe,
    selectedPlayer,
    opponentTeam,
  } = params;

  // If no filter axis selected, use adjustedChartData (which already has timeframe filter from baseGameData)
  if (!selectedFilterForAxis || !allGamesSecondAxisData || propsMode !== 'player') {
    return adjustedChartData;
  }
  
  // If sliderRange is not set yet, still need to apply timeframe filter to allGamesSecondAxisData
  // This ensures timeframe is always respected even before slider is initialized
  if (!sliderRange) {
    // Apply timeframe filter directly to allGamesSecondAxisData
    let timeframeFiltered = allGamesSecondAxisData;
    
    if (selectedTimeframe === 'h2h' && opponentTeam && opponentTeam !== '') {
      const normalizedOpponent = normalizeAbbr(opponentTeam);
      timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
        // FIXED to handle players who changed teams
        // If a player has stats for a game, and the opponent is in that game, it's an H2H match
        const stats = item.stats;
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        
        if (!homeTeamAbbr || !visitorTeamAbbr) {
          return false;
        }
        
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const awayNorm = normalizeAbbr(visitorTeamAbbr);
        
        // If the opponent is in this game, and the player has stats for it, it's an H2H match
        return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
      }).slice(0, 6);
    } else if (selectedTimeframe === 'thisseason') {
      const currentSeason = currentNbaSeason();
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
      timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
        const stats = item.stats;
        if (!stats?.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === seasonStartYear;
      });
    } else if (selectedTimeframe === 'lastseason') {
      const lastSeason = currentNbaSeason() - 1;
      timeframeFiltered = allGamesSecondAxisData.filter((item: any) => {
        const stats = item.stats;
        if (!stats?.game?.date) return false;
        const gameDate = new Date(stats.game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === lastSeason;
      });
    } else if (selectedTimeframe.startsWith('last')) {
      // Handle 'last10', 'last5', etc.
      const n = parseInt(selectedTimeframe.replace('last', ''));
      if (!Number.isNaN(n)) {
        // Sort by date (newest first) and take first N
        const sorted = [...allGamesSecondAxisData].sort((a: any, b: any) => {
          const dateA = a.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
          const dateB = b.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
          return dateB - dateA; // Newest first
        });
        timeframeFiltered = sorted.slice(0, n);
      } else {
        timeframeFiltered = allGamesSecondAxisData;
      }
    }
    
    // Map to chartData format
    const sorted = [...timeframeFiltered].sort((a: any, b: any) => {
      const dateA = a.stats?.game?.date ? new Date(a.stats.game.date).getTime() : 0;
      const dateB = b.stats?.game?.date ? new Date(b.stats.game.date).getTime() : 0;
      return dateB - dateA;
    }).reverse();
    
    return sorted.map((item: any, index: number) => {
      const stats = item.stats;
      let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
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
      const iso = stats?.game?.date;
      const d = iso ? new Date(iso) : null;
      const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
      const gameData = {
        stats,
        opponent,
        gameNumber: index + 1,
        game: opponent ? `vs ${opponent}` : "—",
        date: shortDate,
        xKey: getStableGameId(stats),
        tickLabel: opponent || "",
      };
      const statValue = getStatValue(stats, selectedStat);
      const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
      return {
        ...gameData,
        value,
      };
    });
  }

  // Filter ALL games by slider range using allGamesSecondAxisData (calculated from playerStats directly)
  const filteredStats = allGamesSecondAxisData
    .filter(item => {
      if (item.value === null || !Number.isFinite(item.value)) {
        return false; // Exclude games without filter data
      }
      // Filter games within the range [min, max]
      return item.value >= sliderRange.min && item.value <= sliderRange.max;
    })
    .map(item => item.stats); // Get the original stats objects

  // Now we need to recreate baseGameData format from these filtered stats
  // Then apply timeframe to get the final result
  // Sort by date (newest first) to match baseGameData logic
  const sortedFilteredStats = [...filteredStats].sort((a: any, b: any) => {
    const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
    const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
    return dateB - dateA; // Newest first
  });

  // Apply timeframe to the filtered games
  const n = parseInt(selectedTimeframe.replace('last', ''), 10);
  let timeframeFilteredStats = sortedFilteredStats;

  if (!Number.isNaN(n) && selectedTimeframe.startsWith('last')) {
    // Apply L10/L20 etc.: take the N most recent games that match the DvP (or other slider) filter
    timeframeFilteredStats = sortedFilteredStats.slice(0, n);
  } else if (selectedTimeframe === 'h2h') {
    // Filter to only show games against the current opponent team
    if (opponentTeam && opponentTeam !== '') {
      const normalizedOpponent = normalizeAbbr(opponentTeam);
      const beforeFilter = sortedFilteredStats.length;
      timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
        // FIXED to handle players who changed teams
        // If a player has stats for a game, and the opponent is in that game, it's an H2H match
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        
        if (!homeTeamAbbr || !visitorTeamAbbr) {
          return false;
        }
        
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const awayNorm = normalizeAbbr(visitorTeamAbbr);
        
        // If the opponent is in this game, and the player has stats for it, it's an H2H match
        return homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
      }).slice(0, 6); // Limit to last 6 H2H games
      console.log(`[filteredChartData] H2H filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games vs ${opponentTeam}`);
    } else {
      timeframeFilteredStats = [];
      console.log(`[filteredChartData] H2H filter: No opponent team, returning empty`);
    }
  } else if (selectedTimeframe === 'thisseason') {
    // Filter to current season games only
    const currentSeason = currentNbaSeason();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
    const beforeFilter = sortedFilteredStats.length;
    
    timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
      if (!stats?.game?.date) return false;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      
      // Calculate which NBA season this game belongs to
      const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
      
      // Game must be from the current NBA season
      return gameSeasonYear === seasonStartYear;
    });
    console.log(`[filteredChartData] This Season filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games (seasonStartYear=${seasonStartYear}, currentSeason=${currentSeason})`);
  } else if (selectedTimeframe === 'lastseason') {
    // Filter to last season games only
    const lastSeason = currentNbaSeason() - 1;
    const beforeFilter = sortedFilteredStats.length;
    
    timeframeFilteredStats = sortedFilteredStats.filter((stats: any) => {
      if (!stats?.game?.date) return false;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      
      // NBA season spans two calendar years
      const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
      return gameSeasonYear === lastSeason;
    });
    console.log(`[filteredChartData] Last Season filter: ${beforeFilter} -> ${timeframeFilteredStats.length} games (lastSeason=${lastSeason})`);
  }

  // Reverse for chronological order (oldest→newest, left→right)
  const ordered = timeframeFilteredStats.slice().reverse();

  // Map to baseGameData format, then to chartData format
  const mapped = ordered.map((stats: any, index: number) => {
    // Recreate baseGameData structure
    let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
    const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
    const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
    const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
    const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
    
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
    
    const iso = stats?.game?.date;
    const d = iso ? new Date(iso) : null;
    const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
    // Use stable game id so DvP/second-axis lookups match (same key as allGamesSecondAxisDataUtils)
    const xKey = getStableGameId(stats);
    
    const gameData = {
      stats,
      opponent,
      gameNumber: index + 1,
      game: opponent ? `vs ${opponent}` : "—",
      date: shortDate,
      xKey,
      tickLabel: opponent || "",
    };

    const statValue = getStatValue(stats, selectedStat);
    const value = (statValue !== null && statValue !== undefined) ? statValue : 0;
    
    return {
      ...gameData,
      value,
    };
  });

  return mapped;
}

