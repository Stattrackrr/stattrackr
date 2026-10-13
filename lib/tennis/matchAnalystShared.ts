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
  /** Retired / walkover matches in the window, left out of the games numbers. */
  retiredLeftOut: number;
  /** Counts over finished matches, written as hits/sample (e.g. "12/15"). */
  wonASet: string | null;
  straightSetWins: string | null;
  straightSetLosses: string | null;
  decidingSet: string | null;
};

export type TennisAnalystForm = {
  record: string;
  winPct: number | null;
  results: Array<{ opponent: string; win: boolean; surface: 'hard' | 'clay' | 'grass' | null }>;
};

/** How recent the form is, with "ago" text worked out in code so the AI never does date maths. */
export type TennisAnalystTimeline = {
  /** Current run across all matches, newest first. */
  streak: { result: 'won' | 'lost'; count: number } | null;
  lastMatch: { date: string; daysAgo: number; ago: string; won: boolean; opponent: string } | null;
  /** Oldest match in the last-15 window for this format. */
  last15From: { date: string; ago: string } | null;
};

export type TennisAnalystPlayer = {
  name: string;
  last: string;
  rank: number | null;
  hand: string | null;
  l5: TennisAnalystForm;
  l10: TennisAnalystForm;
  l15: TennisAnalystStats;
  surface: { surface: string; stats: TennisAnalystStats } | null;
  timeline: TennisAnalystTimeline;
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
  tournamentName?: string | null;
  player: TennisAnalystPlayer;
  opponent: TennisAnalystPlayer;
  h2h: {
    matches: number;
    playerWins: number;
    opponentWins: number;
    record: string;
    surfaceRecord: string | null;
    avgGames: number | null;
    avgGamesBo3: number | null;
    avgGamesBo5: number | null;
    recent: Array<{ date: string | null; ago: string | null; winner: string; score: string; surface: string | null }>;
    lastMeeting: { date: string; ago: string; monthsAgo: number } | null;
    /** Oldest match on file for the player; meetings before this are not in the data. */
    onFileSince: string | null;
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
    expectedTotalGames: number;
    totalsLine: number;
    totalsOverPct: number;
  };
  edges: TennisAnalystEdge[];
  bestEdge: TennisAnalystEdge;
  marketOdds: {
    listedTotalLine: number | null;
    pickemTotalLine: number | null;
    formatMin: number;
    formatMax: number;
    totals: Array<{ book: string; line: number | null; over: number | null; under: number | null }>;
    totalsAtListed: Array<{ book: string; line: number | null; over: number | null; under: number | null }>;
    moneyline: Array<{ book: string; player: number | null; opponent: number | null }>;
    sets?: Array<{
      book: string;
      playerToWinASet: number | null;
      opponentToWinASet: number | null;
      playerStraightSets: number | null;
      opponentStraightSets: number | null;
      totalSetsLine: number | null;
      totalSetsOver: number | null;
      totalSetsUnder: number | null;
    }>;
  } | null;
};
