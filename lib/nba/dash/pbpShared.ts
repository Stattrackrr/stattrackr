/** Client-safe NBA PBP quarter-split keys (points, rebounds, assists). */

export const NBA_QUARTER_PARENT_STATS = ['points', 'rebounds', 'assists'] as const;
export type NbaQuarterParentStat = (typeof NBA_QUARTER_PARENT_STATS)[number];

export const NBA_QUARTER_SUFFIX_BY_PARENT: Record<NbaQuarterParentStat, 'pts' | 'reb' | 'ast'> = {
  points: 'pts',
  rebounds: 'reb',
  assists: 'ast',
};

export const NBA_QUARTER_PARENT_BY_SUFFIX: Record<'pts' | 'reb' | 'ast', NbaQuarterParentStat> = {
  pts: 'points',
  reb: 'rebounds',
  ast: 'assists',
};

export const NBA_PLAYER_QUARTER_POINT_KEYS = ['q1_pts', 'q2_pts', 'q3_pts', 'q4_pts'] as const;
export const NBA_PLAYER_QUARTER_REBOUND_KEYS = ['q1_reb', 'q2_reb', 'q3_reb', 'q4_reb'] as const;
export const NBA_PLAYER_QUARTER_ASSIST_KEYS = ['q1_ast', 'q2_ast', 'q3_ast', 'q4_ast'] as const;

export const NBA_PLAYER_QUARTER_STAT_KEYS = [
  ...NBA_PLAYER_QUARTER_POINT_KEYS,
  ...NBA_PLAYER_QUARTER_REBOUND_KEYS,
  ...NBA_PLAYER_QUARTER_ASSIST_KEYS,
] as const;

export type NbaPlayerQuarterPointKey = (typeof NBA_PLAYER_QUARTER_POINT_KEYS)[number];
export type NbaPlayerQuarterStatKey = (typeof NBA_PLAYER_QUARTER_STAT_KEYS)[number];

const QUARTER_KEY_SET = new Set<string>(NBA_PLAYER_QUARTER_STAT_KEYS);
const QUARTER_POINT_KEY_SET = new Set<string>(NBA_PLAYER_QUARTER_POINT_KEYS);

export function isNbaPlayerQuarterStat(stat: string | null | undefined): boolean {
  return !!stat && QUARTER_KEY_SET.has(stat);
}

export function isNbaPlayerQuarterPointStat(stat: string | null | undefined): boolean {
  return !!stat && QUARTER_POINT_KEY_SET.has(stat);
}

export function isNbaQuarterParentStat(stat: string | null | undefined): stat is NbaQuarterParentStat {
  return stat === 'points' || stat === 'rebounds' || stat === 'assists';
}

export function parseNbaPlayerQuarterStat(
  stat: string | null | undefined
): { n: 1 | 2 | 3 | 4; parent: NbaQuarterParentStat } | null {
  const m = String(stat || '').match(/^q([1-4])_(pts|reb|ast)$/);
  if (!m) return null;
  const n = Number(m[1]) as 1 | 2 | 3 | 4;
  const suffix = m[2] as 'pts' | 'reb' | 'ast';
  return { n, parent: NBA_QUARTER_PARENT_BY_SUFFIX[suffix] };
}

export function nbaQuarterParentStat(stat: string | null | undefined): NbaQuarterParentStat | null {
  return parseNbaPlayerQuarterStat(stat)?.parent ?? null;
}

export function nbaPlayerQuarterStatKey(
  parent: NbaQuarterParentStat,
  n: 1 | 2 | 3 | 4
): NbaPlayerQuarterStatKey {
  return `q${n}_${NBA_QUARTER_SUFFIX_BY_PARENT[parent]}` as NbaPlayerQuarterStatKey;
}

export function nbaPlayerQuarterKeysForParent(
  parent: NbaQuarterParentStat
): readonly NbaPlayerQuarterStatKey[] {
  if (parent === 'points') return NBA_PLAYER_QUARTER_POINT_KEYS;
  if (parent === 'rebounds') return NBA_PLAYER_QUARTER_REBOUND_KEYS;
  return NBA_PLAYER_QUARTER_ASSIST_KEYS;
}
