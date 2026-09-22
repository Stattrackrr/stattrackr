/** Client-safe NBL PBP quarter-split keys (points, rebounds, assists). */

export const NBL_QUARTER_PARENT_STATS = ['points', 'rebounds', 'assists'] as const;
export type NblQuarterParentStat = (typeof NBL_QUARTER_PARENT_STATS)[number];

export const NBL_QUARTER_SUFFIX_BY_PARENT: Record<NblQuarterParentStat, 'pts' | 'reb' | 'ast'> = {
  points: 'pts',
  rebounds: 'reb',
  assists: 'ast',
};

export const NBL_QUARTER_PARENT_BY_SUFFIX: Record<'pts' | 'reb' | 'ast', NblQuarterParentStat> = {
  pts: 'points',
  reb: 'rebounds',
  ast: 'assists',
};

export const NBL_PLAYER_QUARTER_POINT_KEYS = ['q1_pts', 'q2_pts', 'q3_pts', 'q4_pts'] as const;
export const NBL_PLAYER_QUARTER_REBOUND_KEYS = ['q1_reb', 'q2_reb', 'q3_reb', 'q4_reb'] as const;
export const NBL_PLAYER_QUARTER_ASSIST_KEYS = ['q1_ast', 'q2_ast', 'q3_ast', 'q4_ast'] as const;

export const NBL_PLAYER_QUARTER_STAT_KEYS = [
  ...NBL_PLAYER_QUARTER_POINT_KEYS,
  ...NBL_PLAYER_QUARTER_REBOUND_KEYS,
  ...NBL_PLAYER_QUARTER_ASSIST_KEYS,
] as const;

export type NblPlayerQuarterPointKey = (typeof NBL_PLAYER_QUARTER_POINT_KEYS)[number];
export type NblPlayerQuarterStatKey = (typeof NBL_PLAYER_QUARTER_STAT_KEYS)[number];

const QUARTER_KEY_SET = new Set<string>(NBL_PLAYER_QUARTER_STAT_KEYS);
const QUARTER_POINT_KEY_SET = new Set<string>(NBL_PLAYER_QUARTER_POINT_KEYS);

export function isNblPlayerQuarterStat(stat: string | null | undefined): boolean {
  return !!stat && QUARTER_KEY_SET.has(stat);
}

export function isNblPlayerQuarterPointStat(stat: string | null | undefined): boolean {
  return !!stat && QUARTER_POINT_KEY_SET.has(stat);
}

export function isNblQuarterParentStat(stat: string | null | undefined): stat is NblQuarterParentStat {
  return stat === 'points' || stat === 'rebounds' || stat === 'assists';
}

export function parseNblPlayerQuarterStat(
  stat: string | null | undefined
): { n: 1 | 2 | 3 | 4; parent: NblQuarterParentStat } | null {
  const m = String(stat || '').match(/^q([1-4])_(pts|reb|ast)$/);
  if (!m) return null;
  const n = Number(m[1]) as 1 | 2 | 3 | 4;
  const suffix = m[2] as 'pts' | 'reb' | 'ast';
  return { n, parent: NBL_QUARTER_PARENT_BY_SUFFIX[suffix] };
}

export function nblQuarterParentStat(stat: string | null | undefined): NblQuarterParentStat | null {
  return parseNblPlayerQuarterStat(stat)?.parent ?? null;
}

export function nblPlayerQuarterStatKey(
  parent: NblQuarterParentStat,
  n: 1 | 2 | 3 | 4
): NblPlayerQuarterStatKey {
  return `q${n}_${NBL_QUARTER_SUFFIX_BY_PARENT[parent]}` as NblPlayerQuarterStatKey;
}

export function nblPlayerQuarterKeysForParent(
  parent: NblQuarterParentStat
): readonly NblPlayerQuarterStatKey[] {
  if (parent === 'points') return NBL_PLAYER_QUARTER_POINT_KEYS;
  if (parent === 'rebounds') return NBL_PLAYER_QUARTER_REBOUND_KEYS;
  return NBL_PLAYER_QUARTER_ASSIST_KEYS;
}
