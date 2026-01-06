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

  // Return null - this component is no longer used
  return null;
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

