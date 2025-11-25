'use client';

import { memo, useMemo } from 'react';
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, ReferenceLine } from 'recharts';
import { CHART_CONFIG } from '../../constants';

export default memo(function DynamicReferenceLineChart({
  yAxisConfig,
  isDark,
  bettingLine,
  dataLength,
  compactMobile,
}: {
  yAxisConfig: { domain: [number, number]; ticks: number[]; dataMin: number; dataMax: number };
  isDark: boolean;
  bettingLine: number;
  dataLength: number;
  compactMobile?: boolean;
}) {
  const clampedRefLine = useMemo(() => {
    const maxY = Array.isArray(yAxisConfig?.domain) ? yAxisConfig.domain[1] : undefined;
    const top = typeof maxY === 'number' ? maxY : bettingLine;
    const y = Math.min(bettingLine, top);
    return y;
  }, [bettingLine, yAxisConfig]);
  
  const refLineColor = useMemo(() => isDark ? '#ffffff' : '#000000', [isDark]);
  
  const dummyData = useMemo(() => 
    Array.from({ length: Math.max(dataLength, 1) }, (_, i) => ({ 
      xKey: `dummy_${i}`, 
      value: yAxisConfig.domain[0] + 0.1
    })), 
    [dataLength, yAxisConfig]
  );
  
  const chartMargin = useMemo(() => {
    if (compactMobile) {
      const mobileMargin = { ...CHART_CONFIG.margin };
      mobileMargin.bottom = 0;
      mobileMargin.left = 2;
      mobileMargin.right = 2;
      return mobileMargin;
    }
    return CHART_CONFIG.margin;
  }, [compactMobile]);

  return (
    <ResponsiveContainer 
      width="100%" 
      height="100%"
    >
      <BarChart 
        data={dummyData}
        margin={chartMargin}
      >
        <XAxis 
          dataKey="xKey"
          hide
        />
        <YAxis 
          domain={yAxisConfig.domain}
          ticks={yAxisConfig.ticks}
          hide
        />
        <ReferenceLine y={clampedRefLine} stroke={refLineColor} strokeDasharray="6 6" strokeWidth={3} ifOverflow="extendDomain" />
        <Bar 
          dataKey="value" 
          fill="transparent" 
          isAnimationActive={false}
        />
      </BarChart>
    </ResponsiveContainer>
  );
});






