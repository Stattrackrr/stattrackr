'use client';

import { useMemo, useCallback, useEffect, useRef, useState, memo } from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Cell,
  ComposedChart,
  Line,
  Tooltip,
} from 'recharts';
import StaticLabelList from './StaticLabelList';
import CustomXAxisTick from './CustomXAxisTick';
import { CHART_CONFIG } from '../../constants';

interface SimpleChartProps {
  isLoading?: boolean;
  chartData: Array<{ value: number; [key: string]: any }>;
  yAxisConfig: { domain: [number, number]; ticks: number[] };
  isDark: boolean;
  bettingLine: number;
  selectedStat: string;
  selectedTimeframe?: string;
  secondAxisData?: Array<{ gameId: string; gameDate: string; value: number | null }> | null;
  selectedFilterForAxis?: string | null;
  customTooltip?: any;
  teammateFilterId?: number | null;
  teammateFilterName?: string | null;
  withWithoutMode?: 'with' | 'without';
  clearTeammateFilter?: () => void;
  customXAxisTick?: any;
  /** Optional Y-axis tick label formatter (e.g. show "-" for bottom tick in AFL chart) */
  yAxisTickFormatter?: (value: number) => string;
  [key: string]: any; // Accept other props for compatibility
}

const SimpleChart = memo(function SimpleChart({
  isLoading,
  chartData,
  yAxisConfig,
  isDark,
  bettingLine,
  selectedStat,
  selectedTimeframe,
  secondAxisData,
  selectedFilterForAxis,
  customTooltip,
  teammateFilterId,
  teammateFilterName,
  withWithoutMode,
  clearTeammateFilter,
  customXAxisTick,
  yAxisTickFormatter,
}: SimpleChartProps) {
  // Detect mobile for hiding Y-axis and X-axis tick marks
  const [isMobile, setIsMobile] = useState(false);
  const [mobileTooltipActive, setMobileTooltipActive] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPayloadRef = useRef<{ payload: any[]; coordinate?: { x: number; y: number }; props: any } | null>(null);
  
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    checkMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  const handleChartTouchStart = useCallback((e: React.TouchEvent) => {
    if (!isMobile) return;
    setIsDragging(false);
    if (e.touches?.length > 0) {
      const t = e.touches[0];
      touchStartRef.current = { x: t.clientX, y: t.clientY };
    } else {
      touchStartRef.current = null;
    }
  }, [isMobile]);

  const handleChartTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isMobile || !touchStartRef.current || !e.touches?.length) return;
    const t = e.touches[0];
    const dx = t.clientX - touchStartRef.current.x;
    const dy = t.clientY - touchStartRef.current.y;
    if (dx * dx + dy * dy > 16) setIsDragging(true);
  }, [isMobile]);

  const handleChartTouchEnd = useCallback(() => {
    if (!isMobile) return;
    touchStartRef.current = null;
    if (isDragging) {
      setIsDragging(false);
      setMobileTooltipActive(false);
      lastPayloadRef.current = null;
      return;
    }
    setIsDragging(false);
    setMobileTooltipActive(prev => {
      if (prev) lastPayloadRef.current = null;
      return !prev;
    });
  }, [isMobile, isDragging]);

  const handleChartMouseLeave = useCallback(() => {
    if (isMobile) {
      setMobileTooltipActive(false);
      lastPayloadRef.current = null;
    }
  }, [isMobile]);

  const adjustedTooltip = useCallback((props: any) => {
    if (!customTooltip) return null;
    if (props?.active && props?.payload?.length) {
      lastPayloadRef.current = { payload: props.payload, coordinate: props.coordinate, props };
    }
    if (isMobile) {
      if (!mobileTooltipActive) return null;
      const p = lastPayloadRef.current;
      if (!p?.payload?.length) return null;
      return customTooltip({ ...props, active: true, payload: p.payload, coordinate: p.coordinate ?? props.coordinate });
    }
    if (!props?.active || !props?.payload?.length) return null;
    return customTooltip({ ...props, coordinate: props.coordinate });
  }, [isMobile, mobileTooltipActive, customTooltip]);

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
  // OPTIMIZATION: Single pass through array instead of two filters
  const initialBackgroundGradient = useMemo(() => {
    if (!chartData || chartData.length === 0) return '';
    const total = chartData.length;
    let overCount = 0;
    let underCount = 0;
    for (let i = 0; i < total; i++) {
      const value = chartData[i].value;
      if (value > bettingLine) overCount++;
      else if (value < bettingLine) underCount++;
    }
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

  const isCompositeStat = ['pra', 'pr', 'pa', 'ra'].includes(selectedStat);

  // Memoize cells - skip for composite stats (they use custom chopped shape)
  const barCells = useMemo(() => {
    if (isCompositeStat) return null;
    return chartData.map((entry, index) => (
      <Cell 
        key={`cell-${index}`} 
        fill={getBarColor(entry.value, bettingLine)}
        data-bar-index={index}
        data-bar-value={entry.value}
      />
    ));
  }, [chartData, getBarColor, bettingLine, isCompositeStat]);

  // Merge second axis data with main data
  const mergedChartData = useMemo(() => {
    if (!secondAxisData || !selectedFilterForAxis) {
      return chartData;
    }
    
    // Create a map of second axis values by gameId
    const secondAxisMap = new Map<string, number | null>();
    secondAxisData.forEach(item => {
      secondAxisMap.set(item.gameId, item.value);
    });
    
    // Merge into main data
    const merged = chartData.map((item: any) => {
      const lookupKey = item.xKey || String(item.game?.id || item.gameId || '');
      const secondValue = secondAxisMap.get(lookupKey) ?? null;
      
      return {
        ...item,
        secondAxisValue: secondValue,
      };
    });
    
    return merged;
  }, [chartData, secondAxisData, selectedFilterForAxis]);

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

  // Calculate Y-axis config for second axis
  const secondAxisConfig = useMemo(() => {
    if (!selectedFilterForAxis || !secondAxisData) return null;
    
    const values = secondAxisData
      .map(item => item.value)
      .filter((v): v is number => v !== null && Number.isFinite(v));
    
    if (values.length === 0) return null;
    
    const dataMin = Math.min(...values);
    const dataMax = Math.max(...values);
    
    // Special handling for DvP ranks: always use 0-30 domain (30 teams in NBA)
    if (selectedFilterForAxis === 'dvp_rank') {
      const min = 0;
      const max = 30;
      const ticks = [0, 5, 10, 15, 20, 25, 30];
      return { domain: [min, max] as [number, number], ticks, dataMin, dataMax };
    }
    
    // Special handling for game pace
    if (selectedFilterForAxis === 'pace') {
      const paddedMin = dataMin * 0.97;
      const min = Math.floor(paddedMin / 5) * 5;
      const paddedMax = dataMax * 1.05;
      const max = Math.ceil(paddedMax / 5) * 5;
      const range = max - min;
      const tickCount = Math.max(6, Math.min(7, Math.floor(range / 10) + 1));
      const step = range / (tickCount - 1);
      const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(min + step * i));
      return { domain: [min, max] as [number, number], ticks, dataMin, dataMax };
    }
    
    // Default: start at 0
    const min = 0;
    const paddedMax = dataMax * 1.05;
    const roughMax = Math.ceil(paddedMax);
    const max = Math.ceil(roughMax / 5) * 5;
    const tickCount = 6;
    const step = max / (tickCount - 1);
    const ticks = Array.from({ length: tickCount }, (_, i) => Math.round(min + step * i));
    return { domain: [min, max] as [number, number], ticks, dataMin, dataMax };
  }, [secondAxisData, selectedFilterForAxis]);

  const hasSecondAxis = selectedFilterForAxis && secondAxisData && secondAxisConfig;
  const ChartComponent = hasSecondAxis ? ComposedChart : BarChart;

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
        selectedStat={selectedStat}
        chartData={mergedChartData}
      />
    );
  }, [isDark, formatChartLabel, chartData.length, selectedStat, mergedChartData]);

  // Y-axis ticks: evenly spaced. Use 3 ticks when range is small to avoid uneven/duplicate labels, else 4.
  const limitTicks = useCallback((ticks: number[], domain: [number, number]) => {
    if (!domain || !ticks || ticks.length === 0) {
      return ticks || [];
    }
    
    const [minY, maxY] = domain;
    
    const minTick = minY === 0 || domain[0] === 0 ? 0 : minY;
    const maxTick = maxY;
    const range = maxTick - minTick;
    
    if (range <= 3) {
      // Small range: 3 evenly spaced ticks so labels stay distinct when rounded
      const mid = minTick + range / 2;
      return [minTick, mid, maxTick];
    }
    
    // Normal: 4 evenly spaced ticks
    const step = range / 3;
    return [
      minTick,
      minTick + step,
      minTick + 2 * step,
      maxTick,
    ];
  }, []);

  // Limit left Y-axis ticks to only 4
  const limitedTicks = useMemo(() => {
    if (!yAxisConfig?.domain || !yAxisConfig?.ticks) {
      return yAxisConfig?.ticks || [];
    }
    return limitTicks(yAxisConfig.ticks, yAxisConfig.domain);
  }, [yAxisConfig, limitTicks]);

  // Limit right Y-axis ticks to only 4 (matching left axis)
  const limitedRightTicks = useMemo(() => {
    if (!hasSecondAxis || !secondAxisConfig?.domain || !secondAxisConfig?.ticks) {
      return secondAxisConfig?.ticks || [];
    }
    return limitTicks(secondAxisConfig.ticks, secondAxisConfig.domain);
  }, [hasSecondAxis, secondAxisConfig, limitTicks]);

  // Function to update betting line container margins via DOM (no re-renders)
  const updateBettingLineContainerMargin = useCallback(() => {
    const container = document.getElementById('simple-chart-betting-line-container');
    if (container) {
      if (isMobile) {
        // Full width on mobile
        (container as HTMLElement).style.left = '0px';
        (container as HTMLElement).style.right = '0px';
      } else {
        // Desktop margins
        (container as HTMLElement).style.left = '32px';
        (container as HTMLElement).style.right = hasSecondAxis ? '77px' : '14px';
      }
    }
  }, [isMobile, hasSecondAxis]);

  // Update container margin when second axis or mobile state changes
  useEffect(() => {
    updateBettingLineContainerMargin();
    // Also update on initial mount with a small delay to ensure DOM is ready
    const timeout = setTimeout(() => {
      updateBettingLineContainerMargin();
    }, 0);
    return () => clearTimeout(timeout);
  }, [updateBettingLineContainerMargin]);

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

  // Track last betting line value and yAxisConfig to detect changes
  const lastBettingLineRef = useRef<number | null>(null);
  const lastYAxisConfigRef = useRef(yAxisConfig);
  
  // Update betting line position when bettingLine prop or yAxisConfig changes
  // yAxisConfig changes when timeframe changes, so we need to recalculate position
  useEffect(() => {
    if (!chartData || chartData.length === 0) return;
    
    // Check if yAxisConfig changed (timeframe change)
    const yAxisConfigChanged = lastYAxisConfigRef.current !== yAxisConfig;
    if (yAxisConfigChanged) {
      lastYAxisConfigRef.current = yAxisConfig;
    }
    
    // Check if bettingLine value changed
    const bettingLineChanged = lastBettingLineRef.current !== bettingLine;
    if (bettingLineChanged) {
      lastBettingLineRef.current = bettingLine;
    }
    
    // Recalculate position if either changed
    if (yAxisConfigChanged || bettingLineChanged) {
      updateBettingLinePosition(bettingLine);
      // Retry to ensure DOM is ready
      const timeout = setTimeout(() => updateBettingLinePosition(bettingLine), 50);
      return () => clearTimeout(timeout);
    }
  }, [bettingLine, updateBettingLinePosition, chartData, yAxisConfig]);

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

  // Compute average and hit rate for in-chart overlay (stat + timeframe)
  const averageDisplay = useMemo(() => {
    if (['moneyline', 'spread', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat)) return null;
    const validEntries = chartData
      .map((d: any) => {
        const v = selectedStat === 'fg3m' && d?.stats ? Number((d.stats as any).fg3m) : (Number.isFinite(d.value) ? d.value : null);
        return v != null ? { value: v } : null;
      })
      .filter((x): x is { value: number } => x != null);
    if (validEntries.length === 0) return null;
    const validValues = validEntries.map(x => x.value);
    const avg = validValues.reduce((s, v) => s + v, 0) / validValues.length;
    const pctStats = ['fg3_pct', 'fg_pct', 'ft_pct', 'opp_fg_pct', 'opp_fg3_pct', 'opp_ft_pct'];
    const formatted = pctStats.includes(selectedStat) ? `${avg.toFixed(1)}%` : avg.toFixed(1);
    const tfLabels: Record<string, string> = {
      last5: 'L5', last10: 'L10', last15: 'L15', last20: 'L20',
      h2h: 'H2H', lastseason: 'Last Season', thisseason: 'Season'
    };
    const tfLabel = (selectedTimeframe && tfLabels[selectedTimeframe]) || '';
    // Hit rate: % of games over the line in selected timeframe
    let hitRate: number | null = null;
    if (Number.isFinite(bettingLine) && validEntries.length > 0) {
      const overCount = validEntries.filter(({ value }) => value > bettingLine).length;
      hitRate = Math.round((overCount / validEntries.length) * 100);
    }
    return { formatted, tfLabel, hitRate };
  }, [chartData, selectedStat, selectedTimeframe, bettingLine]);

  // Loading state
  // Chart is independent - only depends on its own data, not global isLoading
  if (!chartData || chartData.length === 0) {
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
      
      {/* In-chart average + hit rate - center when second axis visible, else top right (z-[1] so dropdowns appear on top) */}
      {averageDisplay && (
        <div
          className={`absolute top-1 pointer-events-none z-[1] flex items-center justify-center gap-2 px-2 py-1 rounded shadow leading-none ${hasSecondAxis ? 'left-1/2 -translate-x-1/2' : 'right-2'}`}
          style={{
            backgroundColor: isDark ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.95)',
            border: `1px solid ${isDark ? 'rgba(148, 163, 184, 0.3)' : 'rgba(203, 213, 225, 0.8)'}`,
          }}
          aria-hidden
        >
          <span className={`text-[11px] font-medium leading-none ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
            {averageDisplay.tfLabel ? `${averageDisplay.tfLabel} Avg: ` : 'Avg: '}
            <span className="font-semibold">{averageDisplay.formatted}</span>
          </span>
          {averageDisplay.hitRate != null && (
            <>
              <span className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>|</span>
              <span className={`text-[11px] font-medium leading-none ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>
                Hit: <span className="font-semibold">{averageDisplay.hitRate}%</span>
              </span>
            </>
          )}
        </div>
      )}
      {/* In-chart teammate filter - center horizontally, inline with average (same top). NBA: teammateFilterId + name; AFL: teammateFilterName only */}
      {(teammateFilterId != null || teammateFilterName) && clearTeammateFilter && (
        <div
          className="absolute top-1 left-1/2 -translate-x-1/2 pointer-events-none z-[100]"
          aria-hidden
        >
          <div
            className="pointer-events-auto flex items-center gap-1.5 px-2 py-1 rounded shadow leading-none"
            style={{
              backgroundColor: isDark ? 'rgba(88, 28, 135, 0.9)' : 'rgba(147, 51, 234, 0.2)',
              border: `1px solid ${isDark ? 'rgba(167, 139, 250, 0.4)' : 'rgba(126, 34, 206, 0.5)'}`,
            }}
          >
            <span className={`text-[11px] font-medium leading-none ${isDark ? 'text-purple-100' : 'text-purple-800'}`}>
              {withWithoutMode === 'without' ? 'Without' : 'With'} {teammateFilterName}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                clearTeammateFilter();
              }}
              className="flex-shrink-0 w-4 h-4 flex items-center justify-center rounded-full hover:opacity-80 transition-opacity bg-white/20 text-purple-100"
              aria-label="Clear filter"
            >
              <svg width="7" height="7" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M1 1L7 7M7 1L1 7" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {/* Betting line overlay - updates via DOM, no re-renders */}
      <div 
        id="simple-chart-betting-line-container"
        className="absolute pointer-events-none"
        style={{
          left: isMobile ? '0px' : '32px', // Full width on mobile, yAxis width on desktop
          right: isMobile ? '0px' : '14px', // Full width on mobile, updated via DOM when second axis changes on desktop
          top: '22px', // margin.top
          bottom: '57px', // margin.bottom + extra space for alignment
          zIndex: 25 // above bars (chart is z-20), purple line is also in chart so it will be above betting line
        }}
      >
        <div
          id="simple-chart-betting-line-fast"
          className="absolute w-full"
          style={{
            bottom: '50%', // Initial position
            opacity: 1,
            height: isMobile ? '2px' : '3px',
            background: isDark ? '#ffffff' : '#000000'
          }}
        />
      </div>
      
      <div 
        className="relative z-20 w-full h-full"
        onTouchStart={handleChartTouchStart}
        onTouchMove={handleChartTouchMove}
        onTouchEnd={handleChartTouchEnd}
        onMouseLeave={handleChartMouseLeave}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ChartComponent
            key={`chart-${selectedStat}-${mergedChartData.length}-${hasSecondAxis ? 'secondaxis' : 'single'}`}
            data={mergedChartData}
            margin={{ 
              top: 22, 
              right: isMobile ? 0 : (hasSecondAxis ? 5 : 14), 
              left: 0, 
              bottom: 19 
            }}
            barCategoryGap="5%"
          >
            <XAxis
              dataKey="xKey"
              tick={(selectedTimeframe === 'lastseason' || selectedTimeframe === 'thisseason')
                ? false
                : (customXAxisTick || <CustomXAxisTick data={mergedChartData} hideLogo={selectedTimeframe === 'lastseason' || selectedTimeframe === 'thisseason'} />)}
              height={40}
              interval={0}
              allowDuplicatedCategory={false}
              axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: isMobile ? 3 : 2 }}
              tickLine={false}
              hide={false}
            />
            <YAxis
              domain={yAxisConfig.domain}
              ticks={limitedTicks}
              tick={{ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }}
              tickFormatter={yAxisTickFormatter ?? ((v: number) => String(Math.round(v)))}
              axisLine={false}
              tickLine={false}
              width={32}
              hide={isMobile}
            />
            {hasSecondAxis && secondAxisConfig && (
              <YAxis
                yAxisId="right"
                orientation="right"
                domain={secondAxisConfig.domain}
                ticks={limitedRightTicks}
                tick={{ fill: isDark ? '#a855f7' : '#9333ea', fontSize: 12 }}
                axisLine={false}
                tickLine={false}
                width={isMobile ? 30 : 70}
              />
            )}

            {/* Tooltip - on mobile, tap to show, tap again to dismiss */}
            <Tooltip 
              content={adjustedTooltip}
              cursor={{ 
                fill: isDark ? 'rgba(107, 114, 128, 0.5)' : 'rgba(156, 163, 175, 0.6)', 
                stroke: isDark ? '#6b7280' : '#9ca3af',
                strokeWidth: 2,
                opacity: 0.7,
                width: 2
              }}
              trigger="hover"
              allowEscapeViewBox={{ x: true, y: true }}
              wrapperStyle={{ zIndex: 100000, pointerEvents: 'none' }}
              shared={false}
              itemStyle={{ padding: '4px' }}
              isAnimationActive={false}
            />

            {/* Bar chart - invisible hover rect covers full width and top 2/3 of bar slot */}
            <Bar
              key={`bar-${selectedStat}-${mergedChartData.length}`}
              dataKey={selectedStat === 'fg3m' ? "stats.fg3a" : "value"}
              radius={[10, 10, 10, 10]}
              shape={isCompositeStat ? (props: any) => {
                const { x, y, width, height, payload } = props;
                const stats = payload?.stats || {};
                const pts = Number(stats.pts ?? 0);
                const reb = Number(stats.reb ?? 0);
                const ast = Number(stats.ast ?? 0);
                const total = selectedStat === 'pra' ? pts + reb + ast
                  : selectedStat === 'pr' ? pts + reb
                  : selectedStat === 'pa' ? pts + ast
                  : reb + ast;
                const barColor = getBarColor(payload?.value ?? total, bettingLine);
                const isLive = (payload as any)?.isLive;
                const barIndex = props.index ?? -1;
                const isMostRecent = isLive && barIndex === mergedChartData.length - 1;
                const chopStroke = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.35)';
                const segments: { h: number; val: number }[] = [];
                if (total > 0) {
                  if (selectedStat === 'pra') {
                    segments.push(
                      { h: (pts / total) * height, val: pts },
                      { h: (reb / total) * height, val: reb },
                      { h: (ast / total) * height, val: ast }
                    );
                  } else if (selectedStat === 'pr') {
                    segments.push({ h: (pts / total) * height, val: pts }, { h: (reb / total) * height, val: reb });
                  } else if (selectedStat === 'pa') {
                    segments.push({ h: (pts / total) * height, val: pts }, { h: (ast / total) * height, val: ast });
                  } else {
                    segments.push({ h: (reb / total) * height, val: reb }, { h: (ast / total) * height, val: ast });
                  }
                }
                const clipId = `composite-clip-bar-${barIndex}`;
                let offset = 0;
                const HOVER_H = 400;
                const hoverH = HOVER_H;
                const hoverY = y - HOVER_H;
                return (
                  <g style={{ pointerEvents: 'all' }}>
                    {/* Invisible hover rect: full width, full bar slot height for every bar */}
                    <rect x={x} y={hoverY} width={width} height={hoverH} fill="transparent" style={{ pointerEvents: 'all' }} />
                    <defs>
                      <clipPath id={clipId}>
                        <rect x={x} y={y} width={width} height={height} rx={10} ry={10} />
                      </clipPath>
                    </defs>
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="none"
                      stroke={isMostRecent ? '#9333ea' : 'transparent'}
                      strokeWidth={isMostRecent ? 3 : 0}
                      rx={10}
                      ry={10}
                    />
                    <g clipPath={`url(#${clipId})`}>
                      {segments.map((seg, i) => {
                        const segH = Math.max(4, Math.round(seg.h));
                        const segY = y + height - offset - segH;
                        offset += segH;
                        const isLast = i === segments.length - 1;
                        const textFill = barColor === '#6b7280' ? (isDark ? '#e5e7eb' : '#374151') : '#fff';
                        return (
                          <g key={i}>
                            <rect
                              x={x}
                              y={segY}
                              width={width}
                              height={segH}
                              rx={isLast ? 6 : 0}
                              ry={isLast ? 6 : 0}
                              fill={barColor}
                            />
                            {segH >= 8 && (
                              <text
                                x={x + width / 2}
                                y={segY + segH / 2}
                                textAnchor="middle"
                                dominantBaseline="central"
                                fontSize={Math.min(11, Math.max(8, segH - 4))}
                                fontWeight="600"
                                fill={textFill}
                              >
                                {seg.val}
                              </text>
                            )}
                          </g>
                        );
                      })}
                    </g>
                    {segments.length > 1 && (() => {
                      let off = 0;
                      const chopY: number[] = [];
                      for (let i = 0; i < segments.length - 1; i++) {
                        off += Math.max(4, Math.round(segments[i].h));
                        chopY.push(y + height - off);
                      }
                      return chopY.map((cy, i) => (
                        <line
                          key={i}
                          x1={x}
                          x2={x + width}
                          y1={cy}
                          y2={cy}
                          stroke={chopStroke}
                          strokeWidth={2}
                        />
                      ));
                    })()}
                    {/* Total on top of bar */}
                    <text
                      x={x + width / 2}
                      y={y - 4}
                      textAnchor="middle"
                      dominantBaseline="auto"
                      fontSize={12}
                      fontWeight={700}
                      fill={isDark ? '#ffffff' : '#000000'}
                    >
                      {payload?.value ?? total}
                    </text>
                  </g>
                );
              } : selectedStat === 'fg3m' ? (props: any) => {
                const { x, y, width, height, payload } = props;
                const attempts = payload?.stats?.fg3a || 0;
                const makes = payload?.stats?.fg3m || 0;
                const makesHeight = attempts > 0 ? (makes / attempts) * height : 0;
                const isLive = (payload as any)?.isLive;
                const barIndex = props.index ?? -1;
                const isMostRecent = isLive && barIndex === mergedChartData.length - 1;
                
                // Get color for makes bar based on betting line comparison
                const makesColor = makes > bettingLine 
                  ? CHART_CONFIG.colors.green 
                  : makes === bettingLine 
                    ? '#9ca3af' 
                    : CHART_CONFIG.colors.red;
                const HOVER_H = 400;
                const hoverH = HOVER_H;
                const hoverY = y - HOVER_H;
                return (
                  <g>
                    {/* Invisible hover rect: full width, full bar slot height for every bar */}
                    <rect x={x} y={hoverY} width={width} height={hoverH} fill="transparent" style={{ pointerEvents: 'all' }} />
                    {/* Background bar (attempts) - gray, semi-transparent */}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill={isDark ? '#4b5563' : '#d1d5db'}
                      fillOpacity={0.5}
                      rx={10}
                      ry={10}
                      stroke={isMostRecent ? '#9333ea' : 'none'}
                      strokeWidth={isMostRecent ? 3 : 0}
                      style={{ pointerEvents: 'all' }}
                    />
                    
                    {/* Attempts label on top of attempts bar */}
                    {attempts > 0 && (
                      <text
                        x={x + width / 2}
                        y={y - 4}
                        textAnchor="middle"
                        fontSize="12"
                        fontWeight="bold"
                        fill={isDark ? '#ffffff' : '#000000'}
                      >
                        {attempts}
                      </text>
                    )}
                    
                    {/* Foreground bar (makes) - colored based on betting line */}
                    {makes > 0 && (
                      <rect
                        x={x}
                        y={y + height - makesHeight}
                        width={width}
                        height={makesHeight}
                        fill={makesColor}
                        rx={10}
                        ry={10}
                        stroke={isMostRecent ? '#9333ea' : 'none'}
                        strokeWidth={isMostRecent ? 3 : 0}
                        style={{ pointerEvents: 'none' }}
                      />
                    )}
                    
                    {/* Makes label on top of makes bar */}
                    {makes > 0 && makesHeight > 10 && (
                      <text
                        x={x + width / 2}
                        y={y + height - makesHeight - 4}
                        textAnchor="middle"
                        fontSize="12"
                        fontWeight="bold"
                        fill="#ffffff"
                      >
                        {makes}
                      </text>
                    )}
                  </g>
                );
              } : (props: any) => {
                const { x, y, width, height, fill, payload } = props;
                const barIndex = props['data-bar-index'] ?? props.index ?? -1;
                const barValue = payload?.value ?? props['data-bar-value'];
                const HOVER_H = 400;
                const hoverH = HOVER_H;
                const hoverY = y - HOVER_H;
                return (
                  <g>
                    {/* Invisible hover rect: full width, top 2/3 of bar slot */}
                    <rect x={x} y={hoverY} width={width} height={hoverH} fill="transparent" style={{ pointerEvents: 'all' }} />
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill={fill ?? '#888'}
                      rx={10}
                      ry={10}
                      data-bar-index={barIndex}
                      data-bar-value={barValue}
                    />
                  </g>
                );
              }}
            >
              {selectedStat !== 'fg3m' && barCells}
            
              {/* Labels on top of bars - memoized to prevent re-renders when betting line changes */}
              {/* Don't show default labels for fg3m since we handle them in the custom shape */}
              {selectedStat !== 'fg3m' && memoizedLabelList}
            </Bar>
            {hasSecondAxis && (
              <Line
                yAxisId="right"
                type="linear"
                dataKey="secondAxisValue"
                stroke={isDark ? '#a855f7' : '#9333ea'}
                strokeWidth={3}
                dot={false}
                isAnimationActive={false}
                animationDuration={0}
              />
            )}
          </ChartComponent>
        </ResponsiveContainer>
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Re-render if meaningful props change
  // Only skip re-render if ONLY bettingLine changed (dragging scenario)
  // Allow re-render when selectedStat changes (stat/player change scenario)
  const statChanged = prevProps.selectedStat !== nextProps.selectedStat;
  const dataChanged = prevProps.chartData !== nextProps.chartData;
  const configChanged = prevProps.yAxisConfig !== nextProps.yAxisConfig;
  const otherPropsChanged = 
    prevProps.isLoading !== nextProps.isLoading ||
    prevProps.isDark !== nextProps.isDark ||
    prevProps.secondAxisData !== nextProps.secondAxisData ||
    prevProps.selectedFilterForAxis !== nextProps.selectedFilterForAxis ||
    prevProps.selectedTimeframe !== nextProps.selectedTimeframe ||
    prevProps.customTooltip !== nextProps.customTooltip ||
    prevProps.teammateFilterId !== nextProps.teammateFilterId ||
    prevProps.teammateFilterName !== nextProps.teammateFilterName ||
    prevProps.withWithoutMode !== nextProps.withWithoutMode;
  
  // If stat/data/config/other props changed, allow re-render
  if (statChanged || dataChanged || configChanged || otherPropsChanged) {
    return false; // Allow re-render
  }
  
  // If only bettingLine changed (and nothing else), skip re-render (dragging scenario)
  // The betting line position is updated via DOM manipulation in useEffect
  return prevProps.bettingLine === nextProps.bettingLine;
});

export default SimpleChart;
