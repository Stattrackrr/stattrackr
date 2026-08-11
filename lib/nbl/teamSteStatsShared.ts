/**
 * Shared NBL STE (Opponent Breakdown) constants — safe for client + server.
 */

import {
  NBL_CLUBS,
  getNblClubByCode,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

export const NBL_STE_STAT_KEYS = [
  'pts',
  'reb',
  'ast',
  'fg_pct',
  'fg3_pct',
  'stl',
  'blk',
] as const;

export type NblSteStatKey = (typeof NBL_STE_STAT_KEYS)[number];

export const NBL_STE_STAT_LABELS: Record<NblSteStatKey, string> = {
  pts: 'Points',
  reb: 'Rebounds',
  ast: 'Assists',
  fg_pct: 'Field Goal %',
  fg3_pct: '3-Point %',
  stl: 'Steals',
  blk: 'Blocks',
};

export type NblSteAverages = Record<NblSteStatKey, number>;

export type NblSteTeamSlice = {
  code: string;
  name: string;
  games: number;
  offense: NblSteAverages;
  allowed: NblSteAverages;
};

export type NblSteMetricBlock = {
  values: Record<string, number>;
  ranks: Record<string, number>;
};

export type NblSteStatsPayload = {
  year: number;
  seasonLabel: string;
  window: number;
  generatedAt: string;
  source: string;
  teamCount: number;
  names: Record<string, string>;
  games: Record<string, number>;
  totalGames: Record<string, number>;
  metrics: Record<NblSteStatKey, NblSteMetricBlock>;
  forMetrics: Record<NblSteStatKey, NblSteMetricBlock>;
  teams: NblSteTeamSlice[];
};

/** Plain-language side labels for Team Matchup (World Cup style). */
export function nblSteMatchupSideLabels(statKey: NblSteStatKey): {
  team: string;
  opponent: string;
} {
  switch (statKey) {
    case 'pts':
      return { team: 'Scores', opponent: 'Concedes' };
    case 'reb':
      return { team: 'Grabs', opponent: 'Allows' };
    case 'ast':
      return { team: 'Dishes', opponent: 'Allows' };
    case 'fg_pct':
      return { team: 'Shoots', opponent: 'Allows FG%' };
    case 'fg3_pct':
      return { team: 'From three', opponent: 'Allows 3P%' };
    case 'stl':
      return { team: 'Steals', opponent: 'Allows' };
    case 'blk':
      return { team: 'Blocks', opponent: 'Allows' };
    default:
      return { team: 'For', opponent: 'Faces' };
  }
}

function resolveCode(code: string | null | undefined, name: string | null | undefined): string | null {
  const byCode = getNblClubByCode(code);
  if (byCode) return byCode.code;
  const resolved = resolveNblClubName(name);
  if (!resolved) return null;
  const club = NBL_CLUBS.find((c) => normalizeTeamKey(c.name) === normalizeTeamKey(resolved));
  return club?.code ?? null;
}

/** Resolve a free-text team name / code to canonical NBL club code. */
export function resolveNblSteTeamCode(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  return resolveCode(input, input);
}
