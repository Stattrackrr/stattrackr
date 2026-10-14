/**
 * Shared NBA STE (Opponent Breakdown) constants — safe for client + server.
 */

import {
  NBA_CLUBS,
  getNbaClubByCode,
  normalizeTeamKey,
  resolveNbaClubName,
} from '@/lib/nba/dash/teams';

export const NBA_STE_STAT_KEYS = [
  'pts',
  'reb',
  'oreb',
  'dreb',
  'ast',
  'fg_pct',
  'fg3_pct',
  'stl',
  'blk',
] as const;

export type NbaSteStatKey = (typeof NBA_STE_STAT_KEYS)[number];

export const NBA_STE_STAT_LABELS: Record<NbaSteStatKey, string> = {
  pts: 'Points',
  reb: 'Rebounds',
  oreb: 'O-Boards',
  dreb: 'D-Boards',
  ast: 'Assists',
  fg_pct: 'Field Goal %',
  fg3_pct: '3-Point %',
  stl: 'Steals',
  blk: 'Blocks',
};

export type NbaSteAverages = Record<NbaSteStatKey, number>;

export type NbaSteTeamSlice = {
  code: string;
  name: string;
  games: number;
  offense: NbaSteAverages;
  allowed: NbaSteAverages;
};

export type NbaSteMetricBlock = {
  values: Record<string, number>;
  ranks: Record<string, number>;
};

export type NbaSteStatsPayload = {
  year: number;
  seasonLabel: string;
  window: number;
  generatedAt: string;
  source: string;
  teamCount: number;
  names: Record<string, string>;
  games: Record<string, number>;
  totalGames: Record<string, number>;
  metrics: Record<NbaSteStatKey, NbaSteMetricBlock>;
  forMetrics: Record<NbaSteStatKey, NbaSteMetricBlock>;
  teams: NbaSteTeamSlice[];
};

/** Plain-language side labels for Team Matchup (World Cup style). */
export function nbaSteMatchupSideLabels(statKey: NbaSteStatKey): {
  team: string;
  opponent: string;
} {
  switch (statKey) {
    case 'pts':
      return { team: 'Scores', opponent: 'Concedes' };
    case 'reb':
      return { team: 'Grabs', opponent: 'Allows' };
    case 'oreb':
      return { team: 'O-Boards', opponent: 'Allows' };
    case 'dreb':
      return { team: 'D-Boards', opponent: 'Allows' };
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
  const byCode = getNbaClubByCode(code);
  if (byCode) return byCode.code;
  const resolved = resolveNbaClubName(name);
  if (!resolved) return null;
  const club = NBA_CLUBS.find((c) => normalizeTeamKey(c.name) === normalizeTeamKey(resolved));
  return club?.code ?? null;
}

/** Resolve a free-text team name / code to canonical NBA club code. */
export function resolveNbaSteTeamCode(input: string | null | undefined): string | null {
  if (!input?.trim()) return null;
  return resolveCode(input, input);
}
