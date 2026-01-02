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
        const value = props?.value;
        // Hide label if value is null or undefined
        if (value === null || value === undefined) {
          return null;
        }
        const { x, y, width, value: labelValue, height, viewBox } = props;
        
        // For zero values, position the label at the baseline (floor)
        // The chart has a bottom margin, so the baseline (y=0) is offset from the bottom of viewBox
        // For 0-height bars, the y coordinate should already be at the baseline
        // When position is "top", Recharts positions labels above bars, but for 0 values we want them at the baseline
        const isZero = value === 0;
        
        // Calculate baseline: account for bottom margin (29px from CHART_CONFIG)
        const bottomMargin = 29;
        let labelY = y;
        
        if (isZero && viewBox) {
          // Baseline is at: viewBox.y + viewBox.height - bottomMargin
          // This gives us the actual y=0 coordinate in the chart
          labelY = (viewBox.y || 0) + (viewBox.height || 0) - bottomMargin;
        } else if (isZero) {
          // Fallback: use y coordinate (should be at baseline for 0-height bars)
          labelY = y;
        } else {
          // For non-zero values, move label up slightly above the bar
          // Subtract a small offset to position it higher
          labelY = y - 4;
        }
        
        return (
          <text
            x={x + (width / 2)}
            y={labelY}
            textAnchor="middle"
            dominantBaseline={isZero ? "hanging" : "auto"}
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






