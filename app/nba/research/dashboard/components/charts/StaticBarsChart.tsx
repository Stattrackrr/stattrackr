'use client';

import { memo, useState, useEffect, useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, Cell } from 'recharts';
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
  onChartTouchStart?: () => void;
  onChartTouchMove?: () => void;
  onChartTouchEnd?: () => void;
  onChartMouseLeave?: () => void;
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
      margin.right = 2;
    }
    return margin;
  }, [compactMobile, isMobileSB]);
  
  const hideLogosAndLabels = selectedTimeframe === 'lastseason';

  return (
    <ResponsiveContainer 
      key={viewportWidth}
      width="100%" 
      height="100%" 
      debounce={CHART_CONFIG.performance.debounceMs}
    >
      <BarChart 
        data={data} 
        margin={chartMargin}
        syncMethod="value"
        maxBarSize={data.length <= 5 ? 250 : data.length <= 10 ? 250 : computedMaxBarSize}
        barCategoryGap={computedBarCategoryGap}
        barGap={selectedStat === 'fg3m' ? -40 : (compactMobile ? 2 : 2)}
        onTouchStart={onChartTouchStart}
        onTouchMove={onChartTouchMove}
        onTouchEnd={onChartTouchEnd}
        onMouseLeave={onChartMouseLeave}
      >
        <XAxis
          dataKey="xKey"
          tick={hideLogosAndLabels ? false : <CustomXAxisTick data={data} />}
          axisLine={xAxisLineStyle}
          height={CHART_CONFIG.xAxis.height}
          interval={CHART_CONFIG.xAxis.interval}
          allowDuplicatedCategory={CHART_CONFIG.xAxis.allowDuplicatedCategory}
          hide={!!compactMobile || hideLogosAndLabels}
          padding={compactMobile ? { left: 8, right: 8 } : undefined as any}
        />
        <YAxis 
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          tick={yAxisTickStyle}
          axisLine={yAxisLineStyle}
          hide={!!compactMobile}
          width={!isMobileSB ? CHART_CONFIG.yAxis.width : undefined}
        />
        <Tooltip 
          isAnimationActive={false} 
          content={customTooltip}
          animationDuration={0}
          wrapperStyle={{ zIndex: 9999 }}
          cursor={{ fill: isDark ? '#4b5563' : '#9ca3af', opacity: 0.3 }}
        />
        <Bar 
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
          {data.map((e, i) => {
            const isLive = (e as any).isLive && i === data.length - 1; // Most recent game (last item)
            return (
              <Cell 
                key={e.xKey || i} 
                fill={colorMap[i] === 'over' ? CHART_CONFIG.colors.green : colorMap[i] === 'push' ? '#9ca3af' : CHART_CONFIG.colors.red}
                data-bar-index={i}
                data-value={typeof e.value === 'number' ? e.value : ''}
                stroke={isLive ? '#9333ea' : 'none'} // Purple border for live game
                strokeWidth={isLive ? 3 : 0}
                style={{ 
                  transition: 'all 0.3s ease'
                }}
              />
            );
          })}
          {!['fg3m', 'moneyline', 'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline'].includes(selectedStat) && !hideLogosAndLabels && (
            <StaticLabelList isDark={isDark} formatChartLabel={formatChartLabel} fontSizePx={compactMobile ? 14 : 12} />
          )}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}, (prev, next) => (
  prev.data === next.data &&
  prev.yAxisConfig === next.yAxisConfig &&
  prev.isDark === next.isDark &&
  prev.selectedStat === next.selectedStat &&
  prev.customTooltip === next.customTooltip &&
  prev.formatChartLabel === next.formatChartLabel
));


