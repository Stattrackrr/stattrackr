/**
 * Game-specific adjustments to an NBL prop projection, on top of the player's own game logs:
 * how the opponent defends this kind of player, the opponent's defensive rating, the pace both
 * teams play at, the player's home/away split, teammates who are out (from games he played without
 * them), and a short turnaround. Each factor is shrunk by its sample and capped, the product is
 * capped, and every factor is kept so the review and the learning loop can see what moved the number.
 */

import type { NblPropMarket } from '@/lib/aiPicks/markets';
import { nblStatValue, playedGames } from '@/lib/aiPicks/model/nblProps';
import { clamp, round } from '@/lib/aiPicks/model/math';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';

export type NblContextFactor = { key: string; factor: number; note: string };

export type NblTeamContext = { offRtg: number; defRtg: number; pace: number | null; games: number };

export type NblInjuryContext = { player: string; status: string; injury?: string; returning?: string };

export type NblPropContextInput = {
  stat: NblPropMarket;
  games: NblGameLogRow[];
  currentSeason: number;
  isHome: boolean | null;
  /** Opponent's rank defending this player type / stat: 1 allows the least, fieldSize the most. */
  dvp: { rank: number | null; fieldSize: number | null; allowed: number | null } | null;
  team: NblTeamContext | null;
  opponent: NblTeamContext | null;
  league: { defRtg: number; pace: number } | null;
  /** Teammates on the injury list, with their game logs when they could be loaded. */
  teammatesOut: Array<NblInjuryContext & { games: NblGameLogRow[] | null }>;
  restDays: number | null;
  /** Scales every factor (log space); 1 = as built. */
  strength?: number;
};

export type NblPropContext = {
  factors: NblContextFactor[];
  total: number;
  /** The total at strength 1, whatever strength is in use. */
  fullTotal: number;
};

const MAX_TOTAL = 1.18;
const MIN_TOTAL = 0.85;
const SCORING_STATS = new Set<NblPropMarket>(['points', 'threeMade', 'pra', 'pr', 'pa']);
/** Long-term absences: once he has missed this many of the player's last 5 games, the logs already show it. */
const ALREADY_IN_LOGS = 4;

function ratePerMinute(rows: NblGameLogRow[], stat: NblPropMarket): { rate: number | null; minutes: number; n: number } {
  let v = 0;
  let m = 0;
  let n = 0;
  for (const g of rows) {
    const x = nblStatValue(g, stat);
    if (x == null || !(typeof g.minutes === 'number' && g.minutes > 0)) continue;
    v += x;
    m += g.minutes;
    n += 1;
  }
  return { rate: m > 0 ? v / m : null, minutes: n ? m / n : 0, n };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** Opponent's rank defending this player type, centred: the easiest matchup is up to +5%. */
export function matchupFactor(dvp: NblPropContextInput['dvp']): NblContextFactor | null {
  if (!dvp?.rank || !dvp.fieldSize || dvp.fieldSize < 4) return null;
  const position = (dvp.rank - 1) / (dvp.fieldSize - 1) - 0.5;
  const factor = 1 + clamp(position * 0.1, -0.05, 0.05);
  const easy = dvp.rank > dvp.fieldSize / 2;
  return {
    key: 'matchup',
    factor,
    note: `Opponent ranks ${ordinal(dvp.rank)} of ${dvp.fieldSize} defending this (${easy ? 'gives up more than most' : 'one of the tougher matchups'})`,
  };
}

/** Opponent defensive rating against the league, for scoring stats when there is no matchup rank. */
export function defenceFactor(stat: NblPropMarket, opp: NblTeamContext | null, league: NblPropContextInput['league']): NblContextFactor | null {
  if (!opp || !league || !SCORING_STATS.has(stat) || opp.games < 3) return null;
  const ratio = opp.defRtg / league.defRtg;
  const factor = 1 + clamp((ratio - 1) * 0.6, -0.05, 0.05);
  return { key: 'defence', factor, note: `Opponent defensive rating ${opp.defRtg} vs league ${round(league.defRtg, 1)}` };
}

/** Expected game pace against the pace of the games behind his rate. */
export function paceFactor(games: NblGameLogRow[], team: NblTeamContext | null, opp: NblTeamContext | null): NblContextFactor | null {
  if (!team?.pace || !opp?.pace) return null;
  const recent = playedGames(games)
    .slice(-10)
    .map((g) => (g as NblGameLogRow & { pace?: number | null }).pace)
    .filter((p): p is number => typeof p === 'number' && p > 50 && p < 120);
  if (recent.length < 3) return null;
  const his = recent.reduce((a, b) => a + b, 0) / recent.length;
  const expected = (team.pace + opp.pace) / 2;
  const factor = 1 + clamp(expected / his - 1, -0.05, 0.05);
  return { key: 'pace', factor, note: `Expected pace ${round(expected, 1)} vs ${round(his, 1)} in his last ${recent.length} games` };
}

/** His per-minute rate at home (or away) against overall, shrunk toward no split. */
export function homeAwayFactor(input: Pick<NblPropContextInput, 'games' | 'stat' | 'isHome' | 'currentSeason'>): NblContextFactor | null {
  if (input.isHome == null) return null;
  const rows = playedGames(input.games).filter((g) => Number(g.season) >= input.currentSeason - 1);
  const all = ratePerMinute(rows, input.stat);
  const split = ratePerMinute(rows.filter((g) => Boolean(g.isHome) === input.isHome), input.stat);
  if (!all.rate || !split.rate || split.n < 4) return null;
  const shrink = split.n / (split.n + 12);
  const factor = 1 + clamp((split.rate / all.rate - 1) * shrink, -0.04, 0.04);
  return {
    key: 'home_away',
    factor,
    note: `${input.isHome ? 'Home' : 'Away'}: ${round(split.rate * 36, 1)} per 36 over ${split.n} games vs ${round(all.rate * 36, 1)} overall`,
  };
}

/**
 * A teammate who is out: his output per game in games without that teammate against games with him
 * (rate x minutes, so extra minutes count), shrunk by the without-sample. A long absence already
 * sitting in his recent games is not counted twice.
 */
export function teammateOutFactor(
  games: NblGameLogRow[],
  stat: NblPropMarket,
  mate: NblInjuryContext & { games: NblGameLogRow[] | null },
  currentSeason: number
): NblContextFactor | null {
  if (!mate.games?.length) return null;
  const mateGames = playedGames(mate.games);
  const mateSeason = mateGames.filter((g) => Number(g.season) >= currentSeason - 1);
  const mateMinutes = mateSeason.length ? mateSeason.reduce((a, g) => a + (g.minutes ?? 0), 0) / mateSeason.length : 0;
  if (mateMinutes < 15) return null;
  const played = new Set(mateGames.map((g) => g.matchId));
  const mine = playedGames(games).filter((g) => Number(g.season) >= currentSeason - 1);
  const teamCode = mine.at(-1)?.teamCode;
  const sameTeam = mine.filter((g) => g.teamCode && g.teamCode === teamCode);
  const lastFive = sameTeam.slice(-5);
  if (lastFive.filter((g) => !played.has(g.matchId)).length >= ALREADY_IN_LOGS) {
    return { key: 'teammate_out', factor: 1, note: `${mate.player} out (${mate.status}): already missing from his recent games` };
  }
  const without = ratePerMinute(sameTeam.filter((g) => !played.has(g.matchId)), stat);
  const withHim = ratePerMinute(sameTeam.filter((g) => played.has(g.matchId)), stat);
  if (!without.rate || !withHim.rate || without.n < 2 || withHim.n < 4) {
    return { key: 'teammate_out', factor: 1, note: `${mate.player} out (${mate.status}): too few games without him to measure` };
  }
  const raw = (without.rate * without.minutes) / (withHim.rate * withHim.minutes);
  const shrink = without.n / (without.n + 8);
  const factor = clamp(1 + (raw - 1) * shrink, 0.92, 1.12);
  return {
    key: 'teammate_out',
    factor,
    note: `${mate.player} out (${mate.status}): ${round(without.rate * without.minutes, 1)} per game in ${without.n} games without him vs ${round(withHim.rate * withHim.minutes, 1)} with him`,
  };
}

export function restFactor(restDays: number | null): NblContextFactor | null {
  if (restDays == null) return null;
  if (restDays <= 1) return { key: 'rest', factor: 0.98, note: 'Back to back' };
  if (restDays >= 12) return { key: 'rest', factor: 1, note: `${restDays} days since his last game` };
  return null;
}

export function nblPropContext(input: NblPropContextInput): NblPropContext {
  const strength = input.strength ?? 1;
  const matchup = matchupFactor(input.dvp);
  const factors = [
    matchup,
    matchup ? null : defenceFactor(input.stat, input.opponent, input.league),
    paceFactor(input.games, input.team, input.opponent),
    homeAwayFactor(input),
    ...input.teammatesOut.map((m) => teammateOutFactor(input.games, input.stat, m, input.currentSeason)),
    restFactor(input.restDays),
  ].filter((f): f is NblContextFactor => f != null);
  const logSum = factors.reduce((a, f) => a + Math.log(f.factor), 0);
  const capped = (s: number) => round(clamp(Math.exp(logSum * s), MIN_TOTAL, MAX_TOTAL), 3);
  return {
    factors: factors.map((f) => ({ ...f, factor: round(f.factor, 3) })),
    total: capped(strength),
    fullTotal: capped(1),
  };
}

/** Averages, minutes and usage trend, and shooting the review can quote; nothing it has to infer. */
export function nblPlayerEvidence(games: NblGameLogRow[], stat: NblPropMarket, currentSeason: number) {
  const played = playedGames(games);
  const season = played.filter((g) => Number(g.season) === currentSeason);
  const avg = (rows: NblGameLogRow[], read: (g: NblGameLogRow) => number | null | undefined) => {
    const xs = rows.map(read).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
    return xs.length ? round(xs.reduce((a, b) => a + b, 0) / xs.length, 1) : null;
  };
  const window = (rows: NblGameLogRow[]) => ({
    games: rows.length,
    stat: avg(rows, (g) => nblStatValue(g, stat)),
    minutes: avg(rows, (g) => g.minutes),
    usage: avg(rows, (g) => (g as NblGameLogRow & { usgPct?: number | null }).usgPct),
    trueShooting: avg(rows, (g) => (g as NblGameLogRow & { tsPct?: number | null }).tsPct),
    fieldGoalAttempts: avg(rows, (g) => g.fgAttempted),
    threeAttempts: avg(rows, (g) => g.threeAttempted),
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
