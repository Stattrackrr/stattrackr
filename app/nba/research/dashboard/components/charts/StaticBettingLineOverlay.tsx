'use client';

import { memo } from 'react';
import { CHART_CONFIG } from '../../constants';

const StaticBettingLineOverlay = memo(function StaticBettingLineOverlay({ isDark, isMobile, hasSecondAxis }: { isDark: boolean; isMobile?: boolean; hasSecondAxis?: boolean }) {
  const lineColor = isDark ? '#ffffff' : '#000000';
  
  // Adjust right margin when there's a second axis - extra space beyond chart's 10px to stop before y-axis
  // On mobile, always use full width (2px) since y-axis is hidden
  const rightMargin = isMobile ? 2 : (hasSecondAxis ? 70 : (CHART_CONFIG.margin.right + 10));
  
  return (
    <div 
      id="betting-line-container"
      className="absolute pointer-events-none"
      style={{
        left: isMobile ? 2 : CHART_CONFIG.yAxis.width,
        right: rightMargin,
        top: CHART_CONFIG.margin.top,
        bottom: isMobile ? CHART_CONFIG.margin.bottom : CHART_CONFIG.margin.bottom + 40,
        zIndex: 5 // above bars but below tooltips
      }}
    >
      <div
        id="betting-line-fast"
        className="absolute w-full"
        style={{
          bottom: '50%', // Initial position
          opacity: 1,
          height: '2px',
          background: lineColor
        }}
      />
    </div>
  );
}, (prev, next) => prev.isDark === next.isDark && prev.hasSecondAxis === next.hasSecondAxis && prev.isMobile === next.isMobile);

export default StaticBettingLineOverlay;
