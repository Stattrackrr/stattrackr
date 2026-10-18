/**
 * The tennis model's serve rates and match-winner probability with more of the stored stats in:
 * serve and return points weighted toward this surface and credited for the strength of who they
 * came against, recent workload, and a match-winner blend of the simulation, Elo (overall and on
 * the surface), ranking, form and head to head.
 */

import { clamp, round } from '@/lib/aiPicks/model/math';
import type { TennisMatchRow } from '@/lib/tennis/types';
import { fitServeProbability, rowsBefore, type HistoryMatch, type MatchupFeatures } from '@/lib/tennisAi/features';
import { formWinProb, sideProb } from '@/lib/tennisAi/pack';
import { simulateMatch, type SimSummary } from '@/lib/tennisAi/simulate';
import type { AvailableMarket } from '@/lib/tennisAi/types';

const MATCH_WINNER_HOME = { key: 'MATCH_WINNER', selection: 'PLAYER', model: 'simulation', line: null } as AvailableMarket;

const HALF_LIFE_DAYS = 180;
const SURFACE_K = 8;
const SHRINK_K = 12;
const HEAVY_MINUTES_14 = 360;
const DAY_MS = 86_400_000;

const WIN_WEIGHTS = { sim: 0.45, elo: 0.2, rank: 0.1, form: 0.15, h2h: 0.1 } as const;

export type TennisWinParts = { sim: number; elo: number | null; rank: number | null; form: number | null; h2h: number | null };

export type TennisContext = {
  pA: number;
  pB: number;
  sim: SimSummary;
  /** Home (player A) win probability. */
  winProb: number;
  /** The same at strength 1, whatever strength is in use. */
  fullWinProb: number;
  /** Serve rates and simulation at strength 1 (the same objects as above when strength is 1). */
  full: { pA: number; pB: number; sim: SimSummary };
  parts: TennisWinParts;
  notes: string[];
  serve: { home: { serve: number; returns: number }; away: { serve: number; returns: number } };
};

/** Serving or returning well against a top player says more than doing it against the 300th. */
export function opponentBonus(opponentRank: number | null): number {
  if (opponentRank == null || !(opponentRank > 0)) return 0;
  return clamp(-0.01 * Math.log(opponentRank / 50), -0.02, 0.03);
}

function decay(asOf: string, date: string): number {
  const days = Math.max(0, (Date.parse(asOf) - Date.parse(date)) / DAY_MS);
  return Number.isFinite(days) ? Math.exp((-Math.LN2 * days) / HALF_LIFE_DAYS) : 0;
}

function weighted(rows: HistoryMatch[], asOf: string, read: (r: HistoryMatch) => number | null): { mean: number | null; n: number } {
  let w = 0;
  let t = 0;
  let n = 0;
  for (const r of rows) {
    const v = read(r);
    if (v == null || !Number.isFinite(v)) continue;
    const d = decay(asOf, r.date);
    w += d;
    t += d * (v + opponentBonus(r.opponentRank));
    n += 1;
  }
  return w > 0 ? { mean: t / w, n } : { mean: null, n: 0 };
}

/** Surface rate blended with all-surface rate by how much surface sample there is, then shrunk to the tour prior. */
export function surfaceRate(rows: HistoryMatch[], asOf: string, surface: string, read: (r: HistoryMatch) => number | null, prior: number): number {
  const all = weighted(rows, asOf, read);
  if (all.mean == null) return prior;
  const onSurface = weighted(rows.filter((r) => r.surface.toLowerCase() === surface.toLowerCase()), asOf, read);
  const blended = onSurface.mean == null ? all.mean : (onSurface.n * onSurface.mean + SURFACE_K * all.mean) / (onSurface.n + SURFACE_K);
  return (all.n * blended + SHRINK_K * prior) / (all.n + SHRINK_K);
}

/** Serve-point penalty for a heavy last two weeks. */
export function fatiguePenalty(minutes14: number): number {
  if (!(minutes14 > HEAVY_MINUTES_14)) return 0;
  return Math.min(0.01, ((minutes14 - HEAVY_MINUTES_14) / 60) * 0.0025);
}

export function eloWinProb(features: MatchupFeatures): number | null {
  if (features.player.n < 5 || features.opponent.n < 5) return null;
  const a = (features.player.elo + features.player.surfaceElo) / 2;
  const b = (features.opponent.elo + features.opponent.surfaceElo) / 2;
  return 1 / (1 + 10 ** ((b - a) / 400));
}

export function latestRank(rows: HistoryMatch[], playerId: string): number | null {
  const own = rows.filter((r) => r.playerId === playerId && r.rank != null && r.rank > 0).sort((a, b) => a.date.localeCompare(b.date));
  return own.at(-1)?.rank ?? null;
}

export function rankWinProb(rankA: number | null, rankB: number | null): number | null {
  if (!rankA || !rankB) return null;
  return 1 / (1 + (rankA / rankB) ** 0.9);
}

export function blendWin(parts: TennisWinParts): number {
  let w = 0;
  let t = 0;
  for (const key of Object.keys(WIN_WEIGHTS) as Array<keyof typeof WIN_WEIGHTS>) {
    const v = parts[key];
    if (v == null) continue;
    w += WIN_WEIGHTS[key];
    t += WIN_WEIGHTS[key] * v;
  }
  return clamp(t / w, 0.02, 0.98);
}

export function tennisContext(input: {
  history: HistoryMatch[];
  features: MatchupFeatures;
  homeId: string;
  awayId: string;
  /** The original simulation (unadjusted serve rates). */
  baseSim: SimSummary;
  /** 1 = as built, 0 = the original serve rates and match-winner blend. */
  strength: number;
  sims: number;
  seed: number;
}): TennisContext {
  const { features: f, strength } = input;
  const past = rowsBefore(input.history, f.asOf).filter((r) => r.tour === f.tour);
  const own = (id: string) => past.filter((r) => r.playerId === id);
  const side = (id: string, base: MatchupFeatures['player']) => ({
    serve: surfaceRate(own(id), f.asOf, f.surface, (r) => r.servicePointsWonPct, base.serve.prior ?? 0.62),
    returns: surfaceRate(own(id), f.asOf, f.surface, (r) => r.returnPointsWonPct, base.returns.prior ?? 0.38),
  });
  const home = side(input.homeId, f.player);
  const away = side(input.awayId, f.opponent);
  const fatigueA = fatiguePenalty(f.player.minutes14);
  const fatigueB = fatiguePenalty(f.opponent.minutes14);
  const rawA = fitServeProbability(past, f.asOf, home.serve, away.returns).p - fatigueA;
  const rawB = fitServeProbability(past, f.asOf, away.serve, home.returns).p - fatigueB;
  const rankA = latestRank(past, input.homeId);
  const rankB = latestRank(past, input.awayId);
  const others = {
    elo: eloWinProb(f),
    rank: rankWinProb(rankA, rankB),
    form: formWinProb(f, 'PLAYER'),
    h2h: f.h2hPlayed >= 3 ? (f.h2hWins + 1) / (f.h2hPlayed + 2) : null,
  };
  const at = (s: number) => {
    const pA = clamp(f.pServePlayer + s * (rawA - f.pServePlayer), 0.4, 0.86);
    const pB = clamp(f.pServeOpponent + s * (rawB - f.pServeOpponent), 0.4, 0.86);
    const sim = simulateMatch({ pA, pB, bestOf: f.bestOf, uncertainty: f.serveUncertainty }, input.sims, input.seed);
    const parts: TennisWinParts = { sim: sim.matchWinA, ...others };
    return { pA, pB, sim, parts, winProb: blendWin(parts) };
  };
  const full = at(1);
  const { pA, pB, sim, parts } = strength === 1 ? full : at(strength);
  const base = sideProb(MATCH_WINNER_HOME, input.baseSim, f)?.prob ?? input.baseSim.matchWinA;
  const winProb = clamp(base + strength * (full.winProb - base), 0.02, 0.98);

  const notes: string[] = [];
  if (fatigueA) notes.push(`Home played ${Math.round(f.player.minutes14)} minutes in the last 14 days`);
  if (fatigueB) notes.push(`Away played ${Math.round(f.opponent.minutes14)} minutes in the last 14 days`);
  return {
    pA: round(pA, 4),
    pB: round(pB, 4),
    sim,
    winProb: round(winProb, 4),
    fullWinProb: round(full.winProb, 4),
    full: { pA: round(full.pA, 4), pB: round(full.pB, 4), sim: full.sim },
    parts: {
      sim: round(parts.sim),
      elo: parts.elo == null ? null : round(parts.elo),
      rank: parts.rank == null ? null : round(parts.rank),
      form: parts.form == null ? null : round(parts.form),
      h2h: parts.h2h == null ? null : round(parts.h2h),
    },
    notes,
    serve: {
      home: { serve: round(home.serve), returns: round(home.returns) },
      away: { serve: round(away.serve), returns: round(away.returns) },
    },
  };
}

const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : v > 1 ? v / 100 : v);

/** Recent stat lines the review can quote: serve, return, pressure points, workload. */
export function tennisPlayerEvidence(rows: TennisMatchRow[], opts: { surface: string; asOf: string; opponentHand: string | null }) {
  const played = rows
    .filter((r) => r.date && Date.parse(String(r.date)) < Date.parse(opts.asOf) && !/w\/o|walkover/i.test(String(r.score || '')))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const recent = played.slice(-20);
  const avg = (list: TennisMatchRow[], read: (r: TennisMatchRow) => number | null) => {
    const xs = list.map(read).filter((v): v is number => v != null && Number.isFinite(v));
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const ratio = (num: (r: TennisMatchRow) => number | null, den: (r: TennisMatchRow) => number | null) => {
    let a = 0;
    let b = 0;
    for (const r of recent) {
      const x = num(r);
      const y = den(r);
      if (x == null || y == null || !(y > 0)) continue;
      a += x;
      b += y;
    }
    return b > 0 ? round(a / b) : null;
  };
  const onSurface = played.filter((r) => String(r.surface).toLowerCase() === opts.surface.toLowerCase());
  const vsHand = opts.opponentHand ? played.filter((r) => r.opponentHand === opts.opponentHand).slice(-20) : [];
  const wins = recent.filter((r) => r.isWin);
  const latest = played.at(-1);
  return {
    matches: recent.length,
    rank: latest?.playerRank ?? null,
    servePointsWon: avg(recent, (r) => pct(r.servicePointsWonPct)),
    returnPointsWon: avg(recent, (r) => pct(r.returnPointsWonPct)),
    holdRate: ratio((r) => r.serviceGamesWon ?? null, (r) => r.serveGames),
    firstServeIn: avg(recent, (r) => pct(r.firstServePct)),
    firstServeWon: avg(recent, (r) => pct(r.firstServeWonPct)),
    secondServeWon: avg(recent, (r) => pct(r.secondServeWonPct)),
    breakPointsSaved: ratio((r) => r.breakPointsSaved, (r) => r.breakPointsFaced),
    breakPointsConverted: avg(recent, (r) => pct(r.breakPointsConvertedPct)),
    acesPerServiceGame: ratio((r) => r.aces, (r) => r.serveGames),
    doubleFaultsPerServiceGame: ratio((r) => r.doubleFaults, (r) => r.serveGames),
    straightSetsWins: wins.length ? round(wins.filter((r) => (r.setsLost ?? 0) === 0).length / wins.length) : null,
    surfaceRecord: { wins: onSurface.slice(-20).filter((r) => r.isWin).length, played: onSurface.slice(-20).length },
    vsHandRecord: opts.opponentHand ? { hand: opts.opponentHand, wins: vsHand.filter((r) => r.isWin).length, played: vsHand.length } : null,
    avgMinutes: avg(recent, (r) => r.minutes),
  };
}
