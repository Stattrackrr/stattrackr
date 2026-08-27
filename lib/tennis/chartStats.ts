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
] as const;

const CHART_KEYS = new Set<string>(TENNIS_CHART_STAT_OPTIONS.map((s) => s.key));
const ALL_STAT_KEYS = new Set<string>(TENNIS_PLAYER_STAT_PRIORITY);

/** Walkover / default with no balls played — the match never started. */
export function isUnplayedTennisMatch(score: unknown): boolean {
  const text = String(score ?? '').trim();
  if (!text) return false;
  if (/^(w\/o|wo|walkover|def|default)$/i.test(text)) return true;
  if (/\b(w\/o|walkover)\b/i.test(text) && !/\d+\s*[-–]\s*\d+/.test(text)) return true;
  return false;
}

export function tennisMatchesPlayed<T extends { score?: unknown }>(games: readonly T[]): T[] {
  return games.filter((game) => !isUnplayedTennisMatch(game.score));
}

export type TennisSetScore = {
  playerGames: number;
  opponentGames: number;
  tiebreak: number | null;
};

/** Sackmann scores are winner-view (`6-3 3-6 6-3`). Flip when the selected player lost. */
export function parseTennisSetsFromPlayerView(score: unknown, isWin: boolean): TennisSetScore[] {
  const text = String(score ?? '').trim();
  if (!text || isUnplayedTennisMatch(text)) return [];
  return text
    .replace(/\s+(RET|RETIRED|DEF|ABD)\.?$/i, '')
    .split(/\s+/)
    .map((token) => {
      const m = token.match(/^(\d+)-(\d+)(?:\((\d+)\))?/);
      if (!m) return null;
      const winnerGames = Number(m[1]);
      const loserGames = Number(m[2]);
      const tiebreak = m[3] != null && Number.isFinite(Number(m[3])) ? Number(m[3]) : null;
      return isWin
        ? { playerGames: winnerGames, opponentGames: loserGames, tiebreak }
        : { playerGames: loserGames, opponentGames: winnerGames, tiebreak };
    })
    .filter((set): set is TennisSetScore => set != null && !(set.playerGames === 0 && set.opponentGames === 0));
}

export function formatTennisSetScore(set: TennisSetScore): string {
  const base = `${set.playerGames}-${set.opponentGames}`;
  if (set.tiebreak == null) return base;
  const tbLoser = set.tiebreak;
  // Sackmann stores the TB loser's points. Regular TB is first to 7, win by 2.
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

export function defaultTennisGameStat(stat: string | null | undefined): string {
  if (isTennisChartStat(stat)) return stat as string;
  return 'moneyline';
}

export const TENNIS_STAT_LABELS: Record<string, string> = {
  aces: 'ACES',
  opponentAces: 'OPP ACES',
  totalAces: 'TOTAL ACES',
  totalSets: 'TOTAL SETS',
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
};
