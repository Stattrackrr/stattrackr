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
  opponentTeam?: string;
  opponentTeamLogoUrl?: string;
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
  isDark = false,
  opponentTeam,
  opponentTeamLogoUrl
}: TeamTrackingStatsTableProps) {
  const [category, setCategory] = useState<StatCategory>('passing');
  const [gameFilter, setGameFilter] = useState<'all' | 'vs'>('all'); // 'all' or 'vs' opponent
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
        // Build URLs with optional opponent filter
        const baseParams = `team=${encodeURIComponent(teamAbbr)}&season=${season}`;
        const opponentParam = (gameFilter === 'vs' && opponentTeam && opponentTeam !== 'N/A') 
          ? `&opponentTeam=${encodeURIComponent(opponentTeam)}` 
          : '';
        
        // Fetch both passing and rebounding data in parallel
        const [passingResponse, reboundingResponse] = await Promise.all([
          fetch(`/api/tracking-stats/team?${baseParams}&category=passing${opponentParam}`),
          fetch(`/api/tracking-stats/team?${baseParams}&category=rebounding${opponentParam}`)
        ]);

        if (!passingResponse.ok || !reboundingResponse.ok) {
          throw new Error(`Failed to fetch team tracking stats`);
        }

        const [passingResult, reboundingResult] = await Promise.all([
          passingResponse.json(),
          reboundingResponse.json()
        ]);

        setPassingData(passingResult.players || []);
        setReboundingData(reboundingResult.players || []);
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
  }, [teamAbbr, season, gameFilter, opponentTeam]);

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
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
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
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Passing
          </button>
          <button
            onClick={() => setCategory('rebounding')}
            className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              category === 'rebounding'
                ? 'bg-purple-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
            }`}
          >
            Rebounding
          </button>
        </div>
      </div>

      {/* Game Filter - Show only if opponent is available */}
      {opponentTeam && opponentTeam !== 'N/A' && (
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setGameFilter('all')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
              gameFilter === 'all'
                ? 'bg-gray-900 dark:bg-gray-700 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            All Games
          </button>
          <button
            onClick={() => setGameFilter('vs')}
            className={`flex-1 px-3 py-2 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2 ${
              gameFilter === 'vs'
                ? 'bg-gray-900 dark:bg-gray-700 text-white'
                : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700'
            }`}
          >
            <span>vs</span>
            {opponentTeamLogoUrl && (
              <img 
                src={opponentTeamLogoUrl} 
                alt={opponentTeam}
                className="w-5 h-5 object-contain"
              />
            )}
            <span>{opponentTeam}</span>
          </button>
        </div>
      )}

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
        <div className="overflow-x-auto -mx-4 md:mx-0">
          <div className="max-h-[380px] overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg scroll-smooth">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900 sticky top-0 z-10 shadow-md border-b-2 border-gray-200 dark:border-gray-700">
              <tr>
                <th className="px-3 md:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Rank
                </th>
                <th className="px-3 md:px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                  Player
                </th>
                {category === 'passing' ? (
                  <>
                    <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      AST
                    </th>
                    <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-blue-600 dark:text-blue-400 uppercase tracking-wider">
                      Pot AST
                    </th>
                    <th className="hidden sm:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      AST%
                    </th>
                    <th className="hidden md:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      Passes
                    </th>
                    <th className="hidden lg:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      AST PTS
                    </th>
                  </>
                ) : (
                  <>
                    <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      REB
                    </th>
                    <th className="px-3 md:px-4 py-3 text-center text-xs font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">
                      REB CHN
                    </th>
                    <th className="hidden sm:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      REB CHN%
                    </th>
                    <th className="hidden md:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      AVG DIST
                    </th>
                    <th className="hidden lg:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      DREB CHN
                    </th>
                    <th className="hidden xl:table-cell px-3 md:px-4 py-3 text-center text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">
                      DREB CHN%
                    </th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="bg-white dark:bg-gray-800 divide-y divide-gray-200 dark:divide-gray-700">
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
                        : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'
                    }`}
                  >
                    <td className="px-3 md:px-4 py-3 whitespace-nowrap">
                      <span className={`text-sm font-bold ${
                        index === 0 ? 'text-yellow-600' :
                        index === 1 ? 'text-gray-400' :
                        index === 2 ? 'text-orange-600' :
                        'text-gray-900 dark:text-gray-100'
                      }`}>
                        {index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}`}
                      </span>
                    </td>
                    <td className="px-3 md:px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        {isSelected && (
                          <span className="text-blue-600 dark:text-blue-400">👤</span>
                        )}
                        <span className={`text-sm font-medium ${
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
                        <td className="px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {player.ast?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-3 md:px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                            {player.potentialAst?.toFixed(1) || 'N/A'}
                          </span>
                        </td>
                        <td className="hidden sm:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.astToPct ? `${(player.astToPct * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="hidden md:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.passesMade?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="hidden lg:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.astPtsCreated?.toFixed(1) || 'N/A'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-900 dark:text-gray-100">
                          {player.reb?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="px-3 md:px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-sm font-bold text-green-600 dark:text-green-400">
                            {player.rebChances?.toFixed(1) || 'N/A'}
                          </span>
                        </td>
                        <td className="hidden sm:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.rebChancePct ? `${(player.rebChancePct * 100).toFixed(1)}%` : 'N/A'}
                        </td>
                        <td className="hidden md:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.avgRebDist?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="hidden lg:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
                          {player.drebChances?.toFixed(1) || 'N/A'}
                        </td>
                        <td className="hidden xl:table-cell px-3 md:px-4 py-3 text-center whitespace-nowrap text-sm text-gray-600 dark:text-gray-400">
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
            {gameFilter === 'vs' && opponentTeam
              ? `No stats available for ${teamAbbr} vs ${opponentTeam} this season. The teams may not have played yet.`
              : 'No tracking stats available for this team'}
          </p>
        </div>
      )}
    </div>
  );
}

