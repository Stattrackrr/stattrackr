/**
 * NBL player prop projection from game logs.
 *
 * Mean = per-minute rate (recency- and season-weighted) x expected minutes.
 * Spread = game-to-game noise around that rate plus minutes uncertainty, as a negative
 * binomial so probabilities exist for every line (main, alternates, milestones).
 */

import type { NblPropMarket } from '@/lib/aiPicks/markets';
import { countSideProbs, round, type SideProbs } from '@/lib/aiPicks/model/math';
import type { SupportRecord } from '@/lib/aiPicks/candidates/types';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

export type NblPropProjection = {
  mean: number;
  variance: number;
  /** Variance / mean, reused to turn a market line into a market distribution. */
  dispersion: number;
  ratePerMinute: number;
  expectedMinutes: number;
  /** Effective games behind the rate (sum of weights / top weight). */
  sample: number;
  currentSeasonGames: number;
  lastGameDate: string | null;
};

export type NblProjectionOptions = {
  currentSeason: number;
  /** Games back for a game's weight to halve. */
  rateHalfLife?: number;
  minutesHalfLife?: number;
  /** Weight of a game from N seasons ago: [current, last season, two back]. */
  seasonWeights?: [number, number, number];
};

const DEFAULTS = { rateHalfLife: 12, minutesHalfLife: 4, seasonWeights: [1, 0.5, 0.2] as [number, number, number] };

export function nblStatValue(row: NblGameLogRow, market: NblPropMarket): number | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const pts = n(row.points);
  const reb = n(row.rebounds);
  const ast = n(row.assists);
  switch (market) {
    case 'points':
      return pts;
    case 'rebounds':
      return reb;
    case 'assists':
      return ast;
    case 'threeMade':
      return n(row.threeMade);
    case 'pra':
      return pts != null && reb != null && ast != null ? pts + reb + ast : null;
    case 'pr':
      return pts != null && reb != null ? pts + reb : null;
    case 'pa':
      return pts != null && ast != null ? pts + ast : null;
    case 'ra':
      return reb != null && ast != null ? reb + ast : null;
  }
}

/** Games the player actually played, oldest first. */
export function playedGames(games: NblGameLogRow[]): NblGameLogRow[] {
  return games
    .filter((g) => typeof g.minutes === 'number' && g.minutes > 0)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

export function projectNblProp(
  games: NblGameLogRow[],
  market: NblPropMarket,
  opts: NblProjectionOptions
): NblPropProjection | null {
  const rateHalfLife = opts.rateHalfLife ?? DEFAULTS.rateHalfLife;
  const minutesHalfLife = opts.minutesHalfLife ?? DEFAULTS.minutesHalfLife;
  const seasonWeights = opts.seasonWeights ?? DEFAULTS.seasonWeights;

  const rows = playedGames(games)
    .map((g) => ({ g, v: nblStatValue(g, market), m: g.minutes as number }))
    .filter((r): r is { g: NblGameLogRow; v: number; m: number } => r.v != null);
  if (rows.length < 3) return null;

  const decay = (back: number, halfLife: number) => Math.pow(0.5, back / halfLife);
  const seasonWeight = (season: number | null | undefined) => {
    const back = opts.currentSeason - Number(season ?? opts.currentSeason);
    return back <= 0 ? seasonWeights[0] : back === 1 ? seasonWeights[1] : back === 2 ? seasonWeights[2] : 0;
  };

  let wSum = 0;
  let wStat = 0;
  let wMin = 0;
  let wTop = 0;
  const weights: number[] = [];
  for (let i = rows.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    const r = rows[i]!;
    const w = decay(back, rateHalfLife) * seasonWeight(r.g.season);
    weights[i] = w;
    wSum += w;
    wStat += w * r.v;
    wMin += w * r.m;
    wTop = Math.max(wTop, w);
  }
  if (!(wSum > 0) || !(wMin > 0)) return null;
  const rate = wStat / wMin;

  // Expected minutes: short memory (rotation changes fast), current season first.
  const current = rows.filter((r) => Number(r.g.season) === opts.currentSeason);
  const minuteRows = (current.length >= 2 ? current : rows).slice(-10);
  let mw = 0;
  let mSum = 0;
  for (let i = minuteRows.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    const w = decay(back, minutesHalfLife);
    mw += w;
    mSum += w * minuteRows[i]!.m;
  }
  const expectedMinutes = mSum / mw;
  let minVar = 0;
  for (let i = minuteRows.length - 1, back = 0; i >= 0; i -= 1, back += 1) {
    minVar += decay(back, minutesHalfLife) * (minuteRows[i]!.m - expectedMinutes) ** 2;
  }
  minVar /= mw;

  const mean = rate * expectedMinutes;
  let residVar = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const r = rows[i]!;
    const scaled = r.v * (expectedMinutes / r.m);
    residVar += weights[i]! * (Math.min(scaled, r.v * 2) - mean) ** 2;
  }
  residVar /= wSum;
  // Total variance = noise at expected minutes + variance from minutes themselves.
  const variance = Math.max(mean * 1.05, residVar + rate * rate * minVar);

  return {
    mean: round(mean, 2),
    variance: round(variance, 2),
    dispersion: variance / Math.max(mean, 1e-6),
    ratePerMinute: round(rate, 4),
    expectedMinutes: round(expectedMinutes, 1),
    sample: round(wSum / Math.max(wTop, 1e-9), 1),
    currentSeasonGames: current.length,
    lastGameDate: rows.at(-1)?.g.date ?? null,
  };
}

export function nblPropSideProbs(p: Pick<NblPropProjection, 'mean' | 'variance'>, line: number): SideProbs {
  return countSideProbs(p.mean, p.variance, line);
}

const sameTeam = (a: string | null | undefined, b: string | null | undefined) => {
  const ka = normalizeTeamKey(resolveNblClubName(a) ?? String(a || ''));
  const kb = normalizeTeamKey(resolveNblClubName(b) ?? String(b || ''));
  return Boolean(ka && kb && ka === kb);
};

/** Hit records for one side of a line, for the write-up and the support gate. */
export function nblPropSupport(
  games: NblGameLogRow[],
  market: NblPropMarket,
  line: number,
  side: 'over' | 'under',
  opts: { currentSeason: number; opponent: string | null }
): SupportRecord[] {
  const rows = playedGames(games)
    .map((g) => ({ g, v: nblStatValue(g, market) }))
    .filter((r): r is { g: NblGameLogRow; v: number } => r.v != null);
  const hit = (v: number) => (side === 'over' ? v > line : v < line);
  const record = (label: string, list: typeof rows): SupportRecord | null =>
    list.length ? { label, hits: list.filter((r) => hit(r.v)).length, games: list.length } : null;
  const season = rows.filter((r) => Number(r.g.season) === opts.currentSeason);
  const vsOpp = opts.opponent ? rows.filter((r) => sameTeam(r.g.opponent, opts.opponent)).slice(-6) : [];
  return [
    record('Last 5', rows.slice(-5)),
    record('Last 10', rows.slice(-10)),
    record('Last 15', rows.slice(-15)),
    record('This season', season),
    record(`Last ${vsOpp.length} vs ${opts.opponent ?? 'opponent'}`, vsOpp),
  ].filter((r): r is SupportRecord => r != null);
}

const SUPPORT_WEIGHTS: Record<string, number> = { 'Last 5': 0.15, 'Last 10': 0.3, 'Last 15': 0.15, 'This season': 0.2 };

/** Same weighting as the NBL ask feature: last 10 heaviest, opponent record 20%. */
export function supportScore(records: SupportRecord[]): number | null {
  let total = 0;
  let weight = 0;
  for (const r of records) {
    if (!r.games) continue;
    const w = SUPPORT_WEIGHTS[r.label] ?? (r.label.includes(' vs ') ? (r.games >= 2 ? 0.2 : 0) : 0);
    if (!w) continue;
    total += w * (r.hits / r.games);
    weight += w;
  }
  return weight > 0 ? round(total / weight, 3) : null;
}
