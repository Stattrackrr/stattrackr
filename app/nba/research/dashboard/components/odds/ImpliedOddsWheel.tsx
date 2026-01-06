'use client';

import { memo, useState, useEffect } from 'react';

interface ImpliedOddsWheelProps {
  isDark: boolean;
  calculatedImpliedOdds: {
    overImpliedProb?: number;
    underImpliedProb?: number;
  } | null;
  size?: number;
}

export const ImpliedOddsWheel = memo(function ImpliedOddsWheel({
  isDark,
  calculatedImpliedOdds,
  size = 120,
}: ImpliedOddsWheelProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  // Helper to render donut chart wheel (hollow, green on left, red on right)
  const renderWheel = (overPercent: number, underPercent: number) => {
    const radius = size / 2 - 14; // Inner radius for donut (hollow center) - adjusted for stroke
    const circumference = 2 * Math.PI * radius;
    const overAngle = (overPercent / 100) * 360;
    const underAngle = (underPercent / 100) * 360;
    const strokeWidth = 8; // Slightly thicker, professional stroke width
    
    // Determine which is higher
    const isOverHigher = overPercent >= underPercent;
    const higherPercent = isOverHigher ? overPercent : underPercent;
    const label = isOverHigher ? 'Over' : 'Under';
    
    // Start at 9 o'clock (270deg) which becomes left after -90deg rotation
    const startAngle = 270;
    const centerX = size / 2;
    const centerY = size / 2;
    
    // Helper to create arc path
    const createArcPath = (startAngleDeg: number, endAngleDeg: number) => {
      const startAngleRad = (startAngleDeg * Math.PI) / 180;
      const endAngleRad = (endAngleDeg * Math.PI) / 180;
      const x1 = centerX + radius * Math.cos(startAngleRad);
      const y1 = centerY + radius * Math.sin(startAngleRad);
      const x2 = centerX + radius * Math.cos(endAngleRad);
      const y2 = centerY + radius * Math.sin(endAngleRad);
      const largeArcFlag = endAngleDeg - startAngleDeg > 180 ? 1 : 0;
      return `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2}`;
    };
    
    const greenStartAngle = startAngle;
    const greenEndAngle = startAngle + overAngle;
    const redStartAngle = greenEndAngle;
    const redEndAngle = redStartAngle + underAngle;
    
    // Adjust font sizes based on size prop
    const percentFontSize = size <= 90 ? 'text-sm' : 'text-lg';
    const labelFontSize = size <= 90 ? 'text-[9px]' : 'text-[10px]';
    
    return (
      <svg width={size} height={size} className="transform -rotate-90">
        <g>
          {/* Background circle (full circle, subtle gray) */}
          <circle
            cx={centerX}
            cy={centerY}
            r={radius}
            fill="none"
            stroke={isDark ? '#374151' : '#e5e7eb'}
            strokeWidth={strokeWidth}
          />
          {/* Over (green, left side) - starts at 9 o'clock (270deg), which becomes left after -90deg rotation */}
          <path
            d={createArcPath(greenStartAngle, greenEndAngle)}
            fill="none"
            stroke="#10b981"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
          {/* Under (red, right side) - starts exactly where green ends, forming continuous circle */}
          <path
            d={createArcPath(redStartAngle, redEndAngle)}
            fill="none"
            stroke="#ef4444"
            strokeWidth={strokeWidth}
            strokeLinecap="butt"
          />
          {/* Center text - counter-rotate to keep it upright */}
          <g transform={`rotate(90 ${centerX} ${centerY})`}>
            <text
              x={centerX}
              y={centerY - 4}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`${percentFontSize} font-semibold ${isDark ? 'fill-white' : 'fill-gray-900'}`}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {higherPercent.toFixed(1)}%
            </text>
            <text
              x={centerX}
              y={centerY + 12}
              textAnchor="middle"
              dominantBaseline="middle"
              className={`${labelFontSize} ${isDark ? 'fill-gray-400' : 'fill-gray-600'}`}
              style={{ fontFamily: 'system-ui, -apple-system, sans-serif' }}
            >
              {label}
            </text>
          </g>
        </g>
      </svg>
    );
  };

  if (!mounted || !calculatedImpliedOdds) {
    return null;
  }

  return (
    <div className="flex items-center justify-center">
      {renderWheel(
        calculatedImpliedOdds.overImpliedProb ?? 50,
        calculatedImpliedOdds.underImpliedProb ?? 50,
      )}
    </div>
  );
}, (prev, next) => {
  return (
    prev.isDark === next.isDark &&
    prev.calculatedImpliedOdds === next.calculatedImpliedOdds &&
    prev.size === next.size
  );
});
