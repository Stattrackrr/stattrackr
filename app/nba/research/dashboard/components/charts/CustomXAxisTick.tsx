'use client';

import { memo, useState } from 'react';
import { getEspnLogoCandidates } from '../../constants';

export default memo(function CustomXAxisTick({ x, y, payload, data }: any) {
  const [logoError, setLogoError] = useState(false);
  const [logoAttempt, setLogoAttempt] = useState(0);
  
  const dataPoint = data?.find((d: any) => d.xKey === payload.value);
  const teamAbbr = dataPoint?.tickLabel || payload.value;
  
  const logoCandidates = getEspnLogoCandidates(teamAbbr);
  const logoUrl = logoCandidates[logoAttempt] || logoCandidates[0];
  
  if (logoError && logoAttempt >= logoCandidates.length - 1) {
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
          {teamAbbr}
        </text>
      </g>
    );
  }
  
  return (
    <g transform={`translate(${x},${y})`}>
      <image
        x={-12}
        y={8}
        width={24}
        height={24}
        xlinkHref={logoUrl}
        onError={() => {
          if (logoAttempt < logoCandidates.length - 1) {
            setLogoAttempt(prev => prev + 1);
          } else {
            setLogoError(true);
          }
        }}
      />
    </g>
  );
}, (prev, next) => prev.x === next.x && prev.y === next.y && prev.payload?.value === next.payload?.value);






