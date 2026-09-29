export type Tour = 'ATP' | 'WTA';

export type HistoryMatch = {
  date: string;
  tour: Tour;
  surface: string;
  playerId: string;
  opponentId: string;
  isWin: boolean;
  retired?: boolean;
  servicePointsWonPct: number | null;
  returnPointsWonPct: number | null;
  holdPct: number | null;
  aces: number | null;
  doubleFaults: number | null;
  serveGames: number | null;
  serveGamesPlayed: number | null;
  minutes: number | null;
  setsPlayed: number | null;
  tiebreak: boolean | null;
  wonTiebreak: boolean | null;
  firstSetWin: boolean | null;
  wonAfterLosingFirst: boolean | null;
  rank: number | null;
  opponentRank: number | null;
  hand: string | null;
  opponentHand: string | null;
};

export type ShrunkStat = {
  value: number | null;
  n: number;
  prior: number | null;
  priorOnly: boolean;
};

const HALF_LIFE_DAYS = 180;

function daysBetween(later: string, earlier: string): number {
  const a = Date.parse(later);
  const b = Date.parse(earlier);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, (a - b) / 86_400_000);
}

export function rowsBefore<T extends { date: string }>(rows: T[], asOf: string): T[] {
  const cut = Date.parse(asOf);
  if (!Number.isFinite(cut)) return [];
  return rows.filter((row) => {
    const at = Date.parse(row.date);
    return Number.isFinite(at) && at < cut;
  });
}

export function shrinkStat(stat: number | null, n: number, prior: number, k: number): ShrunkStat {
  if (stat == null || !Number.isFinite(stat) || n <= 0) {
    return { value: null, n: 0, prior, priorOnly: true };
  }
  return {
    value: (n * stat + k * prior) / (n + k),
    n,
    prior,
    priorOnly: false,
  };
}

function decayWeight(asOf: string, date: string): number {
  return Math.exp((-Math.LN2 * daysBetween(asOf, date)) / HALF_LIFE_DAYS);
}

function weightedRate(
  rows: HistoryMatch[],
  asOf: string,
  read: (row: HistoryMatch) => number | null
): { mean: number | null; n: number } {
  let weight = 0;
  let total = 0;
  let n = 0;
  for (const row of rows) {
    const value = read(row);
    if (value == null || !Number.isFinite(value)) continue;
    const w = decayWeight(asOf, row.date);
    weight += w;
    total += value * w;
    n += 1;
  }
  if (!(weight > 0)) return { mean: null, n: 0 };
  return { mean: total / weight, n };
}

export type FormRecord = { n: number; wins: number };

export type SideForm = {
  surface: FormRecord;
  surfaceLast10: FormRecord;
  last10: FormRecord;
  last5: FormRecord;
};

export type PlayerFeatures = {
  playerId: string;
  n: number;
  serve: ShrunkStat;
  returns: ShrunkStat;
  hold: ShrunkStat;
  aceRate: ShrunkStat;
  dfRate: ShrunkStat;
  elo: number;
  surfaceElo: number;
  restDays: number | null;
  minutes14: number;
  retiredRecent: boolean;
  hand: string | null;
  form: SideForm;
};

export type MatchupFeatures = {
  asOf: string;
  tour: Tour;
  surface: string;
  bestOf: 3 | 5;
  player: PlayerFeatures;
  opponent: PlayerFeatures;
  h2hWins: number;
  h2hPlayed: number;
  pServePlayer: number;
  pServeOpponent: number;
  serveUncertainty: number;
  insufficient: boolean;
};

const SERVE_PRIOR = 0.62;
const RETURN_PRIOR = 0.38;
const HOLD_PRIOR = 0.78;
const ACE_PRIOR = 0.45;
const DF_PRIOR = 0.18;
const K_SERVE = 12;

function eloExpected(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

function formRecord(rows: HistoryMatch[]): FormRecord {
  return { n: rows.length, wins: rows.filter((row) => row.isWin).length };
}

function sideForm(rows: HistoryMatch[], surface: string): SideForm {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const onSurface = ordered.filter((row) => row.surface.toLowerCase() === surface.toLowerCase());
  return {
    surface: formRecord(onSurface),
    surfaceLast10: formRecord(onSurface.slice(-10)),
    last10: formRecord(ordered.slice(-10)),
    last5: formRecord(ordered.slice(-5)),
  };
}

function buildSide(
  playerId: string,
  rows: HistoryMatch[],
  asOf: string,
  surface: string,
  priors: { serve: number; ret: number; hold: number; ace: number; df: number }
): PlayerFeatures {
  const own = rowsBefore(rows, asOf).filter((row) => row.playerId === playerId);
  const serve = weightedRate(own, asOf, (row) => row.servicePointsWonPct);
  const returns = weightedRate(own, asOf, (row) => row.returnPointsWonPct);
  const hold = weightedRate(own, asOf, (row) => row.holdPct);
  const ace = weightedRate(own, asOf, (row) =>
    row.aces != null && row.serveGames ? row.aces / row.serveGames : null
  );
  const df = weightedRate(own, asOf, (row) =>
    row.doubleFaults != null && row.serveGames ? row.doubleFaults / row.serveGames : null
  );
  let elo = 1500;
  let surfaceElo = 1500;
  const ordered = [...own].sort((a, b) => a.date.localeCompare(b.date));
  for (const row of ordered) {
    const opp = 1500 + (row.opponentRank != null ? (100 - row.opponentRank) * 2 : 0);
    const expected = eloExpected(elo, opp);
    const score = row.isWin ? 1 : 0;
    elo += 24 * (score - expected);
    if (row.surface.toLowerCase() === surface.toLowerCase()) {
      surfaceElo += 24 * (score - eloExpected(surfaceElo, opp));
    }
  }
  const last = ordered.at(-1);
  const restDays = last ? daysBetween(asOf, last.date) : null;
  const cut14 = Date.parse(asOf) - 14 * 86_400_000;
  const minutes14 = ordered.reduce((total, row) => {
    const at = Date.parse(row.date);
    if (at >= cut14 && row.minutes) return total + row.minutes;
    return total;
  }, 0);
  return {
    playerId,
    n: own.length,
    serve: shrinkStat(serve.mean, serve.n, priors.serve, K_SERVE),
    returns: shrinkStat(returns.mean, returns.n, priors.ret, K_SERVE),
    hold: shrinkStat(hold.mean, hold.n, priors.hold, K_SERVE),
    aceRate: shrinkStat(ace.mean, ace.n, priors.ace, K_SERVE),
    dfRate: shrinkStat(df.mean, df.n, priors.df, K_SERVE),
    elo,
    surfaceElo,
    restDays,
    minutes14,
    retiredRecent: Boolean(last?.retired),
    hand: ordered.at(-1)?.hand ?? null,
    form: sideForm(own, surface),
  };
}

function tourPrior(rows: HistoryMatch[], asOf: string, surface: string, read: (row: HistoryMatch) => number | null, fallback: number): number {
  const sample = rowsBefore(rows, asOf).filter((row) => row.surface.toLowerCase() === surface.toLowerCase());
  const rate = weightedRate(sample, asOf, read);
  return rate.mean ?? fallback;
}

/**
 * Point-on-serve probability from the two players' shrunk rates.
 * The blend is scaled so it matches the observed serve-win rate in matches already played.
 */
export function fitServeProbability(
  history: HistoryMatch[],
  asOf: string,
  playerServe: number,
  opponentReturn: number
): { p: number; scale: number } {
  const past = rowsBefore(history, asOf).filter((row) => row.servicePointsWonPct != null && row.returnPointsWonPct != null);
  let observed = 0;
  let raw = 0;
  let n = 0;
  for (const row of past) {
    const guess = ((row.servicePointsWonPct as number) + (1 - (row.returnPointsWonPct as number))) / 2;
    observed += row.servicePointsWonPct as number;
    raw += guess;
    n += 1;
  }
  const scale = n >= 20 && raw > 0 ? observed / raw : 1;
  const blended = (playerServe + (1 - opponentReturn)) / 2;
  const p = Math.min(0.86, Math.max(0.4, blended * scale));
  return { p, scale };
}

export function buildMatchupFeatures(input: {
  asOf: string;
  tour: Tour;
  surface: string;
  bestOf: 3 | 5;
  playerId: string;
  opponentId: string;
  history: HistoryMatch[];
}): MatchupFeatures {
  const past = rowsBefore(input.history, input.asOf).filter((row) => row.tour === input.tour);
  const priors = {
    serve: tourPrior(past, input.asOf, input.surface, (row) => row.servicePointsWonPct, SERVE_PRIOR),
    ret: tourPrior(past, input.asOf, input.surface, (row) => row.returnPointsWonPct, RETURN_PRIOR),
    hold: tourPrior(past, input.asOf, input.surface, (row) => row.holdPct, HOLD_PRIOR),
    ace: tourPrior(
      past,
      input.asOf,
      input.surface,
      (row) => (row.aces != null && row.serveGames ? row.aces / row.serveGames : null),
      ACE_PRIOR
    ),
    df: tourPrior(
      past,
      input.asOf,
      input.surface,
      (row) => (row.doubleFaults != null && row.serveGames ? row.doubleFaults / row.serveGames : null),
      DF_PRIOR
    ),
  };
  const player = buildSide(input.playerId, past, input.asOf, input.surface, priors);
  const opponent = buildSide(input.opponentId, past, input.asOf, input.surface, priors);
  const serveValue = player.serve.value ?? priors.serve;
  const oppReturn = opponent.returns.value ?? priors.ret;
  const playerReturn = player.returns.value ?? priors.ret;
  const oppServe = opponent.serve.value ?? priors.serve;
  const fitted = fitServeProbability(past, input.asOf, serveValue, oppReturn);
  const fittedOpp = fitServeProbability(past, input.asOf, oppServe, playerReturn);
  const h2h = past.filter((row) => row.playerId === input.playerId && row.opponentId === input.opponentId);
  const h2hWins = h2h.filter((row) => row.isWin).length;
  const n = Math.min(player.n, opponent.n);
  const uncertainty = 0.035 * Math.sqrt(20 / (n + 1));
  return {
    asOf: input.asOf,
    tour: input.tour,
    surface: input.surface,
    bestOf: input.bestOf,
    player,
    opponent,
    h2hWins,
    h2hPlayed: h2h.length,
    pServePlayer: fitted.p,
    pServeOpponent: fittedOpp.p,
    serveUncertainty: uncertainty,
    insufficient: player.n < 8 || opponent.n < 8,
  };
}
