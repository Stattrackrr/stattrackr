'use client';

import { memo, useState } from 'react';
import { NBL_CLUBS, normalizeTeamKey } from '@/lib/nblTeamCanonical';

const TEAM_ALIASES: Record<string, string[]> = Object.fromEntries(
  NBL_CLUBS.map((club) => {
    const aliases = [
      normalizeTeamKey(club.name),
      normalizeTeamKey(club.shortName),
      normalizeTeamKey(club.code),
    ].filter(Boolean);
    // Extra nicknames / partials
    const extras: string[] = [];
    if (club.code === 'SEM') extras.push('southeastmelbourne', 'sephoenix', 'phoenix');
    if (club.code === 'NZL') extras.push('newzealand', 'nzbreakers', 'breakers');
    if (club.code === 'TAS') extras.push('tasmania', 'jackjumpers');
    if (club.code === 'ADL') extras.push('adelaide', '36ers');
    if (club.code === 'BRI') extras.push('brisbane', 'bullets');
    if (club.code === 'CNS') extras.push('cairns', 'taipans');
    if (club.code === 'ILL') extras.push('illawarra', 'hawks');
    if (club.code === 'MEL') extras.push('melbourne', 'united');
    if (club.code === 'PER') extras.push('perth', 'wildcats');
    if (club.code === 'SYD') extras.push('sydney', 'kings');
    return [normalizeTeamKey(club.name), [...new Set([...aliases, ...extras])]];
  })
);

function resolveLogo(
  teamText: string,
  logoByTeam: Record<string, string> | undefined
): string | null {
  if (!logoByTeam) return null;
  const normalized = normalizeTeamKey(teamText);
  if (!normalized) return null;

  if (logoByTeam[normalized]) return logoByTeam[normalized];
  // Also try raw key (some maps use full names)
  if (logoByTeam[teamText]) return logoByTeam[teamText];

  for (const aliases of Object.values(TEAM_ALIASES)) {
    if (!aliases.includes(normalized)) continue;
    for (const alias of aliases) {
      if (logoByTeam[alias]) return logoByTeam[alias];
    }
  }

  // Fallback: scan logo keys with alias match
  for (const [key, url] of Object.entries(logoByTeam)) {
    const keyNorm = normalizeTeamKey(key);
    if (keyNorm === normalized) return url;
    for (const aliases of Object.values(TEAM_ALIASES)) {
      if (aliases.includes(normalized) && aliases.includes(keyNorm)) return url;
    }
  }

  return null;
}

export default memo(function NblXAxisTick({
  x,
  y,
  payload,
  data,
  logoByTeam,
  isDark,
  hideLogo,
}: any) {
  const [logoError, setLogoError] = useState(false);

  const dataPoint = data?.find((d: any) => d.xKey === payload.value);
  const teamName = dataPoint?.tickLabel || payload.value;
  const logoUrl = resolveLogo(String(teamName ?? ''), logoByTeam);

  if (hideLogo) {
    return <g transform={`translate(${x},${y})`} />;
  }

  if (!logoUrl || logoError) {
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
          {String(teamName ?? '').slice(0, 3).toUpperCase()}
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
        style={{
          filter: isDark
            ? 'drop-shadow(0 0 1px rgba(255,255,255,0.95)) drop-shadow(0 1px 2px rgba(0,0,0,0.65))'
            : 'drop-shadow(0 0 1px rgba(15,23,42,0.45)) drop-shadow(0 1px 1px rgba(0,0,0,0.2))'
        }}
        onError={() => setLogoError(true)}
      />
    </g>
  );
}, (prev, next) => (
  prev.x === next.x
  && prev.y === next.y
  && prev.payload?.value === next.payload?.value
  && prev.logoByTeam === next.logoByTeam
  && prev.isDark === next.isDark
  && prev.hideLogo === next.hideLogo
));
