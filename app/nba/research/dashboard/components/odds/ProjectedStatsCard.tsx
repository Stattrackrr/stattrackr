'use client';

import { memo, useState, useEffect } from 'react';

export default memo(function ProjectedStatsCard({ 
  isDark, 
  selectedPlayer, 
  opponentTeam, 
  currentTeam,
  projectedMinutes,
  loading,
  predictedPace,
  seasonFgPct,
  averageUsageRate,
  averageMinutes,
  averageGamePace,
  selectedTimeframe
}: { 
  isDark: boolean; 
  selectedPlayer: any; 
  opponentTeam: string; 
  currentTeam: string;
  projectedMinutes: number | null;
  loading: boolean;
  predictedPace: number | null;
  seasonFgPct: number | null;
  averageUsageRate: number | null;
  averageMinutes: number | null;
  averageGamePace: number | null;
  selectedTimeframe?: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!selectedPlayer || !currentTeam || !opponentTeam) {
    return (
      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Projected</h3>
        </div>
        <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} p-4`}>
          <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
            Select a player to view projected stats
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Projected</h3>
      </div>
      <div className={`rounded-xl border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} shadow-sm`}>
        {loading ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500 dark:text-gray-400">
            Loading projections...
          </div>
        ) : (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Projected Minutes */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'} p-4 transition-all`}>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium uppercase tracking-wide ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'} mb-2`}>
                    Projected Minutes
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                      {projectedMinutes !== null ? `${projectedMinutes.toFixed(1)}` : '—'}
                    </span>
                    {projectedMinutes !== null && (
                      <span className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>min</span>
                    )}
                  </div>
                  {averageMinutes !== null && (
                    <div className={`text-xs ${mounted && isDark ? 'text-white' : 'text-gray-900'} mt-1.5`}>
                      Avg: {averageMinutes.toFixed(1)} min
                    </div>
                  )}
                </div>
              </div>

              {/* Predicted Game Pace */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'} p-4 transition-all`}>
                <div className="flex flex-col">
                  <span className={`text-[10px] font-medium uppercase tracking-wide ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'} mb-0.5`}>
                    Projected
                  </span>
                  <span className={`text-xs font-medium uppercase tracking-wide ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'} mb-2`}>
                    Game Pace
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                      {predictedPace !== null ? `${predictedPace.toFixed(1)}` : '—'}
                    </span>
                    {predictedPace !== null && (
                      <span className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>poss</span>
                    )}
                  </div>
                  {averageGamePace !== null && (
                    <div className={`text-xs ${mounted && isDark ? 'text-white' : 'text-gray-900'} mt-1.5`}>
                      Avg: {averageGamePace.toFixed(1)} poss
                    </div>
                  )}
                </div>
              </div>

              {/* Average Usage Rate / FG% */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30 hover:bg-gray-800/50' : 'border-gray-200 bg-gray-50 hover:bg-gray-100'} p-4 transition-all`}>
                <div className="flex flex-col">
                  <span className={`text-xs font-medium uppercase tracking-wide ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'} mb-2`}>
                    {(() => {
                      const timeframe = selectedTimeframe || 'last10';
                      if (timeframe === 'last10') return 'L10 Average Usage';
                      if (timeframe === 'last5') return 'L5 Average Usage';
                      if (timeframe === 'thisseason') return 'Season Average Usage';
                      if (timeframe === 'lastseason') return 'Last Season Avg Usage';
                      if (timeframe === 'h2h') return 'H2H Average Usage';
                      return 'Average Usage';
                    })()}
                  </span>
                  <div className="flex items-baseline gap-1">
                    <span className={`text-2xl font-bold ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>
                      {averageUsageRate !== null ? `${averageUsageRate.toFixed(1)}` : '—'}
                    </span>
                    {averageUsageRate !== null && (
                      <span className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>%</span>
                    )}
                  </div>
                  {seasonFgPct !== null && (
                    <div className={`text-xs ${mounted && isDark ? 'text-white' : 'text-gray-900'} mt-1.5`}>
                      Avg FG%: {seasonFgPct.toFixed(1)}%
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => 
  prev.isDark === next.isDark && 
  prev.selectedPlayer?.id === next.selectedPlayer?.id &&
  prev.opponentTeam === next.opponentTeam && 
  prev.currentTeam === next.currentTeam &&
  prev.projectedMinutes === next.projectedMinutes &&
  prev.predictedPace === next.predictedPace &&
  prev.seasonFgPct === next.seasonFgPct &&
  prev.averageUsageRate === next.averageUsageRate &&
  prev.averageMinutes === next.averageMinutes &&
  prev.averageGamePace === next.averageGamePace &&
  prev.selectedTimeframe === next.selectedTimeframe
);






