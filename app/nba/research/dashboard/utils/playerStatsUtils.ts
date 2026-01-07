import { BallDontLieStats } from '../types';
import { currentNbaSeason } from './playerUtils';

/**
 * Core function to fetch player stats (without UI state updates)
 * Fetches stats for current and previous season, handling regular season and playoffs
 */
export async function fetchSortedStatsCore(
  playerId: string,
  selectedTimeframe: string
): Promise<BallDontLieStats[]> {
  console.log('[fetchSortedStatsCore] Starting fetch for playerId:', playerId);
  const season = currentNbaSeason();
  
  // Use queued fetch to prevent rate limiting
  const { queuedFetch } = await import('@/lib/requestQueue');
  
  // OPTIMIZATION: When coming from props page, the stats should already be cached
  // The props page ingestion calls /api/stats which populates the cache
  // We use the same cache key format, so this should be instant!
  
  // Fetch stats for a season - fetch both regular and playoffs in parallel
  // This reduces from 4 requests to 2 requests per player (2 seasons x 1 parallel fetch each)
  const grabSeason = async (yr: number) => {
    const fetchRegular = async () => {
      // Use cache for faster loading - stats API has 8 hour cache
      // This cache is populated by props page ingestion, so clicking from props page should be instant!
      // Fetch 3-5 pages to get this season and last season (max ~82 games per season = 1 page, but 3-5 pages covers edge cases)
      // This is much faster than fetching 50 pages (5000 games) which was overkill
      // OPTIMIZATION: Don't use refresh=1 - use cached data from props page ingestion for instant load
      // OPTIMIZATION: Skip DvP on initial load for faster chart rendering (DvP fetched in background via useDvpRankPrefetch)
      const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`;
      const requestId = `stats-${playerId}-${yr}-reg`;
      try {
        const r = await queuedFetch(url, {}, requestId);
        const j = await r.json().catch(() => ({}));
        const stats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
        
        // Debug: Log team distribution for last season
        if (yr === currentNbaSeason() - 1) {
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
          
          const teams = new Set(stats.map(s => s?.team?.abbreviation).filter(Boolean));
          const withMinutes = stats.filter(s => {
            const min = parseMin(s.min || '');
            return min > 0;
          });
          const teamsWithMinutes = new Set(withMinutes.map(s => s?.team?.abbreviation).filter(Boolean));
          console.log(`[fetchSortedStatsCore] Last season (${yr}) stats: total=${stats.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}, teamsWithMinutes=${Array.from(teamsWithMinutes).join(',')}`);
          if (stats.length > 0 && withMinutes.length === 0) {
            const sample = stats.slice(0, 5).map(s => ({
              date: s.game?.date,
              team: s.team?.abbreviation,
              min: s.min,
              pts: s.pts,
              reb: s.reb
            }));
            console.log(`[fetchSortedStatsCore] Sample last season stats (all have 0 minutes):`, sample);
            
            // WORKAROUND: If all stats have 0 minutes, identify games where player was on their previous team
            // and fetch stats by game_id to get actual data
            console.log(`[fetchSortedStatsCore] 🔧 Attempting to fetch stats by game_id for games with player's previous team...`);
            
            // Identify games where stat.team doesn't match either team in the game
            // This indicates the player was on a different team (e.g., stat.team=WAS but game has ATL)
            const gamesWithPreviousTeam = stats
              .filter(s => {
                const homeTeam = s.game?.home_team?.abbreviation;
                const visitorTeam = s.game?.visitor_team?.abbreviation;
                const statTeam = s.team?.abbreviation;
                
                // If stat.team doesn't match either team in the game, player was likely on one of those teams
                // This handles cases like stat.team=WAS but game has ATL (player was on ATL)
                if (!homeTeam || !visitorTeam || !statTeam) return false;
                
                // Check if stat.team matches either team (normal case - skip)
                if (statTeam === homeTeam || statTeam === visitorTeam) return false;
                
                // stat.team doesn't match - player was on one of the teams in the game
                return true;
              })
              .map(s => s.game?.id)
              .filter((id): id is number => typeof id === 'number' && !isNaN(id));
            
            if (gamesWithPreviousTeam.length > 0) {
              console.log(`[fetchSortedStatsCore] 🔧 Found ${gamesWithPreviousTeam.length} games with player's previous team, fetching stats by game_id...`);
              
              // Fetch stats for these specific games (batch in groups of 50 to avoid URL length issues)
              const batchSize = 50;
              const gameBatches: number[][] = [];
              for (let i = 0; i < gamesWithPreviousTeam.length; i += batchSize) {
                gameBatches.push(gamesWithPreviousTeam.slice(i, i + batchSize));
              }
              
              const statsByGameId: BallDontLieStats[] = [];
              for (const batch of gameBatches) {
                try {
                  const gameIdsStr = batch.join(',');
                  const url = `/api/stats?player_id=${playerId}&game_ids=${gameIdsStr}&per_page=100&max_pages=1`;
                  const requestId = `stats-${playerId}-games-${batch[0]}`;
                  const r = await queuedFetch(url, {}, requestId);
                  const j = await r.json().catch(() => ({}));
                  const batchStats = (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
                  
                  // Filter to only include stats with actual minutes/data
                  const validStats = batchStats.filter(s => {
                    const min = parseMin(s.min || '');
                    return min > 0 || (s.pts > 0 || s.reb > 0 || s.ast > 0);
                  });
                  
                  statsByGameId.push(...validStats);
                  console.log(`[fetchSortedStatsCore] 🔧 Fetched ${validStats.length} valid stats from ${batch.length} games`);
                } catch (error: any) {
                  console.warn(`[fetchSortedStatsCore] ⚠️ Error fetching stats by game_id for batch:`, error?.message || error);
                }
              }
              
              if (statsByGameId.length > 0) {
                console.log(`[fetchSortedStatsCore] ✅ Successfully fetched ${statsByGameId.length} stats by game_id (workaround for API data quality issue)`);
                // Replace the invalid stats with the valid ones we fetched
                return statsByGameId;
              } else {
                console.warn(`[fetchSortedStatsCore] ⚠️ No valid stats found when querying by game_id`);
              }
            }
          }
        }
        
        return stats;
      } catch (error: any) {
        if (error?.status === 429) {
          console.warn(`[fetchSortedStatsCore] Rate limited for ${url}, returning empty array`);
          return [];
        }
        throw error;
      }
    };

    const fetchPlayoffs = async () => {
      // Use cache for faster loading - stats API has 8 hour cache
      // Fetch 3-5 pages to get this season and last season (max ~82 games per season = 1 page, but 3-5 pages covers edge cases)
      // This is much faster than fetching 50 pages (5000 games) which was overkill
      // OPTIMIZATION: Skip DvP on initial load for faster chart rendering (DvP fetched in background via useDvpRankPrefetch)
      const url = `/api/stats?player_id=${playerId}&season=${yr}&per_page=100&max_pages=5&postseason=true&skip_dvp=1`;
      const requestId = `stats-${playerId}-${yr}-po`;
      try {
        const r = await queuedFetch(url, {}, requestId);
        const j = await r.json().catch(() => ({}));
        return (Array.isArray(j?.data) ? j.data : []) as BallDontLieStats[];
      } catch (error: any) {
        if (error?.status === 429) {
          console.warn(`[fetchSortedStatsCore] Rate limited for ${url}, returning empty array`);
          return [];
        }
        throw error;
      }
    };

    // Fetch both in parallel (request queue will handle concurrency)
    const [regular, playoffs] = await Promise.all([
      fetchRegular(),
      fetchPlayoffs()
    ]);

    return [...regular, ...playoffs];
  };

  // OPTIMIZATION: For faster initial render, return current season immediately
  // Last season can load in background and update playerStats incrementally
  // This reduces initial load time from ~6s to ~3s
  if (selectedTimeframe === 'last10') {
    // Fetch current season first (for immediate chart rendering)
    const currSeason = await grabSeason(season);
    console.log(`[fetchSortedStatsCore] Current season loaded for last10: ${currSeason.length} games`);
    
    // Start fetching last season in background (don't await)
    const prevSeasonPromise = grabSeason(season - 1).catch(err => {
      console.error('[fetchSortedStatsCore] Error fetching last season:', err);
      return [];
    });
    
    // Return current season immediately - chart can render with this
    // Last season will be merged in via incremental update
    const rows = currSeason;
    console.log(`[fetchSortedStatsCore] Returning current season immediately (${currSeason.length} games), last season loading in background`);
    
    // Store promise for incremental update (if caller supports it)
    (rows as any)._prevSeasonPromise = prevSeasonPromise;
    
    // Last season will be analyzed when it loads in background
    // For now, return current season immediately for fast chart rendering
    return rows;
  }
  
  // OPTIMIZATION: For faster initial render, return current season immediately
  // Last season can load in background and update playerStats incrementally
  const currSeason = await grabSeason(season);
  console.log(`[fetchSortedStatsCore] Current season loaded for ${selectedTimeframe}: ${currSeason.length} games`);
  
  // Start fetching last season in background (don't await)
  const prevSeasonPromise = grabSeason(season - 1).catch(err => {
    console.error('[fetchSortedStatsCore] Error fetching last season:', err);
    return [];
  });
  
  // Return current season immediately - chart can render with this
  const rows = currSeason;
  console.log(`[fetchSortedStatsCore] Returning current season immediately (${currSeason.length} games), last season loading in background`);
  
  // Store promise for incremental update (if caller supports it)
  (rows as any)._prevSeasonPromise = prevSeasonPromise;
  
  // Debug: Check last season stats when promise resolves (in background)
  prevSeasonPromise.then((prevSeason: any[]) => {
    if (prevSeason && prevSeason.length > 0) {
      const currentSeason = currentNbaSeason();
      const lastSeason = currentSeason - 1;
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
      
      const teams = new Set(prevSeason.map(s => s?.team?.abbreviation).filter(Boolean));
      const withMinutes = prevSeason.filter(s => {
        const min = parseMin(s.min || '');
        return min > 0;
      });
      const teamsWithMinutes = new Set(withMinutes.map(s => s?.team?.abbreviation).filter(Boolean));
      
      console.log(`[fetchSortedStatsCore] Last season (${lastSeason}) analysis: total=${prevSeason.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}, teamsWithMinutes=${Array.from(teamsWithMinutes).join(',')}`);
      
      if (prevSeason.length > 0 && withMinutes.length === 0) {
        const sample = prevSeason.slice(0, 5).map(s => ({
          date: s.game?.date,
          team: s.team?.abbreviation,
          min: s.min,
          pts: s.pts,
          reb: s.reb
        }));
        console.log(`[fetchSortedStatsCore] ⚠️ All last season stats have 0 minutes! Sample:`, sample);
      }
    }
  }).catch(() => {});
  
  // Debug: log season breakdown to help diagnose filtering issues
  if (rows.length > 0) {
    const currentSeason = currentNbaSeason();
    const getSeasonYear = (stat: any) => {
      if (!stat.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    const currentSeasonCount = rows.filter(s => getSeasonYear(s) === currentSeason).length;
    const lastSeasonCount = rows.filter(s => getSeasonYear(s) === currentSeason - 1).length;
    
    // Log sample dates from each season to verify they're being included
    const currentSeasonSample = rows.filter(s => getSeasonYear(s) === currentSeason).slice(0, 3).map(s => ({
      date: s.game?.date,
      min: s.min
    }));
    const lastSeasonSample = rows.filter(s => getSeasonYear(s) === currentSeason - 1).slice(0, 3).map(s => ({
      date: s.game?.date,
      min: s.min
    }));
    
    console.log(`[fetchSortedStatsCore] Season breakdown: current (${currentSeason}): ${currentSeasonCount} games, last (${currentSeason - 1}): ${lastSeasonCount} games, total: ${rows.length}`, {
      currSeasonLength: currSeason.length,
      currentSeasonSample,
      lastSeasonSample
    });
  }
  
  // Check stat coverage across all rows
    const statCoverage = {
      hasPts: rows.filter(s => s.pts !== undefined && s.pts !== null).length,
      hasReb: rows.filter(s => s.reb !== undefined && s.reb !== null).length,
      hasAst: rows.filter(s => s.ast !== undefined && s.ast !== null).length,
      hasStl: rows.filter(s => s.stl !== undefined && s.stl !== null).length,
      hasBlk: rows.filter(s => s.blk !== undefined && s.blk !== null).length,
      hasFg3m: rows.filter(s => s.fg3m !== undefined && s.fg3m !== null).length,
    };
    console.log(`[fetchSortedStatsCore] Stat coverage across ${rows.length} stats:`, statCoverage);
  }
  
  const safe = rows.filter(s => s && (s?.game?.date || s?.team?.abbreviation));
  
  // Debug: log if we're filtering out all stats
  if (rows.length > 0 && safe.length === 0) {
    console.warn('[fetchSortedStatsCore] All stats filtered out! Sample stat structure:', {
      totalRows: rows.length,
      sampleStat: rows[0],
      hasGame: !!rows[0]?.game,
      hasGameDate: !!rows[0]?.game?.date,
      hasTeam: !!rows[0]?.team,
      hasTeamAbbr: !!rows[0]?.team?.abbreviation,
    });
  } else if (rows.length > 0) {
    console.log('[fetchSortedStatsCore] Filtered stats:', {
      totalRows: rows.length,
      safeRows: safe.length,
      filteredOut: rows.length - safe.length,
    });
  }
  
  safe.sort((a, b) => {
    const da = a?.game?.date ? new Date(a.game.date).getTime() : 0;
    const db = b?.game?.date ? new Date(b.game.date).getTime() : 0;
    return db - da; // newest first
  });
  
  // Debug: Log final return value to see what's being returned
  if (safe.length > 0) {
    const currentSeason = currentNbaSeason();
    const getSeasonYear = (stat: any) => {
      if (!stat.game?.date) return null;
      const d = new Date(stat.game.date);
      const y = d.getFullYear();
      const m = d.getMonth();
      return m >= 9 ? y : y - 1;
    };
    const finalCurrentSeasonCount = safe.filter(s => getSeasonYear(s) === currentSeason).length;
    const finalLastSeasonCount = safe.filter(s => getSeasonYear(s) === currentSeason - 1).length;
    
    // Debug: Check team distribution across seasons
    const currentSeasonStats = safe.filter(s => getSeasonYear(s) === currentSeason);
    const lastSeasonStats = safe.filter(s => getSeasonYear(s) === currentSeason - 1);
    const currentSeasonTeams = new Set(currentSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
    const lastSeasonTeams = new Set(lastSeasonStats.map(s => s?.team?.abbreviation).filter(Boolean));
    
    console.log(`[fetchSortedStatsCore] FINAL RETURN: returning ${safe.length} stats (current: ${finalCurrentSeasonCount}, last: ${finalLastSeasonCount})`);
    console.log(`[fetchSortedStatsCore] Team distribution - Current season teams: ${Array.from(currentSeasonTeams).join(', ') || 'none'}, Last season teams: ${Array.from(lastSeasonTeams).join(', ') || 'none'}`);
  }
  
  return safe;
}

