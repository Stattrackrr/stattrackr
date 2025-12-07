'use client';

import React, { useState, useEffect, useRef } from 'react';

interface SimilarPlayerData {
  playerId: number;
  playerName: string;
  gameDate: string;
  opponent: string;
  playerTeam?: string; // Player's team abbreviation
  headshotUrl?: string | null; // Player headshot URL
  statType: string;
  line: number | null;
  overOdds: string | null;
  underOdds: string | null;
  actual: number;
  similarityScore: number;
  heightDiff: number;
  playerHeight?: number | null; // Actual player height in inches
  playTypeMatches: number;
  minutesDiff: number | null;
}

interface SimilarPlayersProps {
  playerId: string | number | null;
  opponent: string;
  statType: string;
  isDark?: boolean;
}

// Module-level cache to persist across component unmounts/remounts
const similarPlayersCache = new Map<string, {
  data: SimilarPlayerData[];
  timestamp: number;
}>();

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache TTL

function getCacheKey(playerId: number, opponent: string, statType: string): string {
  return `${playerId}:${opponent}:${statType}`;
}

export function SimilarPlayers({ playerId, opponent, statType, isDark = false }: SimilarPlayersProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SimilarPlayerData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // Validate playerId - must be a valid number
    const playerIdNum = playerId ? (typeof playerId === 'string' ? parseInt(playerId, 10) : Number(playerId)) : null;
    if (!playerIdNum || isNaN(playerIdNum) || playerIdNum <= 0) {
      setData([]);
      setError(null);
      setLoading(false);
      return;
    }
    
    if (!opponent || opponent === 'ALL' || opponent === 'N/A') {
      setData([]);
      setLoading(false);
      return;
    }

    // Check cache first
    const cacheKey = getCacheKey(playerIdNum, opponent, statType);
    const cached = similarPlayersCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      // Use cached data - no loading state needed
      console.log(`[SimilarPlayers] Using cached data for ${cacheKey}`);
      setData(cached.data);
      setError(null);
      setLoading(false);
      return;
    }

    // Abort any previous request
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const fetchSimilarPlayers = async () => {
      // Create new abort controller for this request
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setLoading(true);
      setError(null);

      try {
        console.log(`[SimilarPlayers] Fetching similar players for playerId=${playerIdNum}, opponent=${opponent}, statType=${statType}`);
        
        const response = await fetch(
          `/api/similar-players?playerId=${playerIdNum}&opponent=${encodeURIComponent(opponent)}&statType=${statType}`,
          { signal: abortController.signal }
        );

        // Check if request was aborted
        if (abortController.signal.aborted) {
          return;
        }

        if (!response.ok) {
          const errorText = await response.text().catch(() => 'Unknown error');
          let errorMessage = `Failed to fetch similar players (${response.status})`;
          try {
            const errorData = JSON.parse(errorText);
            errorMessage = errorData.error || errorData.message || errorMessage;
          } catch {
            if (errorText) {
              errorMessage = `${errorMessage}: ${errorText.substring(0, 100)}`;
            }
          }
          throw new Error(errorMessage);
        }

        const result = await response.json();
        if (!result.success) {
          throw new Error(result.error || 'Failed to fetch similar players');
        }
        
        const resultData = result.data || [];
        
        // Cache the result
        similarPlayersCache.set(cacheKey, {
          data: resultData,
          timestamp: now
        });
        
        // Check again if request was aborted before setting state
        if (!abortController.signal.aborted) {
          setData(resultData);
        }
      } catch (err: any) {
        // Don't set error if request was aborted
        if (err.name === 'AbortError' || abortController.signal.aborted) {
          return;
        }
        console.error('Error fetching similar players:', err);
        if (!abortController.signal.aborted) {
          setError(err.message || 'Failed to load similar players');
        }
      } finally {
        if (!abortController.signal.aborted) {
          setLoading(false);
        }
      }
    };

    fetchSimilarPlayers();

    // Cleanup: abort request on unmount or dependency change
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [playerId, opponent, statType]);

  // Validate playerId before rendering
  const playerIdNum = playerId ? (typeof playerId === 'string' ? parseInt(playerId, 10) : Number(playerId)) : null;
  if (!playerIdNum || isNaN(playerIdNum) || playerIdNum <= 0 || !opponent || opponent === 'ALL' || opponent === 'N/A') {
    return (
      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'} p-4 text-center`}>
        Select a player and opponent to see similar players
      </div>
    );
  }

  if (loading) {
    return (
      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'} p-4 text-center`}>
        Loading similar players...
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'} p-4 text-center`}>
        Error: {error}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'} p-4 text-center`}>
        No similar players found vs {opponent}
      </div>
    );
  }

  // Group by player (show multiple games per player)
  const groupedByPlayer = data.reduce((acc, item) => {
    const key = item.playerId;
    if (!acc[key]) {
      acc[key] = [];
    }
    acc[key].push(item);
    return acc;
  }, {} as Record<number, SimilarPlayerData[]>);

  const players = Object.entries(groupedByPlayer).map(([playerId, games]) => ({
    playerId: parseInt(playerId),
    playerName: games[0].playerName,
    playerTeam: games[0].playerTeam || '', // Player's team abbreviation
    headshotUrl: games[0].headshotUrl || null, // Player headshot URL
    games: games.sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime()),
    similarityScore: games[0].similarityScore,
    heightDiff: games[0].heightDiff,
    playerHeight: games[0].playerHeight, // Actual player height
    playTypeMatches: games[0].playTypeMatches,
    minutesDiff: games[0].minutesDiff,
    mostRecentDate: games[0].gameDate, // Store most recent date for sorting
  }));

  // Sort by most recent date first, then by similarity score
  players.sort((a, b) => {
    const dateA = new Date(a.mostRecentDate).getTime();
    const dateB = new Date(b.mostRecentDate).getTime();
    if (dateB !== dateA) {
      return dateB - dateA; // Most recent first
    }
    return a.similarityScore - b.similarityScore; // Then by similarity
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get team logo URL (simple ESPN logo URL)
  const getTeamLogoUrl = (teamAbbr: string): string => {
    if (!teamAbbr) return '';
    const normalized = teamAbbr.toLowerCase();
    // Use ESPN logo URL - simple approach
    return `https://a.espncdn.com/i/teamlogos/nba/500/${normalized}.png`;
  };

  const getResultColor = (line: number | null, actual: number) => {
    if (!line) return isDark ? 'text-gray-400' : 'text-gray-500';
    if (actual >= line) return isDark ? 'text-green-400' : 'text-green-600'; // >= so equal is OVER (green)
    return isDark ? 'text-red-400' : 'text-red-600'; // UNDER (red)
  };

  // Format height from inches to feet'inches" format
  const formatHeight = (inches: number | null | undefined): string => {
    if (!inches) return 'N/A';
    const feet = Math.floor(inches / 12);
    const remainingInches = inches % 12;
    return `${feet}'${remainingInches}"`;
  };

  // Calculate summary: how many players went OVER vs the opponent
  const totalGames = data.length;
  const overGames = data.filter(game => {
    if (game.line === null || typeof game.line !== 'number') return false;
    return game.actual >= game.line;
  }).length;
  const uniquePlayers = new Set(data.map(d => d.playerId)).size;
  const overPlayers = new Set(
    data
      .filter(game => {
        if (game.line === null || typeof game.line !== 'number') return false;
        return game.actual >= game.line;
      })
      .map(d => d.playerId)
  ).size;

  return (
    <div>
      {/* Summary statistics */}
      {totalGames > 0 && (
        <div className={`text-sm mb-3 p-3 rounded-lg border ${isDark ? 'bg-slate-800 border-slate-700 text-gray-300' : 'bg-gray-50 border-gray-200 text-gray-700'}`}>
          <span className="font-semibold">{overPlayers} from {uniquePlayers}</span> players went <span className="font-semibold text-green-600 dark:text-green-400">OVER</span> their average vs <span className="font-semibold">{opponent}</span>
        </div>
      )}
      <div className="overflow-x-auto max-h-[350px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg">
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className={isDark ? 'bg-slate-900' : 'bg-slate-100'}>
              <th className="text-left py-3 px-3 font-semibold text-gray-700 dark:text-gray-300 sticky left-0 bg-inherit">
                Player
              </th>
            <th className="text-left py-3 px-3 font-semibold text-gray-700 dark:text-gray-300">Date</th>
            <th className="text-left py-3 px-3 font-semibold text-gray-700 dark:text-gray-300">Avg</th>
            <th className="text-left py-3 px-3 font-semibold text-gray-700 dark:text-gray-300">Total</th>
            <th className="text-left py-3 px-3 font-semibold text-gray-700 dark:text-gray-300">Result</th>
            </tr>
          </thead>
          <tbody>
            {players.slice(0, 15).map((player, idx) => (
              <React.Fragment key={player.playerId}>
                {player.games.map((game, gameIdx) => (
                  <tr
                    key={`${player.playerId}-${game.gameDate}`}
                    className={isDark ? 'border-b border-slate-700 hover:bg-slate-800' : 'border-b border-slate-200 hover:bg-gray-50'}
                  >
                    {gameIdx === 0 && (
                      <td
                        rowSpan={player.games.length}
                        className={`py-3 px-3 text-gray-700 dark:text-gray-300 sticky left-0 ${
                          isDark ? 'bg-slate-800' : 'bg-white'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          {player.headshotUrl && (
                            <img 
                              src={player.headshotUrl} 
                              alt={player.playerName}
                              className="w-8 h-8 rounded-full object-cover"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          )}
                          <div>
                            <div className="font-medium text-base">{player.playerName}</div>
                            <div className={`text-xs mt-1 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                              {formatHeight(player.playerHeight)}
                            </div>
                          </div>
                        </div>
                      </td>
                    )}
                    <td className="py-3 px-3 text-gray-600 dark:text-gray-400">
                      <div className="flex items-center gap-1">
                        <span className="text-xs">{formatDate(game.gameDate)}</span>
                        {player.playerTeam && game.opponent && (
                          <div className="flex items-center gap-1 ml-2">
                            <img 
                              src={getTeamLogoUrl(player.playerTeam)} 
                              alt={player.playerTeam}
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                            <span className="text-xs text-gray-400">@</span>
                            <img 
                              src={getTeamLogoUrl(game.opponent)} 
                              alt={game.opponent}
                              className="w-4 h-4 object-contain"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                              }}
                            />
                          </div>
                        )}
                      </div>
                    </td>
                  <td className="py-3 px-3">
                    {game.line !== null ? (
                      <span className="font-mono text-base">{typeof game.line === 'number' ? Math.round(game.line) : game.line}</span>
                    ) : (
                      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>N/A</span>
                    )}
                  </td>
                    <td className="py-3 px-3">
                      <span className="font-mono font-semibold text-base">{game.actual}</span>
                    </td>
                  <td className="py-3 px-3">
                    {game.line !== null && typeof game.line === 'number' ? (
                      <span className={`font-mono text-base font-semibold ${getResultColor(game.line, game.actual)}`}>
                        {game.actual >= game.line ? 'OVER' : 'UNDER'}
                      </span>
                    ) : (
                      <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>-</span>
                    )}
                  </td>
                  </tr>
                ))}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {players.length === 0 && (
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'} p-4 text-center`}>
          No similar players found
        </div>
      )}
    </div>
  );
}

