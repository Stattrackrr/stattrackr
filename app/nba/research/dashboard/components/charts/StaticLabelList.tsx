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
    />
  );
}, (prev, next) => prev.isDark === next.isDark && prev.formatChartLabel === next.formatChartLabel && prev.fontSizePx === next.fontSizePx);





