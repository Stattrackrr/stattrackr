/** Shared combined-props snapshot types (client + server safe — no Node imports). */

export type CombinedPropsBookmakerLine = {
  bookmaker: string;
  line: number;
  overOdds: string;
  underOdds: string;
};

export type CombinedPlayerProp = {
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  statType: string;
  line: number;
  overProb: number;
  underProb: number;
  overOdds: string;
  underOdds: string;
  impliedOverProb: number;
  impliedUnderProb: number;
  bestLine: number;
  bookmaker: string;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number;
  gameDate: string;
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonAvg?: number | null;
  seasonHitRate?: { hits: number; total: number } | null;
  streak?: number | null;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  bookmakerLines?: CombinedPropsBookmakerLine[];
  gameId?: string;
  homeTeam?: string;
  awayTeam?: string;
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  wcGameLog?: Array<{ opponent: string; value: number; date?: string }>;
  headshotUrl?: string | null;
  wcPosition?: string | null;
};

export type CombinedAflGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

export type CombinedPropsSnapshot = {
  success: boolean;
  snapshotVersion: 1;
  generatedAt: string;
  staleAt: string;
  nba: {
    ok: boolean;
    status: number;
    cached: boolean;
    lastUpdated: string | null;
    gameDate: string | null;
    props: CombinedPlayerProp[];
  };
  afl: {
    ok: boolean;
    status: number;
    lastUpdated: string | null;
    nextUpdate: string | null;
    ingestMessage: string | null;
    noAflOdds: boolean;
    games: CombinedAflGame[];
    props: CombinedPlayerProp[];
    debugMeta?: Record<string, unknown> | null;
  };
  worldCup: {
    ok: boolean;
    status: number;
    lastUpdated: string | null;
    nextUpdate: string | null;
    ingestMessage: string | null;
    noWorldCupOdds: boolean;
    games: CombinedAflGame[];
    props: CombinedPlayerProp[];
  };
};
