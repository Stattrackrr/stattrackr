// components/PlayTypeAnalysis.tsx
"use client";

import React, { useState, useEffect } from 'react';

interface PlayTypeAnalysisProps {
  playerId: string | number;
  opponentTeam?: string;
  season?: number;
  isDark?: boolean;
}

interface PlayTypeData {
  playType: string;
  displayName: string;
  points: number;
  pointsPct: number;
  oppRank: number | null;
}

export function PlayTypeAnalysis({ 
  playerId, 
  opponentTeam,
  season = 2025,
  isDark = false
}: PlayTypeAnalysisProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false); // Start as false, only set to true when fetching
  const [error, setError] = useState<string | null>(null);
  const [playTypeData, setPlayTypeData] = useState<PlayTypeData[]>([]);
  const [totalPoints, setTotalPoints] = useState(0);

  // Log when component mounts/updates
  useEffect(() => {
    console.log('[PlayTypeAnalysis] Component mounted/updated', { 
      playerId, 
      opponentTeam, 
      season,
      hasPlayerId: !!playerId 
    });
  }, [playerId, opponentTeam, season]);

  // Only fetch data when the component is opened (isOpen is true)
  // This defers loading until user clicks to expand, improving initial page load
  useEffect(() => {
    const fetchData = async () => {
      console.log('[PlayTypeAnalysis] useEffect triggered', { playerId, opponentTeam, season, isOpen });
      
      // Only fetch when component is opened (user clicked to expand)
      if (!isOpen) {
        console.log('[PlayTypeAnalysis] Component is closed, skipping fetch');
        return;
      }
      
      if (!playerId) {
        console.log('[PlayTypeAnalysis] No playerId, skipping fetch');
        setLoading(false);
        return;
      }

      console.log('[PlayTypeAnalysis] Starting fetch...');
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams({
          playerId: String(playerId),
          season: String(season),
          // Cache is enabled by default - remove bypassCache to use caching
        });
        
        if (opponentTeam && opponentTeam !== 'N/A') {
          params.append('opponentTeam', opponentTeam);
        }

        const url = `/api/play-type-analysis?${params.toString()}`;
        console.log('[PlayTypeAnalysis] Fetching:', url);
        console.log('[PlayTypeAnalysis] Full URL:', window.location.origin + url);

        const response = await fetch(url);

        if (!response.ok) {
          // Try to get error message from response
          let errorMessage = `Failed to fetch play type analysis (${response.status})`;
          try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorData.message || errorMessage;
            console.error('[PlayTypeAnalysis] API error:', response.status, errorData);
          } catch {
            const errorText = await response.text().catch(() => '');
            console.error('[PlayTypeAnalysis] API error:', response.status, errorText);
            if (errorText) {
              errorMessage = errorText.substring(0, 200);
            }
          }
          throw new Error(errorMessage);
        }

        const data = await response.json();
        console.log('[PlayTypeAnalysis] Data received:', data);
        console.log('[PlayTypeAnalysis] Play types:', data.playTypes?.length || 0);
        console.log('[PlayTypeAnalysis] Total points:', data.totalPoints);
        
        // Filter out play types with 0.0 points
        const filteredPlayTypes = (data.playTypes || []).filter((playType: PlayTypeData) => 
          playType.points > 0
        );
        
        console.log('[PlayTypeAnalysis] Filtered play types (removed 0.0):', filteredPlayTypes.length);
        
        setPlayTypeData(filteredPlayTypes);
        setTotalPoints(data.totalPoints || 0);
      } catch (err: any) {
        console.error('[PlayTypeAnalysis] Error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [playerId, opponentTeam, season, isOpen]);

  const getRankColor = (rank: number | null) => {
    if (rank === null) return 'text-gray-500 dark:text-gray-400';
    
    // Red = Better Defense (lower rank = harder matchup)
    // Green = Easier Defense (higher rank = easier matchup)
    if (rank >= 1 && rank <= 5) return 'text-red-600 dark:text-red-400';
    if (rank >= 6 && rank <= 11) return 'text-orange-600 dark:text-orange-400';
    if (rank >= 12 && rank <= 21) return 'text-yellow-600 dark:text-yellow-400';
    if (rank >= 22 && rank <= 30) return 'text-green-600 dark:text-green-400';
    return 'text-gray-500 dark:text-gray-400';
  };

  const getRankBgColor = (rank: number | null) => {
    if (rank === null) return 'bg-gray-100 dark:bg-gray-700';
    
    if (rank >= 1 && rank <= 5) return 'bg-red-50 dark:bg-red-900/20';
    if (rank >= 6 && rank <= 11) return 'bg-orange-50 dark:bg-orange-900/20';
    if (rank >= 12 && rank <= 21) return 'bg-yellow-50 dark:bg-yellow-900/20';
    if (rank >= 22 && rank <= 30) return 'bg-green-50 dark:bg-green-900/20';
    return 'bg-gray-100 dark:bg-gray-700';
  };

  if (!playerId) {
    return null;
  }

  return (
    <div className="w-full overflow-hidden mt-6">
      {/* Collapsible Header/Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-inset"
      >
        <div className="flex items-center gap-2">
          <svg
            className="w-5 h-5 text-gray-500 dark:text-gray-400"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z"></path>
          </svg>
          <h3 className="text-base font-semibold text-gray-900 dark:text-white">
            Play Type Filter
          </h3>
        </div>
        <svg
          className={`w-5 h-5 text-gray-500 dark:text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path d="M19 9l-7 7-7-7"></path>
        </svg>
      </button>

      {/* Collapsible Content */}
      {isOpen && (
        <div className="px-4 pb-4 border-t border-gray-200 dark:border-gray-700">

      {/* Loading State */}
      {loading && (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-600"></div>
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

      {/* Data Table */}
      {!loading && !error && playTypeData.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-700">
                <th className="text-left py-2 px-3 font-semibold text-gray-900 dark:text-white">Play Type</th>
                <th className="text-right py-2 px-3 font-semibold text-gray-900 dark:text-white">Points/Game</th>
                <th className="text-right py-2 px-3 font-semibold text-gray-900 dark:text-white">Opp. Rank</th>
              </tr>
            </thead>
            <tbody>
              {playTypeData.map((playType) => (
                <tr 
                  key={playType.playType}
                  className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors"
                >
                  <td className="py-3 px-3 text-gray-900 dark:text-white font-medium">
                    {playType.displayName}
                  </td>
                  <td className="py-3 px-3 text-right text-gray-900 dark:text-white">
                    <span className="font-semibold">{playType.points.toFixed(1)}</span>
                    <span className="text-gray-500 dark:text-gray-400 ml-1">
                      ({playType.pointsPct}%)
                    </span>
                  </td>
                  <td className="py-3 px-3 text-right">
                    {playType.oppRank !== null ? (
                      <span className={`inline-flex items-center justify-center min-w-[3rem] px-2 py-1 rounded font-semibold ${getRankColor(playType.oppRank)} ${getRankBgColor(playType.oppRank)}`}>
                        #{playType.oppRank}
                      </span>
                    ) : (
                      <span className="text-gray-400 dark:text-gray-500">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && (playTypeData.length === 0 || totalPoints === 0) && (
        <div className="text-center py-12">
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
            Play type data is not currently available
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            The NBA Stats API's play type endpoint is not returning data. This feature may be temporarily unavailable.
          </p>
        </div>
      )}

      {/* Legend */}
      {!loading && !error && playTypeData.length > 0 && opponentTeam && opponentTeam !== 'N/A' && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-600 dark:text-gray-400 font-semibold">Better Defense</span>
            <div className="flex-1 mx-2 h-2 bg-gradient-to-r from-red-500 via-orange-500 via-yellow-500 to-green-500 rounded"></div>
            <span className="text-gray-600 dark:text-gray-400 font-semibold">Easier Defense</span>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 text-center">
            Lower rank = stronger defense (harder matchup) • Higher rank = weaker defense (easier matchup)
          </p>
        </div>
      )}
        </div>
      )}
    </div>
  );
}

