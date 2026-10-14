/**
 * Client-safe NBA attacking play types + edge-matrix shapes.
 * Locked to the current NBA season (2026 = 2026/27).
 */

export const NBA_PLAY_TYPE_YEAR = 2026;

export const NBA_PLAY_TYPE_IDS = [
  'primary_bh',
  'secondary_bh',
  'three_shooter',
  'slasher',
  'post_up',
  'stretch_four',
] as const;

export type NbaPlayTypeId = (typeof NBA_PLAY_TYPE_IDS)[number];

export const NBA_PLAY_TYPE_LABELS: Record<NbaPlayTypeId, string> = {
  primary_bh: 'Primary BH',
  secondary_bh: 'Second BH',
  three_shooter: '3PT',
  slasher: 'Slasher',
  post_up: 'Interior',
  stretch_four: 'Stretch',
};

export const NBA_PLAY_TYPE_FULL_LABELS: Record<NbaPlayTypeId, string> = {
  primary_bh: 'Primary Ball Handler',
  secondary_bh: 'Secondary Ball Handler',
  three_shooter: '3-Point Shooter',
  slasher: 'Slasher',
  post_up: 'Interior',
  stretch_four: 'Stretch',
};

export type NbaPlayTypeStatKey =
  | 'points'
  | 'assists'
  | 'rebounds'
  | 'pra'
  | 'pr'
  | 'pa'
  | 'ra';

export const NBA_PLAY_TYPE_STAT_LABELS: Record<NbaPlayTypeStatKey, string> = {
  points: 'PTS',
  assists: 'AST',
  rebounds: 'REB',
  pra: 'PRA',
  pr: 'PR',
  pa: 'PA',
  ra: 'RA',
};

export const NBA_PLAY_TYPE_STAT_ALIASES: Record<string, NbaPlayTypeStatKey> = {
  pts: 'points',
  point: 'points',
  points: 'points',
  ast: 'assists',
  assist: 'assists',
  assists: 'assists',
  reb: 'rebounds',
  rebound: 'rebounds',
  rebounds: 'rebounds',
  pra: 'pra',
  pointsreboundsassists: 'pra',
  pr: 'pr',
  pointsrebounds: 'pr',
  pa: 'pa',
  pointsassists: 'pa',
  ra: 'ra',
  reboundsassists: 'ra',
};

export type NbaPlayTypePlayerRow = {
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  position: string | null;
  imageUrl: string | null;
  type: NbaPlayTypeId;
  games: number;
  minutes: number | null;
  points: number | null;
  assists: number | null;
  statValue: number | null;
  threeRate: number | null;
  usgPct: number | null;
};

export type NbaPlayTypeRoundPick = {
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  imageUrl: string | null;
  type: NbaPlayTypeId;
  typeLabel: string;
  opponent: string;
  opponentCode: string | null;
  statValue: number | null;
  pct: number | null;
  pctLabel: 'USG' | '3P%';
  boost: number | null;
};

export type NbaPlayTypeCell = {
  /** Allowed minus type league average, shrunk by sample. Positive = easier matchup. */
  boost: number | null;
  /** Minutes-weighted stat this team allowed to this type. */
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

export type NbaPlayTypeMatrixRow = {
  type: NbaPlayTypeId;
  label: string;
  /** Unique qualified players tagged as this type. */
  playerCount: number;
  /** Player-games in the matrix (same player can appear more than once). */
  gameCount: number;
  cells: Record<string, NbaPlayTypeCell>;
};

export type NbaPlayTypesPayload = {
  year: number;
  seasonLabel: string;
  stat: NbaPlayTypeStatKey | null;
  statLabel: string | null;
  statSupported: boolean;
  generatedAt: string;
  rosterCount: number;
  taggedCount: number;
  player: {
    playerId: string;
    name: string;
    team: string;
    type: NbaPlayTypeId;
    typeLabel: string;
  } | null;
  teams: Array<{ code: string; name: string; shortName: string }>;
  rows: NbaPlayTypeMatrixRow[];
  players: NbaPlayTypePlayerRow[];
  roundPicks: NbaPlayTypeRoundPick[];
};

export function nbaPlayTypeStatKey(raw: string | null | undefined): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

export function parseNbaPlayTypeStat(raw: string | null | undefined): NbaPlayTypeStatKey | null {
  const key = nbaPlayTypeStatKey(raw);
  if (!key) return 'points';
  return NBA_PLAY_TYPE_STAT_ALIASES[key] ?? null;
}

/** Unknown stats fall back to points for callers that always need a key. */
export function normalizeNbaPlayTypeStat(raw: string | null | undefined): NbaPlayTypeStatKey {
  return parseNbaPlayTypeStat(raw) ?? 'points';
}

/** Roster G/F/C (including GF/FC) for the props-page line under the name. */
export function formatNbaRosterPosition(raw: string | null | undefined): string | null {
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
export function formatNbaPropsPositionLabel(
  position: string | null | undefined,
  playType: NbaPlayTypeId | string | null | undefined
): string | null {
  const pos = formatNbaRosterPosition(position);
  const typeKey = String(playType || '').trim() as NbaPlayTypeId;
  const type = typeKey && typeKey in NBA_PLAY_TYPE_LABELS ? NBA_PLAY_TYPE_LABELS[typeKey] : null;
  if (pos && type) return `${pos} - ${type}`;
  return pos || type || null;
}
