/**
 * Client-safe NBL attacking play types + edge-matrix shapes.
 * Locked to the current NBL27 season (Rosetta year 2026).
 */

export const NBL_PLAY_TYPE_YEAR = 2026;

export const NBL_PLAY_TYPE_IDS = [
  'primary_bh',
  'secondary_bh',
  'three_shooter',
  'slasher',
  'post_up',
  'stretch_four',
] as const;

export type NblPlayTypeId = (typeof NBL_PLAY_TYPE_IDS)[number];

export const NBL_PLAY_TYPE_LABELS: Record<NblPlayTypeId, string> = {
  primary_bh: 'Primary BH',
  secondary_bh: 'Second BH',
  three_shooter: '3PT',
  slasher: 'Slasher',
  post_up: 'Interior',
  stretch_four: 'Stretch',
};

export const NBL_PLAY_TYPE_FULL_LABELS: Record<NblPlayTypeId, string> = {
  primary_bh: 'Primary Ball Handler',
  secondary_bh: 'Secondary Ball Handler',
  three_shooter: '3-Point Shooter',
  slasher: 'Slasher',
  post_up: 'Interior',
  stretch_four: 'Stretch',
};

export type NblPlayTypeStatKey = 'points' | 'assists' | 'rebounds';

export const NBL_PLAY_TYPE_STAT_LABELS: Record<NblPlayTypeStatKey, string> = {
  points: 'PTS',
  assists: 'AST',
  rebounds: 'REB',
};

export const NBL_PLAY_TYPE_STAT_ALIASES: Record<string, NblPlayTypeStatKey> = {
  pts: 'points',
  point: 'points',
  points: 'points',
  ast: 'assists',
  assist: 'assists',
  assists: 'assists',
  reb: 'rebounds',
  rebound: 'rebounds',
  rebounds: 'rebounds',
};

export type NblPlayTypePlayerRow = {
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  position: string | null;
  imageUrl: string | null;
  type: NblPlayTypeId;
  games: number;
  minutes: number | null;
  points: number | null;
  assists: number | null;
  statValue: number | null;
  threeRate: number | null;
  usgPct: number | null;
};

export type NblPlayTypeRoundPick = {
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  imageUrl: string | null;
  type: NblPlayTypeId;
  typeLabel: string;
  opponent: string;
  opponentCode: string | null;
  statValue: number | null;
  pct: number | null;
  pctLabel: 'USG' | '3P%';
  boost: number | null;
};

export type NblPlayTypeCell = {
  /** Allowed minus type league average, shrunk by sample. Positive = easier matchup. */
  boost: number | null;
  /** Minutes-weighted PTS/AST/REB this team allowed to this type. */
  allowed: number | null;
  /** Minutes-weighted type average across the league. */
  league: number | null;
  /** 1 = hardest (allows least to this type), 10 = easiest. */
  rank: number | null;
  fieldSize: number;
  games: number;
  players: number;
  minutes: number;
  significant: boolean;
  names: string[];
};

export type NblPlayTypeMatrixRow = {
  type: NblPlayTypeId;
  label: string;
  /** Unique qualified players tagged as this type. */
  playerCount: number;
  /** Player-games in the matrix (same player can appear more than once). */
  gameCount: number;
  cells: Record<string, NblPlayTypeCell>;
};

export type NblPlayTypesPayload = {
  year: number;
  seasonLabel: string;
  stat: NblPlayTypeStatKey | null;
  statLabel: string | null;
  statSupported: boolean;
  generatedAt: string;
  rosterCount: number;
  taggedCount: number;
  player: {
    playerId: string;
    name: string;
    team: string;
    type: NblPlayTypeId;
    typeLabel: string;
  } | null;
  teams: Array<{ code: string; name: string; shortName: string }>;
  rows: NblPlayTypeMatrixRow[];
  players: NblPlayTypePlayerRow[];
  roundPicks: NblPlayTypeRoundPick[];
};

export function nblPlayTypeStatKey(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function parseNblPlayTypeStat(raw: string | null | undefined): NblPlayTypeStatKey | null {
  const key = nblPlayTypeStatKey(raw);
  if (!key) return 'points';
  return NBL_PLAY_TYPE_STAT_ALIASES[key] ?? null;
}

/** Unknown stats fall back to points for callers that always need a key. */
export function normalizeNblPlayTypeStat(raw: string | null | undefined): NblPlayTypeStatKey {
  return parseNblPlayTypeStat(raw) ?? 'points';
}

/** Roster G/F/C (including GF/FC) for the props-page line under the name. */
export function formatNblRosterPosition(raw: string | null | undefined): string | null {
  const s = String(raw || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (!s) return null;
  if (s === 'GF' || s === 'FG') return 'G/F';
  if (s === 'FC' || s === 'CF') return 'F/C';
  if (s === 'GC' || s === 'CG') return 'G/C';
  if (s === 'G' || s === 'F' || s === 'C') return s;
  if (s.includes('G') && s.includes('F')) return 'G/F';
  if (s.includes('F') && s.includes('C')) return 'F/C';
  if (s.includes('C')) return 'C';
  if (s.includes('F')) return 'F';
  if (s.includes('G')) return 'G';
  return s;
}

/** AFL-style "MID - INS MID": roster position plus play type. */
export function formatNblPropsPositionLabel(
  position: string | null | undefined,
  playType: NblPlayTypeId | string | null | undefined
): string | null {
  const pos = formatNblRosterPosition(position);
  const typeKey = String(playType || '').trim() as NblPlayTypeId;
  const type = typeKey && typeKey in NBL_PLAY_TYPE_LABELS ? NBL_PLAY_TYPE_LABELS[typeKey] : null;
  if (pos && type) return `${pos} - ${type}`;
  return pos || type || null;
}
