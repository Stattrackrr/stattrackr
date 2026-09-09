export type TennisAnalystStats = {
  matches: number;
  record: string;
  winPct: number | null;
  gameWinPct: number | null;
  setWinPct: number | null;
  holdPct: number | null;
  breakPct: number | null;
  aces: number | null;
  acesAllowed: number | null;
  df: number | null;
  firstServePct: number | null;
  firstServeWonPct: number | null;
  secondServeWonPct: number | null;
  spw: number | null;
  rpw: number | null;
  bpConv: number | null;
  bpSaved: number | null;
  gamesWon: number | null;
  gamesLost: number | null;
  totalGames: number | null;
  over215: number | null;
  over225: number | null;
};

export type TennisAnalystPlayer = {
  name: string;
  last: string;
  rank: number | null;
  hand: string | null;
  l5: { record: string; winPct: number | null };
  l10: { record: string; winPct: number | null };
  l15: TennisAnalystStats;
  surface: { surface: string; stats: TennisAnalystStats } | null;
};

export type TennisAnalystEdge = {
  id: string;
  market: string;
  selection: string;
  leanSide: 'player' | 'opponent' | 'over' | 'under';
  probability: number;
  fairOdds: number;
  line: string | null;
  modelPts: number;
  why: string;
  score: number;
};

export type TennisAnalystDriver = {
  label: string;
  player: number | null;
  opponent: number | null;
  unit: '%' | 'n' | '';
  lean: string;
};

export type TennisMatchAnalysis = {
  tour: 'ATP' | 'WTA';
  surface: string | null;
  bestOf: 3 | 5;
  player: TennisAnalystPlayer;
  opponent: TennisAnalystPlayer;
  h2h: {
    matches: number;
    playerWins: number;
    opponentWins: number;
    record: string;
    surfaceRecord: string | null;
    avgGames: number | null;
    recent: Array<{ date: string | null; winner: string; score: string }>;
  };
  model: {
    winner: string;
    winnerSide: 'player' | 'opponent';
    playerWinPct: number;
    opponentWinPct: number;
    playerFairOdds: number;
    opponentFairOdds: number;
    confidence: number;
    drivers: TennisAnalystDriver[];
    expectedWinnerMargin: number;
    playerCover15Pct: number;
    playerCover25Pct: number;
    playerCover35Pct: number;
    playerCover55Pct: number;
    opponentCover15Pct: number;
    opponentCover25Pct: number;
    opponentCover35Pct: number;
    opponentCover55Pct: number;
    winnerCover15Pct: number;
    winnerCover25Pct: number;
  };
  edges: TennisAnalystEdge[];
  bestEdge: TennisAnalystEdge;
  marketOdds: null;
};
