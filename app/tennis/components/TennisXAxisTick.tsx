'use client';

import { memo, useState } from 'react';
import { tennisOpponentCode } from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';

export default memo(function TennisXAxisTick({
  x,
  y,
  payload,
  data,
  isDark,
  hideLogo,
}: {
  x?: number;
  y?: number;
  payload?: { value?: string };
  data?: Array<{
    xKey?: string;
    tickLabel?: string;
    opponent?: string;
    opponentIoc?: string | null;
  }>;
  logoByTeam?: Record<string, string>;
  isDark?: boolean;
  hideLogo?: boolean;
}) {
  const [flagError, setFlagError] = useState(false);
  const dataPoint = data?.find((d) => d.xKey === payload?.value);
  const code = tennisOpponentCode(dataPoint?.tickLabel || dataPoint?.opponent || '');
  const flagUrl = tennisFlagUrl(dataPoint?.opponentIoc);

  if (hideLogo || !code) {
    return <g transform={`translate(${x},${y})`} />;
  }

  const label = (
    <text
      x={0}
      y={0}
      dy={12}
      textAnchor="middle"
      fill="currentColor"
      fontSize={10}
      fontWeight="600"
    >
      {code}
    </text>
  );

  if (!flagUrl || flagError) {
    return (
      <g transform={`translate(${x},${y})`}>
        {label}
      </g>
    );
  }

  return (
    <g transform={`translate(${x},${y})`}>
      {label}
      <image
        x={-11}
        y={16}
        width={22}
        height={15}
        href={flagUrl}
        xlinkHref={flagUrl}
        preserveAspectRatio="xMidYMid meet"
        style={{
          filter: isDark
            ? 'drop-shadow(0 0 1px rgba(255,255,255,0.85)) drop-shadow(0 1px 2px rgba(0,0,0,0.55))'
            : 'drop-shadow(0 0 1px rgba(15,23,42,0.4)) drop-shadow(0 1px 1px rgba(0,0,0,0.18))',
        }}
        onError={() => setFlagError(true)}
      />
    </g>
  );
}, (prev, next) => (
  prev.x === next.x
  && prev.y === next.y
  && prev.payload?.value === next.payload?.value
  && prev.isDark === next.isDark
  && prev.hideLogo === next.hideLogo
  && prev.data === next.data
));
