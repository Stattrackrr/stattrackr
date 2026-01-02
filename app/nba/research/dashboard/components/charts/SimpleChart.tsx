'use client';

import { useMemo, useCallback, useEffect, useRef } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import StaticLabelList from './StaticLabelList';

interface SimpleChartProps {
  isLoading?: boolean;
  chartData: Array<{ value: number; [key: string]: any }>;
  yAxisConfig: { domain: [number, number]; ticks: number[] };
  isDark: boolean;
  bettingLine: number;
  selectedStat: string;
  [key: string]: any; // Accept other props for compatibility
}

export default function SimpleChart({
  isLoading,
  chartData,
  yAxisConfig,
  isDark,
  bettingLine,
  selectedStat,
}: SimpleChartProps) {
  // Calculate initial background gradient (only when chartData or isDark changes)
  const getBackgroundGradient = useCallback((overPercent: number, underPercent: number) => {
    if (overPercent > 60) {
      return isDark 
        ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.28) 0%, rgba(34, 197, 94, 0.20) 15%, rgba(34, 197, 94, 0.12) 30%, rgba(34, 197, 94, 0.06) 45%, rgba(34, 197, 94, 0.02) 60%, rgba(34, 197, 94, 0.008) 75%, rgba(34, 197, 94, 0.003) 85%, rgba(34, 197, 94, 0.001) 92%, rgba(34, 197, 94, 0.0002) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.20) 0%, rgba(34, 197, 94, 0.14) 15%, rgba(34, 197, 94, 0.09) 30%, rgba(34, 197, 94, 0.045) 45%, rgba(34, 197, 94, 0.015) 60%, rgba(34, 197, 94, 0.006) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)';
    } else if (underPercent > 60) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.28) 0%, rgba(239, 68, 68, 0.20) 15%, rgba(239, 68, 68, 0.12) 30%, rgba(239, 68, 68, 0.06) 45%, rgba(239, 68, 68, 0.02) 60%, rgba(239, 68, 68, 0.008) 75%, rgba(239, 68, 68, 0.003) 85%, rgba(239, 68, 68, 0.001) 92%, rgba(239, 68, 68, 0.0002) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.20) 0%, rgba(239, 68, 68, 0.14) 15%, rgba(239, 68, 68, 0.09) 30%, rgba(239, 68, 68, 0.045) 45%, rgba(239, 68, 68, 0.015) 60%, rgba(239, 68, 68, 0.006) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)';
    } else if (overPercent > underPercent && overPercent > 40) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.16) 0%, rgba(34, 197, 94, 0.11) 15%, rgba(34, 197, 94, 0.06) 30%, rgba(34, 197, 94, 0.03) 45%, rgba(34, 197, 94, 0.012) 60%, rgba(34, 197, 94, 0.005) 75%, rgba(34, 197, 94, 0.002) 85%, rgba(34, 197, 94, 0.0006) 92%, rgba(34, 197, 94, 0.0001) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(34, 197, 94, 0.12) 0%, rgba(34, 197, 94, 0.085) 15%, rgba(34, 197, 94, 0.055) 30%, rgba(34, 197, 94, 0.024) 45%, rgba(34, 197, 94, 0.008) 60%, rgba(34, 197, 94, 0.003) 75%, rgba(34, 197, 94, 0.001) 85%, rgba(34, 197, 94, 0.0003) 92%, rgba(34, 197, 94, 0.00005) 97%, transparent 100%)';
    } else if (underPercent > overPercent && underPercent > 40) {
      return isDark
        ? 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.16) 0%, rgba(239, 68, 68, 0.11) 15%, rgba(239, 68, 68, 0.06) 30%, rgba(239, 68, 68, 0.03) 45%, rgba(239, 68, 68, 0.012) 60%, rgba(239, 68, 68, 0.005) 75%, rgba(239, 68, 68, 0.002) 85%, rgba(239, 68, 68, 0.0006) 92%, rgba(239, 68, 68, 0.0001) 97%, transparent 100%)'
        : 'radial-gradient(ellipse at center, rgba(239, 68, 68, 0.12) 0%, rgba(239, 68, 68, 0.085) 15%, rgba(239, 68, 68, 0.055) 30%, rgba(239, 68, 68, 0.024) 45%, rgba(239, 68, 68, 0.008) 60%, rgba(239, 68, 68, 0.003) 75%, rgba(239, 68, 68, 0.001) 85%, rgba(239, 68, 68, 0.0003) 92%, rgba(239, 68, 68, 0.00005) 97%, transparent 100%)';
    }
    return '';
  }, [isDark]);

  // Initial background gradient (recalculates when chartData, bettingLine, or isDark changes)
  const initialBackgroundGradient = useMemo(() => {
    if (!chartData || chartData.length === 0) return '';
    const total = chartData.length;
    const overCount = chartData.filter(d => d.value > bettingLine).length;
    const underCount = chartData.filter(d => d.value < bettingLine).length;
    const overPercent = total > 0 ? (overCount / total) * 100 : 0;
    const underPercent = total > 0 ? (underCount / total) * 100 : 0;
    return getBackgroundGradient(overPercent, underPercent);
  }, [chartData, bettingLine, getBackgroundGradient]);
  
  const backgroundGradientRef = useRef(initialBackgroundGradient);
  const getBackgroundGradientRef = useRef(getBackgroundGradient);
  
  // Update refs when they change
  useEffect(() => {
    backgroundGradientRef.current = initialBackgroundGradient;
    getBackgroundGradientRef.current = getBackgroundGradient;
  }, [initialBackgroundGradient, getBackgroundGradient]);

  // Determine bar color based on value vs betting line
  const getBarColor = useCallback((value: number, line: number) => {
    if (value > line) return '#10b981'; // green
    if (value < line) return '#ef4444'; // red
    return '#6b7280'; // gray for equal
  }, []);

  // Memoize cells - only recalculate when chartData changes, NOT when betting line changes
  // Colors are updated via DOM manipulation for instant updates (no React re-renders)
  // Initial colors use bettingLine prop, but cells don't re-render when it changes
  const barCells = useMemo(() => {
    return chartData.map((entry, index) => (
      <Cell 
        key={`cell-${index}`} 
        fill={getBarColor(entry.value, bettingLine)}
        data-bar-index={index}
        data-bar-value={entry.value}
      />
    ));
  }, [chartData, getBarColor]); // Removed bettingLine - colors updated via DOM

  // Store chartData in ref so event handler always has latest data
  const chartDataRef = useRef(chartData);
  useEffect(() => {
    chartDataRef.current = chartData;
  }, [chartData]);

  // Function to update bar colors via DOM (no React re-renders)
  // This function directly manipulates DOM, matching original recolorBarsFast pattern
  const updateBarColors = useCallback((line: number) => {
    const data = chartDataRef.current;
    if (!data || data.length === 0) return;
    
    const rects = document.querySelectorAll('[data-bar-index]');
    if (rects.length === 0) return; // No bars found
    
    rects.forEach((el: any) => {
      // Skip if this doesn't have the data attribute
      if (!el.hasAttribute('data-bar-index')) return;
      
      const idxAttr = el.getAttribute('data-bar-index');
      if (idxAttr == null) return;
      
      const i = parseInt(idxAttr, 10);
      if (!Number.isFinite(i) || !data[i]) return;
      
      const barValue = data[i].value;
      // Handle spread stat (reversed logic) - same as original recolorBarsFast
      const isOver = selectedStat === 'spread' ? (barValue < line) : (barValue > line);
      const isPush = barValue === line;
      const newState = isOver ? 'over' : isPush ? 'push' : 'under';
      const currentState = el.getAttribute('data-state');
      if (currentState === newState) return; // Skip if state hasn't changed
      
      const newColor = newState === 'over' ? '#10b981' : newState === 'push' ? '#9ca3af' : '#ef4444';
      
      // Update using setAttribute only (matching original recolorBarsFast pattern)
      el.setAttribute('data-state', newState);
      el.setAttribute('fill', newColor);
    });
  }, [selectedStat]);

  // Update bar colors and background glow via DOM when betting line changes (prevents re-renders)
  useEffect(() => {
    if (!chartData || chartData.length === 0) return;
    
    // Update bar colors via DOM (no React re-renders)
    updateBarColors(bettingLine);
    
    // Update background glow gradient (use setTimeout to ensure DOM is ready)
    const timeoutId = setTimeout(() => {
      const total = chartData.length;
      const overCount = chartData.filter(d => d.value > bettingLine).length;
      const underCount = chartData.filter(d => d.value < bettingLine).length;
      const overPercent = total > 0 ? (overCount / total) * 100 : 0;
      const underPercent = total > 0 ? (underCount / total) * 100 : 0;
      const newGradient = getBackgroundGradient(overPercent, underPercent);
      
      if (newGradient !== backgroundGradientRef.current) {
        backgroundGradientRef.current = newGradient;
        const glowElement = document.querySelector('[data-chart-glow]') as HTMLElement;
        if (glowElement) {
          glowElement.style.background = newGradient;
        }
      }
    }, 0);
    
    return () => clearTimeout(timeoutId);
  }, [bettingLine, chartData, getBackgroundGradient, updateBarColors]);

  // Ensure colors are set correctly on initial render (after DOM is ready)
  useEffect(() => {
    if (!chartData || chartData.length === 0) return;
    
    // Use multiple timeouts to ensure DOM is fully rendered
    const timeout1 = setTimeout(() => updateBarColors(bettingLine), 50);
    const timeout2 = setTimeout(() => updateBarColors(bettingLine), 200);
    
    return () => {
      clearTimeout(timeout1);
      clearTimeout(timeout2);
    };
  }, [chartData, updateBarColors, bettingLine]);

  // Store updateBarColors in ref for stable event handler
  const updateBarColorsRef = useRef(updateBarColors);
  useEffect(() => {
    updateBarColorsRef.current = updateBarColors;
  }, [updateBarColors]);

  // Store selectedStat in ref for window function (stable reference)
  const selectedStatRef = useRef(selectedStat);
  useEffect(() => {
    selectedStatRef.current = selectedStat;
  }, [selectedStat]);

  // Expose update function on window for parent to call directly (like original recolorBarsFast)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      (window as any).__simpleChartRecolorBars = (value: number) => {
        if (!Number.isFinite(value)) return;
        // Call via ref to get latest function with correct selectedStat
        updateBarColorsRef.current(value);
        
        // Also update background glow
        const data = chartDataRef.current;
        if (data && data.length > 0) {
          const total = data.length;
          const stat = selectedStatRef.current;
          const overCount = stat === 'spread'
            ? data.filter(d => d.value < value).length
            : data.filter(d => d.value > value).length;
          const underCount = stat === 'spread'
            ? data.filter(d => d.value > value).length
            : data.filter(d => d.value < value).length;
          const overPercent = total > 0 ? (overCount / total) * 100 : 0;
          const underPercent = total > 0 ? (underCount / total) * 100 : 0;
          const newGradient = getBackgroundGradientRef.current(overPercent, underPercent);
          
          if (newGradient !== backgroundGradientRef.current) {
            backgroundGradientRef.current = newGradient;
            const glowElement = document.querySelector('[data-chart-glow]') as HTMLElement;
            if (glowElement) {
              glowElement.style.background = newGradient;
            }
          }
        }
      };
      
      return () => {
        delete (window as any).__simpleChartRecolorBars;
      };
    }
  }, []); // Empty deps - use refs for everything

  // Listen for transient-line event for instant updates while dragging
  useEffect(() => {
    const handleTransientLine = (event: Event) => {
      const customEvent = event as CustomEvent;
      const value = customEvent.detail?.value;
      if (value === undefined || !Number.isFinite(value)) return;
      
      // CRITICAL: Update bar colors instantly via DOM FIRST (no React state updates to prevent re-renders)
      // Use ref to get latest function, do this synchronously to ensure instant visual feedback
      updateBarColorsRef.current(value);
      
      // Update background glow gradient instantly (also DOM manipulation)
      const data = chartDataRef.current;
      if (data && data.length > 0) {
        const total = data.length;
        const stat = selectedStatRef.current;
        const overCount = stat === 'spread' 
          ? data.filter(d => d.value < value).length
          : data.filter(d => d.value > value).length;
        const underCount = stat === 'spread'
          ? data.filter(d => d.value > value).length
          : data.filter(d => d.value < value).length;
        const overPercent = total > 0 ? (overCount / total) * 100 : 0;
        const underPercent = total > 0 ? (underCount / total) * 100 : 0;
        const newGradient = getBackgroundGradientRef.current(overPercent, underPercent);
        
        if (newGradient !== backgroundGradientRef.current) {
          backgroundGradientRef.current = newGradient;
          const glowElement = document.querySelector('[data-chart-glow]') as HTMLElement;
          if (glowElement) {
            glowElement.style.background = newGradient;
          }
        }
      }
      
      // DON'T update state - causes re-renders which are laggy
      // Bar colors and background glow update instantly via DOM
      // ReferenceLine will update after debounce via bettingLine prop
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('transient-line', handleTransientLine, { passive: true });
      return () => {
        window.removeEventListener('transient-line', handleTransientLine);
      };
    }
  }, [selectedStat]); // Only depend on selectedStat for spread logic

  // Format label value based on stat type
  // Memoize this to a stable reference - only changes when selectedStat changes
  const formatChartLabel = useMemo(() => {
    return (value: any): string => {
      const isPercentageStat = ['fg3_pct', 'fg_pct', 'ft_pct'].includes(selectedStat);
      const numValue = typeof value === 'number' ? value : parseFloat(value) || 0;
      if (isPercentageStat) return `${numValue.toFixed(1)}%`;
      return `${numValue}`;
    };
  }, [selectedStat]);

  // Memoize the label list component - only re-renders when data/stat changes, NOT when betting line changes
  const memoizedLabelList = useMemo(() => {
    return (
      <StaticLabelList 
        isDark={isDark} 
        formatChartLabel={formatChartLabel} 
        fontSizePx={12}
      />
    );
  }, [isDark, formatChartLabel, chartData.length, selectedStat]);

  // Function to update betting line position via DOM (no re-renders)
  const updateBettingLinePosition = useCallback((line: number) => {
    const el = document.getElementById('simple-chart-betting-line-fast');
    if (!el || !yAxisConfig?.domain) return;
    
    const [minY, maxY] = yAxisConfig.domain;
    const clampedLine = Math.max(minY, Math.min(line, maxY));
    
    // Use actual bars range when available to prevent visual offset from axis padding
    let effectiveMin = minY;
    let effectiveMax = maxY;
    const effectiveRange = effectiveMax - effectiveMin;
    let percentage = effectiveRange > 0 ? ((clampedLine - effectiveMin) / effectiveRange) * 100 : 50;
    
    // Clamp for safety
    if (!Number.isFinite(percentage)) percentage = 50;
    percentage = Math.max(0, Math.min(100, percentage));
    
    (el as HTMLElement).style.bottom = `${percentage}%`;
  }, [yAxisConfig]);

  // Store update function in ref for event handler
  const updateBettingLinePositionRef = useRef(updateBettingLinePosition);
  useEffect(() => {
    updateBettingLinePositionRef.current = updateBettingLinePosition;
  }, [updateBettingLinePosition]);

  // Update betting line position when bettingLine prop changes (after debounce)
  useEffect(() => {
    if (!chartData || chartData.length === 0) return;
    updateBettingLinePosition(bettingLine);
    // Retry to ensure DOM is ready
    const timeout = setTimeout(() => updateBettingLinePosition(bettingLine), 50);
    return () => clearTimeout(timeout);
  }, [bettingLine, updateBettingLinePosition, chartData]);

  // Update betting line position instantly during dragging (via transient-line event)
  useEffect(() => {
    const handleTransientLineForBettingLine = (event: Event) => {
      const customEvent = event as CustomEvent;
      const value = customEvent.detail?.value;
      if (value === undefined || !Number.isFinite(value)) return;
      updateBettingLinePositionRef.current(value);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('transient-line', handleTransientLineForBettingLine, { passive: true });
      return () => {
        window.removeEventListener('transient-line', handleTransientLineForBettingLine);
      };
    }
  }, []);

  // Loading state
  if (isLoading || !chartData || chartData.length === 0) {
    return (
      <div className="h-full w-full flex flex-col" style={{ padding: '16px 8px 8px 8px' }}>
        <div className="flex-1 flex items-end justify-center gap-1 px-2 h-full">
          {[...Array(20)].map((_, idx) => {
            const heights = [45, 62, 38, 71, 55, 48, 65, 42, 58, 51, 47, 63, 39, 72, 56, 49, 66, 43, 59, 52];
            const height = heights[idx] || (Math.random() * 40 + 30);
            return (
              <div
                key={idx}
                className="flex-1 max-w-[50px] flex flex-col items-center justify-end"
                style={{ height: '100%' }}
              >
                <div
                  className={`w-full rounded-t animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
                  style={{
                    height: `${height}%`,
                    animationDelay: `${idx * 0.08}s`,
                    minHeight: '30px',
                    transition: 'height 0.3s ease',
                    minWidth: '28px'
                  }}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-full relative">
      {/* Background glow gradient - matching original dashboard */}
      {initialBackgroundGradient && (
        <div 
          data-chart-glow
          className="absolute pointer-events-none"
          style={{
            top: '-5%',
            left: '-30%',
            right: '-30%',
            bottom: '-30%',
            background: initialBackgroundGradient,
            zIndex: 0,
            transition: 'background 0.1s ease-out'
          }}
        />
      )}
      
      {/* Betting line overlay - updates via DOM, no re-renders */}
      <div 
        id="simple-chart-betting-line-container"
        className="absolute pointer-events-none"
        style={{
          left: '32px', // yAxis width
          right: '14px', // margin.right
          top: '22px', // margin.top
          bottom: '57px', // margin.bottom + extra space for alignment
          zIndex: 15 // above bars and chart
        }}
      >
        <div
          id="simple-chart-betting-line-fast"
          className="absolute w-full"
          style={{
            bottom: '50%', // Initial position
            opacity: 1,
            height: '3px',
            background: isDark ? '#ffffff' : '#000000'
          }}
        />
      </div>
      
      <div className="relative z-10 w-full h-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            key={`chart-${selectedStat}-${chartData.length}`}
            data={chartData}
            margin={{ top: 22, right: 14, left: 0, bottom: 29 }}
            barCategoryGap="5%"
          >
            <XAxis
              dataKey="tickLabel"
              tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }}
              height={30}
            />
            <YAxis
              domain={yAxisConfig.domain}
              ticks={yAxisConfig.ticks}
              tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }}
              width={32}
            />

            {/* Bar chart */}
            <Bar
              key={`bar-${selectedStat}-${chartData.length}`}
              dataKey="value"
              radius={[10, 10, 10, 10]}
            >
              {barCells}
            
              {/* Labels on top of bars - memoized to prevent re-renders when betting line changes */}
              {memoizedLabelList}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
