'use client';

import { memo } from 'react';
import { CHART_CONFIG } from '../../constants';

export default memo(function StaticBettingLineOverlay({ 
  isDark, 
  isMobile 
}: { 
  isDark: boolean; 
  isMobile?: boolean 
}) {
  const lineColor = isDark ? '#ffffff' : '#000000';
  
  return (
    <div 
      id="betting-line-container"
      className="absolute pointer-events-none"
      style={{
        left: isMobile ? 8 : CHART_CONFIG.yAxis.width,
        right: isMobile ? 8 : (CHART_CONFIG.margin.right + 10),
        top: CHART_CONFIG.margin.top,
        bottom: isMobile ? CHART_CONFIG.margin.bottom : CHART_CONFIG.margin.bottom + 30,
        zIndex: 5
      }}
    >
      <div
        id="betting-line-fast"
        className="absolute w-full"
        style={{
          bottom: '50%',
          opacity: 0.8,
          height: '3px',
          background: `repeating-linear-gradient(to right, ${lineColor} 0px, ${lineColor} 12px, transparent 12px, transparent 18px)`
        }}
      />
    </div>
  );
}, (prev, next) => prev.isDark === next.isDark);




