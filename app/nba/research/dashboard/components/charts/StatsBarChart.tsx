
'use client';

import { memo, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  ResponsiveContainer, ReferenceLine, Cell, Tooltip, LabelList
} from 'recharts';
import { updateBettingLinePosition } from './chartUtils';
import StaticLabelList from './StaticLabelList';
import CustomXAxisTick from './CustomXAxisTick';
import StaticBettingLineOverlay from './StaticBettingLineOverlay';
import StaticBarsChart from './StaticBarsChart';
import DynamicReferenceLineChart from './DynamicReferenceLineChart';

// Combined chart component
const StatsBarChart = memo(function StatsBarChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
  selectedTimeframe,
  secondAxisData,
  selectedFilterForAxis,
}: {
  data: any[];
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  customTooltip: any;
  formatChartLabel: (v: any) => string;
  selectedStat: string;
  selectedTimeframe?: string;
  secondAxisData?: Array<{ gameId: string; gameDate: string; value: number | null }> | null;
  selectedFilterForAxis?: string | null;
}) {
  // Keep overlay in sync only with committed line (reduces updates during hold).
  useEffect(() => {
    updateBettingLinePosition(yAxisConfig, bettingLine, !!selectedFilterForAxis);
  }, [bettingLine, yAxisConfig, selectedFilterForAxis]);

  // Detect mobile only on client to avoid affecting desktop SSR
  const [isMobile, setIsMobile] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [mobileTooltipActive, setMobileTooltipActive] = useState(false);
  const mobileTooltipTimerRef = useRef<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);

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
      // Safari/older
      // @ts-ignore
      mq.addListener(update);
      return () => {
        // @ts-ignore
        mq.removeListener(update);
      };
    }
  }, []);

  // Mobile transient line for live updates during hold (ReferenceLine follows this)
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

  // Use transient line if available, otherwise use committed betting line
  const activeLine = mobileLine ?? bettingLine;

  // Calculate colorMap for background glow using active line (transient or committed)
  const colorMap = useMemo(() => {
    return data.map(e => {
      const val = e.value;
      if (val == null) return 'under';
      return val > activeLine ? 'over' : val === activeLine ? 'push' : 'under';
    });
  }, [data, activeLine]);

  // Calculate predominant trend for background glow
  const overCount = colorMap.filter((c: string) => c === 'over').length;
  const underCount = colorMap.filter((c: string) => c === 'under').length;
  const total = data.length;
  const overPercent = total > 0 ? (overCount / total) * 100 : 0;
  const underPercent = total > 0 ? (underCount / total) * 100 : 0;
  
  // Determine background glow based on predominant trend (disabled for moneyline/spread)
  let backgroundGradient = '';
  const disableGlow = ['moneyline', 'spread'].includes(selectedStat);
  if (!disableGlow && overPercent > 60) {
    // Strong over trend - green glow
    backgroundGradient = isDark 
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.28) 0%, rgba(34, 197, 94, 0.20) 15%, rgba(34, 197, 94, 0.12) 30%, rgba(34, 197, 94, 0.06) 45%, rgba(34, 197, 94, 0.02) 60%, rgba(34, 197, 94, 0.008) 75%, rgba(34, 197, 94, 0.003) 85%, rgba(34, 197, 94, 0.001) 92%, rgba(34, 197, 94, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.20) 0%, rgba(34, 197, 94, 0.14) 15%, rgba(34, 197, 94, 0.09) 30%, rgba(34, 197, 94, 0.045) 45%, rgba(34, 197, 94, 0.015) 60%, rgba(34, 197, 94, 0.006) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > 60) {
    // Strong under trend - red glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.20) 15%, rgba(239, 68, 68, 0.12) 30%, rgba(239, 68, 68, 0.06) 45%, rgba(239, 68, 68, 0.02) 60%, rgba(239, 68, 68, 0.008) 75%, rgba(239, 68, 68, 0.003) 85%, rgba(239, 68, 68, 0.001) 92%, rgba(239, 68, 68, 0.0002) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.20) 0%, rgba(239, 68, 68, 0.14) 15%, rgba(239, 68, 68, 0.09) 30%, rgba(239, 68, 68, 0.045) 45%, rgba(239, 68, 68, 0.015) 60%, rgba(239, 68, 68, 0.006) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
  } else if (!disableGlow && overPercent > underPercent && overPercent > 40) {
    // Slight over trend - subtle green glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0.11) 15%, rgba(34, 197, 94, 0.06) 30%, rgba(34, 197, 94, 0.03) 45%, rgba(34, 197, 94, 0.012) 60%, rgba(34, 197, 94, 0.005) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.085) 15%, rgba(34, 197, 94, 0.055) 30%, rgba(34, 197, 94, 0.024) 45%, rgba(34, 197, 94, 0.008) 60%, rgba(34, 197, 94, 0.003) 75%, rgba(34, 197, 94, 0.001) 85%, rgba(34, 197, 94, 0.0003) 92%, rgba(34, 197, 94, 0.00005) 97%, transparent 100%)';
  } else if (!disableGlow && underPercent > overPercent && underPercent > 40) {
    // Slight under trend - subtle red glow
    backgroundGradient = isDark
      ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.16) 0%, rgba(239, 68, 68, 0.11) 15%, rgba(239, 68, 68, 0.06) 30%, rgba(239, 68, 68, 0.03) 45%, rgba(239, 68, 68, 0.012) 60%, rgba(239, 68, 68, 0.005) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
      : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.085) 15%, rgba(239, 68, 68, 0.055) 30%, rgba(239, 68, 68, 0.024) 45%, rgba(239, 68, 68, 0.008) 60%, rgba(239, 68, 68, 0.003) 75%, rgba(239, 68, 68, 0.001) 85%, rgba(239, 68, 68, 0.0003) 92%, rgba(239, 68, 68, 0.00005) 97%, transparent 100%)';
  }

  const handleChartTouchStart = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setIsDragging(false);
    if (event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      touchStartRef.current = { x: touch.clientX, y: touch.clientY };
    } else {
      touchStartRef.current = null;
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchMove = useCallback((event?: React.TouchEvent | TouchEvent) => {
    if (!isMobile) return;
    if (touchStartRef.current && event && 'touches' in event && event.touches.length > 0) {
      const touch = event.touches[0];
      const dx = touch.clientX - touchStartRef.current.x;
      const dy = touch.clientY - touchStartRef.current.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 16) {
        setIsDragging(true);
        clearMobileTooltipTimer();
        setMobileTooltipActive(false);
      }
    }
  }, [isMobile, clearMobileTooltipTimer]);

  const handleChartTouchEnd = useCallback(() => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    touchStartRef.current = null;
    if (isDragging) {
      setMobileTooltipActive(false);
      setIsDragging(false);
      return;
    }
    setIsDragging(false);
    // Toggle tooltip: if open, close it; if closed, open it
    setMobileTooltipActive(prev => !prev);
  }, [isMobile, clearMobileTooltipTimer, isDragging]);

  const handleChartMouseLeave = useCallback(() => {
    if (!isMobile) return;
    clearMobileTooltipTimer();
    setMobileTooltipActive(false);
  }, [isMobile, clearMobileTooltipTimer]);

  const adjustedTooltip = useCallback((tooltipProps: any) => {
    if (isMobile && !mobileTooltipActive) {
      return null;
    }
    return customTooltip(tooltipProps);
  }, [isMobile, mobileTooltipActive, customTooltip]);

  // Compute average for in-chart overlay (stat + timeframe) - skip moneyline/spread
  const averageDisplay = useMemo(() => {
    if (['moneyline', 'spread', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) return null;
    const validValues = data
      .map((d: any) => {
        if (selectedStat === 'fg3m' && d?.stats) return Number((d.stats as any).fg3m);
        return Number.isFinite(d.value) ? d.value : null;
      })
      .filter((v): v is number => v != null);
    if (validValues.length === 0) return null;
    const avg = validValues.reduce((s, v) => s + v, 0) / validValues.length;
    const pctStats = ['fg3_pct', 'fg_pct', 'ft_pct', 'opp_fg_pct', 'opp_fg3_pct', 'opp_ft_pct'];
    const formatted = pctStats.includes(selectedStat) ? `${avg.toFixed(1)}%` : avg.toFixed(1);
    const tfLabels: Record<string, string> = {
      last5: 'L5', last10: 'L10', last15: 'L15', last20: 'L20',
      h2h: 'H2H', lastseason: 'Last Season', thisseason: 'Season'
    };
    const tfLabel = (selectedTimeframe && tfLabels[selectedTimeframe]) || '';
    return { avg, formatted, tfLabel };
  }, [data, selectedStat, selectedTimeframe]);

  return (
    <div className="relative w-full h-full chart-mobile-optimized" key={layoutKey}>
      {/* Background glow effect */}
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
      {/* Static bars layer */}
      <StaticBarsChart
        key={`${selectedStat}-${selectedTimeframe || ''}-${yAxisConfig?.domain?.join?.(',') || ''}-${selectedFilterForAxis || 'none'}`}
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
        secondAxisData={secondAxisData}
        selectedFilterForAxis={selectedFilterForAxis}
        averageDisplay={averageDisplay}
      />
      {/* Mobile-only: Reference line layer (SVG) for perfect alignment */}
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
      {/* Desktop-only: CSS overlay line */}
      {!isMobile && <StaticBettingLineOverlay key={`betting-line-${!!selectedFilterForAxis}`} isDark={isDark} hasSecondAxis={!!selectedFilterForAxis} />}
    </div>
  );
});

export default StatsBarChart;
