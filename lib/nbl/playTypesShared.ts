/**
 * Client-safe NBL attacking play types + edge-matrix shapes.
 * Locked to NBL26 (Rosetta year 2025).
 */

export const NBL_PLAY_TYPE_YEAR = 2025;

export const NBL_PLAY_TYPE_IDS = [
  'primary_bh',
  'secondary_bh',
  'perimeter',
  'three_shooter',
  'slasher',
  'post_up',
  'stretch_four',
  'rim_runner',
] as const;

export type NblPlayTypeId = (typeof NBL_PLAY_TYPE_IDS)[number];

export const NBL_PLAY_TYPE_LABELS: Record<NblPlayTypeId, string> = {
  primary_bh: 'Primary BH',
  secondary_bh: 'Second BH',
  perimeter: 'Perimeter',
  three_shooter: '3PT shooter',
  slasher: 'Slasher',
  post_up: 'Post-up',
  stretch_four: 'Stretch four',
  rim_runner: 'Rim runner',
};

export type NblPlayTypeStatKey =
  | 'points'
  | 'assists'
  | 'threeMade'
  | 'pra'
  | 'pa'
  | 'fgMade';

export const NBL_PLAY_TYPE_STAT_LABELS: Record<NblPlayTypeStatKey, string> = {
  points: 'Points',
  assists: 'Assists',
  threeMade: '3PM',
  pra: 'PRA',
  pa: 'P+A',
  fgMade: 'FGM',
};

export type NblPlayTypePlayerRow = {
  playerId: string;
  name: string;
  team: string;
  teamCode: string | null;
  position: string | null;
  type: NblPlayTypeId;
  games: number;
  minutes: number | null;
  points: number | null;
  assists: number | null;
  threeRate: number | null;
};

export type NblPlayTypeCell = {
  boost: number | null;
  games: number;
  players: number;
  significant: boolean;
};

export type NblPlayTypeMatrixRow = {
  type: NblPlayTypeId;
  label: string;
  /** Unique players tagged as this type. */
  playerCount: number;
  /** Player-games in the matrix (same player can appear more than once). */
  gameCount: number;
  cells: Record<string, NblPlayTypeCell>;
};

export type NblPlayTypesPayload = {
  year: number;
  seasonLabel: string;
  stat: NblPlayTypeStatKey;
  statLabel: string;
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
};

export function normalizeNblPlayTypeStat(raw: string | null | undefined): NblPlayTypeStatKey {
  const key = String(raw || 'points')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const aliases: Record<string, NblPlayTypeStatKey> = {
    pts: 'points',
    point: 'points',
    points: 'points',
    ast: 'assists',
    assist: 'assists',
    assists: 'assists',
    threes: 'threeMade',
    threemade: 'threeMade',
    '3pm': 'threeMade',
    fg3m: 'threeMade',
    pra: 'pra',
    pa: 'pa',
    fgm: 'fgMade',
    fgmade: 'fgMade',
  };
  return aliases[key] || 'points';
}
