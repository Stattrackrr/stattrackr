/** Client-safe types for similar players vs an opponent. */

export type TennisSimilarStatKey =
  | 'moneyline'
  | 'spread'
  | 'totalGames'
  | 'gamesWon'
  | 'gamesLost'
  | 'aces'
  | 'opponentAces'
  | 'totalAces'
  | 'totalSets'
  | 'dominanceRatio'
  | 'doubleFaults'
  | 'pointsWon'
  | 'returnPointsWon'
  | 'firstServePct'
  | 'firstServeWonPct'
  | 'secondServeWonPct'
  | 'servicePointsWonPct'
  | 'returnPointsWonPct'
  | 'breakPointsConverted'
  | 'breakPointsConvertedPct'
  | 'breakPointsSaved'
  | 'breakPointsSavedPct'
  | 'firstServesWon';

export const TENNIS_SIMILAR_STAT_LABELS: Record<TennisSimilarStatKey, string> = {
  moneyline: 'W/L',
  spread: 'Spread',
  totalGames: 'Games',
  gamesWon: 'Won',
  gamesLost: 'Lost',
  aces: 'Aces',
  opponentAces: 'Opp aces',
  totalAces: 'Aces',
  totalSets: 'Sets',
  dominanceRatio: 'DR',
  doubleFaults: 'DF',
  pointsWon: 'Pts',
  returnPointsWon: 'RPW',
  firstServePct: '1st %',
  firstServeWonPct: '1st W%',
  secondServeWonPct: '2nd W%',
  servicePointsWonPct: 'SPW',
  returnPointsWonPct: 'RPW%',
  breakPointsConverted: 'BP',
  breakPointsConvertedPct: 'BP%',
  breakPointsSaved: 'BP svd',
  breakPointsSavedPct: 'BP svd%',
  firstServesWon: '1st pts',
};

export type TennisSimilarMatchStats = {
  aces: number | null;
  opponentAces: number | null;
  totalGames: number | null;
  gamesWon: number | null;
  gamesLost: number | null;
  totalSets: number | null;
  doubleFaults: number | null;
  firstServePct: number | null;
  dominanceRatio: number | null;
  breakPointsConverted: number | null;
  returnPointsWonPct: number | null;
};

export type TennisSimilarPlayerRow = {
  matchId: string;
  date: string | null;
  playerId: string;
  name: string;
  ioc: string | null;
  imageUrl: string | null;
  hand: 'R' | 'L' | null;
  rank: number | null;
  similarity: number;
  isWin: boolean;
  score: string;
  surface: string | null;
  h2hWins: number;
  h2hLosses: number;
  value: number | null;
  stats: TennisSimilarMatchStats;
};

export type TennisSimilarPlayersPayload = {
  stat: TennisSimilarStatKey;
  statLabel: string;
  player: {
    playerId: string | null;
    name: string;
    ioc: string | null;
    hand: 'R' | 'L' | null;
    rank: number | null;
  } | null;
  opponent: {
    playerId: string | null;
    name: string;
    ioc: string | null;
  } | null;
  similar: TennisSimilarPlayerRow[];
};
