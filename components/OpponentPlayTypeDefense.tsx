// components/OpponentPlayTypeDefense.tsx
"use client";

import React, { useState, useEffect } from 'react';

interface OpponentPlayTypeDefenseProps {
  opponentTeam: string;
  opponentTeamLogoUrl?: string;
  season?: number;
  isDark?: boolean;
}

interface PlayTypeDefense {
  playType: string;
  displayName: string;
  points: number; // Points allowed
  fgPct: number; // FG% allowed
  rank: number; // 1-30 ranking (1 = best defense, 30 = worst defense)
  frequency: number; // % of opponent possessions
}

export function OpponentPlayTypeDefense({ 
  opponentTeam, 
  opponentTeamLogoUrl,
  season = 2025,
  isDark = false
}: OpponentPlayTypeDefenseProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playTypeData, setPlayTypeData] = useState<PlayTypeDefense[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      if (!opponentTeam || opponentTeam === 'N/A') {
        setLoading(false);
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/opponent-playtype-defense?team=${encodeURIComponent(opponentTeam)}&season=${season}`
        );

        if (!response.ok) {
          throw new Error('Failed to fetch play type defense data');
        }

        const data = await response.json();
        setPlayTypeData(data.playTypes || []);
      } catch (err: any) {
        console.error('[OpponentPlayTypeDefense] Error:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [opponentTeam, season]);

  const getRankColor = (rank: number) => {
    // Lower rank = better defense = harder for opponent (red for betting)
    // Higher rank = worse defense = easier for opponent (green for betting)
    if (rank <= 10) return 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20'; // Elite defense (bad for offense)
    if (rank <= 20) return 'text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20'; // Average defense
    return 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20'; // Weak defense (good for offense)
  };

  const getRankLabel = (rank: number) => {
    if (rank <= 10) return '🔒 Elite'; // Strong defense
    if (rank <= 20) return '➖ Average';
    return '✅ Weak'; // Weak defense = opportunity
  };

  if (!opponentTeam || opponentTeam === 'N/A') {
    return null;
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        {opponentTeamLogoUrl && (
          <img 
            src={opponentTeamLogoUrl} 
            alt={opponentTeam}
            className="w-8 h-8 object-contain"
          />
        )}
        <div>
          <h3 className="text-lg font-semibold">Play Type Defense</h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            vs {opponentTeam} • {season}-{(season + 1).toString().slice(-2)}
          </p>
        </div>
      </div>

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

      {/* Data Display */}
      {!loading && !error && playTypeData.length > 0 && (
        <div className="space-y-3">
          {playTypeData.map((playType) => (
            <div 
              key={playType.playType}
              className="border border-gray-200 dark:border-gray-700 rounded-lg p-3 hover:border-purple-400 dark:hover:border-purple-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-gray-900 dark:text-white">
                    {playType.displayName}
                  </span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${getRankColor(playType.rank)}`}>
                    #{playType.rank} {getRankLabel(playType.rank)}
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-2 text-sm">
                <div>
                  <span className="text-gray-600 dark:text-gray-400 text-xs">Points Allowed</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {playType.points.toFixed(1)}
                  </p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400 text-xs">FG% Allowed</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {playType.fgPct.toFixed(1)}%
                  </p>
                </div>
                <div>
                  <span className="text-gray-600 dark:text-gray-400 text-xs">Frequency</span>
                  <p className="font-semibold text-gray-900 dark:text-white">
                    {playType.frequency.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!loading && !error && playTypeData.length === 0 && (
        <div className="text-center py-12">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            No play type defense data available
          </p>
        </div>
      )}

      {/* Legend */}
      {!loading && !error && playTypeData.length > 0 && (
        <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
          <p className="text-xs text-gray-600 dark:text-gray-400">
            <span className="font-semibold">Ranking Guide:</span> Lower rank = stronger defense (harder matchup). 
            <span className="text-green-600 dark:text-green-400"> ✅ Weak defense</span> = betting opportunity.
          </p>
        </div>
      )}
    </div>
  );
}


