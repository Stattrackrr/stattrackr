'use client';

import { memo, useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, ReferenceLine, LabelList } from 'recharts';
import { CHART_CONFIG } from '../../constants';
import { getEspnLogoCandidates } from '../../constants';
import StaticBarsChart from './StaticBarsChart';
import DynamicReferenceLineChart from './DynamicReferenceLineChart';
import StaticBettingLineOverlay from './StaticBettingLineOverlay';
import { updateBettingLinePosition } from './chartUtils';

// Re-export for convenience
export { StaticBarsChart, DynamicReferenceLineChart, StaticBettingLineOverlay };

export default memo(function StatsBarChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
  selectedTimeframe,
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
  selectedTimeframe?: string;
}) {
  useEffect(() => {
    updateBettingLinePosition(yAxisConfig, bettingLine);
  }, [bettingLine, yAxisConfig]);

  const [isMobile, setIsMobile] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [mobileTooltipActive, setMobileTooltipActive] = useState(false);
  const mobileTooltipTimerRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const clearMobileTooltipTimer = useCallback(() => {
    if (mobileTooltipTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(mobileTooltipTimerRef.current);
      mobileTooltipTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      clearMobileTooltipTimer();
    };
  }, [clearMobileTooltipTimer]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => {
      const matches = mq.matches;
      setIsMobile(prev => {
        if (prev !== matches) {
          setLayoutKey((k) => k + 1);
          if (!matches) {
            setMobileTooltipActive(false);
            clearMobileTooltipTimer();
          }
        }
        return matches;
      });
    };
    update();
    if (mq.addEventListener) {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    } else {
      // @ts-ignore
      mq.addListener(update);
      return () => {
        // @ts-ignore
        mq.removeListener(update);
      };
    }
  }, []);

  const [mobileLine, setMobileLine] = useState<number | null>(null);
  useEffect(() => {
    const handler = (e: any) => {
      const v = e?.detail?.value;
      if (typeof v === 'number') setMobileLine(v);
    };
    window.addEventListener('transient-line', handler as any);
    return () => window.removeEventListener('transient-line', handler as any);
  }, []);
  useEffect(() => { setMobileLine(null); }, [bettingLine, selectedStat]);

  const activeLine = mobileLine ?? bettingLine;

  const colorMap = useMemo(() => {
    return data.map(e => {
      const val = e.value;
      if (val == null) return 'under';
      return val > activeLine ? 'over' : val === activeLine ? 'push' : 'under';
    });
  }, [data, activeLine]);

  const overCount = colorMap.filter(c => c === 'over').length;
  const underCount = colorMap.filter(c => c === 'under').length;
  const total = data.length;
  const overPercent = total > 0 ? (overCount / total) * 100 : 0;
  const underPercent = total > 0 ? (underCount / total) * 100 : 0;
  
  let backgroundGradient = '';
  const disableGlow = ['moneyline', 'spread'].includes(selectedStat);
  if (!disableGlow && overPercent > 60) {
    backgroundGradient = isDark 
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.28) 0%, rgba(34, 197, 94, 0.20) 15%, rgba(34, 197, 94, 0.12) 30%, rgba(34, 197, 94, 0.06) 45%, rgba(34, 197, 94, 0.02) 60%, rgba(34, 197, 94, 0.008) 75%, rgba(34, 197, 94, 0.003) 85%, rgba(34, 197, 94, 0.001) 92%, rgba(34, 197, 94, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.20) 0%, rgba(34, 197, 94, 0.14) 15%, rgba(34, 197, 94, 0.09) 30%, rgba(34, 197, 94, 0.045) 45%, rgba(34, 197, 94, 0.015) 60%, rgba(34, 197, 94, 0.006) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > 60) {
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.20) 15%, rgba(239, 68, 68, 0.12) 30%, rgba(239, 68, 68, 0.06) 45%, rgba(239, 68, 68, 0.02) 60%, rgba(239, 68, 68, 0.008) 75%, rgba(239, 68, 68, 0.003) 85%, rgba(239, 68, 68, 0.001) 92%, rgba(239, 68, 68, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.20) 0%, rgba(239, 68, 68, 0.14) 15%, rgba(239, 68, 68, 0.09) 30%, rgba(239, 68, 68, 0.045) 45%, rgba(239, 68, 68, 0.015) 60%, rgba(239, 68, 68, 0.006) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
  } else if (!disableGlow && overPercent > underPercent && overPercent > 40) {
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0.11) 15%, rgba(34, 197, 94, 0.06) 30%, rgba(34, 197, 94, 0.03) 45%, rgba(34, 197, 94, 0.012) 60%, rgba(34, 197, 94, 0.005) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.085) 15%, rgba(34, 197, 94, 0.055) 30%, rgba(34, 197, 94, 0.024) 45%, rgba(34, 197, 94, 0.008) 60%, rgba(34, 197, 94, 0.003) 75%, rgba(34, 197, 94, 0.001) 85%, rgba(34, 197, 94, 0.0003) 92%, rgba(34, 197, 94, 0.00005) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > overPercent && underPercent > 40) {
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.16) 0%, rgba(239, 68, 68, 0.11) 15%, rgba(239, 68, 68, 0.06) 30%, rgba(239, 68, 68, 0.03) 45%, rgba(239, 68, 68, 0.012) 60%, rgba(239, 68, 68, 0.005) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.085) 15%, rgba(239, 68, 68, 0.055) 30%, rgba(239, 68, 68, 0.024) 45%, rgba(239, 68, 68, 0.008) 60%, rgba(239, 68, 68, 0.003) 75%, rgba(239, 68, 68, 0.001) 85%, rgba(239, 68, 68, 0.0003) 92%, rgba(239, 68, 68, 0.00005) 97%, transparent 100%)';
  }

  const handleChartTouchStart = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setIsDragging(false);
    setMobileTooltipActive(false); // Always hide tooltip on touch start
    
    // Prevent Recharts from handling the touch event
    if (event && 'preventDefault' in event) {
      event.preventDefault();
    }
    
    if (event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    } else {
      touchStartRef.current = null;
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchMove = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    
    // Always hide tooltip during any movement (scrolling)
    setMobileTooltipActive(false);
    clearMobileTooltipTimer();
    
    if (touchStartRef.current && event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const distanceSquared = dx * dx + dy * dy;
      // Reduced threshold to detect scrolling more easily (from 16 to 5 pixels)
      if (distanceSquared > 25) {
        setIsDragging(true);
      }
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchEnd = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    
    // Check if this was a tap (no movement and quick)
    const wasTap = touchStartRef.current && !isDragging && 
                   (Date.now() - (touchStartRef.current.time || 0)) < 300;
    
    touchStartRef.current = null;
    
    if (isDragging || !wasTap) {
      // Was a scroll/drag, don't show tooltip
      setMobileTooltipActive(false);
      setIsDragging(false);
      return;
    }
    
    // Was a tap, show tooltip (tap again elsewhere to close)
    setIsDragging(false);
    setMobileTooltipActive(true);
  }, [isMobile, clearMobileTooltipTimer, isDragging]);

  const handleChartMouseLeave = useCallback(() => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setMobileTooltipActive(false);
  }, [isMobile, clearMobileTooltipTimer]);

  const adjustedTooltip = useCallback((tooltipProps: any) => {
    // On mobile, only show tooltip if explicitly activated by tap and not dragging
    if (isMobile) {
      if (!mobileTooltipActive || isDragging) {
        return null;
      }
    }
    return customTooltip(tooltipProps);
  }, [isMobile, mobileTooltipActive, isDragging, customTooltip]);

  return (
    <div 
      className="relative w-full h-full chart-mobile-optimized" 
      key={layoutKey}
      style={isMobile ? { touchAction: 'pan-y' } : undefined}
      onTouchStart={(e) => {
        if (isMobile) {
          // Don't handle touch events if they're on interactive elements (buttons)
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, select, textarea')) {
            return; // Let buttons handle their own touch events
          }
          handleChartTouchStart(e);
        }
      }}
      onTouchMove={(e) => {
        if (isMobile) {
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, select, textarea')) {
            return;
          }
          handleChartTouchMove(e);
        }
      }}
      onTouchEnd={(e) => {
        if (isMobile) {
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, select, textarea')) {
            return;
          }
          handleChartTouchEnd(e);
        }
      }}
    >
      {backgroundGradient && (
        <div 
          key={`glow-${activeLine}-${overPercent.toFixed(0)}`}
          className="absolute pointer-events-none" 
          style={{ 
            top: '-5%',
            left: '-30%',
            right: '-30%',
            bottom: '-30%',
            background: backgroundGradient,
            zIndex: 0,
            transition: 'background 0.1s ease-out'
          }}
        />
      )}
      <StaticBarsChart
        key={`${selectedStat}-${selectedTimeframe || ''}-${yAxisConfig?.domain?.join?.(',') || ''}`}
        data={data}
        yAxisConfig={yAxisConfig}
        isDark={isDark}
        bettingLine={bettingLine}
        customTooltip={adjustedTooltip}
        formatChartLabel={formatChartLabel}
        selectedStat={selectedStat}
        compactMobile={isMobile}
        selectedTimeframe={selectedTimeframe}
        onChartTouchStart={handleChartTouchStart}
        onChartTouchMove={handleChartTouchMove}
        onChartTouchEnd={handleChartTouchEnd}
        onChartMouseLeave={handleChartMouseLeave}
      />
      {isMobile && (
        <div className="absolute inset-0 pointer-events-none">
          <DynamicReferenceLineChart
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={mobileLine ?? bettingLine}
            dataLength={data.length}
            compactMobile={isMobile}
          />
        </div>
      )}
      {!isMobile && <StaticBettingLineOverlay isDark={isDark} />}
    </div>
  );
});

