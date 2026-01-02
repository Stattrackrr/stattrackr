'use client';

import { memo, useState, useEffect } from 'react';
import { OfficialOddsCardProps } from '../../types';

export const OfficialOddsCard = memo(function OfficialOddsCard({
  isDark,
  derivedOdds,
  intradayMovements,
  selectedTeam,
  opponentTeam,
  selectedTeamLogoUrl,
  opponentTeamLogoUrl,
  matchupInfo,
  oddsFormat,
  books,
  fmtOdds,
  lineMovementEnabled,
  lineMovementData,
  selectedStat,
  calculatedImpliedOdds,
  selectedBookmakerName,
  selectedBookmakerLine,
  propsMode = 'player',
  selectedPlayer,
  primaryMarketLine,
  bettingLine,
}: OfficialOddsCardProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper to render donut chart wheel (hollow, green on left, red on right)
  const renderWheel = (overPercent: number, underPercent: number, label: string, size = 120) => {
    const radius = size / 2 - 20; // Inner radius for donut (hollow center)
    const circumference = 2 * Math.PI * radius;
    const overLength = circumference * (overPercent / 100);
    const underLength = circumference * (underPercent / 100);
    
    return (
      <div className="flex flex-col items-center">
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
          {/* Background circle (full circle, light gray) */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={mounted && isDark ? "#374151" : "#e5e7eb"}
            strokeWidth="16"
          />
          {/* Under (red, right side) - draw first so it's on the right */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#ef4444"
            strokeWidth="16"
            strokeDasharray={`${underLength} ${circumference}`}
            strokeDashoffset={-overLength}
            strokeLinecap="round"
          />
          {/* Over (green, left side) - draw second so it's on the left */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="#10b981"
            strokeWidth="16"
            strokeDasharray={`${overLength} ${circumference}`}
            strokeDashoffset={0}
            strokeLinecap="round"
          />
          {/* Center text - counter-rotate to keep it upright */}
          <text
            x={size / 2}
            y={size / 2}
            textAnchor="middle"
            dominantBaseline="middle"
            transform={`rotate(90 ${size / 2} ${size / 2})`}
            className={`text-sm font-semibold ${mounted && isDark ? 'fill-white' : 'fill-gray-900'}`}
          >
            {overPercent.toFixed(1)}%
          </text>
        </svg>
        <div className={`text-xs mt-2 font-medium ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {label}
        </div>
      </div>
    );
  };

  // Always render container - show empty state for game props instead of returning null
  return (
    <div className="relative z-50 bg-white dark:bg-[#0a1929] rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 w-full min-w-0 flex-shrink-0 overflow-hidden">
      <div className="p-3 sm:p-4 md:p-6">
        {/* Show empty state for game props mode */}
        {propsMode === 'team' ? (
          <div className="text-center py-8">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Official Odds are only available for Player Props
            </div>
          </div>
        ) : (
          <>
            {/* Market Predicted Outcomes - Full Width (only show for player props, not game props) */}
            <div>
              <div>
                <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#0a1929]/40 p-4 h-full flex flex-col gap-3">
                  <div className="text-sm sm:text-base font-semibold text-gray-900 dark:text-white">
                    Market Predicted Outcomes
                  </div>
                  
                  {/* Player Name and Line */}
                  {selectedPlayer && selectedStat && (
                    <div className="flex items-center gap-2 text-xs sm:text-sm mb-2">
                      <span className={mounted && isDark ? 'text-gray-300' : 'text-gray-600'}>
                        {selectedPlayer.full || `${selectedPlayer.firstName || ''} ${selectedPlayer.lastName || ''}`.trim()}:
                      </span>
                      <span className={(mounted && isDark ? 'text-slate-200' : 'text-slate-800') + ' font-mono font-semibold'}>
                        {selectedStat.toUpperCase()} {primaryMarketLine !== null && primaryMarketLine !== undefined && Number.isFinite(primaryMarketLine) ? primaryMarketLine.toFixed(1) : selectedBookmakerLine !== null && selectedBookmakerLine !== undefined && Number.isFinite(selectedBookmakerLine) ? selectedBookmakerLine.toFixed(1) : (bettingLine !== null && bettingLine !== undefined && Number.isFinite(bettingLine) ? bettingLine.toFixed(1) : 'N/A')}
                      </span>
                    </div>
                  )}

                  {/* Bookmaker/Implied Odds Wheel */}
                  <div className="flex flex-col items-center justify-center">
                    {calculatedImpliedOdds ? (
                      <>
                        {renderWheel(
                          calculatedImpliedOdds.overImpliedProb ?? 50,
                          calculatedImpliedOdds.underImpliedProb ?? 50,
                          'Bookmaker/Implied Odds',
                          140
                        )}
                        <div className="mt-3 text-center">
                          <div className={`text-xs ${mounted && isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                            Market Prob: <span className="font-semibold">{calculatedImpliedOdds.overImpliedProb?.toFixed(1) ?? 'N/A'}%</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className={`text-sm ${mounted && isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                        No market odds available
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  return (
    prev.isDark === next.isDark &&
    prev.derivedOdds === next.derivedOdds &&
    prev.intradayMovements === next.intradayMovements &&
    prev.selectedTeam === next.selectedTeam &&
    prev.opponentTeam === next.opponentTeam &&
    prev.selectedTeamLogoUrl === next.selectedTeamLogoUrl &&
    prev.opponentTeamLogoUrl === next.opponentTeamLogoUrl &&
    prev.matchupInfo?.tipoffLocal === next.matchupInfo?.tipoffLocal &&
    prev.oddsFormat === next.oddsFormat &&
    prev.books === next.books &&
    prev.calculatedImpliedOdds === next.calculatedImpliedOdds &&
    prev.selectedBookmakerName === next.selectedBookmakerName &&
    prev.selectedBookmakerLine === next.selectedBookmakerLine
  );
});

