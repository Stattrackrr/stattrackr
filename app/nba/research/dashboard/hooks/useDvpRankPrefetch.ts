import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { parseMinutes } from '../utils/playerUtils';
import { getStableGameId } from '../utils/allGamesSecondAxisDataUtils';
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
  const filteredChartDataRef = useRef<any[]>([]);
  const playerStatsRef = useRef<any[]>([]);
  filteredChartDataRef.current = filteredChartData;
  playerStatsRef.current = playerStats;

  // Clear DvP ranks when player changes so we never render new player with previous player's ranks
  // (useLayoutEffect runs before paint, so we avoid showing "a few games" from stale rank lookups)
  const playerId = selectedPlayer?.id?.toString() ?? null;
  useLayoutEffect(() => {
    setDvpRanksPerGame({});
  }, [playerId, setDvpRanksPerGame]);

  // Prefetch DvP ranks in background for all possible stat/position combinations
  // Use ALL playerStats (not adjustedChartData) to ensure ranks are available for all games
  useEffect(() => {
    if (propsMode !== 'player' || !playerStats.length || !selectedStat) {
      return;
    }
    
    if (!selectedPosition) {
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

    // Include playerId so we never reuse another player's DvP ranks (fixes "few teams" on first load after search)
    const playerId = selectedPlayer?.id?.toString() ?? 'none';
    const prefetchKey = `${playerId}:${selectedPosition}:${dvpMetric}`;

    if (dvpRanksPrefetchRef.current.has(prefetchKey)) {
      return;
    }
    if (prefetchedDvpRanks[prefetchKey]) {
      dvpRanksPrefetchRef.current.add(prefetchKey);
      return;
    }
    dvpRanksPrefetchRef.current.add(prefetchKey);

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
            
            const gameIdStr = getStableGameId(stats);
            const gameDate = stats?.game?.date || '';
            
            return { gameIdStr, opponent, gameDate, stats };
          });
        
        // Fetch snapshots (historical) and live (batch) ranks in parallel so we always have full data on first load
        const currentRanksPromise: Promise<Record<string, number>> = cachedFetch<any>(
          `/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`,
          undefined,
          60 * 60 * 1000
        ).then(data => (data?.metrics?.[dvpMetric] as Record<string, number>) || {}).catch((): Record<string, number> => ({}));

        const rankPromises = gamesToProcess.map(async ({ gameIdStr, opponent, gameDate }) => {
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          if (!gameDate) {
            return { gameIdStr, rank: null, useCurrent: true };
          }
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalData = await cachedFetch<any>(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`,
              undefined,
              60 * 60 * 1000
            );
            if (historicalData?.success && historicalData.ranks) {
              const normalizedOpp = normalizeAbbr(opponent);
              const rank = historicalData.ranks[normalizedOpp] ?? historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
              if (rank && rank > 0) return { gameIdStr, rank };
            }
          } catch {
            // ignore
          }
          return { gameIdStr, rank: null, useCurrent: true };
        });

        const [rankResults, currentRanks] = await Promise.all([Promise.all(rankPromises), currentRanksPromise]);

        if (!isMounted) return;

        // Merge: use snapshot (historical) when available, else live (current) so every game has a rank
        rankResults.forEach((result, index) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
          } else {
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
        
        // Store prefetched data (key includes playerId so switching players doesn't reuse wrong data)
        const storeKey = `${playerId}:${selectedPosition}:${dvpMetric}`;
        setPrefetchedDvpRanks(prev => ({
          ...prev,
          [storeKey]: ranksByGame,
        }));
      } catch (error) {
        // Silent fail for prefetch
      }
    };

    prefetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playerStats, propsMode, selectedPosition, selectedStat, selectedPlayer?.id, playerTeamRoster]);

  // Use prefetched DvP ranks when dvp_rank filter is selected
  useEffect(() => {
    if (!selectedFilterForAxis || propsMode !== 'player') {
      setDvpRanksPerGame({});
      return;
    }

    if (selectedFilterForAxis === 'dvp_rank') {
      // Need player position and selected stat to get the right prefetched data
      if (!selectedPosition || !selectedStat) {
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

      // Same key as prefetch: include playerId so we never use another player's ranks
      const prefetchKey = `${playerId ?? 'none'}:${selectedPosition}:${dvpMetric}`;
      const prefetched = prefetchedDvpRanks[prefetchKey];

      if (prefetched) {
        setDvpRanksPerGame(prefetched);
      } else {
        setDvpRanksPerGame({});
      }
    } else {
      setDvpRanksPerGame({});
    }
  }, [selectedFilterForAxis, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks, playerId, setDvpRanksPerGame]);

  // Legacy fetch DvP ranks (kept for backward compatibility, but should use prefetched data)
  // Use a ref for filteredChartData to avoid re-running when it changes due to setDvpRanksPerGame
  // (which would cause: dvpRanksPerGame -> allGamesSecondAxisData -> filteredChartData -> this effect -> loop)
  useEffect(() => {
    const data = filteredChartDataRef.current;
    const stats = playerStatsRef.current;
    if (selectedFilterForAxis !== 'dvp_rank' || propsMode !== 'player') {
      return;
    }

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
    if (!dvpMetric) return;

    const currentPlayerId = selectedPlayer?.id?.toString() ?? 'none';
    const prefetchKey = `${currentPlayerId}:${selectedPosition}:${dvpMetric}`;
    const prefetched = prefetchedDvpRanks[prefetchKey];
    if (prefetched) {
      const hasValidValues = Object.values(prefetched).some(v => v !== null && v !== undefined);
      if (hasValidValues) return;
    }

    // When filtered chart data is empty (no ranks yet), build game list from all playerStats so we still fetch
    type GameForFetch = { gameIdStr: string; opponent: string; gameDate: string };
    const gamesToFetch: GameForFetch[] = data.length > 0
      ? data.map((game: any) => ({
          gameIdStr: game.xKey || String(game.game?.id || game.stats?.game?.id || ''),
          opponent: game.opponent || game.tickLabel || '',
          gameDate: game.date || game.stats?.game?.date || '',
        }))
      : (stats || [])
          .filter((s: any) => parseMinutes(s.min) > 0)
          .map((s: any) => {
            let playerTeam = s?.team?.abbreviation || selectedPlayer?.teamAbbr || '';
            const homeTeamId = s?.game?.home_team?.id ?? (s?.game as any)?.home_team_id;
            const visitorTeamId = s?.game?.visitor_team?.id ?? (s?.game as any)?.visitor_team_id;
            const homeTeamAbbr = s?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
            const visitorTeamAbbr = s?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
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
            return { gameIdStr: getStableGameId(s), opponent, gameDate: s?.game?.date || '' };
          });

    if (gamesToFetch.length === 0) return;

    let isMounted = true;
    const fetchDvpRanks = async () => {
      try {
        const ranksByGame: Record<string, number | null> = {};
        // Fetch snapshots (historical) and live (batch) in parallel so initial load has full data
        const currentRanksPromise: Promise<Record<string, number>> = cachedFetch<any>(
          `/api/dvp/rank/batch?pos=${selectedPosition}&metrics=${dvpMetric}&games=82`,
          undefined,
          60 * 60 * 1000
        ).then(data => (data?.metrics?.[dvpMetric] as Record<string, number>) || {}).catch((): Record<string, number> => ({}));

        const rankPromises = gamesToFetch.map(async ({ gameIdStr, opponent, gameDate }) => {
          if (!opponent || opponent === 'N/A' || opponent === 'ALL' || opponent === '') {
            return { gameIdStr, rank: null };
          }
          if (!gameDate) {
            return { gameIdStr, rank: null, useCurrent: true };
          }
          try {
            const dateStr = new Date(gameDate).toISOString().split('T')[0];
            const historicalData = await cachedFetch<any>(
              `/api/dvp/rank/historical?date=${dateStr}&pos=${selectedPosition}&metric=${dvpMetric}`,
              undefined,
              24 * 60 * 60 * 1000
            );
            if (historicalData?.success && historicalData.ranks && Object.keys(historicalData.ranks).length > 0) {
              const normalizedOpp = normalizeAbbr(opponent);
              const rank = historicalData.ranks[normalizedOpp] ?? historicalData.ranks[normalizedOpp.toUpperCase()] ?? null;
              if (rank && rank > 0) return { gameIdStr, rank };
            }
          } catch {
            // ignore
          }
          return { gameIdStr, rank: null, useCurrent: true };
        });

        const [rankResults, currentRanks] = await Promise.all([Promise.all(rankPromises), currentRanksPromise]);

        if (!isMounted) return;

        // Merge: snapshot when available, else live so every game has a rank
        rankResults.forEach((result) => {
          if (result.rank !== null) {
            ranksByGame[result.gameIdStr] = result.rank;
          } else if (result.useCurrent) {
            const item = gamesToFetch.find(g => g.gameIdStr === result.gameIdStr);
            const opponent = item?.opponent ?? '';
            if (opponent && opponent !== 'N/A' && opponent !== 'ALL' && opponent !== '') {
              const normalizedOpp = normalizeAbbr(opponent);
              let rank = currentRanks[normalizedOpp] ?? currentRanks[normalizedOpp.toUpperCase()] ?? currentRanks[normalizedOpp.toLowerCase()] ?? null;
              if (rank === null || rank === undefined) {
                const matchingKey = Object.keys(currentRanks).find(key =>
                  key.toUpperCase() === normalizedOpp.toUpperCase() ||
                  normalizedOpp.toUpperCase().includes(key.toUpperCase()) ||
                  key.toUpperCase().includes(normalizedOpp.toUpperCase())
                );
                if (matchingKey) rank = currentRanks[matchingKey];
              }
              ranksByGame[result.gameIdStr] = typeof rank === 'number' && rank > 0 ? rank : null;
            } else {
              ranksByGame[result.gameIdStr] = null;
            }
          } else {
            ranksByGame[result.gameIdStr] = null;
          }
        });
        
        setDvpRanksPerGame(ranksByGame);
      } catch (error) {
        if (isMounted) {
          setDvpRanksPerGame({});
        }
      }
    };

    fetchDvpRanks();
    
    return () => {
      isMounted = false;
    };
  }, [selectedFilterForAxis, propsMode, selectedPosition, selectedStat, prefetchedDvpRanks, setDvpRanksPerGame]);
}

