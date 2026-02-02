'use client';

import { memo } from 'react';
import { LabelList } from 'recharts';
import { CHART_CONFIG } from '../../constants';

export default memo(function StaticLabelList({ 
  isDark, 
  formatChartLabel, 
  fontSizePx = 12,
  selectedStat,
  chartData
}: { 
  isDark: boolean; 
  formatChartLabel: (v: any) => string; 
  fontSizePx?: number;
  selectedStat?: string;
  chartData?: Array<{ value: number; [key: string]: any }>;
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
      content={(props: any) => {
        
        if (!props) return null;
        
        const value = props?.value ?? props?.payload?.value;
        // Hide label if value is null or undefined
        if (value === null || value === undefined) {
          return null;
        }
        
        // In Recharts LabelList, props.payload is the data object
        // But we should also check props directly as it might be structured differently
        const { x, y, width, value: labelValue, height, viewBox, payload, index } = props;
        
        // For fg3m, we need to access the full data entry with stats
        // Since payload is undefined in LabelList, we'll use the index to look up the data from chartData
        let dataObject = payload;
        
        // If payload is undefined and we have chartData and index, look up the data entry
        if (!dataObject && chartData && (index !== undefined && index !== null)) {
          dataObject = chartData[index];
        }
        
        // Fallback to props if still no data
        if (!dataObject) {
          dataObject = props;
        }
        
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
        
        // Composite stats (PR, PRA, RA, PA) - numbers are inside each segment, hide default label
        if (['pra', 'pr', 'pa', 'ra'].includes(selectedStat || '')) {
          return null;
        }

        // Special handling for fg3m (3PM/A) - show made/attempted format
        let displayText = formatChartLabel(labelValue);
        
        // Always check for fg3m - try multiple ways to access the data
        if (selectedStat === 'fg3m') {
          // Try dataObject.stats (from chartData lookup by index)
          const stats = dataObject?.stats;
          if (stats && (stats.fg3m !== undefined || stats.fg3a !== undefined)) {
            const makes = stats.fg3m || 0;
            const attempts = stats.fg3a || 0;
            displayText = `${makes}/${attempts}`;
          } 
          // Try payload.stats (fallback)
          else if (payload?.stats && (payload.stats.fg3m !== undefined || payload.stats.fg3a !== undefined)) {
            const makes = payload.stats.fg3m || 0;
            const attempts = payload.stats.fg3a || 0;
            displayText = `${makes}/${attempts}`;
          }
          // Try root level (shouldn't happen but just in case)
          else if (dataObject?.fg3m !== undefined || dataObject?.fg3a !== undefined) {
            const makes = dataObject.fg3m || 0;
            const attempts = dataObject.fg3a || 0;
            displayText = `${makes}/${attempts}`;
          }
          // Try props directly (last resort)
          else if (props?.stats && (props.stats.fg3m !== undefined || props.stats.fg3a !== undefined)) {
            const makes = props.stats.fg3m || 0;
            const attempts = props.stats.fg3a || 0;
            displayText = `${makes}/${attempts}`;
          }
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
            {displayText}
          </text>
        );
      }}
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel && prev.fontSizePx === next.fontSizePx && prev.selectedStat === next.selectedStat && prev.chartData === next.chartData);
