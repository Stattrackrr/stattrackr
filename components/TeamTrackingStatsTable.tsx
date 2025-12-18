// components/TeamTrackingStatsTable.tsx
"use client";

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getNbaStatsId } from '@/lib/playerIdMapping';

interface TeamTrackingStatsTableProps {
  teamAbbr: string;
  selectedPlayerId?: string;
  selectedPlayerName?: string;
  season?: number;
  isDark?: boolean;
}

type StatCategory = 'passing' | 'rebounding';

interface PlayerTrackingData {
  playerId: string;
  playerName: string;
  gp: number;
  // Passing stats
  potentialAst?: number;
  ast?: number;
  astPtsCreated?: number;
  passesMade?: number;
  astToPct?: number;
  // Rebounding stats
  rebChances?: number;
  reb?: number;
  rebChancePct?: number;
  rebContest?: number;
  rebUncontest?: number;
  avgRebDist?: number;
  drebChances?: number;
  drebChancePct?: number;
  avgDrebDist?: number;
}

export function TeamTrackingStatsTable({ 
  teamAbbr, 
  selectedPlayerId,
  selectedPlayerName,
  season = 2025,
  isDark = false
}: TeamTrackingStatsTableProps) {
  const [category, setCategory] = useState<StatCategory>('passing');
  const [gameFilter, setGameFilter] = useState<'all' | 'last5'>('all'); // 'all' or 'last5' games
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passingData, setPassingData] = useState<PlayerTrackingData[]>([]);
  const [reboundingData, setReboundingData] = useState<PlayerTrackingData[]>([]);
  const selectedRowRef = useRef<HTMLTableRowElement>(null);

  // Use the appropriate cached data based on category
  const teamData = category === 'passing' ? passingData : reboundingData;

  // Convert player ID to NBA Stats format if needed
  const nbaPlayerId = useMemo(() => {
    if (!selectedPlayerId) return undefined;
    return getNbaStatsId(selectedPlayerId) || selectedPlayerId;
  }, [selectedPlayerId]);

  useEffect(() => {
    const fetchBothCategories = async () => {
      setLoading(true);
      setError(null);

      try {
        // Build URLs with optional last 5 games filter
        const baseParams = `team=${encodeURIComponent(teamAbbr)}&season=${season}`;
        const last5Param = gameFilter === 'last5' ? `&lastNGames=5` : '';
        
        // Check sessionStorage first for "Last 5 Games" data (instant load)
        if (gameFilter === 'last5') {
          const cacheKeyPassing = `tracking_stats_${teamAbbr}_${season}_passing_last5`;
          const cacheKeyRebounding = `tracking_stats_${teamAbbr}_${season}_rebounding_last5`;
          
          const cachedPassing = sessionStorage.getItem(cacheKeyPassing);
          const cachedRebounding = sessionStorage.getItem(cacheKeyRebounding);
          
          if (cachedPassing && cachedRebounding) {
            try {
              const passingData = JSON.parse(cachedPassing);
              const reboundingData = JSON.parse(cachedRebounding);
              
              // Check if cache is still valid (30 minutes TTL)
              const cacheTimestamp = passingData.__timestamp || 0;
              const cacheAge = Date.now() - cacheTimestamp;
              const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
              
              if (cacheAge < CACHE_TTL_MS && passingData.players && reboundingData.players) {
                console.log(`[TeamTrackingStats] ✅ Using cached Last 5 Games data (${Math.round(cacheAge / 1000)}s old)`);
                setPassingData(passingData.players || []);
                setReboundingData(reboundingData.players || []);
                setLoading(false);
                return; // Use cached data, skip API call
              }
            } catch (e) {
              // Invalid cache, continue to fetch
              console.warn('[TeamTrackingStats] Invalid cached data, fetching fresh...');
            }
          }
        }
        
        // Fetch both passing and rebounding data in parallel
        const [passingResponse, reboundingResponse] = await Promise.all([
          fetch(`/api/tracking-stats/team?${baseParams}&category=passing${last5Param}`),
          fetch(`/api/tracking-stats/team?${baseParams}&category=rebounding${last5Param}`)
        ]);

        if (!passingResponse.ok || !reboundingResponse.ok) {
          throw new Error(`Failed to fetch team tracking stats`);
        }

        const [passingResult, reboundingResult] = await Promise.all([
          passingResponse.json(),
          reboundingResponse.json()
        ]);

        // Check if API returned an error (even with 200 status)
        if (passingResult.error || reboundingResult.error) {
          throw new Error(passingResult.error || reboundingResult.error || 'Failed to fetch team tracking stats');
        }

        // Success - use the data
        setPassingData(passingResult.players || []);
        setReboundingData(reboundingResult.players || []);
        
        // Cache "Last 5 Games" data in sessionStorage for instant future loads
        if (gameFilter === 'last5') {
          try {
            const cacheKeyPassing = `tracking_stats_${teamAbbr}_${season}_passing_last5`;
            const cacheKeyRebounding = `tracking_stats_${teamAbbr}_${season}_rebounding_last5`;
            
            sessionStorage.setItem(cacheKeyPassing, JSON.stringify({
              players: passingResult.players || [],
              __timestamp: Date.now()
            }));
            sessionStorage.setItem(cacheKeyRebounding, JSON.stringify({
              players: reboundingResult.players || [],
              __timestamp: Date.now()
            }));
            console.log(`[TeamTrackingStats] 💾 Cached Last 5 Games data to sessionStorage`);
          } catch (e) {
            // Ignore storage errors
          }
        }
      } catch (err: any) {
        console.error('[TeamTrackingStats] Error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (teamAbbr && teamAbbr !== 'N/A') {
      fetchBothCategories();
    }
    }, [teamAbbr, season, gameFilter]);

  // Sort players based on the selected category
  const sortedPlayers = useMemo(() => {
    if (!teamData.length) return [];

    return [...teamData].sort((a, b) => {
      if (category === 'passing') {
        // Sort by Potential Assists (descending)
        return (b.potentialAst || 0) - (a.potentialAst || 0);
      } else {
        // Sort by Rebound Chances (descending)
        return (b.rebChances || 0) - (a.rebChances || 0);
      }
    });
  }, [teamData, category]);

  // Auto-scroll disabled - users can manually scroll to find their player
  // useEffect(() => {
  //   if (selectedRowRef.current && !loading) {
  //     setTimeout(() => {
  //       selectedRowRef.current?.scrollIntoView({ 
  //         behavior: 'smooth', 
  //         block: 'center' 
  //       });
  //     }, 100);
  //   }
  // }, [sortedPlayers, selectedPlayerId, selectedPlayerName, loading]);

  if (!teamAbbr || teamAbbr === 'N/A') {
    return null;
  }

  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold">Potentials</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {teamAbbr} • {season}-{(season + 1).toString().slice(-2)} Season
          </p>
        </div>

        {/* Category Toggle */}
        <div className="flex gap-2">
          <button
            onClick={() => setCategory('passing')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              category === 'passing'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Passing
          </button>
          <button
            onClick={() => setCategory('rebounding')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              category === 'rebounding'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Rebounding
          </button>
        </div>
      </div>

      {/* Game Filter - All Games vs Last 5 Games */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setGameFilter('all')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
            gameFilter === 'all'
              ? 'bg-gray-900 dark:bg-[#0a1929] text-white'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#0d1f35]'
          }`}
        >
          All Games
        </button>
        <button
          onClick={() => setGameFilter('last5')}
          className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
            gameFilter === 'last5'
              ? 'bg-gray-900 dark:bg-[#0a1929] text-white'
              : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-[#0d1f35]'
          }`}
        >
          Last 5 Games
        </button>
      </div>

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Error State */}
      {error && !loading && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <p className="text-sm text-yellow-800 dark:text-yellow-300">
            ⚠️ {error}
          </p>
        </div>
      )}

      {/* Table */}
      {!loading && !error && sortedPlayers.length > 0 && (
        <div className="overflow-x-auto -mx-4 md:mx-0 px-4 md:px-0">
          <div className="max-h-[380px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg scroll-smooth">
          <table className="min-w-[600px] md:min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-[#0a1929] sticky top-0 z-10 shadow-md border-b-2 border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-2 sm:px-3 md:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider w-12 sm:w-auto">
                  Rank
                </th>
                <th className="px-2 sm:px-3 md:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider min-w-[120px]">
                  Player
                </th>
                {category === 'passing' ? (
                  <>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      AST
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider whitespace-nowrap">
                      Pot AST
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      AST%
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      Passes
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      AST PTS
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      REB
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider whitespace-nowrap">
                      REB CHN
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      REB CHN%
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      AVG DIST
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      DREB CHN
                    </th>
                    <th className="px-2 sm:px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider whitespace-nowrap">
                      DREB CHN%
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-[#0a1929] divide-y divide-gray-200 dark:divide-gray-700">
              {sortedPlayers.map((player, index) => {
                // Try ID matching first, then fall back to name matching
                let isSelected = false;
                
                if (nbaPlayerId && player.playerId === nbaPlayerId) {
                  isSelected = true;
                } else if (selectedPlayerName && player.playerName) {
                  // Normalize names for comparison (case-insensitive, trim whitespace)
                  const normalizedPlayerName = player.playerName.toLowerCase().trim();
                  const normalizedSelectedName = selectedPlayerName.toLowerCase().trim();
                  isSelected = normalizedPlayerName === normalizedSelectedName;
                }
                return (
                  <tr 
                    key={player.playerId}
                    ref={isSelected ? selectedRowRef : null}
                    className={`transition-all ${
                      isSelected 
                        ? 'bg-blue-100 dark:bg-blue-900/30 border-l-4 border-blue-600 shadow-md' 
                        : 'hover:bg-gray-50 dark:hover:bg-[#0d1f35]/50'
                    }`}
                  >
                    <td className="px-2 sm:px-3 md:px-4 py-3 whitespace-nowrap w-12 sm:w-auto">
                      <span className={`text-sm font-bold ${
                        index === 0 ? 'text-yellow-600' :
                        index === 1 ? 'text-gray-400' :
                        index === 2 ? 'text-orange-600' :
                        'text-gray-900 dark:text-gray-100'
                      }`}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`}
                      </span>
                    </td>
                    <td className="px-2 sm:px-3 md:px-4 py-3 whitespace-nowrap min-w-[120px]">
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-blue-600 dark:text-blue-400 flex-shrink-0">👤</span>
                        )}
                        <span className={`text-sm font-medium truncate ${
                          isSelected 
                            ? 'text-blue-700 dark:text-blue-300 font-bold' 
                            : 'text-gray-900 dark:text-gray-100'
                        }`}>
                          {player.playerName}
                        </span>
                      </div>
                    </td>
                    {category === 'passing' ? (
                      <>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {player.ast?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                            {player.potentialAst?.toFixed(1) || 'N/A'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.astToPct ? `${(player.astToPct * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.passesMade?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.astPtsCreated?.toFixed(1) || 'N/A'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {player.reb?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-sm font-bold text-green-600 dark:text-green-400">
                            {player.rebChances?.toFixed(1) || 'N/A'}
                          </span>
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.rebChancePct ? `${(player.rebChancePct * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.avgRebDist?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.drebChances?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-2 sm:px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.drebChancePct ? `${(player.drebChancePct * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && sortedPlayers.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {gameFilter === 'last5'
              ? `No stats available for ${teamAbbr} (last 5 games) this season.`
              : 'No tracking stats available for this team'}
          </p>
        </div>
      )}
    </div>
  );
}

