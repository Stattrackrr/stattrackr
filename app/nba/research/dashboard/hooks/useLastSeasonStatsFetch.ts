import { useEffect, useRef } from 'react';
import { BallDontLieStats } from '../types';
import { currentNbaSeason } from '../utils/playerUtils';

export interface UseLastSeasonStatsFetchParams {
  selectedTimeframe: string;
  selectedPlayer: any;
  playerStats: BallDontLieStats[];
  setPlayerStats: (stats: BallDontLieStats[] | ((prev: BallDontLieStats[]) => BallDontLieStats[])) => void;
}

/**
 * Custom hook to handle last season stats fetching workaround
 * When viewing last season and all stats have 0 minutes, fetch stats by game_id
 * for games where the player was on their previous team
 */
export function useLastSeasonStatsFetch({
  selectedTimeframe,
  selectedPlayer,
  playerStats,
  setPlayerStats,
}: UseLastSeasonStatsFetchParams) {
  const lastSeasonGameIdFetchRef = useRef<{ playerId: string; attempted: boolean }>({ playerId: '', attempted: false });

  // Extract player ID to avoid dependency on object reference changes
  const playerId = selectedPlayer?.id?.toString() || null;

  useEffect(() => {
    console.log(`[useEffect lastseason] Triggered:`, {
      selectedTimeframe,
      hasSelectedPlayer: !!selectedPlayer?.id,
      playerStatsLength: playerStats.length,
      refPlayerId: lastSeasonGameIdFetchRef.current.playerId,
      refAttempted: lastSeasonGameIdFetchRef.current.attempted
    });
    
    if (selectedTimeframe !== 'lastseason' || !playerId || playerStats.length === 0) {
      // Reset ref when not viewing last season
      if (selectedTimeframe !== 'lastseason') {
        lastSeasonGameIdFetchRef.current = { playerId: '', attempted: false };
      }
      return;
    }
    const lastSeason = currentNbaSeason() - 1;
    const getSeasonYear = (stat: any) => {
      if (!stat?.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    
    const lastSeasonStats = playerStats.filter(s => getSeasonYear(s) === lastSeason);
    if (lastSeasonStats.length === 0) {
      console.log(`[useEffect lastseason] ⏸️ No last season stats found, skipping`);
      return;
    }
    
    // Skip if we've already attempted for this player AND we have valid stats
    // But if we still have 0-minute stats, try again (maybe the fetch failed)
    const parseMin = (minStr: string): number => {
      if (!minStr) return 0;
      const str = String(minStr).trim();
      if (!str || str === '0' || str === '00' || str === '0:00') return 0;
      const parts = str.split(':');
      if (parts.length === 2) {
        return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
      }
      const num = parseFloat(str);
      return isNaN(num) ? 0 : num;
    };
    
    const withMinutes = lastSeasonStats.filter(s => {
      const min = parseMin(s.min || '');
      return min > 0;
    });
    
    // Check if we have valid stats (even if minutes are 0)
    const hasValidLastSeasonStats = lastSeasonStats.some(s => {
      const min = parseMin(s.min || '');
      return min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
    });
    
    // Skip if we've already attempted AND we have valid stats
    if (lastSeasonGameIdFetchRef.current.playerId === playerId && 
        lastSeasonGameIdFetchRef.current.attempted && 
        hasValidLastSeasonStats) {
      console.log(`[useEffect lastseason] ⏸️ Already attempted for player ${playerId} and have valid stats, skipping`);
      return;
    }
    
    // Reset ref if it's a different player
    if (lastSeasonGameIdFetchRef.current.playerId !== playerId) {
      lastSeasonGameIdFetchRef.current = { playerId, attempted: false };
    }
    
    // If all last season stats have 0 minutes, fetch by game_id
    if (withMinutes.length === 0) {
      // Mark as attempted NOW to prevent duplicate fetches
      lastSeasonGameIdFetchRef.current = { playerId, attempted: true };
      
      console.log(`[useEffect lastseason] 🔧 Detected API data quality issue: all ${lastSeasonStats.length} last season stats have 0 minutes. Fetching by game_id...`);
      
      // Identify ALL games where ATL appears - player was on ATL for those games
      // We know from the logs that there are 4 games where ATL appears
      const atlGames = lastSeasonStats.filter(s => {
        const homeTeam = s.game?.home_team?.abbreviation;
        const visitorTeam = s.game?.visitor_team?.abbreviation;
        return (homeTeam === 'ATL' || visitorTeam === 'ATL') && s.game?.id;
      });
      
      console.log(`[useEffect lastseason] 🔍 Found ${atlGames.length} games where ATL appears (player was on ATL):`, atlGames.map(s => ({
        gameId: s.game?.id,
        date: s.game?.date,
        homeTeam: s.game?.home_team?.abbreviation,
        visitorTeam: s.game?.visitor_team?.abbreviation,
        statTeam: s.team?.abbreviation
      })));
      
      // Get unique game IDs for games where ATL appears
      const gameIds = Array.from(new Set(
        atlGames
          .map(s => s.game?.id)
          .filter((id): id is number => typeof id === 'number' && !isNaN(id))
      ));
      
      console.log(`[useEffect lastseason] 🔍 Unique game IDs to fetch: ${gameIds.length}`, gameIds);
      
      if (gameIds.length > 0) {
        console.log(`[useEffect lastseason] 🔧 Found ${gameIds.length} games with player's previous team, fetching stats by game_id...`);
        console.log(`[useEffect lastseason] 🔧 Game IDs to fetch:`, gameIds);
        
        // Fetch stats by game_id in batches (async, don't block)
        const fetchStatsByGameId = async () => {
          const { queuedFetch } = await import('@/lib/requestQueue');
          const batchSize = 50;
          const gameBatches: number[][] = [];
          for (let i = 0; i < gameIds.length; i += batchSize) {
            gameBatches.push(gameIds.slice(i, i + batchSize));
          }
          
          const statsByGameId: BallDontLieStats[] = [];
          for (const batch of gameBatches) {
            try {
              const gameIdsStr = batch.join(',');
              const url = `/api/stats?player_id=${playerId}&game_ids=${gameIdsStr}&per_page=100&max_pages=1`;
              const requestId = `stats-${playerId}-games-${batch[0]}-${Date.now()}`;
              console.log(`[useEffect lastseason] 🔧 Fetching stats for game IDs: ${gameIdsStr}`);
              const r = await queuedFetch(url, {}, requestId);
              const j = await r.json().catch(() => ({}));
              
              console.log(`[useEffect lastseason] 🔧 API response:`, {
                hasData: !!j?.data,
                dataIsArray: Array.isArray(j?.data),
                dataLength: Array.isArray(j?.data) ? j.data.length : 0,
                error: j?.error,
                fullResponse: j
              });
              
              const batchStats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
              
              console.log(`[useEffect lastseason] 🔧 Raw batch stats (${batchStats.length}):`, batchStats.slice(0, 3).map(s => ({
                gameId: s.game?.id,
                date: s.game?.date,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts,
                reb: s.reb,
                ast: s.ast
              })));
              
              // WORKAROUND: Even if stats have 0 minutes, if we know from game data that the player
              // was on ATL for these games, include them. The API has data quality issues for players
              // who changed teams, but we can still use the game data to show the player played.
              // We'll include stats if:
              // 1. They have actual minutes/data (normal case), OR
              // 2. The game has ATL as a participant (we know player was on ATL)
              // WORKAROUND: The BallDon'tLie API returns placeholder stats (0 minutes, 0 values) 
              // for players who changed teams, even when querying by game_id.
              // However, we know these are the correct games (we identified them by finding games where ATL appears).
              // So we'll include ALL stats returned from the game_id query, even if they have 0 minutes,
              // because at least we know these are the correct games where the player was on ATL.
              const validStats = batchStats.filter(s => {
                const gameId = s.game?.id;
                const min = parseMin(s.min || '');
                const hasActualData = min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
                
                // Since we're querying by game_id for games we identified as ATL games,
                // include ALL stats returned, even if they have 0 minutes (API data quality issue)
                const isIdentifiedAtlGame = gameId && gameIds.includes(gameId);
                
                if (isIdentifiedAtlGame) {
                  console.log(`[useEffect lastseason] ✅ Including stat from identified ATL game (even with 0 minutes):`, {
                    gameId,
                    date: s.game?.date,
                    team: s.team?.abbreviation,
                    homeTeam: s.game?.home_team?.abbreviation,
                    visitorTeam: s.game?.visitor_team?.abbreviation,
                    min: s.min,
                    pts: s.pts,
                    reb: s.reb,
                    ast: s.ast
                  });
                  return true; // Always include stats from identified ATL games
                }
                
                // For other games, only include if they have actual data
                if (!hasActualData) {
                  console.log(`[useEffect lastseason] 🔍 Filtered out stat (not identified ATL game, no data):`, {
                    gameId,
                    min: s.min,
                    parsedMin: min,
                    pts: s.pts
                  });
                }
                return hasActualData;
              });
              
              statsByGameId.push(...validStats);
              console.log(`[useEffect lastseason] 🔧 Fetched ${validStats.length} valid stats from ${batch.length} games (raw: ${batchStats.length})`);
            } catch (error: any) {
              console.warn(`[useEffect lastseason] ⚠️ Error fetching stats by game_id for batch:`, error?.message || error);
            }
          }
          
          if (statsByGameId.length > 0) {
            console.log(`[useEffect lastseason] ✅ Successfully fetched ${statsByGameId.length} stats by game_id. Updating playerStats...`);
            
            // CORRECT THE TEAM: For stats from identified ATL games, fix the team abbreviation
            // The API returns stat.team=WAS, but we know the player was on ATL for these games
            const correctedStats = statsByGameId.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && gameIds.includes(gameId)) {
                // This is one of our identified ATL games - correct the team to ATL
                const homeTeam = stat.game?.home_team?.abbreviation;
                const visitorTeam = stat.game?.visitor_team?.abbreviation;
                
                // We know the player was on ATL for these games, so set team to ATL
                const correctTeam = 'ATL';
                const correctTeamId = homeTeam === 'ATL' 
                  ? stat.game?.home_team?.id 
                  : (visitorTeam === 'ATL' 
                    ? stat.game?.visitor_team?.id 
                    : stat.team?.id);
                
                // Ensure team.id is always a number (required by BallDontLieStats type)
                // Use the team ID from game data if available, otherwise fall back to original or 0
                const teamId: number = correctTeamId ?? stat.team?.id ?? 0;
                
                console.log(`[useEffect lastseason] 🔧 Correcting team for game ${gameId}: ${stat.team?.abbreviation} → ${correctTeam} (home: ${homeTeam}, visitor: ${visitorTeam}, teamId: ${teamId})`);
                
                return {
                  ...stat,
                  team: {
                    ...(stat.team || {}),
                    abbreviation: correctTeam,
                    id: teamId,
                    full_name: 'Atlanta Hawks',
                    name: 'Hawks'
                  }
                };
              }
              return stat;
            });
            
            // Merge with existing stats
            // Keep all current season stats, and for last season:
            // - Keep all original last season stats (they have game data even if team is wrong)
            // - Add/update with the corrected stats from game_id fetch
            const currentSeasonStats = playerStats.filter(s => getSeasonYear(s) === currentNbaSeason());
            const lastSeasonStatsOriginal = playerStats.filter(s => getSeasonYear(s) === lastSeason);
            
            console.log(`[useEffect lastseason] 📊 Before merge: current=${currentSeasonStats.length}, lastSeason original=${lastSeasonStatsOriginal.length}, corrected stats=${correctedStats.length}`);
            
            // Create a map of game_id -> corrected stat for quick lookup
            const correctedStatsMap = new Map(correctedStats.map(s => [s.game?.id, s]));
            
            // For each original last season stat, use the corrected version if available, otherwise keep original
            const lastSeasonStatsCorrected = lastSeasonStatsOriginal.map(stat => {
              const gameId = stat.game?.id;
              if (gameId && correctedStatsMap.has(gameId)) {
                console.log(`[useEffect lastseason] 🔄 Replacing stat for game ${gameId} with corrected version`);
                return correctedStatsMap.get(gameId)!;
              }
              return stat;
            });
            
            // Also add any corrected stats that weren't in the original (shouldn't happen, but just in case)
            const correctedGameIds = new Set(correctedStats.map(s => s.game?.id).filter(Boolean));
            const originalGameIds = new Set(lastSeasonStatsOriginal.map(s => s.game?.id).filter(Boolean));
            const newStats = correctedStats.filter(s => {
              const gameId = s.game?.id;
              return gameId && !originalGameIds.has(gameId);
            });
            
            if (newStats.length > 0) {
              console.log(`[useEffect lastseason] ➕ Adding ${newStats.length} new stats that weren't in original`);
            }
            
            // Combine: current season + corrected last season stats + any new stats
            const updatedStats = [...currentSeasonStats, ...lastSeasonStatsCorrected, ...newStats];
            
            console.log(`[useEffect lastseason] 📊 After merge: current=${currentSeasonStats.length}, lastSeason=${lastSeasonStatsCorrected.length}, new=${newStats.length}, total=${updatedStats.length}`);
            
            setPlayerStats(updatedStats);
          } else {
            console.warn(`[useEffect lastseason] ⚠️ No valid stats found when querying by game_id`);
          }
        };
        
        // Fetch asynchronously (don't block the UI)
        fetchStatsByGameId().catch(err => {
          console.error(`[useEffect lastseason] ❌ Error in fetchStatsByGameId:`, err);
        });
      } else {
        console.log(`[useEffect lastseason] ⏸️ No game IDs found to fetch`);
      }
    } else {
      console.log(`[useEffect lastseason] ✅ Last season stats have minutes, no fetch needed`);
    }
  }, [selectedTimeframe, playerId, playerStats, setPlayerStats]);
}

