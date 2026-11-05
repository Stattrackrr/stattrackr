/**
 * Candidate inputs for the feature library (agreed build spec, Part D: added one at a time, only with
 * lift): opponent absences, fatigue and schedule, chances against results, and combos priced against
 * their parts. Pure, so each is unit-tested; the prop logger stores them on every snapshot and nothing
 * bets on them until a fit shows the market doesn't already price them.
 */

import { solveMeanForFair, sizeFromSpread } from './clv';
import type { BaseStat } from './design';

export type PositionGroup = 'G' | 'F' | 'C';

/** "G", "F-C", "PG", "SF", "Center"... as the groups it covers. */
export function positionGroups(position: string | null | undefined): Set<PositionGroup> {
  const p = String(position ?? '').toUpperCase();
  const out = new Set<PositionGroup>();
  if (/G|GUARD/.test(p)) out.add('G');
  if (/F|FORWARD/.test(p)) out.add('F');
  if (/C(?!O)|CENTER|CENTRE/.test(p)) out.add('C');
  return out;
}

export type OpponentAbsentee = { id: string; pOut: number; minutes: number; position: string | null; statPerGame: Partial<Record<BaseStat, number>> };

/** Minutes of a starter, for reading minutes out as starters out. */
export const STARTER_MINUTES = 32;

/**
 * What the opponent is missing tonight (fresh absences, weighted by the chance each sits): minutes,
 * minutes at the player's position, and the share of each stat the opponent normally produces.
 */
export function opponentAbsence(absentees: OpponentAbsentee[], teamPerGame: Record<BaseStat, number>, playerPosition: string | null): {
  startersOut: number;
  positionStartersOut: number | null;
  shareOut: Record<BaseStat, number>;
} {
  const mine = positionGroups(playerPosition);
  const minutesOut = absentees.reduce((a, o) => a + o.pOut * o.minutes, 0);
  const positionOut = mine.size
    ? absentees.filter((o) => [...positionGroups(o.position)].some((g) => mine.has(g))).reduce((a, o) => a + o.pOut * o.minutes, 0)
    : null;
  const share = (s: BaseStat) => (teamPerGame[s] > 0 ? Math.min(0.6, absentees.reduce((a, o) => a + o.pOut * (o.statPerGame[s] ?? 0), 0) / teamPerGame[s]) : 0);
  return {
    startersOut: minutesOut / STARTER_MINUTES,
    positionStartersOut: positionOut == null ? null : positionOut / STARTER_MINUTES,
    shareOut: { points: share('points'), rebounds: share('rebounds'), assists: share('assists'), threeMade: share('threeMade') },
  };
}

export type ScheduleGame = { date: string; home: boolean };

const ALTITUDE_HOMES = new Set(['DEN', 'UTA']);
const dayMs = 86_400_000;

/** Rest, density and travel for one team going into tonight (dates are US Eastern YYYY-MM-DD). */
export function fatigue(past: ScheduleGame[], tonight: string, homeTonight: boolean | null): { restDays: number | null; gamesLast6: number; roadTrip: number | null } {
  const before = past.filter((g) => g.date < tonight).sort((a, b) => a.date.localeCompare(b.date));
  const last = before.at(-1);
  const restDays = last ? Math.min(5, Math.round((Date.parse(tonight) - Date.parse(last.date)) / dayMs)) : null;
  const gamesLast6 = before.filter((g) => Date.parse(tonight) - Date.parse(g.date) <= 5 * dayMs).length + 1;
  let roadTrip: number | null = null;
  if (homeTonight != null) {
    roadTrip = 0;
    if (!homeTonight) {
      roadTrip = 1;
      for (let i = before.length - 1; i >= 0 && !before[i]!.home; i -= 1) roadTrip += 1;
    }
  }
  return { restDays, gamesLast6, roadTrip };
}

/** A visiting team playing at Denver or Utah. */
export function altitudeVisitor(homeCode: string, teamCode: string): boolean {
  return ALTITUDE_HOMES.has(homeCode) && teamCode !== homeCode;
}

export type ChanceGame = {
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  threeMade: number | null;
  potentialRebounds?: number | null;
  passes?: number | null;
  fgAttempted: number | null;
  ftAttempted: number | null;
  threeAttempted: number | null;
};

const CHANCES: Record<BaseStat, { made: (g: ChanceGame) => number | null; chances: (g: ChanceGame) => number | null }> = {
  rebounds: { made: (g) => g.rebounds, chances: (g) => g.potentialRebounds ?? null },
  assists: { made: (g) => g.assists, chances: (g) => g.passes ?? null },
  points: { made: (g) => g.points, chances: (g) => (g.fgAttempted == null ? null : g.fgAttempted + 0.44 * (g.ftAttempted ?? 0)) },
  threeMade: { made: (g) => g.threeMade, chances: (g) => g.threeAttempted },
};

export const CHANCES_RECENT = 10;
const MIN_RECENT = 5;
const MIN_LONG = 15;

/**
 * Recent chances at the long-run conversion minus what he actually made, per game (positive: getting
 * the chances but not converting, so recent box scores understate him). Null without enough data.
 */
export function chancesGap(games: ChanceGame[], stat: BaseStat): number | null {
  const c = CHANCES[stat];
  const usable = games.filter((g) => c.made(g) != null && (c.chances(g) ?? 0) > 0);
  if (usable.length < MIN_LONG) return null;
  const conv = usable.reduce((a, g) => a + c.made(g)!, 0) / usable.reduce((a, g) => a + c.chances(g)!, 0);
  const recent = usable.slice(-CHANCES_RECENT);
  if (recent.length < MIN_RECENT) return null;
  const expected = (recent.reduce((a, g) => a + c.chances(g)!, 0) / recent.length) * conv;
  const actual = recent.reduce((a, g) => a + c.made(g)!, 0) / recent.length;
  return expected - actual;
}

export type PricedPart = { fairOver: number; line: number; mean: number; variance: number };

/** The mean the market implies for a stat: the mean at which its fair over-price holds at its line. */
export function impliedMean(p: PricedPart): number {
  return solveMeanForFair(p.fairOver, sizeFromSpread(p.mean, p.variance), p.line);
}

/**
 * A combo against its parts: the parts' implied means added up, minus the combo's implied mean, in
 * the combo's spread (positive: the parts say more than the combo line does, so the combo looks low).
 */
export function comboGapZ(combo: PricedPart, parts: PricedPart[]): number | null {
  if (!parts.length) return null;
  const sd = Math.sqrt(combo.variance);
  if (!(sd > 0)) return null;
  return (parts.reduce((a, p) => a + impliedMean(p), 0) - impliedMean(combo)) / sd;
}
