'use client';

import { memo } from 'react';
import { LabelList } from 'recharts';
import { CHART_CONFIG } from '../../constants';

export default memo(function StaticLabelList({ 
  isDark, 
  formatChartLabel, 
  fontSizePx = 12 
}: { 
  isDark: boolean; 
  formatChartLabel: (v: any) => string; 
  fontSizePx?: number 
}) {
  return (
    <LabelList
      dataKey="value"
      position={CHART_CONFIG.labelList.position}
      style={{
        fontSize: `${fontSizePx}px`,
        fontWeight: CHART_CONFIG.labelList.fontWeight,
        fill: isDark ? '#ffffff' : '#000000'
      }}
      formatter={formatChartLabel}
      content={(props: any) => {
        if (!props) return null;
        
        const value = props?.value ?? props?.payload?.value;
        // Hide label if value is null or undefined
        if (value === null || value === undefined) {
          return null;
        }
        
        const { x, y, width, value: labelValue, height, viewBox } = props;
        
        // Ensure we have valid positioning props - if not, don't render (Recharts will call again)
        if (x === undefined || y === undefined || width === undefined) {
          return null;
        }
        
        // For zero values, position the label at the baseline (floor)
        const isZero = value === 0;
        
        let labelY = y;
        if (!isZero) {
          // For non-zero values, move label up slightly above the bar
          labelY = y - 4;
        }
        
        return (
          <text
            key={`label-${x}-${y}-${value}`}
            x={x + (width / 2)}
            y={labelY}
            textAnchor="middle"
            dominantBaseline="auto"
            style={{
              fontSize: `${fontSizePx}px`,
              fontWeight: CHART_CONFIG.labelList.fontWeight,
              fill: isDark ? '#ffffff' : '#000000'
            }}
          >
            {formatChartLabel(labelValue)}
          </text>
        );
      }}
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel && prev.fontSizePx === next.fontSizePx);






