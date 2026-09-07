/** Leading chart pills — remaining player stats follow this order. */
export const TENNIS_CHART_STAT_OPTIONS = [
  { key: 'moneyline', label: 'MONEYLINE' },
  { key: 'spread', label: 'SPREAD' },
  { key: 'totalGames', label: 'TOTAL GAMES' },
  { key: 'gamesWon', label: 'GAMES WON' },
  { key: 'gamesLost', label: 'OPP GAMES WON' },
] as const;

export const TENNIS_TEAM_STAT_OPTIONS = TENNIS_CHART_STAT_OPTIONS;

export const TENNIS_PLAYER_STAT_PRIORITY = [
  ...TENNIS_CHART_STAT_OPTIONS.map((s) => s.key),
  'aces',
  'opponentAces',
  'totalAces',
  'totalSets',
  'dominanceRatio',
  'doubleFaults',
  'pointsWon',
  'returnPointsWon',
  'firstServePct',
  'firstServeWonPct',
  'secondServeWonPct',
  'servicePointsWonPct',
  'returnPointsWonPct',
  'breakPointsConverted',
  'breakPointsConvertedPct',
  'breakPointsSaved',
  'breakPointsSavedPct',
  'firstServesWon',
  'winners',
  'unforcedErrors',
  'netPointsWon',
  'firstServeSpeed',
  'secondServeSpeed',
] as const;

const CHART_KEYS = new Set<string>(TENNIS_CHART_STAT_OPTIONS.map((s) => s.key));
const ALL_STAT_KEYS = new Set<string>(TENNIS_PLAYER_STAT_PRIORITY);

/** Walkover / default with no balls played — the match never started. */
export function isUnplayedTennisMatch(score: unknown): boolean {
  const text = String(score ?? '').trim();
  if (!text || text === '-' || text === '–' || text === '—') return true;
  if (/^(w\/o|wo|walkover|def|default|abd|abandoned)$/i.test(text)) return true;
  if (/^0\s*[-–]\s*0(?:\s|$)/i.test(text)) return true;
  if (/\b(w\/o|walkover)\b/i.test(text) && !/\d+\s*[-–]\s*\d+/.test(text)) return true;
  return false;
}

type ParsedScoreSet = { first: number; second: number; tb: number | null };

function parseScoreSetTokens(score: unknown): ParsedScoreSet[] {
  if (isUnplayedTennisMatch(score)) return [];
  const text = String(score ?? '')
    .trim()
    .replace(/\s+(RET|RETIRED|DEF|ABD)\.?$/i, '');
  const out: ParsedScoreSet[] = [];
  for (const token of text.split(/\s+/)) {
    const m = token.match(/^(\d+)-(\d+)(?:\((\d+)\))?/);
    if (!m) continue;
    out.push({
      first: Number(m[1]),
      second: Number(m[2]),
      tb: m[3] != null && Number.isFinite(Number(m[3])) ? Number(m[3]) : null,
    });
  }
  return out;
}

function gameIsWin(game: { isWin?: boolean | null; result?: unknown }): boolean {
  if (game.isWin === true) return true;
  if (game.isWin === false) return false;
  return String(game.result ?? '').trim().toLowerCase().startsWith('w');
}

/**
 * Winner-first scores (`7-5 6-2`) vs player-view (`5-7 2-6` on a straight-sets loss).
 * API-Tennis rows are already player-view.
 */
export function tennisScoreIsWinnerView(score: unknown, isWin: boolean): boolean {
  if (isWin) return true;
  const sets = parseScoreSetTokens(score);
  if (!sets.length) return true;
  let firstAhead = 0;
  let secondAhead = 0;
  for (const set of sets) {
    if (set.first === set.second) continue;
    if (set.first > set.second) firstAhead += 1;
    else secondAhead += 1;
  }
  return firstAhead > secondAhead;
}

/** Games from the written score tokens. Does not flip winner-view vs player-view. */
export function tennisScoreGameTotals(score: unknown): { gamesWon: number; gamesLost: number } | null {
  const sets = parseScoreSetTokens(score);
  if (!sets.length) return null;
  const gamesWon = sets.reduce((sum, set) => sum + set.first, 0);
  const gamesLost = sets.reduce((sum, set) => sum + set.second, 0);
  if (gamesWon + gamesLost <= 0) return null;
  return { gamesWon, gamesLost };
}

export function tennisPlayerViewGameTotals(
  score: unknown,
  isWin: boolean
): { gamesWon: number; gamesLost: number } | null {
  const raw = tennisScoreGameTotals(score);
  if (!raw) return null;
  if (!isWin && tennisScoreIsWinnerView(score, isWin)) {
    return { gamesWon: raw.gamesLost, gamesLost: raw.gamesWon };
  }
  return raw;
}

export function tennisMatchNeverStarted(game: {
  score?: unknown;
  totalGames?: number | null;
  gamesWon?: number | null;
  gamesLost?: number | null;
  setsWon?: number | null;
  setsLost?: number | null;
}): boolean {
  if (isUnplayedTennisMatch(game.score)) return true;
  if (tennisScoreGameTotals(game.score)) return false;
  const played =
    (Number(game.gamesWon) || 0) +
    (Number(game.gamesLost) || 0) +
    (Number(game.totalGames) || 0) +
    (Number(game.setsWon) || 0) +
    (Number(game.setsLost) || 0);
  return played <= 0;
}

export function withRepairedTennisTotals<T extends {
  score?: unknown;
  totalGames?: number | null;
  gamesWon?: number | null;
  gamesLost?: number | null;
  spread?: number | null;
  isWin?: boolean | null;
  result?: unknown;
}>(game: T): T {
  const fromScore = tennisPlayerViewGameTotals(game.score, gameIsWin(game));
  if (!fromScore) return game;
  const totalGames = fromScore.gamesWon + fromScore.gamesLost;
  const alreadyRight =
    game.gamesWon === fromScore.gamesWon &&
    game.gamesLost === fromScore.gamesLost &&
    (game.totalGames ?? 0) === totalGames;
  if (alreadyRight) return game;
  return {
    ...game,
    gamesWon: fromScore.gamesWon,
    gamesLost: fromScore.gamesLost,
    totalGames,
    spread: fromScore.gamesLost - fromScore.gamesWon,
  };
}

export function tennisMatchesPlayed<T extends {
  score?: unknown;
  totalGames?: number | null;
  gamesWon?: number | null;
  gamesLost?: number | null;
  setsWon?: number | null;
  setsLost?: number | null;
  spread?: number | null;
}>(games: readonly T[]): T[] {
  return games
    .map((game) => withRepairedTennisTotals(game))
    .filter((game) => !tennisMatchNeverStarted(game));
}

export type TennisSetScore = {
  playerGames: number;
  opponentGames: number;
  tiebreak: number | null;
};

/** Player-first set scores. Winner-view rows are flipped on a loss; API rows are not. */
export function parseTennisSetsFromPlayerView(score: unknown, isWin: boolean): TennisSetScore[] {
  const sets = parseScoreSetTokens(score);
  const flip = !isWin && tennisScoreIsWinnerView(score, isWin);
  return sets
    .map((set) =>
      flip
        ? { playerGames: set.second, opponentGames: set.first, tiebreak: set.tb }
        : { playerGames: set.first, opponentGames: set.second, tiebreak: set.tb }
    )
    .filter((set) => !(set.playerGames === 0 && set.opponentGames === 0));
}

export function formatTennisSetScore(set: TennisSetScore): string {
  const base = `${set.playerGames}-${set.opponentGames}`;
  if (set.tiebreak == null) return base;
  const tbLoser = set.tiebreak;
  // Score token is the TB loser's points. Regular TB is first to 7, win by 2.
  const tbWinner = tbLoser <= 5 ? 7 : tbLoser + 2;
  const playerWonSet = set.playerGames > set.opponentGames;
  const tb = playerWonSet ? `${tbWinner}-${tbLoser}` : `${tbLoser}-${tbWinner}`;
  return `${base} (${tb})`;
}

export function tennisScoreIsRetired(score: unknown): boolean {
  return /\b(RET|RETIRED|ABD)\.?\b/i.test(String(score ?? ''));
}

export function isTennisGameStat(stat: string | null | undefined): boolean {
  return !!stat && CHART_KEYS.has(stat);
}

export function isTennisChartStat(stat: string | null | undefined): boolean {
  return !!stat && ALL_STAT_KEYS.has(stat);
}

export function tennisLastName(name: string | null | undefined): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return parts[parts.length - 1] || String(name || '');
}

/** First 3 letters of last name — chart / matchup opponent code. */
export function tennisOpponentCode(name: string | null | undefined): string {
  const last = tennisLastName(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '');
  return last.slice(0, 3).toUpperCase();
}

export function tennisTourLabel(opts: {
  tour?: string | null;
  isGrandSlam?: boolean;
}): string {
  if (opts.isGrandSlam) return 'Grand Slam';
  const tour = String(opts.tour || '').toUpperCase();
  if (tour === 'WTA') return 'WTA';
  if (tour === 'ATP') return 'ATP';
  return tour || 'Tennis';
}

/** Return points won % / serve points lost %. Both inputs are 0–100. */
export function tennisDominanceRatio(
  returnPointsWonPct: number | null | undefined,
  servicePointsWonPct: number | null | undefined
): number | null {
  const rpw =
    typeof returnPointsWonPct === 'number' && Number.isFinite(returnPointsWonPct)
      ? returnPointsWonPct
      : null;
  const spw =
    typeof servicePointsWonPct === 'number' && Number.isFinite(servicePointsWonPct)
      ? servicePointsWonPct
      : null;
  if (rpw == null || spw == null) return null;
  const lost = 100 - spw;
  if (lost <= 0) return null;
  return rpw / lost;
}

export function defaultTennisGameStat(stat: string | null | undefined): string {
  if (isTennisChartStat(stat)) return stat as string;
  return 'moneyline';
}

export const TENNIS_STAT_LABELS: Record<string, string> = {
  aces: 'ACES',
  opponentAces: 'OPP ACES',
  totalAces: 'TOTAL ACES',
  totalSets: 'TOTAL SETS',
  dominanceRatio: 'DR',
  doubleFaults: 'DF',
  gamesWon: 'GAMES WON',
  gamesLost: 'OPP GAMES WON',
  totalGames: 'TOTAL GAMES',
  pointsWon: 'PTS WON',
  returnPointsWon: 'RETURN PTS',
  returnPointsWonPct: 'RETURN %',
  servePointsWon: 'SERVE PTS WON',
  servePoints: 'SERVE PTS',
  serveGames: 'SERVE GAMES',
  firstServesIn: '1ST SERVE IN',
  firstServesWon: '1ST SERVE PTS',
  secondServeAttempts: '2ND SERVE ATT',
  secondServesWon: '2ND SERVE PTS',
  firstServePct: '1ST SERVE %',
  firstServeWonPct: '1ST SERVE WON',
  secondServeWonPct: '2ND SERVE WON',
  servicePointsWonPct: 'SERVE %',
  breakPointsConverted: 'BP WON',
  breakPointsConvertedPct: 'BP %',
  breakPointsSaved: 'BP SVD',
  breakPointsSavedPct: 'BP SVD %',
  breakPointsFaced: 'BP FACED',
  minutes: 'MINS',
  moneyline: 'MONEYLINE',
  spread: 'SPREAD',
  setsWon: 'SETS',
  setsLost: 'SETS L',
  totalPoints: 'MATCH PTS',
  winners: 'WINNERS',
  unforcedErrors: 'UE',
  netPointsWon: 'NET PTS',
  firstServeSpeed: '1ST SPEED',
  secondServeSpeed: '2ND SPEED',
  distanceCovered: 'DISTANCE',
  serviceGamesWon: 'HOLD GAMES',
  returnGamesWon: 'BREAKS',
};
