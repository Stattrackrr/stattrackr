/**
 * Usage shift when teammates may sit (agreed build spec, Part D feature 2). Pooled, not per player:
 * the share of the team's production the absent teammates usually supply (each weighted by his
 * chance of sitting) is redistributed to the players left, in proportion to their own production,
 * with one coefficient per stat. Minutes are the minutes model's job; this is role only.
 *
 * scripts/_backtest-usage.ts on 2025-26 (fit Nov to Jan, tested Feb to Apr, 23k player-stat games
 * with a rotation teammate out): per-player with/without splits made predictions worse at every
 * amount of shrinkage tried (noise: a 1.3-point swing per game for a 0.1-point average shift); the
 * pooled shift lowered points error 2.4% and assists 0.9%. Rebounds came out at zero and threes
 * negative, so both stay at zero (usage may only raise points, assists and threes).
 */

import type { BaseStat } from './design';

export const POOLED_USAGE_BETA: Record<BaseStat, number> = { points: 0.141, assists: 0.148, rebounds: 0, threeMade: 0 };

/** Absent shares above this are treated as this (a team missing most of its production is an outlier). */
const MAX_SHARE = 0.6;

export type Absentee = { id: string; pOut: number; statPerGame: Partial<Record<BaseStat, number>> };

/** Expected share of the team's per-game production for `stat` that sits out tonight. */
export function absentShare(absentees: Absentee[], teamStatPerGame: number, stat: BaseStat): number {
  if (!(teamStatPerGame > 0)) return 0;
  const missing = absentees.reduce((acc, a) => acc + a.pOut * (a.statPerGame[stat] ?? 0), 0);
  return Math.min(MAX_SHARE, missing / teamStatPerGame);
}

/** Expected change in his stat tonight: his usual output at tonight's minutes, scaled by the pooled shift. */
export function usageDelta(ratePerMinute: number, expectedMinutes: number, share: number, stat: BaseStat, beta = POOLED_USAGE_BETA): number {
  return ratePerMinute * expectedMinutes * beta[stat] * share;
}

export function usageShiftZ(delta: number, sd: number): number {
  return sd > 0 ? delta / sd : 0;
}
