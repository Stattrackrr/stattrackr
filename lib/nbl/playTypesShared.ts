/**
 * Client-safe NBL attacking play types + edge-matrix shapes.
 * Locked to NBL26 (Rosetta year 2025).
 */

export const NBL_PLAY_TYPE_YEAR = 2025;

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

export type NblPlayTypeStatKey =
  | 'points'
  | 'assists'
  | 'rebounds'
  | 'threeMade'
  | 'pra'
  | 'pr'
  | 'pa'
  | 'ra'
  | 'fgMade'
  | 'steals'
  | 'blocks';

export const NBL_PLAY_TYPE_STAT_LABELS: Record<NblPlayTypeStatKey, string> = {
  points: 'Points',
  assists: 'Assists',
  rebounds: 'Rebounds',
  threeMade: '3PM',
  pra: 'PRA',
  pr: 'P+R',
  pa: 'P+A',
  ra: 'R+A',
  fgMade: 'FGM',
  steals: 'Steals',
  blocks: 'Blocks',
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
  threes: 'threeMade',
  threemade: 'threeMade',
  '3pm': 'threeMade',
  fg3m: 'threeMade',
  pra: 'pra',
  pr: 'pr',
  pa: 'pa',
  ra: 'ra',
  fgm: 'fgMade',
  fgmade: 'fgMade',
  stl: 'steals',
  steal: 'steals',
  steals: 'steals',
  blk: 'blocks',
  block: 'blocks',
  blocks: 'blocks',
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
  boost: number | null;
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
