'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';

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
  playerMinutes?: number | null; // Player's average minutes for display
}

interface SimilarPlayersProps {
  playerId: string | number | null;
  opponent: string;
  statType: string;
  isDark?: boolean;
  shouldFetch?: boolean; // Only fetch when this is true (allows delaying until other components load)
}

// Module-level cache to persist across component unmounts/remounts
const similarPlayersCache = new Map<string, {
  data: SimilarPlayerData[];
  timestamp: number;
}>();

const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day cache TTL
const STORAGE_KEY = 'similarPlayersCache';

// Load cache from localStorage on module load (for production persistence)
if (typeof window !== 'undefined') {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const now = Date.now();
      // Only load non-expired entries
      Object.entries(parsed).forEach(([key, value]: [string, any]) => {
        if (value && value.timestamp && (now - value.timestamp) < CACHE_TTL) {
          similarPlayersCache.set(key, {
            data: value.data || [],
            timestamp: value.timestamp
          });
        }
      });
      console.log(`[SimilarPlayers] Loaded ${similarPlayersCache.size} cached entries from localStorage`);
    }
  } catch (e) {
    console.warn('[SimilarPlayers] Failed to load cache from localStorage:', e);
  }
}

// Helper to save cache to localStorage
function saveCacheToStorage() {
  if (typeof window === 'undefined') return;
  try {
    const cacheObj: Record<string, any> = {};
    similarPlayersCache.forEach((value, key) => {
      cacheObj[key] = value;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheObj));
  } catch (e) {
    console.warn('[SimilarPlayers] Failed to save cache to localStorage:', e);
  }
}

function getCacheKey(playerId: number, opponent: string, statType: string): string {
  // Normalize statType to uppercase for consistent cache keys
  const normalizedStatType = statType.toUpperCase();
  return `${playerId}:${opponent}:${normalizedStatType}`;
}

export function SimilarPlayers({ playerId, opponent, statType, isDark = false, shouldFetch = true }: SimilarPlayersProps) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SimilarPlayerData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const prefetchRef = useRef<Promise<void> | null>(null);
  const activeRequestRef = useRef<string | null>(null); // Track active request key

  // Pre-fetch function that can be called immediately
  const fetchSimilarPlayers = useCallback(async (playerIdNum: number, opponent: string, statType: string, isPrefetch = false) => {
    // Normalize statType for cache key
    const normalizedStatType = statType.toUpperCase();
    const cacheKey = getCacheKey(playerIdNum, opponent, normalizedStatType);
    const cached = similarPlayersCache.get(cacheKey);
    const now = Date.now();
    
    if (cached && (now - cached.timestamp) < CACHE_TTL) {
      // Use cached data - but if it's empty, still fetch fresh data (might be stale from before fix)
      // For prefetches, always use cache if available (don't show loading)
      if (cached.data.length > 0) {
        if (!isPrefetch) {
          console.log(`[SimilarPlayers] Using cached data for ${cacheKey} (${cached.data.length} results)`);
          setData(cached.data);
          setError(null);
          setLoading(false);
        }
        // For prefetches, just return (don't set state, don't show loading)
        return;
      } else {
        if (!isPrefetch) {
          console.log(`[SimilarPlayers] Cached data is empty, fetching fresh data for ${cacheKey}`);
        }
        // Continue to fetch fresh data below
      }
    }

    // Create new abort controller for this request
    // Don't abort previous - let it complete naturally unless props actually changed
    const abortController = new AbortController();
    abortControllerRef.current = abortController;
    
    if (!isPrefetch) {
      console.log(`[SimilarPlayers] Created new AbortController, signal.aborted: ${abortController.signal.aborted}`);
    }

    if (!isPrefetch) {
      setLoading(true);
      setError(null);
    }
    
    // Add timeout to prevent infinite loading (60 seconds for complex queries) - declare outside try so it's accessible in catch
    let timeoutId: NodeJS.Timeout | null = null;
    
    try {
      if (!isPrefetch) {
        console.log(`[SimilarPlayers] Fetching similar players for playerId=${playerIdNum}, opponent=${opponent}, statType=${statType}`);
      }
      
      // Set timeout - increased to 60 seconds for complex similar players queries
      timeoutId = setTimeout(() => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          if (!isPrefetch) {
            setError('Request timed out after 60 seconds. Please try again.');
            setLoading(false);
          }
        }
      }, 60000);
      
      if (!isPrefetch) {
        console.log(`[SimilarPlayers] Making API request to /api/similar-players?playerId=${playerIdNum}&opponent=${encodeURIComponent(opponent)}&statType=${encodeURIComponent(normalizedStatType)}`);
        console.log(`[SimilarPlayers] AbortController signal aborted before fetch: ${abortController.signal.aborted}`);
      }
      
      let response: Response;
      try {
        const url = `/api/similar-players?playerId=${playerIdNum}&opponent=${encodeURIComponent(opponent)}&statType=${encodeURIComponent(normalizedStatType)}`;
        if (!isPrefetch) {
          console.log(`[SimilarPlayers] About to call fetch for: ${url}`);
        }
        response = await fetch(url, { signal: abortController.signal });
        
        clearTimeout(timeoutId);
        
        if (!isPrefetch) {
          console.log(`[SimilarPlayers] ✅ API request completed, status: ${response.status}, ok: ${response.ok}`);
        }
      } catch (fetchErr: any) {
        clearTimeout(timeoutId);
        if (fetchErr.name === 'AbortError') {
          if (!isPrefetch) {
            console.log(`[SimilarPlayers] Request was aborted`);
          }
          throw fetchErr; // Re-throw to be caught by outer catch
        }
        if (!isPrefetch) {
          console.error(`[SimilarPlayers] Fetch error:`, fetchErr);
        }
        throw fetchErr; // Re-throw to be caught by outer catch
      }

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
        // For prefetches, silently ignore "Player not found" errors FIRST (before any logging)
        if (isPrefetch && (errorMessage.includes('Player not found') || errorMessage.includes('player not found'))) {
          return; // Silently return for prefetches with "Player not found" errors - no logging at all
        }
        
        if (!isPrefetch) {
          console.error(`[SimilarPlayers] API error: ${errorMessage}`);
        } else {
          // For prefetch, only log non-"Player not found" errors
          if (!errorMessage.includes('Player not found') && !errorMessage.includes('player not found')) {
            console.warn(`[SimilarPlayers] Pre-fetch API error (non-critical): ${errorMessage}`);
          }
        }
        throw new Error(errorMessage);
      }

      const result = await response.json();
      
      // Log the response for debugging
      if (!isPrefetch) {
        console.log(`[SimilarPlayers] API response:`, {
          success: result.success,
          dataLength: result.data?.length || 0,
          error: result.error,
          debug: result.debug,
          firstResult: result.data?.[0] || null
        });
        // Debug: Check if playerMinutes is in the data
        if (result.data && result.data.length > 0) {
          const firstPlayer = result.data[0];
          console.log(`[SimilarPlayers] Sample player data (checking minutes):`, {
            playerName: firstPlayer.playerName,
            playerMinutes: firstPlayer.playerMinutes,
            playerHeight: firstPlayer.playerHeight,
            hasPlayerMinutes: firstPlayer.playerMinutes !== null && firstPlayer.playerMinutes !== undefined,
            allKeys: Object.keys(firstPlayer)
          });
          // Log all players' minutes to see the pattern
          const minutesData = result.data.map((p: any) => ({
            name: p.playerName,
            minutes: p.playerMinutes
          }));
          console.log(`[SimilarPlayers] All players' minutes:`, minutesData);
        }
      }
      
      if (!result.success) {
        const errorMsg = result.error || 'Failed to fetch similar players';
        // For prefetches, silently ignore "Player not found" errors - check FIRST before any logging
        if (isPrefetch && (errorMsg.includes('Player not found') || errorMsg.includes('player not found'))) {
          return; // Silently return for prefetches with "Player not found" errors - no logging, no error state
        }
        // Only throw error if not a prefetch or if it's not a "Player not found" error
        throw new Error(errorMsg);
      }
      
      const resultData = result.data || [];
      
      // Log if we got results
      if (!isPrefetch) {
        console.log(`[SimilarPlayers] Received ${resultData.length} results, setting state...`);
      }
      
      // Cache the result
      similarPlayersCache.set(cacheKey, {
        data: resultData,
        timestamp: now
      });
      
      // Persist to localStorage for production (survives page refresh)
      saveCacheToStorage();
      
      // Check again if request was aborted before setting state
      if (!abortController.signal.aborted && !isPrefetch) {
        console.log(`[SimilarPlayers] ✅ Setting data state with ${resultData.length} results (not aborted)`);
        setData(resultData);
        setError(null);
        setLoading(false);
        console.log(`[SimilarPlayers] ✅ State updated: data.length=${resultData.length}, loading=false, error=null`);
      } else {
        console.log(`[SimilarPlayers] ⚠️ Not setting data - aborted: ${abortController.signal.aborted}, isPrefetch: ${isPrefetch}`);
      }
    } catch (err: any) {
      // Clear timeout in case of error
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      
      // Don't set error if request was aborted
      if (err.name === 'AbortError' || abortController.signal.aborted) {
        if (!isPrefetch) {
          console.log(`[SimilarPlayers] Request aborted (name: ${err.name}, signal.aborted: ${abortController.signal.aborted})`);
          setLoading(false);
        }
        return;
      }
      
      // For prefetches, silently ignore "Player not found" errors FIRST (before any logging)
      if (isPrefetch && (err.message?.includes('Player not found') || err.message?.includes('player not found'))) {
        return; // Silently return - don't log, don't set error, don't do anything
      }
      
      if (!isPrefetch) {
        console.error(`[SimilarPlayers] Error fetching similar players:`, {
          name: err.name,
          message: err.message,
          stack: err.stack?.substring(0, 200)
        });
      } else {
        // For prefetch, only log non-"Player not found" errors
        if (!err.message?.includes('Player not found') && !err.message?.includes('player not found')) {
          console.warn(`[SimilarPlayers] Pre-fetch error (non-critical):`, err.message);
        }
      }
      
      if (!abortController.signal.aborted && !isPrefetch) {
        setError(err.message || 'Failed to load similar players');
        setLoading(false); // Always clear loading on error
      }
    } finally {
      // Ensure timeout is always cleared
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      // Always clear loading if not prefetch and not aborted
      if (!abortController.signal.aborted && !isPrefetch) {
        setLoading(false);
      }
    }
  }, []);

  // Pre-fetch when props change (even if component isn't visible)
  useEffect(() => {
    // Don't fetch if shouldFetch is false (waiting for other components to load)
    if (!shouldFetch) {
      return;
    }
    
    // Add a small debounce to prevent rapid re-renders from causing multiple requests
    const timeoutId = setTimeout(() => {
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

      // Normalize statType to uppercase for consistent caching
      const normalizedStatType = statType.toUpperCase();
      
      // Create a unique key for this request
      const requestKey = `${playerIdNum}:${opponent}:${normalizedStatType}`;
      
      // If this is the same request that's already in progress, don't start a new one
      if (activeRequestRef.current === requestKey) {
        return;
      }
      
      // Abort previous request only if it's for different parameters
      if (abortControllerRef.current && activeRequestRef.current && activeRequestRef.current !== requestKey) {
        abortControllerRef.current.abort();
      }
      
      // Mark this as the active request
      activeRequestRef.current = requestKey;
      
      // Check cache first - if we have it, set it immediately (don't show loading)
      const cacheKey = getCacheKey(playerIdNum, opponent, normalizedStatType);
      const cached = similarPlayersCache.get(cacheKey);
      const now = Date.now();
      
      if (cached && (now - cached.timestamp) < CACHE_TTL) {
        // Use cached data immediately - but if it's empty, still fetch fresh data (might be stale from before fix)
        // Also check if cached data has playerMinutes - if not, it's old cached data from before we added minutes
        const hasMinutes = cached.data.length > 0 && cached.data.some((d: SimilarPlayerData) => 
          d.playerMinutes !== null && d.playerMinutes !== undefined
        );
        if (cached.data.length > 0 && hasMinutes) {
          setData(cached.data);
          setError(null);
          setLoading(false);
          return;
        } else if (cached.data.length > 0 && !hasMinutes) {
          console.log(`[SimilarPlayers] Cached data exists but missing playerMinutes - fetching fresh data`);
          // Continue to fetch fresh data below
        }
      }

      // No cache for current stat - start fetching
      setLoading(true);
      
      // Start fetching
      fetchSimilarPlayers(playerIdNum, opponent, normalizedStatType, false);
      
      // Pre-fetch stats in batches of 3 to avoid rate limiting
      // This ensures instant switching between stats without overwhelming the API
      const allStats = ['PTS', 'REB', 'AST', 'PRA', 'PR', 'PA', 'RA', 'FGM', 'FGA', 'FTM', 'FTA', 'STL', 'BLK', 'TO', 'PF', 'OREB', 'DREB'];
      const statsToPrefetch = allStats.filter(stat => stat !== normalizedStatType);
      
      // Process 3 stats at a time, with delays between batches
      const BATCH_SIZE = 3;
      const DELAY_BETWEEN_BATCHES = 5000; // 5 seconds between batches
      const DELAY_BETWEEN_STATS = 1000; // 1 second between stats in same batch
      
      let batchIndex = 0;
      const processBatch = () => {
        const startIndex = batchIndex * BATCH_SIZE;
        const endIndex = Math.min(startIndex + BATCH_SIZE, statsToPrefetch.length);
        const batch = statsToPrefetch.slice(startIndex, endIndex);
        
        if (batch.length === 0) return; // All stats processed
        
        batch.forEach((otherStat, indexInBatch) => {
          const otherCacheKey = getCacheKey(playerIdNum, opponent, otherStat);
          const otherCached = similarPlayersCache.get(otherCacheKey);
          // Only pre-fetch if not already cached
          if (!otherCached || (now - otherCached.timestamp) >= CACHE_TTL) {
            setTimeout(() => {
              fetchSimilarPlayers(playerIdNum, opponent, otherStat, true).catch(() => {
                // Silently ignore errors for background pre-fetches
              });
            }, 2000 + (indexInBatch * DELAY_BETWEEN_STATS)); // Start after main request, then stagger within batch
          }
        });
        
        // Schedule next batch
        batchIndex++;
        if (endIndex < statsToPrefetch.length) {
          setTimeout(processBatch, DELAY_BETWEEN_BATCHES);
        }
      };
      
      // Start processing batches after main request completes (2 seconds)
      setTimeout(processBatch, 2000);
    }, 300); // 300ms debounce to prevent rapid re-renders
    
    // Cleanup: ONLY abort if this specific request is no longer needed
    return () => {
      clearTimeout(timeoutId);
      // Only abort if the active request changed (meaning props changed)
      if (abortControllerRef.current && activeRequestRef.current) {
        // This request is no longer needed, abort it
        abortControllerRef.current.abort();
        activeRequestRef.current = null;
      }
    };
  }, [playerId, opponent, statType, shouldFetch, fetchSimilarPlayers]);

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

  const players = Object.entries(groupedByPlayer).map(([playerId, games], index) => {
    // Sort games by date (most recent first) to get the latest game's minutes
    const sortedGames = games.sort((a, b) => new Date(b.gameDate).getTime() - new Date(a.gameDate).getTime());
    const firstGame = sortedGames[0];
    // Debug: Log to see if playerMinutes is in the raw data (only for first player)
    if (index === 0) {
      console.log(`[SimilarPlayers] Grouping player data (first player):`, {
        playerName: firstGame.playerName,
        playerMinutes: firstGame.playerMinutes,
        hasPlayerMinutes: firstGame.playerMinutes !== null && firstGame.playerMinutes !== undefined,
        allKeys: Object.keys(firstGame)
      });
    }
    return {
      playerId: parseInt(playerId),
      playerName: firstGame.playerName,
      playerTeam: firstGame.playerTeam || '', // Player's team abbreviation
      headshotUrl: firstGame.headshotUrl || null, // Player headshot URL
      games: sortedGames,
      similarityScore: firstGame.similarityScore,
      heightDiff: firstGame.heightDiff,
      playerHeight: firstGame.playerHeight, // Actual player height
      playTypeMatches: firstGame.playTypeMatches,
      minutesDiff: firstGame.minutesDiff,
      playerMinutes: firstGame.playerMinutes ?? null, // Minutes from most recent game vs opponent
      mostRecentDate: firstGame.gameDate, // Store most recent date for sorting
    };
  });

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
                              <span className="ml-2">
                                {player.playerMinutes !== null && player.playerMinutes !== undefined 
                                  ? `• ${player.playerMinutes.toFixed(1)} min`
                                  : '• N/A min'
                                }
                              </span>
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

