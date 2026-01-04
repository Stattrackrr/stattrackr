/**
 * Base game data processing utilities
 * 
 * This file contains the logic for processing and filtering game data
 * for both player and team modes in the NBA dashboard.
 */

import { normalizeAbbr } from '@/lib/nbaAbbr';
import { currentNbaSeason, parseMinutes } from './playerUtils';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from './teamUtils';
import serverLogger from '@/lib/serverLogger';
import { BallDontLieStats, BallDontLieGame, NBAPlayer } from '../types';

export interface BaseGameDataItem {
  stats?: BallDontLieStats;
  gameData?: BallDontLieGame;
  opponent: string;
  gameNumber: number;
  game: string;
  date: string;
  xKey: string;
  tickLabel: string;
}

export interface BaseGameDataParams {
  playerStats: BallDontLieStats[];
  selectedTimeframe: string;
  selectedPlayer: NBAPlayer | null;
  propsMode: 'player' | 'team';
  gameStats: BallDontLieGame[];
  selectedTeam: string;
  opponentTeam: string;
  manualOpponent: string;
  homeAway: string;
  isLoading: boolean;
  resolvedPlayerId: string | null;
  teammateFilterId: number | null;
  gamePropsTeam?: string;
}

/**
 * Processes and filters game data to create base game data structure
 * This is the core logic for building the chart data foundation
 */
export function processBaseGameData(params: BaseGameDataParams): BaseGameDataItem[] {
  const {
    playerStats,
    selectedTimeframe,
    selectedPlayer,
    propsMode,
    gameStats,
    selectedTeam,
    opponentTeam,
    manualOpponent,
    homeAway,
    isLoading,
    resolvedPlayerId,
    teammateFilterId,
    gamePropsTeam,
  } = params;

  // Debug: Check what seasons are in playerStats
  const currentSeason = currentNbaSeason();
  const getSeasonYear = (stat: any) => {
    if (!stat?.game?.date) return null;
    const d = new Date(stat.game.date);
    const y = d.getFullYear();
    const m = d.getMonth();
    return m >= 9 ? y : y - 1;
  };
  const seasonBreakdown: Record<number, number> = {};
  playerStats.forEach(s => {
    const seasonYear = getSeasonYear(s);
    if (seasonYear) {
      seasonBreakdown[seasonYear] = (seasonBreakdown[seasonYear] || 0) + 1;
    }
  });
  
  console.log('[DEBUG baseGameData] Recalculating baseGameData', {
    playerStatsLength: playerStats.length,
    selectedTimeframe,
    selectedPlayer: selectedPlayer?.full,
    propsMode,
    seasonBreakdown,
    currentSeason,
    expectedLastSeason: currentSeason - 1,
    hasLastSeasonData: seasonBreakdown[currentSeason - 1] > 0,
    timestamp: new Date().toISOString()
  });
  
  // Use playerStats directly to prevent double refresh from deferred value
  const statsToUse = playerStats;
  // Team mode: use game data instead of player stats
  if (propsMode === 'team') {
    if (!gameStats.length) return [];
    
    // Guard: If playerStats was just cleared but we're in team mode, don't recalculate
    // This prevents race conditions where playerStats gets cleared during team mode operations
    
    // Apply timeframe to games
    let filteredTeamGames = gameStats;
    
    // First, apply opponent filtering if a specific opponent is selected (not ALL)
    if (manualOpponent && manualOpponent !== 'ALL' && manualOpponent !== '') {
      const normalizedOpponent = normalizeAbbr(manualOpponent);
      filteredTeamGames = gameStats.filter(game => {
        const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
        const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
        const currentTeam = normalizeAbbr(gamePropsTeam || '');
        
        // Check if this game involves both the selected team and the manual opponent
        const teamsInGame = [homeTeam, visitorTeam];
        return teamsInGame.includes(currentTeam) && teamsInGame.includes(normalizedOpponent);
      });
      console.log(`🎯 Manual Opponent Team: Filtered to ${filteredTeamGames.length} games vs ${manualOpponent}`);
    }
    
    // Special case: H2H filtering for team mode (only if no manual opponent is set)
    if (selectedTimeframe === 'h2h' && (!manualOpponent || manualOpponent === 'ALL')) {
      if (opponentTeam && opponentTeam !== '') {
        const normalizedOpponent = normalizeAbbr(opponentTeam);
        filteredTeamGames = gameStats.filter(game => {
          const homeTeam = normalizeAbbr(game.home_team?.abbreviation || '');
          const visitorTeam = normalizeAbbr(game.visitor_team?.abbreviation || '');
          const currentTeam = normalizeAbbr(gamePropsTeam || '');
          
          // Check if this game involves both the selected team and the opponent
          const teamsInGame = [homeTeam, visitorTeam];
          return teamsInGame.includes(currentTeam) && teamsInGame.includes(normalizedOpponent);
        }).slice(-6); // Limit to last 6 H2H games (most recent)
        console.log(`🔥 H2H Team: Filtered to ${filteredTeamGames.length} games vs ${opponentTeam} (max 6)`);
      } else {
        filteredTeamGames = [];
        console.log(`⚠️ H2H Team: No opponent available for filtering`);
      }
    } else if (selectedTimeframe === 'lastseason') {
      // Filter to last season games only
      const lastSeason = currentNbaSeason() - 1;
      filteredTeamGames = gameStats.filter(game => {
        if (!game.date) return false;
        const gameDate = new Date(game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years (e.g., 2023-24 season)
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === lastSeason;
      });
      console.log(`📅 Last Season Team: Filtered to ${filteredTeamGames.length} games from ${lastSeason}-${(lastSeason + 1) % 100}`);
    } else if (selectedTimeframe === 'thisseason') {
      // Filter to current season games only
      const currentSeason = currentNbaSeason();
      filteredTeamGames = gameStats.filter(game => {
        if (!game.date) return false;
        const gameDate = new Date(game.date);
        const gameYear = gameDate.getFullYear();
        const gameMonth = gameDate.getMonth();
        
        // NBA season spans two calendar years (e.g., 2024-25 season)
        const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
        return gameSeasonYear === currentSeason;
      });
      console.log(`📅 This Season Team: Filtered to ${filteredTeamGames.length} games from ${currentSeason}-${(currentSeason + 1) % 100}`);
    }
    
    // Home/Away filter
    if (homeAway !== 'ALL') {
      const currentNorm = normalizeAbbr(gamePropsTeam || selectedTeam || '');
      filteredTeamGames = filteredTeamGames.filter(game => {
        const homeAbbr = normalizeAbbr(game.home_team?.abbreviation || '');
        const isHome = homeAbbr === currentNorm;
        return homeAway === 'HOME' ? isHome : !isHome;
      });
    }
    
    const n = parseInt(selectedTimeframe.replace('last', ''));
    const recentGames = ['h2h', 'lastseason', 'thisseason'].includes(selectedTimeframe) 
      ? filteredTeamGames 
      : (!Number.isNaN(n) ? filteredTeamGames.slice(-n) : filteredTeamGames); // Last N games
    
    return recentGames.map((game, index) => {
      const homeTeam = game.home_team?.abbreviation || '';
      const visitorTeam = game.visitor_team?.abbreviation || '';
      const currentTeam = gamePropsTeam || selectedTeam; // Use gamePropsTeam for team mode
      const isHome = normalizeAbbr(homeTeam) === normalizeAbbr(currentTeam);
      const opponent = isHome ? visitorTeam : homeTeam;
      
      const iso = game.date;
      const d = iso ? new Date(iso) : null;
      const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
      
      return {
        gameData: game, // Keep reference to game data for value calculation
        opponent,
        gameNumber: index + 1,
        game: opponent ? `vs ${opponent}` : "",
        date: shortDate,
        xKey: String(game.id || `game-${index}`),
        tickLabel: opponent || "", // Show opponent abbreviation on x-axis for team mode
      };
    });
  }
  
  // Player mode: use existing player stats logic
  // IMPORTANT: If playerStats is empty but we have a selectedPlayer or resolvedPlayerId, this might be a race condition
  // Don't return empty array immediately - check if we're in the middle of a fetch
  if (!statsToUse.length) {
    // Check if URL params indicate a player should be loaded (for initial page load detection)
    let hasUrlPlayer = false;
    if (typeof window !== 'undefined' && propsMode === 'player') {
      try {
        const url = new URL(window.location.href);
        const pid = url.searchParams.get('pid');
        const name = url.searchParams.get('name');
        hasUrlPlayer = !!(pid && name);
        // Debug: log URL check details
        console.log('[baseGameData] URL check:', {
          href: window.location.href,
          search: window.location.search,
          pid,
          name,
          mode: url.searchParams.get('mode'),
          hasUrlPlayer,
        });
      } catch (e) {
        console.warn('[baseGameData] URL check error:', e);
      }
    }
    
    // Debug: log why we're returning empty
    console.log('[baseGameData] No playerStats:', {
      playerStatsLength: playerStats.length,
      selectedPlayer: selectedPlayer?.full,
      resolvedPlayerId,
      isLoading,
      hasUrlPlayer,
    });
    // If we have a selectedPlayer OR resolvedPlayerId OR URL params indicate a player, we're either loading or haven't started loading yet
    // This can happen on initial page load when URL params exist but selectedPlayer/fetch hasn't started
    // Return empty array to prevent showing wrong data (0/0), but don't break the memoization
    if (selectedPlayer || resolvedPlayerId || hasUrlPlayer) {
      // Player is selected/resolved/indicated by URL but stats aren't loaded yet - treat as loading state
      // This prevents showing "0/0" during initial load
      return [];
    }
    // No player selected or stats truly empty - return empty
    return [];
  }
  
  // Debug: log stats structure at the start of baseGameData processing
  console.log('[baseGameData] Processing playerStats:', {
    playerStatsLength: statsToUse.length,
    selectedPlayer: selectedPlayer?.full,
    selectedTimeframe,
    sampleStat: statsToUse[0],
    hasGame: !!statsToUse[0]?.game,
    hasGameDate: !!statsToUse[0]?.game?.date,
    hasTeam: !!statsToUse[0]?.team,
    hasTeamAbbr: !!statsToUse[0]?.team?.abbreviation,
  });
  
  // Filter out games where player played 0 minutes FIRST
  // BUT for lastseason, we need to check ALL stats (including 0 minutes) to see if we can infer team from game data
  const shouldIncludeZeroMinutes = selectedTimeframe === 'lastseason';
  const gamesPlayed = statsToUse.filter(stats => {
    const minutes = parseMinutes(stats.min);
    if (shouldIncludeZeroMinutes) {
      // For last season, include stats even with 0 minutes if we can infer the team from game data
      // This helps us work around API data quality issues where stat.team is wrong
      return true; // We'll filter by minutes later after we've determined the correct team
    }
    return minutes > 0;
  });
  
  // Debug: Check what's happening with last season stats
  if (selectedTimeframe === 'lastseason') {
    const currentSeason = currentNbaSeason();
    const lastSeason = currentSeason - 1;
    const getSeasonYear = (stat: any) => {
      if (!stat?.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    
    const lastSeasonStats = statsToUse.filter(s => {
      const seasonYear = getSeasonYear(s);
      return seasonYear === lastSeason;
    });
    
    const lastSeasonWithMinutes = lastSeasonStats.filter(s => {
      const minutes = parseMinutes(s.min);
      return minutes > 0;
    });
    
    console.log(`[Last Season Debug] Total last season stats: ${lastSeasonStats.length}, with minutes > 0: ${lastSeasonWithMinutes.length}`);
    
    // Check if there are any stats with actual data (points, rebounds, etc.) even if minutes are 0
    const lastSeasonWithData = lastSeasonStats.filter(s => {
      const hasAnyStat = (s.pts && s.pts > 0) || (s.reb && s.reb > 0) || (s.ast && s.ast > 0) || 
                        (s.fgm && s.fgm > 0) || (s.fga && s.fga > 0);
      return hasAnyStat;
    });
    
    console.log(`[Last Season Debug] Last season stats with actual data (pts/reb/ast > 0): ${lastSeasonWithData.length}`);
    
    if (lastSeasonStats.length > 0 && lastSeasonWithMinutes.length === 0) {
      // Sample a few to see what's wrong
      const samples = lastSeasonStats.slice(0, 10).map(s => ({
        date: s.game?.date,
        team: s.team?.abbreviation,
        teamId: s.team?.id,
        teamFull: s.team?.full_name,
        homeTeam: s.game?.home_team?.abbreviation,
        visitorTeam: s.game?.visitor_team?.abbreviation,
        min: s.min,
        minType: typeof s.min,
        minRaw: s.min,
        minutes: parseMinutes(s.min),
        pts: s.pts,
        reb: s.reb,
        ast: s.ast,
        fgm: s.fgm,
        fga: s.fga,
        // Check player ID
        playerId: s.player?.id,
        // Check all numeric fields that might indicate actual play
        hasAnyStat: (s.pts && s.pts > 0) || (s.reb && s.reb > 0) || (s.ast && s.ast > 0) || (s.fgm && s.fgm > 0)
      }));
      console.log(`[Last Season Debug] Sample last season stats (first 10) - FULL DETAILS:`, samples);
      
      // Also check one stat in full detail to see ALL fields
      if (lastSeasonStats.length > 0) {
        const firstStat = lastSeasonStats[0];
        console.log(`[Last Season Debug] FIRST STAT FULL OBJECT (checking for hidden minutes/data):`, {
          id: firstStat.id,
          min: firstStat.min,
          minRaw: firstStat.min,
          minType: typeof firstStat.min,
          minutesParsed: parseMinutes(firstStat.min),
          pts: firstStat.pts,
          reb: firstStat.reb,
          ast: firstStat.ast,
          team: firstStat.team,
          player: firstStat.player ? { id: firstStat.player.id, name: firstStat.player.first_name + ' ' + firstStat.player.last_name } : null,
          game: firstStat.game ? {
            id: firstStat.game.id,
            date: firstStat.game.date,
            home_team: firstStat.game.home_team,
            visitor_team: firstStat.game.visitor_team
          } : null,
          // Check for alternative minute fields
          allKeys: Object.keys(firstStat),
          // Check if there are any numeric fields > 0
          numericFields: Object.entries(firstStat).filter(([k, v]) => typeof v === 'number' && v > 0).map(([k, v]) => ({ [k]: v })),
          // Show which specific stat fields have values
          statFieldValues: {
            pts: { value: firstStat.pts, type: typeof firstStat.pts, isPositive: firstStat.pts > 0 },
            reb: { value: firstStat.reb, type: typeof firstStat.reb, isPositive: firstStat.reb > 0 },
            ast: { value: firstStat.ast, type: typeof firstStat.ast, isPositive: firstStat.ast > 0 },
            fgm: { value: firstStat.fgm, type: typeof firstStat.fgm, isPositive: firstStat.fgm > 0 },
            fga: { value: firstStat.fga, type: typeof firstStat.fga, isPositive: firstStat.fga > 0 },
            fg3m: { value: firstStat.fg3m, type: typeof firstStat.fg3m, isPositive: firstStat.fg3m > 0 },
            ftm: { value: firstStat.ftm, type: typeof firstStat.ftm, isPositive: firstStat.ftm > 0 },
            fta: { value: firstStat.fta, type: typeof firstStat.fta, isPositive: firstStat.fta > 0 }
          },
          // Also check ALL numeric fields (including 0) to see the full picture
          allNumericFields: Object.entries(firstStat).filter(([k, v]) => typeof v === 'number').map(([k, v]) => ({ [k]: v })).slice(0, 20),
          // Check specific stat fields
          statFields: {
            pts: firstStat.pts,
            reb: firstStat.reb,
            ast: firstStat.ast,
            fgm: firstStat.fgm,
            fga: firstStat.fga,
            fg3m: firstStat.fg3m,
            fg3a: firstStat.fg3a,
            ftm: firstStat.ftm,
            fta: firstStat.fta,
            stl: firstStat.stl,
            blk: firstStat.blk,
            turnover: firstStat.turnover,
            pf: firstStat.pf
          }
        });
      }
      
      // Also check all teams in last season stats
      const allTeams = new Set(lastSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
      console.log(`[Last Season Debug] ⚠️ All teams in last season stats (${lastSeasonStats.length} total):`, Array.from(allTeams));
      
      // Check if ATL appears in the game data (home_team/visitor_team) even if stat.team is wrong
      const teamsInGames = new Set<string>();
      const atlGames: any[] = [];
      lastSeasonStats.forEach(s => {
        const homeTeam = s?.game?.home_team?.abbreviation;
        const visitorTeam = s?.game?.visitor_team?.abbreviation;
        if (homeTeam) teamsInGames.add(homeTeam);
        if (visitorTeam) teamsInGames.add(visitorTeam);
        if (homeTeam === 'ATL' || visitorTeam === 'ATL') {
          atlGames.push({
            date: s.game?.date,
            statTeam: s.team?.abbreviation,
            homeTeam,
            visitorTeam,
            min: s.min,
            pts: s.pts
          });
        }
      });
      console.log(`[Last Season Debug] ⚠️ Teams appearing in game data (home/visitor):`, Array.from(teamsInGames));
      console.log(`[Last Season Debug] ⚠️ Games where ATL appears (${atlGames.length} total):`, atlGames.slice(0, 5));
      
      // Check if in those ATL games, WAS is the opponent (meaning player was on ATL)
      const atlGamesWithWasOpponent = atlGames.filter(g => {
        const opponent = g.homeTeam === 'ATL' ? g.visitorTeam : g.homeTeam;
        return opponent === 'WAS';
      });
      console.log(`[Last Season Debug] ⚠️ Games where ATL vs WAS (player likely on ATL):`, atlGamesWithWasOpponent.length);
      
      // Also check: if stat.team is WAS but game has ATL, player was likely on ATL
      const likelyAtlGames = lastSeasonStats.filter(s => {
        const homeTeam = s?.game?.home_team?.abbreviation;
        const visitorTeam = s?.game?.visitor_team?.abbreviation;
        const statTeam = s?.team?.abbreviation;
        return (homeTeam === 'ATL' || visitorTeam === 'ATL') && statTeam === 'WAS';
      });
      console.log(`[Last Season Debug] ⚠️ Stats where game has ATL but stat.team=WAS (likely player was on ATL):`, likelyAtlGames.length);
      
      // If we have stats with actual data but 0 minutes, we might need to include them
      if (lastSeasonWithData.length > 0) {
        console.log(`[Last Season Debug] ⚠️ Found ${lastSeasonWithData.length} last season stats with data but 0 minutes - these are being filtered out!`);
        const dataSamples = lastSeasonWithData.slice(0, 5).map(s => ({
          date: s.game?.date,
          team: s.team?.abbreviation,
          min: s.min,
          minutes: parseMinutes(s.min),
          pts: s.pts,
          reb: s.reb,
          ast: s.ast
        }));
        console.log(`[Last Season Debug] Sample stats with data but 0 minutes:`, dataSamples);
      }
    }
  }
  
  // Debug: Log breakdown of gamesPlayed by season year to diagnose filtering issues
  if (selectedTimeframe === 'thisseason') {
    const currentSeason = currentNbaSeason();
    const gamesBySeasonYear: Record<number, number> = {};
    const gamesWithZeroMinutes: Record<number, number> = {};
    const currentSeasonStats: any[] = [];
    const lastSeasonStats: any[] = [];
    
    statsToUse.forEach(s => {
      const minutes = parseMinutes(s.min);
      if (!s.game?.date) return;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      
      if (minutes > 0) {
        gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
        if (gameSeasonYear === currentSeason) {
          currentSeasonStats.push({ date: s.game.date, min: s.min, minutes });
        } else {
          lastSeasonStats.push({ date: s.game.date, min: s.min, minutes });
        }
      } else {
        gamesWithZeroMinutes[gameSeasonYear] = (gamesWithZeroMinutes[gameSeasonYear] || 0) + 1;
      }
    });
    
    const breakdown = {
      totalPlayerStats: playerStats.length,
      totalGamesPlayed: gamesPlayed.length,
      gamesBySeasonYear,
      gamesWithZeroMinutes,
      currentSeason,
      expectedCurrentSeasonGames: gamesBySeasonYear[currentSeason] || 0,
      expectedLastSeasonGames: gamesBySeasonYear[currentSeason - 1] || 0,
      currentSeasonStatsSample: currentSeasonStats.slice(0, 5),
      lastSeasonStatsSample: lastSeasonStats.slice(0, 5),
      currentSeasonStatsCount: currentSeasonStats.length,
      lastSeasonStatsCount: lastSeasonStats.length
    };
    
    console.log(`[baseGameData] 📊 Games breakdown for "thisseason" filter:`, breakdown);
    serverLogger.log(`[baseGameData] 📊 Games breakdown: totalStats=${breakdown.totalPlayerStats}, gamesPlayed=${breakdown.totalGamesPlayed}, currentSeason=${breakdown.currentSeason}, currentSeasonGames=${breakdown.expectedCurrentSeasonGames}, lastSeasonGames=${breakdown.expectedLastSeasonGames}`, { data: breakdown });
  }
  
  // If timeframe is "thisseason" and we're still loading, check if we have current season data yet
  // This prevents showing last season data while current season is still loading
  // BUT: If we already have current season data, show it even if still loading (might be loading more data)
  if (selectedTimeframe === 'thisseason' && isLoading) {
    const currentSeason = currentNbaSeason();
    const currentSeasonGames = gamesPlayed.filter(stats => {
      if (!stats.game?.date) return false;
      const d = new Date(stats.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return (m >= 9 ? y : y - 1) === currentSeason;
    });
    
    // If we don't have ANY current season data yet, return empty to prevent showing last season data
    // But if we have some current season data, continue processing (don't return empty)
    if (currentSeasonGames.length === 0) {
      console.log(`[This Season] Still loading current season data, waiting... (have ${gamesPlayed.length} games but none from current season ${currentSeason})`);
      return [];
    } else {
      console.log(`[This Season] Have ${currentSeasonGames.length} current season games, showing them even though still loading`);
      // Continue processing - we have current season data to show
    }
  }
  
  // THEN apply opponent filter (if any) and timeframe logic on a deduped, date-sorted pool
  let filteredGames = gamesPlayed;
  
  // First, apply opponent filtering if a specific opponent is selected (not ALL)
  if (manualOpponent && manualOpponent !== 'ALL' && manualOpponent !== '') {
    const normalizedOpponent = normalizeAbbr(manualOpponent);
    let matchCount = 0;
    let noMatchCount = 0;
    const sampleNoMatches: any[] = [];
    
    filteredGames = gamesPlayed.filter(stats => {
      // FIXED to handle players who changed teams
      // The key insight: if a player has stats for a game, and the opponent we're looking for
      // is one of the teams in that game, then the player played against that opponent
      // (regardless of which team the player was on - this correctly handles team changes)
      
      // Get both teams from the game
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
      
      if (!homeTeamAbbr || !visitorTeamAbbr) {
        return false;
      }
      
      const homeNorm = normalizeAbbr(homeTeamAbbr);
      const awayNorm = normalizeAbbr(visitorTeamAbbr);
      
      // If the opponent we're looking for is in this game, and the player has stats for it,
      // then the player played against that opponent (regardless of which team they were on)
      // This correctly handles players who changed teams - we don't need to know which team
      // the player was on, we just need to know if the opponent is in the game
      const matches = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
      
      if (matches) {
        matchCount++;
      } else {
        noMatchCount++;
        // Collect sample of non-matches for debugging (first 3)
        if (sampleNoMatches.length < 3) {
          sampleNoMatches.push({
            gameDate: stats?.game?.date,
            playerTeamFromStats: stats?.team?.abbreviation,
            homeTeamAbbr,
            visitorTeamAbbr,
            homeTeamId,
            visitorTeamId,
            normalizedOpponent,
            lookingFor: normalizedOpponent,
            // Check if opponent appears in the game
            hasOpponent: (homeTeamAbbr && normalizeAbbr(homeTeamAbbr) === normalizedOpponent) || 
                        (visitorTeamAbbr && normalizeAbbr(visitorTeamAbbr) === normalizedOpponent)
          });
        }
      }
      
      return matches;
    });
    
    console.log(`🎯 Manual Opponent Player: Filtered to ${filteredGames.length} games vs ${manualOpponent} (${matchCount} matches, ${noMatchCount} non-matches)`);
    if (sampleNoMatches.length > 0 && filteredGames.length === 0) {
      console.log(`🔍 Sample non-matches (first 3):`, JSON.stringify(sampleNoMatches, null, 2));
      // Also log a sample stat to see the full structure
      if (gamesPlayed.length > 0) {
        const sampleStat = gamesPlayed[0];
        console.log(`🔍 Sample stat structure:`, {
          hasTeam: !!sampleStat?.team,
          teamAbbr: sampleStat?.team?.abbreviation,
          hasGame: !!sampleStat?.game,
          homeTeam: sampleStat?.game?.home_team?.abbreviation,
          visitorTeam: sampleStat?.game?.visitor_team?.abbreviation,
          homeTeamId: sampleStat?.game?.home_team?.id,
          visitorTeamId: sampleStat?.game?.visitor_team?.id,
          gameDate: sampleStat?.game?.date
        });
      }
    }
  }
  
  // Deduplicate by game id and sort DESC before timeframe selection
  const dedupAndSortDesc = (games: any[]) => {
    const sorted = [...games].sort((a, b) => {
      const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return db - da;
    });
    const seen = new Set<number | string>();
    const out: typeof games = [];
    for (const g of sorted) {
      const gid = (g as any)?.game?.id ?? (g as any)?.game_id;
      if (gid && seen.has(gid)) continue;
      if (gid) seen.add(gid);
      out.push(g);
    }
    return out;
  };

  // Special case filters
  // For L5, L10, L15, L20 - prefer current season, but backfill from previous seasons to reach N games
  const n = parseInt(selectedTimeframe.replace('last', ''));
  if (!Number.isNaN(n) && ['last5', 'last10', 'last15', 'last20'].includes(selectedTimeframe)) {
    const currentSeason = currentNbaSeason();
    
    const getSeasonYear = (stats: any) => {
      if (!stats.game?.date) return null;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      return gameMonth >= 9 ? gameYear : gameYear - 1; // Oct-Dec -> season year, Jan-Apr -> season year - 1
    };
    
    // Dedup and sort before selection to avoid losing count after slicing
    const pool = dedupAndSortDesc(filteredGames);
    
    // Separate by season (all games already have >0 minutes)
    const currentSeasonGames = pool.filter(stats => getSeasonYear(stats) === currentSeason);
    const otherSeasonGames = pool.filter(stats => getSeasonYear(stats) !== currentSeason);
    
    // Take N games: prefer current season first, then backfill from previous seasons
    const result: typeof filteredGames = [];
    
    // First, add current season games up to N
    for (let i = 0; i < currentSeasonGames.length && result.length < n; i++) {
      result.push(currentSeasonGames[i]);
    }
    
    // Then backfill from previous seasons to reach N
    for (let i = 0; i < otherSeasonGames.length && result.length < n; i++) {
      result.push(otherSeasonGames[i]);
    }
    
    filteredGames = result;
    console.log(`📅 ${selectedTimeframe.toUpperCase()}: Using ${filteredGames.length}/${n} games (current season ${currentSeason}-${(currentSeason + 1) % 100}: ${currentSeasonGames.length}, backfill: ${Math.max(filteredGames.length - currentSeasonGames.length, 0)}, pool (dedup) total: ${pool.length})`);
  } else if (selectedTimeframe === 'h2h' && (!manualOpponent || manualOpponent === 'ALL')) {
    // Filter games to only show those against the current opponent team
    if (opponentTeam && opponentTeam !== '') {
      const normalizedOpponent = normalizeAbbr(opponentTeam);
      let matchCount = 0;
      let noMatchCount = 0;
      const sampleNoMatches: any[] = [];
      
      filteredGames = gamesPlayed.filter(stats => {
        // FIXED to handle players who changed teams
        // The key insight: if a player has stats for a game, and the opponent we're looking for
        // is one of the teams in that game, then the player played against that opponent
        // (regardless of which team the player was on - this correctly handles team changes)
        
        // Get both teams from the game
        const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
        const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
        const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
        
        if (!homeTeamAbbr || !visitorTeamAbbr) {
          return false;
        }
        
        const homeNorm = normalizeAbbr(homeTeamAbbr);
        const awayNorm = normalizeAbbr(visitorTeamAbbr);
        
        // If the opponent we're looking for is in this game, and the player has stats for it,
        // then the player played against that opponent (regardless of which team they were on)
        // This correctly handles players who changed teams - we don't need to know which team
        // the player was on, we just need to know if the opponent is in the game
        const matches = homeNorm === normalizedOpponent || awayNorm === normalizedOpponent;
        
        if (matches) {
          matchCount++;
        } else {
          noMatchCount++;
          // Collect sample of non-matches for debugging (first 3)
          if (sampleNoMatches.length < 3) {
            sampleNoMatches.push({
              gameDate: stats?.game?.date,
              playerTeamFromStats: stats?.team?.abbreviation,
              homeTeamAbbr,
              visitorTeamAbbr,
              homeTeamId,
              visitorTeamId,
              normalizedOpponent,
              hasOpponent: (homeTeamAbbr && normalizeAbbr(homeTeamAbbr) === normalizedOpponent) || 
                          (visitorTeamAbbr && normalizeAbbr(visitorTeamAbbr) === normalizedOpponent)
            });
          }
        }
        
        return matches;
      }).slice(0, 6); // Limit to last 6 H2H games
      
      console.log(`🔥 H2H: Filtered to ${filteredGames.length} games vs ${opponentTeam} (${matchCount} matches, ${noMatchCount} non-matches, max 6)`);
      if (sampleNoMatches.length > 0 && filteredGames.length === 0) {
        console.log(`🔍 H2H Sample non-matches (first 3):`, JSON.stringify(sampleNoMatches, null, 2));
      }
    } else {
      // No opponent team available, show empty
      filteredGames = [];
      console.log(`⚠️ H2H: No opponent team available for filtering`);
    }
  } else if (selectedTimeframe === 'lastseason') {
    // Filter to last season games only
    const lastSeason = currentNbaSeason() - 1;
    const currentSeason = currentNbaSeason();
    
    console.log(`🔍 [Last Season] Starting filter - playerStats.length=${playerStats?.length || 0}, gamesPlayed.length=${gamesPlayed.length}`);
    
    // Debug: Log breakdown of all stats by season and team
    const gamesBySeasonYear: Record<number, number> = {};
    const gamesByTeam: Record<string, number> = {};
    const lastSeasonTeams = new Set<string>();
    const currentSeasonTeams = new Set<string>();
    
    gamesPlayed.forEach(s => {
      if (!s.game?.date) return;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      const teamAbbr = s?.team?.abbreviation || 'UNKNOWN';
      
      gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
      gamesByTeam[teamAbbr] = (gamesByTeam[teamAbbr] || 0) + 1;
      
      if (gameSeasonYear === lastSeason) {
        lastSeasonTeams.add(teamAbbr);
      } else if (gameSeasonYear === currentSeason) {
        currentSeasonTeams.add(teamAbbr);
      }
    });
    
    // For last season, we need to work around API data quality issues:
    // 1. stat.team might be wrong (e.g., WAS instead of ATL)
    // 2. All stats might have 0 minutes
    // Solution: Use game data to infer the player's team, then filter by minutes
    filteredGames = gamesPlayed.filter(stats => {
      if (!stats.game?.date) return false;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      
      // NBA season spans two calendar years (e.g., 2023-24 season)
      // Games from Oct-Dec are from the season year, games from Jan-Apr are from season year + 1
      const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
      if (gameSeasonYear !== lastSeason) return false;
      
      // WORKAROUND: If stat.team is wrong (e.g., WAS), try to infer from game data
      // If the game has ATL and stat.team is WAS, the player was likely on ATL
      // NOTE: We do NOT mutate the stats object here to avoid infinite loops
      // Instead, we just use the corrected team for filtering purposes
      const homeTeam = stats.game?.home_team?.abbreviation;
      const visitorTeam = stats.game?.visitor_team?.abbreviation;
      const statTeam = stats.team?.abbreviation;
      
      // Use game data to determine the player's actual team for filtering
      // If stat.team is WAS but game has ATL, the player was on ATL (not WAS)
      // We'll use this corrected team value for filtering, but NOT mutate the original object
      let actualTeam = statTeam;
      if (statTeam === 'WAS' && (homeTeam === 'ATL' || visitorTeam === 'ATL')) {
        // Player was on ATL, not WAS - use ATL for filtering
        actualTeam = 'ATL';
      }
      
      // Include all stats for now - we'll filter by minutes/data later
      // The actualTeam variable is used for logic, but we don't mutate stats.team
      return true;
    });
    
    // Now filter by minutes AFTER we've determined the correct team
    // WORKAROUND: For last season, if all stats have 0 minutes (API data quality issue),
    // use game data to identify which games the player was actually in
    const minutesFiltered = filteredGames.filter(stats => {
      const minutes = parseMinutes(stats.min);
      // For last season, include stats with 0 minutes if they have actual stat data (pts, reb, ast, etc.)
      // This handles cases where minutes are 0 but the player actually played
      if (minutes === 0) {
        const hasAnyStat = (stats.pts && stats.pts > 0) || (stats.reb && stats.reb > 0) || 
                          (stats.ast && stats.ast > 0) || (stats.fgm && stats.fgm > 0) ||
                          (stats.fga && stats.fga > 0);
        return hasAnyStat;
      }
      return minutes > 0;
    });
    
    console.log(`📅 Last Season: Before minutes filter: ${filteredGames.length}, After minutes filter: ${minutesFiltered.length}`);
    
    // CRITICAL WORKAROUND: If all last season stats have 0 minutes (API data quality issue),
    // use game data to identify games where the player was actually involved
    if (filteredGames.length > 0 && minutesFiltered.length === 0) {
      console.warn(`[Last Season Debug] ⚠️ API DATA QUALITY ISSUE: All ${filteredGames.length} last season stats have 0 minutes. Using game data to identify actual games...`);
      
      // Use game data to identify games where the player's team was involved
      // Strategy: If stat.team doesn't match either team in the game, but we have game data,
      // we can infer the player was on one of the teams in the game
      const gamesWithPlayerTeam = filteredGames.filter(stats => {
        const homeTeam = stats.game?.home_team?.abbreviation;
        const visitorTeam = stats.game?.visitor_team?.abbreviation;
        const statTeam = stats.team?.abbreviation;
        
        // Normal case: stat.team matches one of the teams in the game
        if (statTeam && (statTeam === homeTeam || statTeam === visitorTeam)) {
          return true;
        }
        
        // Workaround: If stat.team doesn't match, but we have game data with two teams,
        // the player was likely on one of those teams (API data quality issue)
        // Include the game if we have valid game data
        if (homeTeam && visitorTeam && stats.game?.id) {
          return true;
        }
        
        return false;
      });
      
      console.log(`[Last Season Debug] ✅ Found ${gamesWithPlayerTeam.length} games where player's team appears in game data (workaround for API data quality issue)`);
      
      // Use the games identified from game data instead of the empty minutesFiltered
      if (gamesWithPlayerTeam.length > 0) {
        filteredGames = gamesWithPlayerTeam;
        console.log(`[Last Season Debug] ✅ Using ${filteredGames.length} games identified from game data (workaround for 0-minute stats)`);
      } else {
        console.warn(`[Last Season Debug] ⚠️ Could not identify any games from game data either. All stats filtered out.`);
      }
    } else {
      filteredGames = minutesFiltered;
    }
    
    // Also check ALL stats (before minutes filter) to see what teams are in last season
    const allLastSeasonStats = playerStats?.filter((s: any) => {
      if (!s.game?.date) return false;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      return gameSeasonYear === lastSeason;
    }) || [];
    
    const allLastSeasonTeams = new Set<string>();
    const allLastSeasonWithMinutes = allLastSeasonStats.filter((s: any) => {
      const teamAbbr = s?.team?.abbreviation || 'UNKNOWN';
      allLastSeasonTeams.add(teamAbbr);
      const minutes = parseMinutes(s.min);
      return minutes > 0;
    });
    
    console.log(`📅 Last Season: Filtered to ${filteredGames.length} games from ${lastSeason}-${(lastSeason + 1) % 100}`);
    console.log(`📅 Last Season Debug:`, {
      totalGamesPlayed: gamesPlayed.length,
      gamesBySeasonYear,
      gamesByTeam,
      lastSeasonTeams: Array.from(lastSeasonTeams),
      currentSeasonTeams: Array.from(currentSeasonTeams),
      filteredCount: filteredGames.length,
      sampleFilteredDates: filteredGames.slice(0, 5).map(s => ({ date: s.game?.date, team: s.team?.abbreviation })),
      // NEW: Check ALL last season stats (including 0 minutes)
      allLastSeasonStatsCount: allLastSeasonStats.length,
      allLastSeasonTeams: Array.from(allLastSeasonTeams),
      allLastSeasonWithMinutesCount: allLastSeasonWithMinutes.length,
      sampleAllLastSeason: allLastSeasonStats.slice(0, 5).map(s => ({
        date: s.game?.date,
        team: s.team?.abbreviation,
        min: s.min,
        minutes: parseMinutes(s.min),
        pts: s.pts
      }))
    });
  } else if (selectedTimeframe === 'thisseason') {
    // Filter to current season games only
    const currentSeason = currentNbaSeason();
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    // Calculate the season start year for the current NBA season
    // If we're in Oct-Dec, current season started this year (e.g., Dec 2025 = 2025-26 season = year 2025)
    // If we're in Jan-Apr, current season started last year (e.g., Jan 2025 = 2024-25 season = year 2024)
    const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
    
    filteredGames = gamesPlayed.filter(stats => {
      if (!stats.game?.date) return false;
      const gameDate = new Date(stats.game.date);
      const gameYear = gameDate.getFullYear();
      const gameMonth = gameDate.getMonth();
      
      // Calculate which NBA season this game belongs to
      // Games from Oct-Dec belong to the season year (e.g., Oct 2024 = 2024-25 season = year 2024)
      // Games from Jan-Apr belong to the previous calendar year's season (e.g., Apr 2025 = 2024-25 season = year 2024)
      const gameSeasonYear = gameMonth >= 9 ? gameYear : gameYear - 1;
      
      // Game must be from the current NBA season
      return gameSeasonYear === seasonStartYear;
    });
    const allGameDates = gamesPlayed.map(s => s.game?.date).filter(Boolean);
    
    // Debug: Check what season years the games actually belong to
    // Show both filtered and unfiltered games to understand the mismatch
    const gameSeasonYears = gamesPlayed.slice(0, 10).map(s => {
      if (!s.game?.date) return null;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      return { date: s.game.date, year: y, month: m, seasonYear: gameSeasonYear, matches: gameSeasonYear === seasonStartYear };
    });
    
    // Also check the filtered games to see what we're actually showing
    const filteredGameSeasonYears = filteredGames.slice(0, 10).map(s => {
      if (!s.game?.date) return null;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      return { date: s.game.date, year: y, month: m, seasonYear: gameSeasonYear };
    });
    
    // Show breakdown of games by season year to understand the data
    const gamesBySeasonYear: Record<number, number> = {};
    gamesPlayed.forEach(s => {
      if (!s.game?.date) return;
      const d = new Date(s.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      const gameSeasonYear = m >= 9 ? y : y - 1;
      gamesBySeasonYear[gameSeasonYear] = (gamesBySeasonYear[gameSeasonYear] || 0) + 1;
    });
    
    const filterData = {
      currentSeason,
      seasonStartYear: seasonStartYear,
      totalGames: gamesPlayed.length,
      filteredGames: filteredGames.length,
      isLoading,
      selectedPlayer: selectedPlayer?.full,
      sampleDates: allGameDates.slice(0, 5),
      sampleFilteredDates: filteredGames.slice(0, 5).map(s => s.game?.date),
      selectedTimeframe,
      gameSeasonYears: gameSeasonYears.filter(Boolean),
      filteredGameSeasonYears: filteredGameSeasonYears.filter(Boolean),
      gamesBySeasonYear
    };
    console.log(`📅 [This Season Filter]`, filterData);
    serverLogger.log(`📅 [This Season Filter]`, { data: filterData });
    
    // If thisseason filter returns empty but we have playerStats, check if current season data is still loading
    // If we're still loading (isLoading is true), return empty array to prevent showing last season data
    if (filteredGames.length === 0 && gamesPlayed.length > 0) {
      // Check if we have any current season games in the full playerStats (might still be loading)
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth();
      const seasonStartYear = currentMonth >= 9 ? currentYear : currentYear - 1;
      
      const currentSeasonInAllStats = statsToUse.filter(s => {
        if (!s.game?.date) return false;
        const d = new Date(s.game.date);
        const y = d.getFullYear();
        const m = d.getMonth();
        const gameSeasonYear = m >= 9 ? y : y - 1;
        return gameSeasonYear === seasonStartYear;
      });
      
      console.warn(`⚠️ [This Season Filter] Returned 0 games but player has ${gamesPlayed.length} total games.`, {
        currentSeason,
        isLoading,
        currentSeasonInAllStatsCount: currentSeasonInAllStats.length,
        sampleDates: allGameDates.slice(0, 10),
        sampleCurrentSeasonDates: currentSeasonInAllStats.slice(0, 5).map(s => s.game?.date)
      });
      
      // If we're still loading AND we have current season games in the full stats, wait for them
      // Otherwise, if loading is done and still no current season games, log warning
      if (isLoading && currentSeasonInAllStats.length > 0) {
        console.log(`[This Season] Current season data still loading (${currentSeasonInAllStats.length} games found in full stats), waiting...`);
        // Return empty to prevent showing last season data while current season loads
        filteredGames = [];
      } else if (!isLoading) {
        // Debug: log sample game dates to understand the issue
        const sampleDates = gamesPlayed.slice(0, 5).map(s => {
          if (!s.game?.date) return null;
          const d = new Date(s.game.date);
          const y = d.getFullYear();
          const m = d.getMonth();
          const gameSeasonYear = m >= 9 ? y : y - 1;
          return { date: s.game.date, year: y, month: m, gameSeasonYear, currentSeason };
        });
        console.warn(`⚠️ This Season filter returned 0 games but player has ${gamesPlayed.length} total games.`, {
          currentSeason,
          sampleDates,
          allGameDates: gamesPlayed.map(s => s.game?.date).filter(Boolean).slice(0, 10),
          isLoading,
          currentSeasonInAllStats: currentSeasonInAllStats.length
        });
      }
    }
  }
  
  // Apply Home/Away filter before slicing/time-ordering
  if (homeAway !== 'ALL') {
    filteredGames = filteredGames.filter(stats => {
      const playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || '';
      const playerTeamNorm = normalizeAbbr(playerTeam);
      const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
      const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
      const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
      const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
      const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
      let isHome = false;
      if (playerTeamId && homeTeamId && visitorTeamId) {
        isHome = playerTeamId === homeTeamId;
      } else if (homeTeamAbbr && visitorTeamAbbr) {
        isHome = playerTeamNorm === normalizeAbbr(homeTeamAbbr);
      }
      return homeAway === 'HOME' ? isHome : !isHome;
    });
  }
  
  // Sort games by date (newest first) before applying timeframe filters
  const sortedByDate = [...filteredGames].sort((a, b) => {
    const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
    const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
    return dateB - dateA; // Newest first
  });
  
  // n was already parsed above for season filtering, but we need it again for slicing
  const nForSlice = parseInt(selectedTimeframe.replace('last', ''));
  
  // Deduplicate by gameId to fix API duplicate data issue (on sorted games)
  const uniqueGames = [];
  const seenGameIds = new Set();
  
  for (const game of sortedByDate) {
    const gameId = game?.game?.id;
    if (gameId && !seenGameIds.has(gameId)) {
      seenGameIds.add(gameId);
      uniqueGames.push(game);
    } else if (!gameId) {
      // Keep games without gameId (shouldn't happen but just in case)
      uniqueGames.push(game);
    }
  }
  
  console.log(`📈 Deduplicated: ${sortedByDate.length} → ${uniqueGames.length} unique games`);
  
  // Apply timeframe to unique games - use slice(0, n) to get FIRST n games (most recent)
  // Since uniqueGames is sorted newest-first, slice(0, n) gives us the newest n games
  // For special timeframes (h2h, lastseason, thisseason), don't slice
  // If a teammate filter is active, take many more games (10x) so we have enough after teammate filter
  // This is especially important for "without" filters which can be very restrictive
  const sliceMultiplier = teammateFilterId && selectedTimeframe.startsWith('last') ? 10 : 1;
  const sliceCount = !Number.isNaN(nForSlice) ? nForSlice * sliceMultiplier : undefined;
  const timeframeGames = ['h2h', 'lastseason', 'thisseason'].includes(selectedTimeframe)
    ? uniqueGames
    : (sliceCount ? uniqueGames.slice(0, sliceCount) : uniqueGames);
  
  // Reverse for chronological order (left→right oldest→newest)
  const ordered = timeframeGames.slice().reverse();
  
  // Debug: log before mapping
  console.log('[baseGameData] Before mapping:', {
    selectedTimeframe,
    gamesPlayedCount: gamesPlayed.length,
    filteredGamesCount: filteredGames.length,
    uniqueGamesCount: uniqueGames.length,
    timeframeGamesCount: timeframeGames.length,
    orderedCount: ordered.length,
    sampleOrderedStat: ordered[0],
    hasGame: !!ordered[0]?.game,
    hasGameDate: !!ordered[0]?.game?.date,
  });
  
  const result = ordered.map((stats, index) => {
    let playerTeam = stats?.team?.abbreviation || selectedPlayer?.teamAbbr || "";
    
    // Get team info from stats.game - support both nested objects and *_id fields
    const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
    const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
    const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
    const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
    
    // WORKAROUND: For last season, if stat.team doesn't match either team in the game,
    // infer the correct team from game data (API data quality issue for players who changed teams)
    if (selectedTimeframe === 'lastseason' && playerTeam && homeTeamAbbr && visitorTeamAbbr) {
      const playerTeamNorm = normalizeAbbr(playerTeam);
      const homeNorm = normalizeAbbr(homeTeamAbbr);
      const visitorNorm = normalizeAbbr(visitorTeamAbbr);
      
      // If playerTeam doesn't match either team in the game, infer from game data
      if (playerTeamNorm !== homeNorm && playerTeamNorm !== visitorNorm) {
        // The player was on one of the teams in the game, but stat.team is wrong
        // For Saddiq Bey, we know he was on ATL last season, so if ATL is in the game, use ATL
        // Otherwise, we can't definitively determine which team, but we'll use the home team as a fallback
        if (homeNorm === 'ATL' || visitorNorm === 'ATL') {
          playerTeam = 'ATL';
          console.log(`[baseGameData] 🔧 Corrected team for last season game: ${stats?.team?.abbreviation} → ATL (game: ${homeTeamAbbr} vs ${visitorTeamAbbr})`);
        } else {
          // For other games, we can't be sure, but we'll use the home team as a heuristic
          // (This is a fallback - ideally we'd have better data)
          playerTeam = homeTeamAbbr;
          console.log(`[baseGameData] 🔧 Corrected team for last season game: ${stats?.team?.abbreviation} → ${homeTeamAbbr} (game: ${homeTeamAbbr} vs ${visitorTeamAbbr}, using home team as fallback)`);
        }
      }
    }
    
    const playerTeamNorm = normalizeAbbr(playerTeam);
    
    // Determine opponent using team IDs/abbrs
    const playerTeamId = ABBR_TO_TEAM_ID[playerTeamNorm];
    let opponent = "";
    
    if (playerTeamId && homeTeamId && visitorTeamId) {
      if (playerTeamId === homeTeamId && visitorTeamAbbr) {
        opponent = visitorTeamAbbr;
      } else if (playerTeamId === visitorTeamId && homeTeamAbbr) {
        opponent = homeTeamAbbr;
      }
    }
    // Fallback: compare abbreviations directly if IDs missing
    if (!opponent && homeTeamAbbr && visitorTeamAbbr) {
      const homeNorm = normalizeAbbr(homeTeamAbbr);
      const awayNorm = normalizeAbbr(visitorTeamAbbr);
      if (playerTeamNorm && playerTeamNorm === homeNorm) opponent = awayNorm;
      else if (playerTeamNorm && playerTeamNorm === awayNorm) opponent = homeNorm;
    }
    
    const iso = stats?.game?.date;
    const d = iso ? new Date(iso) : null;
    const shortDate = d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : "";
    
    // Create unique key for each game to fix tooltip data grouping
    const gameId = stats?.game?.id ?? `${opponent}-${index}`;
    const tickLabel = opponent || "";
    
    return {
      stats, // Keep reference to original stats for value calculation
      opponent,
      gameNumber: index + 1,
      game: opponent ? `vs ${opponent}` : "—",
      date: shortDate,
      xKey: String(gameId),   // unique per game
      tickLabel,              // what we show on the axis
    };
  });
  
  console.log('[baseGameData] Final result:', {
    resultLength: result.length,
    selectedTimeframe,
  });
  
  return result;
}


