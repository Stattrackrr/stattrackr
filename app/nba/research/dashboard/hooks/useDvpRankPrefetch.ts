import { useEffect, useRef, useState } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { parseMinutes } from '../utils/playerUtils';
import { TEAM_ID_TO_ABBR, ABBR_TO_TEAM_ID } from '../utils/teamUtils';
import { cachedFetch } from '@/lib/requestCache';

export interface UseDvpRankPrefetchParams {
  propsMode: 'player' | 'team';
  playerStats: any[];
  selectedPosition: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  selectedStat: string;
  selectedPlayer: any;
  selectedFilterForAxis: string | null;
  filteredChartData: any[];
  playerTeamRoster: any;
  setDvpRanksPerGame: (ranks: Record<string, number | null>) => void;
}

/**
 * Custom hook to handle DvP rank prefetching and fetching
 */
export function useDvpRankPrefetch({
  propsMode,
  playerStats,
  selectedPosition,
  selectedStat,
  selectedPlayer,
  selectedFilterForAxis,
  filteredChartData,
  playerTeamRoster,
  setDvpRanksPerGame,
}: UseDvpRankPrefetchParams) {
  const [prefetchedDvpRanks, setPrefetchedDvpRanks] = useState<Record<string, Record<string, number | null>>>({});
  const dvpRanksPrefetchRef = useRef<Set<string>>(new Set());

  // Prefetch DvP ranks in background for all possible stat/position combinations
  // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats.length || !selectedStat) {
      if (propsMode === 'player' && playerStats.length && !selectedPosition) {
        console.log('[DvP Rank Prefetch] Waiting for selectedPosition to be determined...', {
          playerName: selectedPlayer?.full,
          hasPlayerStats: playerStats.length > 0,
          hasRoster: !!playerTeamRoster
        });
      }
      return;
    }
    
    if (!selectedPosition) {
      console.log('[DvP Rank Prefetch] Skipping - selectedPosition is null', {
        playerName: selectedPlayer?.full,
        hasPlayerStats: playerStats.length > 0
      });
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Use a ref to track if we've already started prefetching for this combination
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    
    if (dvpRanksPrefetchRef.current.has(prefetchKey)) {
      // Already prefetching or prefetched for this combination
      return;
    }

    // Check if we already have prefetched data
    if (prefetchedDvpRanks[prefetchKey]) {
      // Already prefetched, mark as done
      dvpRanksPrefetchRef.current.add(prefetchKey);
      return;
    }

    // Mark as prefetching
    dvpRanksPrefetchRef.current.add(prefetchKey);
    
    console.log('[DvP Rank Prefetch] Starting prefetch', {
      prefetchKey,
      selectedPosition,
      selectedStat,
      dvpMetric,
      playerStatsCount: playerStats.length,
      playerName: selectedPlayer?.full
    });

    // Prefetch in background (don't block UI)
    let isMounted = true;
    const prefetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
        const ranksByGame: Record<string, number | null> = {};
        
        // Build game data from playerStats (all games, not filtered by timeframe)
        const gamesToProcess = playerStats
          .filter((stats: any) => {
            // Only include games where player played (same filter as baseGameData)
            const minutes = parseMinutes(stats.min);
            return minutes > 0;
          })
          .map((stats: any) => {
            // Extract opponent and game info from stats
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
            
            const numericGameId = typeof stats?.game?.id === 'number' ? stats.game.id : null;
            const gameIdStr = String(numericGameId || '');
            const gameDate = stats?.game?.date || '';
            
            return { gameIdStr, opponent, gameDate, stats };
          });
        
        // Fetch historical ranks for each game
        const rankPromises = gamesToProcess.map(async ({ gameIdStr, opponent, gameDate }) => {
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalData = await cachedFetch<any>(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`,
              undefined,
              60 * 60 * 1000 // Cache for 1 hour
            );
            
            if (historicalData) {
              if (historicalData.success && historicalData.ranks) {
                const normalizedOpp = normalizeAbbr(opponent);
                const rank = historicalData.ranks[normalizedOpp] ?? 
                            historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
                if (rank && rank > 0) {
                  return { gameIdStr, rank };
                }
                // If historical lookup returned empty, fall through to current ranks
              } else {
                console.log(`[Prefetch] Historical API returned no ranks for ${dateStr} ${selectedPosition}:${dvpMetric}`, {
                  success: historicalData.success,
                  hasRanks: !!historicalData.ranks,
                  note: historicalData.note
                });
              }
            }
          } catch (historicalError) {
            console.warn(`[Prefetch] Historical fetch failed for ${gameIdStr}:`, historicalError);
          }
          
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        // Also check if historical lookups returned any valid ranks
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        const hasHistoricalRanks = rankResults.some(r => r.rank !== null);
        let currentRanks: Record<string, number> = {};
        
        // If no historical ranks were found, fetch current ranks for all games as fallback
        const shouldFetchCurrent = needsCurrentRanks || !hasHistoricalRanks;
        
        if (shouldFetchCurrent) {
          try {
            const currentData = await cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`,
              undefined,
              60 * 60 * 1000 // Cache for 60 minutes
            );
            if (currentData) {
              currentRanks = currentData.metrics?.[dvpMetric] || {};
              console.log(`[Prefetch] Fetched current ranks for ${selectedPosition}:${dvpMetric}:`, {
                rankCount: Object.keys(currentRanks).length,
                sampleTeams: Object.keys(currentRanks).slice(0, 5),
                reason: !hasHistoricalRanks ? 'No historical ranks found, using current as fallback' : 'Some games need current ranks'
              });
            }
          } catch (error) {
            console.error(`[Prefetch] Failed to fetch current ranks:`, error);
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result, index) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
              } else {
            // Try to use current ranks as fallback
            const gameData = gamesToProcess[index];
            if (gameData && gameData.opponent && gameData.opponent !== 'N/A' && gameData.opponent !== 'ALL' && gameData.opponent !== '') {
              const normalizedOpp = normalizeAbbr(gameData.opponent);
              // Try multiple variations of the team abbreviation
              let rank = currentRanks[normalizedOpp] ?? 
                        currentRanks[normalizedOpp.toUpperCase()] ?? 
                        currentRanks[normalizedOpp.toLowerCase()] ?? null;
              
              // If still not found, try to find a partial match
              if (rank === null || rank === undefined) {
                const matchingKey = Object.keys(currentRanks).find(key => 
                  key.toUpperCase() === normalizedOpp.toUpperCase() ||
                  normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                  key.toUpperCase().includes(normalizedOpp.toUpperCase())
                );
                if (matchingKey) {
                  rank = currentRanks[matchingKey];
                }
              }
              
              ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
          } else {
            ranksByGame[result.gameIdStr] = null;
            }
          }
        });
        
        // Store prefetched data
        const ranksWithValues = Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined);
        const sampleRanksWithValues = ranksWithValues.slice(0, 5);
        const sampleRanksNull = Object.entries(ranksByGame).filter(([_, rank]) => rank === null).slice(0, 5);
        
        console.log(`[DvP Rank Prefetch] Stored ranks for ${prefetchKey}:`, {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: ranksWithValues.length,
          sampleRanksWithValues,
          sampleRanksNull,
          sampleGameIds: Object.keys(ranksByGame).slice(0, 10)
        });
        setPrefetchedDvpRanks(prev => ({
          ...prev,
          [prefetchKey]: ranksByGame,
        }));
      } catch (error) {
        // Silent fail for prefetch
        console.error('[Prefetch] Error prefetching DvP ranks:', error);
      }
    };

    prefetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerStats, propsMode, selectedPosition, selectedStat, selectedPlayer?.id, playerTeamRoster]);

  // Use prefetched DvP ranks when dvp_rank filter is selected
  // Only depend on player ID, not the whole object, to prevent recalculation on metadata updates
  const playerId = selectedPlayer?.id?.toString() || null;
  
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setDvpRanksPerGame({});
      return;
    }

    if (selectedFilterForAxis === 'dvp_rank') {
      // Need player position and selected stat to get the right prefetched data
      if (!selectedPosition || !selectedStat) {
        console.log('[DvP Rank] Cannot use ranks - missing data:', {
          hasPosition: !!selectedPosition,
          hasStat: !!selectedStat,
          selectedPosition,
          selectedStat,
          playerName: selectedPlayer?.full
        });
        setDvpRanksPerGame({});
        return;
      }

      const statToDvpMetric: Record<string, string> = {
        'pts': 'pts',
        'reb': 'reb',
        'ast': 'ast',
        'fg3m': 'fg3m',
        'stl': 'stl',
        'blk': 'blk',
        'to': 'to',
        'fg_pct': 'fg_pct',
        'pra': 'pra',
        'pr': 'pr',
        'pa': 'pa',
        'ra': 'ra',
      };
      
      const dvpMetric = statToDvpMetric[selectedStat];
      if (!dvpMetric) {
        setDvpRanksPerGame({});
        return;
      }

      const prefetchKey = `${selectedPosition}:${dvpMetric}`;
      const prefetched = prefetchedDvpRanks[prefetchKey];
      
      if (prefetched) {
        // Use prefetched data immediately
        console.log(`[DvP Rank] Using prefetched data for ${prefetchKey}:`, {
          gameCount: Object.keys(prefetched).length,
          sampleRanks: Object.entries(prefetched).slice(0, 5),
          sampleGameIds: Object.keys(prefetched).slice(0, 5),
          ranksWithValues: Object.entries(prefetched).filter(([_, rank]) => rank !== null && rank !== undefined).length
        });
        setDvpRanksPerGame(prefetched);
      } else {
        // Fallback to empty (will trigger legacy fetch if needed)
        console.log(`[DvP Rank] No prefetched data for ${prefetchKey}, waiting for prefetch...`, {
          availableKeys: Object.keys(prefetchedDvpRanks),
          selectedPosition,
          dvpMetric,
          prefetchKey
        });
        setDvpRanksPerGame({});
      }
    } else {
      setDvpRanksPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks, playerId, setDvpRanksPerGame]);

  // Legacy fetch DvP ranks (kept for backward compatibility, but should use prefetched data)
  // Use filteredChartData to match what's actually displayed
  useEffect(() => {
    if (selectedFilterForAxis !== 'dvp_rank' || propsMode !== 'player' || !filteredChartData.length) {
      return;
    }

    // Need player position and selected stat to fetch DvP ranks
    if (!selectedPosition || !selectedStat) {
      return;
    }

    // Map selected stat to DvP metric
    const statToDvpMetric: Record<string, string> = {
      'pts': 'pts',
      'reb': 'reb',
      'ast': 'ast',
      'fg3m': 'fg3m',
      'stl': 'stl',
      'blk': 'blk',
      'to': 'to',
      'fg_pct': 'fg_pct',
      'pra': 'pra',
      'pr': 'pr',
      'pa': 'pa',
      'ra': 'ra',
    };
    
    const dvpMetric = statToDvpMetric[selectedStat];
    if (!dvpMetric) {
      return;
    }

    // Check if we already have prefetched data with valid values
    const prefetchKey = `${selectedPosition}:${dvpMetric}`;
    const prefetched = prefetchedDvpRanks[prefetchKey];
    if (prefetched) {
      // Check if prefetched data has any valid (non-null) values
      const hasValidValues = Object.values(prefetched).some(v => v !== null && v !== undefined);
      if (hasValidValues) {
        // Already have prefetched data with valid values, skip fetch
        console.log('[DvP Rank Legacy] Skipping - prefetched data has valid values');
      return;
      }
      // Prefetched data exists but all values are null - still fetch to try to get data
      console.log('[DvP Rank Legacy] Prefetched data exists but all values are null, fetching...');
    }

    let isMounted = true;
    const fetchDvpRanks = async () => {
      try {
        // Map ranks to game IDs based on opponent team and game date
        const ranksByGame: Record<string, number | null> = {};
        
        // Fetch historical ranks for each game - use filteredChartData to match displayed games
        const rankPromises = filteredChartData.map(async (game: any) => {
          const gameIdStr = game.xKey || String(game.game?.id || game.stats?.game?.id || '');
          const opponent = game.opponent || game.tickLabel || '';
          const gameDate = game.date || game.stats?.game?.date || '';
          
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          
          if (!gameDate) {
            // If no game date, fallback to current ranks
            return { gameIdStr, rank: null, useCurrent: true };
          }
          
          // Try to fetch historical rank for this game date
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalData = await cachedFetch<any>(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`,
              undefined,
              24 * 60 * 60 * 1000 // Cache for 24 hours (historical data doesn't change)
            );
            
            if (historicalData && historicalData.success && historicalData.ranks && Object.keys(historicalData.ranks).length > 0) {
              const normalizedOpp = normalizeAbbr(opponent);
              const rank = historicalData.ranks[normalizedOpp] ?? 
                          historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
              // Only return rank if it's not 0 (0 means no data)
              if (rank && rank > 0) {
                return { gameIdStr, rank };
              }
            }
            // If historical API returned empty ranks or no match, fall through to use current ranks
          } catch (historicalError) {
            console.warn(`[Second Axis] Failed to fetch historical rank for game ${gameIdStr}:`, historicalError);
          }
          
          // Fallback: use current ranks if historical lookup fails
          return { gameIdStr, rank: null, useCurrent: true };
        });
        
        const rankResults = await Promise.all(rankPromises);
        
        // Check if we need to fetch current ranks for any games
        const needsCurrentRanks = rankResults.some(r => r.useCurrent);
        let currentRanks: Record<string, number> = {};
        
        if (needsCurrentRanks) {
          // Fetch current DvP ranks as fallback
          console.log('[DvP Rank Legacy] Fetching current ranks...', { selectedPosition, dvpMetric });
          const currentData = await cachedFetch<any>(
            `/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`,
            undefined,
            60 * 60 * 1000 // Cache for 60 minutes
          );
          
          if (currentData) {
            currentRanks = currentData.metrics?.[dvpMetric] || {};
            console.log('[DvP Rank Legacy] Current ranks response:', {
              hasMetrics: !!currentData.metrics,
              hasDvpMetric: !!currentData.metrics?.[dvpMetric],
              rankCount: Object.keys(currentRanks).length,
              sampleTeams: Object.keys(currentRanks).slice(0, 10),
              sampleRanks: Object.entries(currentRanks).slice(0, 5)
            });
          }
        }
        
        if (!isMounted) return;
        
        // Map ranks to games
        rankResults.forEach((result) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
          } else if (result.useCurrent) {
            // Use current rank as fallback
            const game = filteredChartData.find((g: any) => {
              const gameIdStr = g.xKey || String(g.game?.id || g.stats?.game?.id || '');
              return gameIdStr === result.gameIdStr;
            });
            
            if (game) {
              const opponent = game.opponent || game.tickLabel || '';
              if (opponent && opponent !== 'N/A' && opponent !== 'ALL' && opponent !== '') {
                const normalizedOpp = normalizeAbbr(opponent);
                // Try multiple variations
                let rank = currentRanks[normalizedOpp] ?? 
                          currentRanks[normalizedOpp.toUpperCase()] ?? 
                          currentRanks[normalizedOpp.toLowerCase()] ?? null;
                
                // If still not found, try partial match
                if (rank === null || rank === undefined) {
                  const matchingKey = Object.keys(currentRanks).find(key => 
                    key.toUpperCase() === normalizedOpp.toUpperCase() ||
                    normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                    key.toUpperCase().includes(normalizedOpp.toUpperCase())
                  );
                  if (matchingKey) {
                    rank = currentRanks[matchingKey];
                  }
                }
                
                ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
                
                // Log when we can't find a match
                if (rank === null || rank === undefined) {
                  console.log('[DvP Rank Legacy] No rank found for opponent:', {
                    gameIdStr: result.gameIdStr,
                    opponent,
                    normalizedOpp,
                    availableTeams: Object.keys(currentRanks).slice(0, 10)
                  });
                }
              } else {
                ranksByGame[result.gameIdStr] = null;
              }
            } else {
              ranksByGame[result.gameIdStr] = null;
            }
          } else {
            ranksByGame[result.gameIdStr] = null;
          }
        });
        
        console.log('[DvP Rank Legacy] Fetched ranks:', {
          gameCount: Object.keys(ranksByGame).length,
          ranksWithValues: Object.entries(ranksByGame).filter(([_, rank]) => rank !== null && rank !== undefined).length,
          sampleRanks: Object.entries(ranksByGame).slice(0, 5),
          sampleGamesWithOpponents: filteredChartData.slice(0, 3).map((g: any) => ({
            gameId: g.xKey || String(g.game?.id || g.stats?.game?.id || ''),
            opponent: g.opponent || g.tickLabel || 'N/A'
          }))
        });
        setDvpRanksPerGame(ranksByGame);
      } catch (error) {
        console.error('[Second Axis] Error fetching DvP ranks:', error);
        if (isMounted) {
          setDvpRanksPerGame({});
        }
      }
    };

    fetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, filteredChartData, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks, setDvpRanksPerGame]);
}

