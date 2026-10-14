/** NBA dashboard client/server shared types. Mirrors the NBL dashboard shapes plus NBA-only stats. */

export type NbaGameLogRow = {
  matchId: string;
  date: string | null;
  season: number;
  round: string | number | null;
  postseason?: boolean;
  opponent: string;
  opponentCode: string | null;
  isHome: boolean;
  team: string;
  teamCode: string | null;
  result: string | null;
  venue?: string | null;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  offensiveRebounds: number | null;
  defensiveRebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgMade: number | null;
  fgAttempted: number | null;
  fgPct: number | null;
  twoMade: number | null;
  twoAttempted: number | null;
  twoPct: number | null;
  threeMade: number | null;
  threeAttempted: number | null;
  threePct: number | null;
  ftMade: number | null;
  ftAttempted: number | null;
  ftPct: number | null;
  plusMinus: number | null;
  efficiency: number | null;
  pra: number | null;
  pr: number | null;
  pa: number | null;
  ra: number | null;
  /** Stocks: steals + blocks. */
  stocks?: number | null;
  q1_pts?: number | null;
  q2_pts?: number | null;
  q3_pts?: number | null;
  q4_pts?: number | null;
  q1_reb?: number | null;
  q2_reb?: number | null;
  q3_reb?: number | null;
  q4_reb?: number | null;
  q1_ast?: number | null;
  q2_ast?: number | null;
  q3_ast?: number | null;
  q4_ast?: number | null;
  /** Rates on a 0-100 scale (pace is possessions per 48). */
  usgPct?: number | null;
  tsPct?: number | null;
  trebPct?: number | null;
  orebPct?: number | null;
  drebPct?: number | null;
  trebOnCourt?: number | null;
  orebOnCourt?: number | null;
  drebOnCourt?: number | null;
  pace?: number | null;
  offRtg?: number | null;
  defRtg?: number | null;
  /** NBA tracking (per game). */
  potentialRebounds?: number | null;
  potentialOffRebounds?: number | null;
  potentialDefRebounds?: number | null;
  touches?: number | null;
  passes?: number | null;
  secondaryAssists?: number | null;
  ftAssists?: number | null;
  contestedFga?: number | null;
  uncontestedFga?: number | null;
  deflections?: number | null;
  possessions?: number | null;
  pointsPaint?: number | null;
  pointsFastBreak?: number | null;
  pointsSecondChance?: number | null;
  distanceMiles?: number | null;
};

/** Season per-game averages for one player (regular season when available). */
export type NbaLeaguePlayerStatRow = {
  playerId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  team: string;
  teamCode: string | null;
  teamId: string | null;
  position: string | null;
  jersey: string | null;
  imageUrl: string | null;
  games: number;
  gamesStarted: number;
  minutes: number | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  fouls: number | null;
  fgPct: number | null;
  threePct: number | null;
  ftPct: number | null;
  threeMade: number | null;
  pra: number | null;
  offensiveRebounds?: number | null;
  defensiveRebounds?: number | null;
  usgPct?: number | null;
  potentialRebounds?: number | null;
  touches?: number | null;
};

export type NbaLineMovePoint = { at: string; line: number; over: number | null; under: number | null };

export type NbaBookLineMovement = {
  book: string;
  opening: NbaLineMovePoint;
  current: NbaLineMovePoint;
  points: NbaLineMovePoint[];
};

export type NbaStatLineMovement = {
  stat: string;
  openingLine: number | null;
  currentLine: number | null;
  books: NbaBookLineMovement[];
};

export type NbaLineMovement = {
  gameKey: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  player: string;
  updatedAt: string;
  stats: NbaStatLineMovement[];
};
