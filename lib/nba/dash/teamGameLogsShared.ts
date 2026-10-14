/**
 * NBA Game Props stat pills — identical to NBA TEAM_STAT_OPTIONS.
 * Client-safe (no fs).
 */

import { TEAM_STAT_OPTIONS } from '@/app/nba/research/dashboard/constants';

export const NBA_TEAM_STAT_OPTIONS = TEAM_STAT_OPTIONS;

export const NBA_TEAM_STAT_KEYS = TEAM_STAT_OPTIONS.map((s) => s.key);

const NBA_TEAM_STAT_KEY_SET = new Set(NBA_TEAM_STAT_KEYS);

export const NBA_TEAM_QUARTER_STAT_KEYS = new Set([
  'first_half_total',
  'second_half_total',
  'q1_moneyline',
  'q1_total',
  'q2_moneyline',
  'q2_total',
  'q3_moneyline',
  'q3_total',
  'q4_moneyline',
  'q4_total',
]);

export function isNbaTeamGameStat(stat: string | null | undefined): boolean {
  return !!stat && NBA_TEAM_STAT_KEY_SET.has(stat);
}

export function defaultNbaTeamStat(stat: string | null | undefined): string {
  if (isNbaTeamGameStat(stat)) return stat as string;
  return 'moneyline';
}
