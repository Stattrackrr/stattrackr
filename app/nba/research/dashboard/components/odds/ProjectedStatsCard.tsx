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

  // Always render the container - show skeleton when loading or data missing
  const showSkeleton = loading || !selectedPlayer || !currentTeam || !opponentTeam;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Projected</h3>
      </div>
      <div className={`rounded-xl border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} shadow-sm`}>
        {showSkeleton ? (
          <div className="p-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Skeleton for Projected Minutes */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50'} p-4`}>
                <div className={`h-3 w-24 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-3`}></div>
                <div className={`h-8 w-16 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-2`} style={{ animationDelay: '0.1s' }}></div>
                <div className={`h-3 w-20 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'}`} style={{ animationDelay: '0.2s' }}></div>
              </div>
              {/* Skeleton for Predicted Game Pace */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50'} p-4`}>
                <div className={`h-3 w-28 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-3`} style={{ animationDelay: '0.15s' }}></div>
                <div className={`h-8 w-16 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-2`} style={{ animationDelay: '0.25s' }}></div>
                <div className={`h-3 w-20 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'}`} style={{ animationDelay: '0.35s' }}></div>
              </div>
              {/* Skeleton for Average Usage Rate */}
              <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-gray-800/30' : 'border-gray-200 bg-gray-50'} p-4`}>
                <div className={`h-3 w-32 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-3`} style={{ animationDelay: '0.2s' }}></div>
                <div className={`h-8 w-16 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'} mb-2`} style={{ animationDelay: '0.3s' }}></div>
                <div className={`h-3 w-24 rounded animate-pulse ${mounted && isDark ? 'bg-gray-700' : 'bg-gray-300'}`} style={{ animationDelay: '0.4s' }}></div>
              </div>
            </div>
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











