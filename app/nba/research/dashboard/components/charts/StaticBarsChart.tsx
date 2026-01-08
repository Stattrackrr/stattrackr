'use client';

import { memo, useState, useEffect, useMemo, useRef } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell, Line, ComposedChart, ReferenceLine, CartesianGrid } from 'recharts';
import { CHART_CONFIG } from '../../constants';
import CustomXAxisTick from './CustomXAxisTick';
import StaticLabelList from './StaticLabelList';

export default memo(function StaticBarsChart({
  data,
  yAxisConfig,
  isDark,
  bettingLine,
  customTooltip,
  formatChartLabel,
  selectedStat,
  compactMobile,
  selectedTimeframe,
  onChartTouchStart,
  onChartTouchMove,
  onChartTouchEnd,
  onChartMouseLeave,
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
  compactMobile?: boolean;
  selectedTimeframe?: string;
  onChartTouchStart?: (e: any) => void;
  onChartTouchMove?: (e: any) => void;
  onChartTouchEnd?: (e: any) => void;
  onChartMouseLeave?: () => void;
  secondAxisData?: Array<{ gameId: string; gameDate: string; value: number | null }> | null;
  selectedFilterForAxis?: string | null;
}) {
  const colorMap = useMemo(() => {
    return data.map(d => {
      if (selectedStat === 'spread') {
        return d.value < bettingLine ? 'over' : d.value === bettingLine ? 'push' : 'under';
      } else {
        return d.value > bettingLine ? 'over' : d.value === bettingLine ? 'push' : 'under';
      }
    });
  }, [data, bettingLine, selectedStat]);
  
  const [isMobileSB, setIsMobileSB] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 639px)');
    const update = () => {
      setIsMobileSB(mq.matches);
      setViewportWidth(window.innerWidth);
    };
    update();
    window.addEventListener('resize', update);
    if (mq.addEventListener) {
      mq.addEventListener('change', update);
      return () => {
        mq.removeEventListener('change', update);
        window.removeEventListener('resize', update);
      };
    } else {
      // @ts-ignore legacy
      mq.addListener(update);
      return () => {
        // @ts-ignore legacy
        mq.removeListener(update);
        window.removeEventListener('resize', update);
      };
    }
  }, []);

  const xAxisTickStyle = useMemo(() => ({ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }), [isDark]);
  const yAxisTickStyle = useMemo(() => ({ fill: isDark ? '#ffffff' : '#000000', fontSize: 12 }), [isDark]);
  // Right y-axis tick style - purple color to match the purple line
  const rightAxisTickStyle = useMemo(() => ({ 
    fill: '#8b5cf6', // Purple color (matches CHART_CONFIG.colors.purple)
    fontSize: compactMobile ? 11 : 12,
    fontWeight: 'normal'
  }), [compactMobile]);
  const xAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);
  const yAxisLineStyle = useMemo(() => ({ stroke: isDark ? '#4b5563' : '#d1d5db' }), [isDark]);

  const computedBarCategoryGap = useMemo(() => {
    const base = data.length <= 5 ? '2%' : data.length <= 10 ? '3%' : '5%';
    return compactMobile ? '1.5%' : base;
  }, [data.length, compactMobile]);
  const computedMaxBarSize = useMemo(() => (compactMobile ? 120 : CHART_CONFIG.performance.maxBarSize), [compactMobile]);
  
  const chartMargin = useMemo(() => {
    const margin = { ...CHART_CONFIG.margin };
    if (compactMobile || isMobileSB) {
      margin.bottom = 0;
      margin.left = 2;
      // On mobile, always use full width (no right margin for y-axis - we'll hide it)
      margin.right = 2;
    }
    return margin;
  }, [compactMobile, isMobileSB]);
  
  const hideLogosAndLabels = selectedTimeframe === 'lastseason' || selectedTimeframe === 'thisseason';

  // Merge second axis data with main data
  const mergedData = useMemo(() => {
    if (!secondAxisData || !selectedFilterForAxis) {
      return data;
    }
    
    // Create a map of second axis values by gameId
    const secondAxisMap = new Map<string, number | null>();
    secondAxisData.forEach(item => {
      secondAxisMap.set(item.gameId, item.value);
    });
    
    // Merge into main data
    const merged = data.map((item: any) => {
      const lookupKey = item.xKey || String(item.game?.id || '');
      const secondValue = secondAxisMap.get(lookupKey) ?? null;
      
      return {
        ...item,
        secondAxisValue: secondValue,
      };
    });
    
    // Debug logging for DvP rank
    if (selectedFilterForAxis === 'dvp_rank') {
      const valuesWithRanks = merged.filter((item: any) => item.secondAxisValue !== null && item.secondAxisValue !== undefined);
      const sampleMerged = merged.slice(0, 3).map((item: any) => ({
        xKey: item.xKey,
        gameId: item.game?.id,
        statsGameId: item.stats?.game?.id,
        secondAxisValue: item.secondAxisValue,
        value: item.value
      }));
      const secondAxisDataSample = secondAxisData.slice(0, 3);
      const allGameIds = Array.from(secondAxisMap.keys());
      const allXKeys = merged.map((item: any) => item.xKey || String(item.game?.id || ''));
      
      console.log('[StaticBarsChart] Merged DvP rank data:', {
        totalGames: merged.length,
        gamesWithRanks: valuesWithRanks.length,
        sampleMerged,
        secondAxisDataSample,
        allGameIdsFromMap: allGameIds.slice(0, 10),
        allXKeysFromData: allXKeys.slice(0, 10),
        matchingGameIds: allGameIds.filter(id => allXKeys.includes(id)).slice(0, 5)
      });
    }
    
    return merged;
  }, [data, secondAxisData, selectedFilterForAxis]);

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
      // Generate ticks: 0, 5, 10, 15, 20, 25, 30
      const ticks = [0, 5, 10, 15, 20, 25, 30];
      
      return {
        domain: [min, max] as [number, number],
        ticks,
        dataMin,
        dataMax,
      };
    }
    
    // Special handling for game pace: more aggressive ticks (start below min, end above max)
    if (selectedFilterForAxis === 'pace') {
      // Start a little less than the lowest pace stat (subtract about 3-5%)
      const paddedMin = dataMin * 0.97;
      const min = Math.floor(paddedMin / 5) * 5; // Round down to nearest 5
      
      // End a bit more than the highest stat (add about 3-5%)
      const paddedMax = dataMax * 1.05;
      const max = Math.ceil(paddedMax / 5) * 5; // Round up to nearest 5
      
      // Generate evenly spaced ticks (about 6-7 ticks)
      const range = max - min;
      const tickCount = Math.max(6, Math.min(7, Math.floor(range / 10) + 1)); // 6-7 ticks depending on range
      const step = range / (tickCount - 1);
      const ticks = Array.from({ length: tickCount }, (_, i) => {
        return Math.round(min + step * i);
      });
      
      return {
        domain: [min, max] as [number, number],
        ticks,
        dataMin,
        dataMax,
      };
    }
    
    // Always start at 0 for other stats
    const min = 0;
    
    // Make max slightly higher than the best stat (add small padding, about 5%)
    const paddedMax = dataMax * 1.05;
    const roughMax = Math.ceil(paddedMax);
    
    // Round to nearest multiple of 5 for clean, evenly spaced ticks
    const max = Math.ceil(roughMax / 5) * 5;
    
    // Generate 6 ticks (0 plus 5 more) - evenly spaced whole numbers
    const tickCount = 6;
    const step = max / (tickCount - 1); // This will be a clean number like 10, 15, etc.
    const ticks = Array.from({ length: tickCount }, (_, i) => {
      return Math.round(min + step * i); // Step is already a clean number, so this gives even spacing
    });
    
    return {
      domain: [min, max] as [number, number],
      ticks,
      dataMin,
      dataMax,
    };
  }, [secondAxisData, selectedFilterForAxis]);

  const hasSecondAxis = selectedFilterForAxis && secondAxisData && secondAxisConfig;
  const ChartComponent = hasSecondAxis ? ComposedChart : BarChart;
  
  // Debug logging for DvP rank
  if (selectedFilterForAxis === 'dvp_rank') {
    console.log('[StaticBarsChart] Second axis setup:', {
      hasSecondAxis,
      hasSelectedFilter: !!selectedFilterForAxis,
      hasSecondAxisData: !!secondAxisData,
      secondAxisDataLength: secondAxisData?.length || 0,
      hasSecondAxisConfig: !!secondAxisConfig,
      secondAxisConfig: secondAxisConfig,
      usingComposedChart: hasSecondAxis,
      sampleSecondAxisData: secondAxisData?.slice(0, 3)
    });
  }
  
  // On mobile, use mobile margins (which already account for second axis)
  // On desktop, use larger right margin when second axis is present to give y-axis more space
  const finalMargin = useMemo(() => {
    if (compactMobile || isMobileSB) {
      return chartMargin; // Mobile margins already set (right: 2)
    }
    return hasSecondAxis ? { ...chartMargin, right: 10 } : chartMargin; // 10px right margin for second axis
  }, [chartMargin, hasSecondAxis, compactMobile, isMobileSB]);

  return (
    <ResponsiveContainer 
      key={viewportWidth}
      width="100%" 
      height="100%" 
      debounce={CHART_CONFIG.performance.debounceMs}
      style={{ overflow: 'visible' }} // Ensure right y-axis isn't clipped
    >
      <ChartComponent 
        data={mergedData} 
        margin={finalMargin}
        syncMethod="value"
        maxBarSize={data.length <= 5 ? 250 : data.length <= 10 ? 250 : computedMaxBarSize}
        barCategoryGap={computedBarCategoryGap}
        barGap={selectedStat === 'fg3m' ? -40 : (compactMobile ? 2 : 2)}
        onTouchStart={(e: any) => {
          onChartTouchStart?.(e);
        }}
        onTouchMove={(e: any) => {
          onChartTouchMove?.(e);
        }}
        onTouchEnd={(e: any) => {
          onChartTouchEnd?.(e);
        }}
        onMouseLeave={onChartMouseLeave}
      >
        <XAxis
          dataKey="xKey"
          tick={hideLogosAndLabels ? false : <CustomXAxisTick data={data} hideLogo={hideLogosAndLabels} />}
          axisLine={xAxisLineStyle}
          height={CHART_CONFIG.xAxis.height}
          interval={CHART_CONFIG.xAxis.interval}
          allowDuplicatedCategory={CHART_CONFIG.xAxis.allowDuplicatedCategory}
          hide={!!compactMobile}
          padding={compactMobile ? { left: 8, right: 8 } : undefined as any}
        />
        <YAxis 
          yAxisId="left"
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          tick={yAxisTickStyle}
          axisLine={false} // Hide the vertical line
          tickLine={false} // Hide the tick marks (dashes)
          hide={!!compactMobile}
          width={!isMobileSB ? CHART_CONFIG.yAxis.width : undefined}
        />
        {hasSecondAxis && secondAxisConfig && (
          <YAxis 
            yAxisId="right"
            orientation="right"
            domain={secondAxisConfig.domain}
            ticks={secondAxisConfig.ticks}
            tick={rightAxisTickStyle}
            axisLine={false} // Hide the vertical line
            tickLine={false} // Hide the tick marks (dashes)
            hide={!!compactMobile || !!isMobileSB} // Hide on mobile, show on desktop
            width={compactMobile || isMobileSB ? CHART_CONFIG.yAxis.width : 60} // Wider on desktop to accommodate larger numbers
            tickCount={secondAxisConfig.ticks.length} // Explicitly set tick count to ensure labels render
            allowDecimals={false} // Ensure whole numbers are shown
            tickFormatter={(value) => String(value)} // Explicit formatter to ensure labels render
            mirror={false} // Don't mirror - show on right side
          />
        )}
        <Tooltip 
          content={customTooltip}
          cursor={compactMobile ? false : { fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
          trigger={compactMobile ? 'click' : 'hover'}
          allowEscapeViewBox={{ x: true, y: true }}
          wrapperStyle={{ zIndex: 9999, pointerEvents: 'none' }}
          shared={false}
          itemStyle={{ padding: '4px' }}
        />
        <Bar 
          yAxisId="left"
          dataKey={selectedStat === 'fg3m' ? "stats.fg3a" : "value"} 
          radius={CHART_CONFIG.bar.radius} 
          isAnimationActive={false} 
          animationDuration={0}
          background={false}
          shape={selectedStat === 'fg3m' ? (props: any) => {
            const { x, y, width, height, payload } = props;
            const attempts = payload?.stats?.fg3a || 0;
            const makes = payload?.stats?.fg3m || 0;
            const makesHeight = attempts > 0 ? (makes / attempts) * height : 0;
            const isLive = (payload as any)?.isLive;
            const barIndex = props.index ?? -1;
            const isMostRecent = isLive && barIndex === data.length - 1;
            
            return (
              <g>
                <rect
                  x={x}
                  y={y}
                  width={width}
                  height={height}
                  fill={isDark ? '#4b5563' : '#d1d5db'}
                  fillOpacity={0.5}
                  rx={CHART_CONFIG.bar.radius[0]}
                  ry={CHART_CONFIG.bar.radius[0]}
                  stroke={isMostRecent ? '#9333ea' : 'none'}
                  strokeWidth={isMostRecent ? 3 : 0}
                />
                
                {attempts > 0 && makes === 0 && (
                  <text
                    x={x + width / 2}
                    y={y + height / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {attempts > 0 && makes > 0 && (
                  <text
                    x={x + width / 2}
                    y={y + (height - makesHeight) / 2 + 4}
                    textAnchor="middle"
                    fontSize="12"
                    fontWeight="bold"
                    fill={isDark ? '#ffffff' : '#000000'}
                  >
                    {attempts}
                  </text>
                )}
                
                {makes > 0 && (
                  <rect
                    x={x}
                    y={y + height - makesHeight}
                    width={width}
                    height={makesHeight}
                    fill={makes > bettingLine ? CHART_CONFIG.colors.green : makes === bettingLine ? '#9ca3af' : CHART_CONFIG.colors.red}
                    rx={CHART_CONFIG.bar.radius[0]}
                    ry={CHART_CONFIG.bar.radius[0]}
                    stroke={isMostRecent ? '#9333ea' : 'none'}
                    strokeWidth={isMostRecent ? 3 : 0}
                    data-fg3m-makes="true"
                    data-bar-index={String(barIndex)}
                    data-makes-value={String(makes)}
                    data-state={makes > bettingLine ? 'over' : makes === bettingLine ? 'push' : 'under'}
                  />
                )}
                
                {makes > 0 && makesHeight > 15 && (
                  <text
                    x={x + width / 2}
                    y={y + height - makesHeight / 2 + 4}
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
          } : undefined}
        >
          {mergedData.map((e, i) => {
            const isLive = (e as any).isLive && i === data.length - 1; // Most recent game (last item)
            return (
              <Cell 
                key={e.xKey || i} 
                fill={colorMap[i] === 'over' ? CHART_CONFIG.colors.green : colorMap[i] === 'push' ? '#9ca3af' : CHART_CONFIG.colors.red}
                data-bar-index={i}
                data-value={typeof e.value === 'number' ? e.value : ''}
                stroke={isLive ? '#9333ea' : 'none'} // Purple border for live game
                strokeWidth={isLive ? 3 : 0}
              />
            );
          })}
          {!['fg3m', 'moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat) && !hideLogosAndLabels && (
            <StaticLabelList isDark={isDark} formatChartLabel={formatChartLabel} fontSizePx={compactMobile ? 14 : 12} />
          )}
        </Bar>
        {/* Only show ReferenceLine on mobile - desktop uses CSS overlay */}
        {compactMobile && (
          <ReferenceLine 
            y={bettingLine} 
            stroke={isDark ? '#ffffff' : '#000000'} 
            strokeWidth={2}
          />
        )}
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
            name="Second Axis"
          />
        )}
      </ChartComponent>
    </ResponsiveContainer>
  );
}, (prev, next) => (
  prev.data === next.data &&
  prev.yAxisConfig === next.yAxisConfig &&
  prev.isDark === next.isDark &&
  prev.selectedStat === next.selectedStat &&
  prev.selectedTimeframe === next.selectedTimeframe &&
  prev.customTooltip === next.customTooltip &&
  prev.formatChartLabel === next.formatChartLabel &&
  prev.secondAxisData === next.secondAxisData &&
  prev.selectedFilterForAxis === next.selectedFilterForAxis
));


