/**
 * NBA player prop projection: the NBL machinery (per-minute rate x expected minutes, negative
 * binomial spread) with NBA-fitted memory, plus NBA game context. Every setting here was chosen on
 * the 2024-25 and 2025-26 seasons, each game projected from earlier games only (scripts backtest).
 */

import type { NblPropMarket } from '@/lib/aiPicks/markets';
import { clamp, countSideProbs, round } from '@/lib/aiPicks/model/math';
import { homeAwayFactor, paceFactor, teammateOutFactor, type NblContextFactor, type NblInjuryContext, type NblPropContext } from '@/lib/aiPicks/model/nblContext';
import { nblStatValue, playedGames, projectNblProp, type NblPropProjection } from '@/lib/aiPicks/model/nblProps';
import type { SupportRecord } from '@/lib/aiPicks/candidates/types';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';

export type NbaPositionGroup = 'G' | 'F' | 'C';

export type NbaProjectionOptions = {
  rateHalfLife: number;
  minutesHalfLife: number;
  priorSeasonWeight: number;
  /** Multiplies the fitted variance (the game-to-game spread the logs alone understate or overstate). */
  varianceScale: number;
};

/**
 * Backtest: a 20-game rate memory, 3-game minutes memory (role changes show fast) and half weight on
 * last season; the logs understate game-to-game spread, so it is widened 15%.
 */
export const NBA_PROJECTION: NbaProjectionOptions = {
  rateHalfLife: 20,
  minutesHalfLife: 3,
  priorSeasonWeight: 0.5,
  varianceScale: 1.15,
};

export type NbaVolumeOptions = {
  /** Weighted attempts (or chances, passes) of the player's long-run rate added to his recent makes. */
  threeShrink: number;
  twoShrink: number;
  ftShrink: number;
  reboundShrink: number;
  assistShrink: number;
  /** Share of the volume-based rate in the projection (0 = box-score rate only). */
  weight: Record<'points' | 'rebounds' | 'assists' | 'threeMade', number>;
};

/**
 * Backtest (38.9k player games, 2024-25 and 2025-26): threes improved most (Brier 0.2131 -> 0.2115),
 * points 0.2436 -> 0.2427, rebounds 0.2373 -> 0.2369, assists barely; every combo improved.
 */
export const NBA_VOLUME: NbaVolumeOptions = {
  threeShrink: 400,
  twoShrink: 600,
  ftShrink: 200,
  reboundShrink: 300,
  assistShrink: 300,
  weight: { points: 0.75, rebounds: 1, assists: 0.75, threeMade: 1 },
};

/** League shooting, and how many attempts of it a player's own long-run percentage starts from. */
const LEAGUE_PCT = { three: 0.36, two: 0.54, ft: 0.78 };
const LEAGUE_PRIOR_ATTEMPTS = 150;

type BaseStat = keyof NbaVolumeOptions['weight'];
const PARTS: Record<NblPropMarket, BaseStat[]> = {
  points: ['points'],
  rebounds: ['rebounds'],
  assists: ['assists'],
  threeMade: ['threeMade'],
  pra: ['points', 'rebounds', 'assists'],
  pr: ['points', 'rebounds'],
  pa: ['points', 'assists'],
  ra: ['rebounds', 'assists'],
};

/**
 * Per-minute rates rebuilt from volume: shots x shooting pulled toward his long-run percentage,
 * rebound chances x conversion, passes x assist rate. Makes swing on hot and cold shooting; volume
 * holds. Returns volume rate minus box-score rate per base stat (same game weights as the projection).
 */
export function nbaVolumeRateGaps(
  games: NbaGameLogRow[],
  currentSeason: number,
  opts: NbaVolumeOptions = NBA_VOLUME,
  proj: NbaProjectionOptions = NBA_PROJECTION
): Partial<Record<BaseStat, number>> {
  const rows = playedGames(games) as NbaGameLogRow[];
  if (rows.length < 3) return {};
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const seasonWeight = (s: number) => (currentSeason - s <= 0 ? 1 : currentSeason - s === 1 ? proj.priorSeasonWeight : 0);
  type Acc = Record<string, number>;
  const w: Acc = {};
  const all: Acc = {};
  const add = (acc: Acc, k: string, v: number) => (acc[k] = (acc[k] ?? 0) + v);
  for (let i = rows.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    const g = rows[i]!;
    const wt = Math.pow(0.5, back / proj.rateHalfLife) * seasonWeight(Number(g.season));
    const m = g.minutes as number;
    const fga = num(g.fgAttempted);
    const fgm = num(g.fgMade);
    const tpa = num(g.threeAttempted);
    const tpm = num(g.threeMade);
    const fta = num(g.ftAttempted);
    const ftm = num(g.ftMade);
    const pts = num(g.points);
    if (fga != null && fgm != null && tpa != null && tpm != null && fta != null && ftm != null && pts != null) {
      for (const [acc, k] of [[w, wt], [all, 1]] as const) {
        add(acc, 'min', k * m);
        add(acc, '2a', k * (fga - tpa));
        add(acc, '2m', k * (fgm - tpm));
        add(acc, '3a', k * tpa);
        add(acc, '3m', k * tpm);
        add(acc, 'fta', k * fta);
        add(acc, 'ftm', k * ftm);
        add(acc, 'pts', k * pts);
      }
    }
    const reb = num(g.rebounds);
    const chances = num(g.potentialRebounds);
    if (reb != null && chances != null && chances > 0) {
      for (const [acc, k] of [[w, wt], [all, 1]] as const) {
        add(acc, 'rMin', k * m);
        add(acc, 'reb', k * reb);
        add(acc, 'rCh', k * chances);
      }
    }
    const ast = num(g.assists);
    const passes = num(g.passes);
    if (ast != null && passes != null && passes > 0) {
      for (const [acc, k] of [[w, wt], [all, 1]] as const) {
        add(acc, 'aMin', k * m);
        add(acc, 'ast', k * ast);
        add(acc, 'pass', k * passes);
      }
    }
  }
  const pct = (made: string, att: string, league: number, shrink: number) => {
    const longRun = ((all[made] ?? 0) + LEAGUE_PRIOR_ATTEMPTS * league) / ((all[att] ?? 0) + LEAGUE_PRIOR_ATTEMPTS);
    return ((w[made] ?? 0) + shrink * longRun) / ((w[att] ?? 0) + shrink);
  };
  const out: Partial<Record<BaseStat, number>> = {};
  if ((w.min ?? 0) > 0) {
    const p3 = pct('3m', '3a', LEAGUE_PCT.three, opts.threeShrink);
    const p2 = pct('2m', '2a', LEAGUE_PCT.two, opts.twoShrink);
    const pft = pct('ftm', 'fta', LEAGUE_PCT.ft, opts.ftShrink);
    const per = (k: string) => (w[k] ?? 0) / w.min!;
    out.threeMade = per('3a') * p3 - per('3m');
    out.points = 2 * per('2a') * p2 + 3 * per('3a') * p3 + per('fta') * pft - per('pts');
  }
  // Tracking numbers are missing for some games; only use them when most recent games have them.
  if ((w.rMin ?? 0) > 0.6 * (w.min ?? 0) && (all.rCh ?? 0) > 0) {
    const conv = ((w.reb ?? 0) + opts.reboundShrink * ((all.reb ?? 0) / all.rCh!)) / ((w.rCh ?? 0) + opts.reboundShrink);
    out.rebounds = ((w.rCh ?? 0) / w.rMin!) * conv - (w.reb ?? 0) / w.rMin!;
  }
  if ((w.aMin ?? 0) > 0.6 * (w.min ?? 0) && (all.pass ?? 0) > 0) {
    const conv = ((w.ast ?? 0) + opts.assistShrink * ((all.ast ?? 0) / all.pass!)) / ((w.pass ?? 0) + opts.assistShrink);
    out.assists = ((w.pass ?? 0) / w.aMin!) * conv - (w.ast ?? 0) / w.aMin!;
  }
  return out;
}

export function projectNbaProp(
  games: NbaGameLogRow[],
  stat: NblPropMarket,
  currentSeason: number,
  opts: NbaProjectionOptions = NBA_PROJECTION,
  volume: NbaVolumeOptions = NBA_VOLUME
): NblPropProjection | null {
  const p = projectNblProp(games, stat, {
    currentSeason,
    rateHalfLife: opts.rateHalfLife,
    minutesHalfLife: opts.minutesHalfLife,
    seasonWeights: [1, opts.priorSeasonWeight, 0],
  });
  if (!p) return null;
  let mean = p.mean;
  const parts = PARTS[stat].filter((s) => volume.weight[s]);
  if (parts.length) {
    const gaps = nbaVolumeRateGaps(games, currentSeason, volume, opts);
    const shift = parts.reduce((a, s) => a + volume.weight[s] * (gaps[s] ?? 0), 0);
    mean = Math.max(0.05, p.mean + shift * p.expectedMinutes);
  }
  const ratio = mean / Math.max(p.mean, 1e-6);
  const variance = Math.max(mean * 1.05, p.variance * ratio * opts.varianceScale);
  return {
    ...p,
    mean: round(mean, 2),
    ratePerMinute: round(mean / Math.max(p.expectedMinutes, 1e-6), 4),
    variance: round(variance, 2),
    dispersion: variance / Math.max(mean, 1e-6),
  };
}

/** Spread of his minutes: the same games and memory the projection's expected minutes use. */
export function nbaMinutesSd(games: NbaGameLogRow[], currentSeason: number, opts: NbaProjectionOptions = NBA_PROJECTION): number {
  const rows = playedGames(games) as NbaGameLogRow[];
  const current = rows.filter((g) => Number(g.season) === currentSeason);
  const recent = (current.length >= 2 ? current : rows).slice(-10);
  let w = 0;
  let sum = 0;
  let sq = 0;
  for (let i = recent.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    const k = Math.pow(0.5, back / opts.minutesHalfLife);
    const m = recent[i]!.minutes as number;
    w += k;
    sum += k * m;
    sq += k * m * m;
  }
  if (!(w > 0)) return 0;
  const mean = sum / w;
  return Math.sqrt(Math.max(0, sq / w - mean * mean));
}

/** Minutes drawn at the deciles of a normal; the stats move together through his minutes. */
const MINUTE_Z = [-1.645, -1.036, -0.674, -0.385, -0.126, 0.126, 0.385, 0.674, 1.036, 1.645];

/** P(at least `need` of the events), events independent. */
function atLeast(ps: number[], need: number): number {
  let dist = [1];
  for (const p of ps) {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((q, k) => {
      next[k] += q * (1 - p);
      next[k + 1] += q * p;
    });
    dist = next;
  }
  return dist.slice(need).reduce((a, b) => a + b, 0);
}

/**
 * P(10+ in at least `need` of the stats): a double-double (2) or triple-double (3) from his points,
 * rebounds and assists projections. Each stat's spread splits into his minutes swinging (shared by
 * all three) and game-to-game noise at fixed minutes (independent).
 */
export function nbaTenPlusProb(parts: NblPropProjection[], minutesSd: number, need: number): number {
  const exp = parts[0]?.expectedMinutes ?? 0;
  if (!(exp > 0) || parts.length < need) return 0;
  let total = 0;
  for (const z of MINUTE_Z) {
    const m = clamp(exp + z * minutesSd, 0, 48);
    const ps = parts.map((p) => {
      const rate = p.mean / exp;
      const noise = Math.max(p.mean * 1.05, p.variance - rate * rate * minutesSd * minutesSd);
      const mean = rate * m;
      if (!(mean > 0)) return 0;
      return countSideProbs(mean, Math.max(mean * 1.0001, noise * (m / exp)), 9.5).over;
    });
    total += atLeast(ps, need);
  }
  return total / MINUTE_Z.length;
}

/** 10+ in two (or three) of points, rebounds, assists, steals, blocks. */
export function nbaTenPlusCount(g: Pick<NbaGameLogRow, 'points' | 'rebounds' | 'assists' | 'steals' | 'blocks'>): number {
  return [g.points, g.rebounds, g.assists, g.steals, g.blocks].filter((v) => typeof v === 'number' && v >= 10).length;
}

/** How often he got there (10+ in `need` stats), over the same windows as the props. */
export function nbaTenPlusSupport(
  games: NbaGameLogRow[],
  need: number,
  opts: { currentSeason: number; opponentCode: string | null; opponentName: string | null }
): SupportRecord[] {
  const rows = playedGames(games) as NbaGameLogRow[];
  const record = (label: string, list: NbaGameLogRow[]): SupportRecord | null =>
    list.length ? { label, hits: list.filter((g) => nbaTenPlusCount(g) >= need).length, games: list.length } : null;
  const vsOpp = opts.opponentCode ? rows.filter((g) => g.opponentCode === opts.opponentCode).slice(-6) : [];
  return [
    record('Last 5', rows.slice(-5)),
    record('Last 10', rows.slice(-10)),
    record('Last 15', rows.slice(-15)),
    record('This season', rows.filter((g) => Number(g.season) === opts.currentSeason)),
    record(`Last ${vsOpp.length} vs ${opts.opponentName ?? opts.opponentCode ?? 'opponent'}`, vsOpp),
  ].filter((r): r is SupportRecord => r != null);
}

export function nbaPositionGroup(position: string | null | undefined): NbaPositionGroup | null {
  const m = /[GFC]/.exec(String(position || '').toUpperCase());
  return (m?.[0] as NbaPositionGroup | undefined) ?? null;
}

/** Stat per minute an opponent allows to one position group, and the league's, from box scores. */
export type NbaDvpTable = {
  byOpp: Map<string, { value: number; minutes: number }>;
  league: Map<string, { value: number; minutes: number }>;
};

export const nbaDvpKey = (opp: string, pos: NbaPositionGroup, stat: NblPropMarket) => `${opp}|${pos}|${stat}`;

export function emptyNbaDvp(): NbaDvpTable {
  return { byOpp: new Map(), league: new Map() };
}

/** Adds one player game (weighted) to the table. */
export function addNbaDvpGame(table: NbaDvpTable, row: NbaGameLogRow, pos: NbaPositionGroup, stats: readonly NblPropMarket[], weight = 1) {
  const m = row.minutes ?? 0;
  if (!(m > 0) || !row.opponentCode) return;
  for (const stat of stats) {
    const v = nblStatValue(row, stat);
    if (v == null) continue;
    for (const [map, key] of [
      [table.byOpp, nbaDvpKey(row.opponentCode, pos, stat)],
      [table.league, `${pos}|${stat}`],
    ] as const) {
      const acc = map.get(key) ?? { value: 0, minutes: 0 };
      acc.value += weight * v;
      acc.minutes += weight * m;
      map.set(key, acc);
    }
  }
}

export type NbaContextWeights = {
  dvp: number;
  /** Minutes of opponent sample for the matchup to count half. */
  dvpShrinkMinutes: number;
  pace: number;
  homeAway: number;
  backToBack: number;
  teammatesOut: number;
  /** Minutes lost per point of expected margin past BLOWOUT_FROM, for heavy-minute players. */
  blowoutPerPoint: number;
};

/**
 * Backtest (208k player-stat games): the position matchup helped most, pace a little, teammates out at
 * half strength (full strength overshoots). Home/away splits, a back-to-back trim and blowout minutes
 * all made projections worse, so they are off.
 */
export const NBA_CONTEXT: NbaContextWeights = {
  dvp: 1,
  dvpShrinkMinutes: 1500,
  pace: 0.75,
  homeAway: 0,
  backToBack: 1,
  teammatesOut: 0.5,
  blowoutPerPoint: 0,
};

const BLOWOUT_FROM = 6;
const BLOWOUT_MIN_MINUTES = 28;
const MAX_TOTAL = 1.2;
const MIN_TOTAL = 0.82;

function ordinalPct(x: number): string {
  return `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
}

/** How much more (or less) of this stat the opponent gives up to his position than the league does. */
export function nbaDvpFactor(
  table: NbaDvpTable | null,
  opp: string | null,
  pos: NbaPositionGroup | null,
  stat: NblPropMarket,
  w: Pick<NbaContextWeights, 'dvp' | 'dvpShrinkMinutes'>
): NblContextFactor | null {
  if (!table || !opp || !pos || !w.dvp) return null;
  const mine = table.byOpp.get(nbaDvpKey(opp, pos, stat));
  const lg = table.league.get(`${pos}|${stat}`);
  if (!mine || !lg || !(mine.minutes > 0) || !(lg.value > 0)) return null;
  const ratio = mine.value / mine.minutes / (lg.value / lg.minutes);
  const shrink = mine.minutes / (mine.minutes + w.dvpShrinkMinutes);
  const factor = 1 + clamp((ratio - 1) * shrink * w.dvp, -0.08, 0.08);
  const label = pos === 'G' ? 'guards' : pos === 'F' ? 'forwards' : 'centres';
  return { key: 'matchup', factor, note: `Opponent allows ${ordinalPct(ratio - 1)} ${stat} per minute to ${label} vs the league` };
}

/** Starters sit late in lopsided games: heavy-minute players lose minutes as the expected margin grows. */
export function blowoutFactor(expectedMinutes: number, absMargin: number | null, perPoint: number): NblContextFactor | null {
  if (absMargin == null || !perPoint || expectedMinutes < BLOWOUT_MIN_MINUTES || absMargin <= BLOWOUT_FROM) return null;
  const factor = 1 - perPoint * (absMargin - BLOWOUT_FROM);
  return { key: 'blowout', factor, note: `Expected margin ${round(absMargin, 1)}: blowout risk trims his minutes` };
}

const scaled = (f: NblContextFactor | null, w: number): NblContextFactor | null =>
  f && w ? { ...f, factor: Math.exp(Math.log(f.factor) * w) } : null;

export type NbaPropContextInput = {
  stat: NblPropMarket;
  games: NbaGameLogRow[];
  currentSeason: number;
  isHome: boolean | null;
  position: NbaPositionGroup | null;
  opponent: string | null;
  dvp: NbaDvpTable | null;
  expectedPace: number | null;
  gamePace: Map<string, number>;
  teammatesOut: Array<NblInjuryContext & { games: NbaGameLogRow[] | null }>;
  restDays: number | null;
  /** |expected margin| from the game model or the market spread. */
  absMargin: number | null;
  expectedMinutes: number;
  strength?: number;
  weights?: NbaContextWeights;
};

export function nbaPropContextFactors(input: NbaPropContextInput): NblContextFactor[] {
  const w = input.weights ?? NBA_CONTEXT;
  const rest: NblContextFactor | null =
    input.restDays != null && input.restDays <= 1 && w.backToBack !== 1 ? { key: 'rest', factor: w.backToBack, note: 'Back to back' } : null;
  return [
    nbaDvpFactor(input.dvp, input.opponent, input.position, input.stat, w),
    scaled(paceFactor(input.games, input.expectedPace, input.gamePace), w.pace),
    scaled(homeAwayFactor({ games: input.games, stat: input.stat, isHome: input.isHome, currentSeason: input.currentSeason }), w.homeAway),
    ...input.teammatesOut.map((m) => scaled(teammateOutFactor(input.games, input.stat, m, input.currentSeason), w.teammatesOut)),
    rest,
    blowoutFactor(input.expectedMinutes, input.absMargin, w.blowoutPerPoint),
  ].filter((f): f is NblContextFactor => f != null);
}

export function nbaPropContext(input: NbaPropContextInput): NblPropContext {
  const strength = input.strength ?? 1;
  const factors = nbaPropContextFactors(input);
  const logSum = factors.reduce((a, f) => a + Math.log(f.factor), 0);
  const capped = (s: number) => round(clamp(Math.exp(logSum * s), MIN_TOTAL, MAX_TOTAL), 3);
  return { factors: factors.map((f) => ({ ...f, factor: round(f.factor, 3) })), total: capped(strength), fullTotal: capped(1) };
}

/** Hit records for one side of a line (last 5 / 10 / 15, this season, last 6 against the opponent). */
export function nbaPropSupport(
  games: NbaGameLogRow[],
  stat: NblPropMarket,
  line: number,
  side: 'over' | 'under',
  opts: { currentSeason: number; opponentCode: string | null; opponentName: string | null }
): SupportRecord[] {
  const rows = (playedGames(games) as NbaGameLogRow[])
    .map((g) => ({ g, v: nblStatValue(g, stat) }))
    .filter((r): r is { g: NbaGameLogRow; v: number } => r.v != null);
  const hit = (v: number) => (side === 'over' ? v > line : v < line);
  const record = (label: string, list: typeof rows): SupportRecord | null =>
    list.length ? { label, hits: list.filter((r) => hit(r.v)).length, games: list.length } : null;
  const season = rows.filter((r) => Number(r.g.season) === opts.currentSeason);
  const vsOpp = opts.opponentCode ? rows.filter((r) => r.g.opponentCode === opts.opponentCode).slice(-6) : [];
  return [
    record('Last 5', rows.slice(-5)),
    record('Last 10', rows.slice(-10)),
    record('Last 15', rows.slice(-15)),
    record('This season', season),
    record(`Last ${vsOpp.length} vs ${opts.opponentName ?? opts.opponentCode ?? 'opponent'}`, vsOpp),
  ].filter((r): r is SupportRecord => r != null);
}

/** Averages, minutes, usage and the tracking numbers the review can quote. */
export function nbaPlayerEvidence(games: NbaGameLogRow[], stat: NblPropMarket, currentSeason: number) {
  const played = playedGames(games) as NbaGameLogRow[];
  const season = played.filter((g) => Number(g.season) === currentSeason);
  const avg = (rows: NbaGameLogRow[], read: (g: NbaGameLogRow) => number | null | undefined) => {
    const xs = rows.map(read).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null;
  };
  const window = (rows: NbaGameLogRow[]) => ({
    games: rows.length,
    stat: avg(rows, (g) => nblStatValue(g, stat)),
    minutes: avg(rows, (g) => g.minutes),
    usage: avg(rows, (g) => g.usgPct),
    trueShooting: avg(rows, (g) => g.tsPct),
    fieldGoalAttempts: avg(rows, (g) => g.fgAttempted),
    threeAttempts: avg(rows, (g) => g.threeAttempted),
    ...(stat === 'rebounds' || stat === 'ra' || stat === 'pr' || stat === 'pra' ? { reboundChances: avg(rows, (g) => g.potentialRebounds) } : {}),
    ...(stat === 'assists' || stat === 'ra' || stat === 'pa' || stat === 'pra' ? { passes: avg(rows, (g) => g.passes), touches: avg(rows, (g) => g.touches) } : {}),
  });
  return {
    last5: window(played.slice(-5)),
    last10: window(played.slice(-10)),
    thisSeason: window(season),
    lastFive: played
      .slice(-5)
      .reverse()
      .map((g) => ({ date: String(g.date || '').slice(0, 10), vs: g.opponentCode || g.opponent, value: nblStatValue(g, stat), minutes: g.minutes, home: g.isHome })),
  };
}

/** Points / rebounds / assists averages and the last five lines, for double-double and triple-double bets. */
export function nbaTenPlusEvidence(games: NbaGameLogRow[], currentSeason: number) {
  const played = playedGames(games) as NbaGameLogRow[];
  const avg = (rows: NbaGameLogRow[], read: (g: NbaGameLogRow) => number | null | undefined) => {
    const xs = rows.map(read).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null;
  };
  const window = (rows: NbaGameLogRow[]) => ({
    games: rows.length,
    points: avg(rows, (g) => g.points),
    rebounds: avg(rows, (g) => g.rebounds),
    assists: avg(rows, (g) => g.assists),
    minutes: avg(rows, (g) => g.minutes),
    reboundChances: avg(rows, (g) => g.potentialRebounds),
    passes: avg(rows, (g) => g.passes),
  });
  return {
    last5: window(played.slice(-5)),
    last10: window(played.slice(-10)),
    thisSeason: window(played.filter((g) => Number(g.season) === currentSeason)),
    lastFive: played
      .slice(-5)
      .reverse()
      .map((g) => ({
        date: String(g.date || '').slice(0, 10),
        vs: g.opponentCode || g.opponent,
        line: `${g.points ?? '-'} pts, ${g.rebounds ?? '-'} reb, ${g.assists ?? '-'} ast`,
        minutes: g.minutes,
      })),
  };
}
