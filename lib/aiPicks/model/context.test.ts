import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  homeAwayFactor,
  matchupFactor,
  nblPropContext,
  paceFactor,
  restFactor,
  teammateOutFactor,
} from './nblContext';
import { adjustNblGame, injuryPoints, type NblGameProjection } from './nblGames';
import { blendWin, fatiguePenalty, opponentBonus, rankWinProb, surfaceRate } from './tennisContext';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import type { HistoryMatch } from '@/lib/tennisAi/features';

const near = (a: number, b: number, tol: number) => assert.ok(Math.abs(a - b) <= tol, `${a} not within ${tol} of ${b}`);

function log(i: number, over: Partial<NblGameLogRow> = {}): NblGameLogRow {
  return {
    matchId: `m${i}`,
    date: `2026-0${1 + Math.floor(i / 28)}-${String((i % 28) + 1).padStart(2, '0')}`,
    season: 2026,
    teamCode: 'SYD',
    isHome: i % 2 === 0,
    minutes: 30,
    points: 15,
    rebounds: 5,
    assists: 4,
    ...over,
  } as NblGameLogRow;
}

test('matchup: easiest defence lifts, toughest cuts, capped at 5%', () => {
  assert.equal(matchupFactor({ rank: 10, fieldSize: 10, allowed: null })!.factor, 1.05);
  assert.equal(matchupFactor({ rank: 1, fieldSize: 10, allowed: null })!.factor, 0.95);
  near(matchupFactor({ rank: 5, fieldSize: 9, allowed: null })!.factor, 1, 1e-9);
  assert.equal(matchupFactor({ rank: null, fieldSize: 10, allowed: null }), null);
});

test('pace: faster expected game than his recent games lifts the projection', () => {
  const games = Array.from({ length: 10 }, (_, i) => log(i, { pace: 80 } as Partial<NblGameLogRow>));
  const f = paceFactor(games, { offRtg: 110, defRtg: 110, pace: 84, games: 5 }, { offRtg: 110, defRtg: 110, pace: 84, games: 5 })!;
  assert.equal(f.factor, 1.05);
  assert.equal(paceFactor(games, null, null), null);
});

test('home/away split is shrunk and capped', () => {
  const games = Array.from({ length: 20 }, (_, i) => log(i, { points: i % 2 === 0 ? 20 : 10 }));
  const home = homeAwayFactor({ games, stat: 'points', isHome: true, currentSeason: 2026 })!;
  const away = homeAwayFactor({ games, stat: 'points', isHome: false, currentSeason: 2026 })!;
  assert.equal(home.factor, 1.04);
  assert.equal(away.factor, 0.96);
});

test('teammate out: uses games without him, ignores a long absence already in the logs', () => {
  const games = Array.from({ length: 16 }, (_, i) => log(i, { points: i >= 10 && i < 13 ? 24 : 15 }));
  const mateGames = Array.from({ length: 16 }, (_, i) => log(i, { minutes: i >= 10 && i < 13 ? 0 : 28 }));
  const f = teammateOutFactor(games, 'points', { player: 'Mate', status: 'Out', games: mateGames }, 2026)!;
  assert.ok(f.factor > 1.08 && f.factor <= 1.12, String(f.factor));

  const longOut = Array.from({ length: 16 }, (_, i) => log(i, { minutes: i >= 11 ? 0 : 28 }));
  assert.equal(teammateOutFactor(games, 'points', { player: 'Mate', status: 'Out', games: longOut }, 2026)!.factor, 1);

  const bench = Array.from({ length: 16 }, (_, i) => log(i, { minutes: 8 }));
  assert.equal(teammateOutFactor(games, 'points', { player: 'Bench', status: 'Out', games: bench }, 2026), null);
});

test('rest: back to back trims', () => {
  assert.equal(restFactor(1)!.factor, 0.98);
  assert.equal(restFactor(4), null);
});

test('context total is a capped product and strength 0 turns it off', () => {
  const games = Array.from({ length: 12 }, (_, i) => log(i, { pace: 80 } as Partial<NblGameLogRow>));
  const input = {
    stat: 'points' as const,
    games,
    currentSeason: 2026,
    isHome: null,
    dvp: { rank: 10, fieldSize: 10, allowed: null },
    team: { offRtg: 110, defRtg: 110, pace: 90, games: 5 },
    opponent: { offRtg: 110, defRtg: 110, pace: 90, games: 5 },
    league: { defRtg: 110, pace: 82 },
    teammatesOut: [],
    restDays: 3,
  };
  near(nblPropContext(input).total, 1.05 * 1.05, 0.001);
  assert.equal(nblPropContext({ ...input, strength: 0 }).total, 1);
});

test('game lines: ratings blend, injuries and back to backs move the margin', () => {
  const base: NblGameProjection = { homeMargin: 0, total: 180 } as NblGameProjection;
  const even = { offRtg: 110, defRtg: 110, pace: 82, games: 10 };
  const adj = adjustNblGame(base, {
    home: { ...even, offRtg: 118 },
    away: even,
    leaguePace: 82,
    homeOutPoints: 0,
    awayOutPoints: injuryPoints(20),
    homeOut: [],
    awayOut: ['Star'],
    homeRestDays: 3,
    awayRestDays: 1,
    strength: 1,
  });
  assert.ok(adj.homeMargin > 5, String(adj.homeMargin));
  assert.ok(adj.notes.some((n) => /Star/.test(n)));
  assert.ok(adj.notes.some((n) => /back to back/.test(n)));
});

test('tennis: opponent strength bonus, fatigue, rank and win blend', () => {
  assert.ok(opponentBonus(5) > 0.02);
  assert.ok(opponentBonus(300) < -0.015);
  assert.equal(opponentBonus(null), 0);
  assert.equal(fatiguePenalty(300), 0);
  assert.equal(fatiguePenalty(600), 0.01);
  near(rankWinProb(10, 10)!, 0.5, 1e-9);
  assert.ok(rankWinProb(5, 80)! > 0.9);
  near(blendWin({ sim: 0.6, elo: null, rank: null, form: null, h2h: null }), 0.6, 1e-9);
  near(blendWin({ sim: 0.6, elo: 0.4, rank: null, form: null, h2h: null }), (0.45 * 0.6 + 0.2 * 0.4) / 0.65, 1e-9);
});

test('tennis: surface matches count more than other surfaces', () => {
  const row = (i: number, surface: string, serve: number): HistoryMatch =>
    ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, surface, servicePointsWonPct: serve, opponentRank: 50 }) as HistoryMatch;
  const rows = [...Array.from({ length: 10 }, (_, i) => row(i, 'Clay', 0.7)), ...Array.from({ length: 10 }, (_, i) => row(i + 10, 'Hard', 0.6))];
  const read = (r: HistoryMatch) => r.servicePointsWonPct;
  const clay = surfaceRate(rows, '2026-10-01', 'Clay', read, 0.62);
  const hard = surfaceRate(rows, '2026-10-01', 'Hard', read, 0.62);
  assert.ok(clay > hard + 0.02, `${clay} vs ${hard}`);
});
