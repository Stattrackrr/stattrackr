'use client';

import { memo } from 'react';
import { tennisLastName } from '@/lib/tennis/chartStats';

export default memo(function TennisXAxisTick({
  x,
  y,
  payload,
  data,
  hideLogo,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  data?: Array<{ xKey?: string; tickLabel?: string; opponent?: string }>;
  logoByTeam?: Record<string, string>;
  isDark?: boolean;
  hideLogo?: boolean;
}) {
  if (hideLogo) {
    return <g transform={`translate(${x},${y})`} />;
  }

  const dataPoint = data?.find((d) => d.xKey === payload?.value);
  const label = tennisLastName(dataPoint?.tickLabel || dataPoint?.opponent || String(payload?.value ?? ''));
  const short = label.slice(0, 4).toUpperCase();

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={0}
        y={0}
        dy={16}
        textAnchor="middle"
        fill="currentColor"
        fontSize={10}
        fontWeight="600"
      >
        {short}
      </text>
    </g>
  );
});
