'use client';

import { memo, useState } from 'react';

function normalizeTeamName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const TEAM_ALIASES: Record<string, string[]> = {
  adelaide: ['adelaide', 'adelaidecrows', 'crows'],
  brisbane: ['brisbane', 'brisbanelions', 'lions'],
  carlton: ['carlton', 'carltonblues', 'blues'],
  collingwood: ['collingwood', 'collingwoodmagpies', 'magpies'],
  essendon: ['essendon', 'essendonbombers', 'bombers'],
  fremantle: ['fremantle', 'fremantledockers', 'dockers'],
  geelong: ['geelong', 'geelongcats', 'cats'],
  goldcoast: ['goldcoast', 'goldcoastsuns', 'suns'],
  gws: ['gws', 'gwsgiants', 'greaterwesternsydney', 'greaterwesternsydneygiants', 'giants'],
  hawthorn: ['hawthorn', 'hawthornhawks', 'hawks'],
  melbourne: ['melbourne', 'melbournedemons', 'demons'],
  northmelbourne: ['northmelbourne', 'northmelbournekangaroos', 'kangaroos', 'north'],
  portadelaide: ['portadelaide', 'portadelaidepower', 'power'],
  richmond: ['richmond', 'richmondtigers', 'tigers'],
  stkilda: ['stkilda', 'saints', 'stkildasaints'],
  sydney: ['sydney', 'sydneyswans', 'swans'],
  westcoast: ['westcoast', 'westcoasteagles', 'eagles'],
  westernbulldogs: ['westernbulldogs', 'bulldogs', 'footscray'],
};

function resolveLogo(
  teamText: string,
  logoByTeam: Record<string, string> | undefined
): string | null {
  if (!logoByTeam) return null;
  const normalized = normalizeTeamName(teamText);
  if (!normalized) return null;

  if (logoByTeam[normalized]) return logoByTeam[normalized];

  for (const aliases of Object.values(TEAM_ALIASES)) {
    if (!aliases.includes(normalized)) continue;
    for (const alias of aliases) {
      if (logoByTeam[alias]) return logoByTeam[alias];
    }
  }

  return null;
}

export default memo(function AflXAxisTick({
  x,
  y,
  payload,
  data,
  logoByTeam,
  isDark,
}: any) {
  const [logoError, setLogoError] = useState(false);

  const dataPoint = data?.find((d: any) => d.xKey === payload.value);
  const teamName = dataPoint?.tickLabel || payload.value;
  const logoUrl = resolveLogo(String(teamName ?? ''), logoByTeam);

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
));
