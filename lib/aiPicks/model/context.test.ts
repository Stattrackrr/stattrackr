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
import { adjustNblGame, injuryPoints, nblTeamKey, type NblGameProjection } from './nblGames';
import { expectedNblGamePace, nblPaceTable } from './nblPace';
import { teamGamesFromBoxes } from '@/lib/nbl/teamGames';
import { injuryReportUpdatedAt } from '../candidates/nblContextData';
import { historyFromRows } from '@/lib/tennisAi/live';
import { buildMatchupFeatures } from '@/lib/tennisAi/features';
import type { TennisMatchRow } from '@/lib/tennis/types';
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
  assert.equal(paceFactor(games, 84)!.factor, 1.05);
  assert.equal(paceFactor(games, null), null);

  // Live rows carry no pace: each game's pace comes from the team-game table by match id.
  const live = Array.from({ length: 10 }, (_, i) => log(i));
  assert.equal(paceFactor(live, 84), null);
  const byMatch = new Map(live.map((g) => [g.matchId, 82]));
  near(paceFactor(live, 84, byMatch)!.factor, 84 / 82, 1e-9);
});

test('pace table: complete boxes only, recent games count more, expected pace is both teams against the league', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 9, d)).toISOString();
  const game = (id: string, d: number, home: string, away: string, pace: number) => {
    const poss = pace;
    const row = (team: string, opponent: string, isHome: boolean) => ({ matchId: id, date: day(d), season: 2026, team, opponent, isHome, pace, poss, oppPoss: poss, pts: 90, oppPts: 90 });
    return [row(home, away, true), row(away, home, false)];
  };
  const rows = [
    ...game('a', 1, 'Sydney Kings', 'Perth Wildcats', 76),
    ...game('b', 3, 'Sydney Kings', 'Perth Wildcats', 76),
    ...game('c', 5, 'Sydney Kings', 'Perth Wildcats', 92),
    ...game('d', 2, 'Cairns Taipans', 'Illawarra Hawks', 80),
    ...game('e', 4, 'Cairns Taipans', 'Illawarra Hawks', 80),
    ...game('late', 20, 'Cairns Taipans', 'Sydney Kings', 120),
  ];
  const table = nblPaceTable(rows, 2026, Date.UTC(2026, 9, 10));
  const syd = table.teams.get(nblTeamKey('Sydney Kings'))!;
  assert.equal(syd.games, 3, 'the game after the cut-off is not used');
  assert.ok(syd.pace > (76 + 76 + 92) / 3 - 1, 'most recent game (92) weighted up');
  assert.equal(syd.last5, 81.3);
  assert.equal(table.byMatch.get('c'), 92);
  const exp = expectedNblGamePace(table, 'Sydney Kings', 'Cairns Taipans')!;
  const cns = table.teams.get(nblTeamKey('Cairns Taipans'))!;
  near(exp.pace, syd.pace + cns.pace - table.leaguePace!, 0.01);
  assert.equal(expectedNblGamePace(table, 'Sydney Kings', 'Perth Wildcats')!.h2h?.n, 3);

  const boxes = new Map([
    ['g::SYD', { matchId: 'g', teamCode: 'SYD', opponentCode: 'PER', minutes: 200, pts: 90, fgm: 30, fga: 70, ftm: 10, fta: 15, tov: 12, orb: 10, drb: 25, trb: 35, stl: 5, blk: 3, pf: 18, date: day(1), isHome: true }],
    ['g::PER', { matchId: 'g', teamCode: 'PER', opponentCode: 'SYD', minutes: 160, pts: 70, fgm: 25, fga: 55, ftm: 8, fta: 10, tov: 10, orb: 8, drb: 20, trb: 28, stl: 4, blk: 2, pf: 15, date: day(1), isHome: false }],
  ]);
  assert.equal(teamGamesFromBoxes(boxes, 2026).length, 0, 'a box missing a player (160 of 200 minutes) is dropped');
  boxes.get('g::PER')!.minutes = 200;
  const ok = teamGamesFromBoxes(boxes, 2026);
  assert.equal(ok.length, 2);
  assert.equal(ok.find((r) => r.team === 'Sydney Kings')!.opponent, 'Perth Wildcats');
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
    expectedPace: 90,
    teammatesOut: [],
    restDays: 3,
  };
  near(nblPropContext(input).total, 1.05 * 1.05, 0.001);
  assert.equal(nblPropContext({ ...input, strength: 0 }).total, 1);
});

test('game lines: injuries and back to backs move the margin; pace is reported only', () => {
  const base: NblGameProjection = { homeMargin: 0, total: 180 } as NblGameProjection;
  const even = { offRtg: 110, defRtg: 110, pace: 82, games: 10 };
  const ctx = {
    home: { ...even, offRtg: 118 },
    away: even,
    pace: { pace: 86, notes: ['fast teams'] },
    homeOutPoints: 0,
    awayOutPoints: injuryPoints(20),
    homeOut: [],
    awayOut: ['Star'],
    homeRestDays: 3,
    awayRestDays: 1,
    strength: 1,
  };
  const adj = adjustNblGame(base, ctx);
  near(adj.homeMargin, injuryPoints(20) + 1.5, 0.01);
  near(adj.total, 180 - injuryPoints(20) - 1.5, 0.05);
  assert.ok(adj.notes.some((n) => /Star/.test(n)));
  assert.ok(adj.notes.some((n) => /back to back/.test(n)));
  assert.ok(adj.notes.some((n) => /Expected pace 86/.test(n)));
  assert.deepEqual(adjustNblGame(base, { ...ctx, pace: null, awayOutPoints: 0, awayOut: [], awayRestDays: 3 }), { ...base, notes: [] });
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

test('NBL injury report: dated by the page, not by when we scraped it', () => {
  assert.equal(injuryReportUpdatedAt('Tuesday, October 13, 6:00pm AEDT', '2026-10-18T16:29:24.263Z'), '2026-10-13T07:00:00.000Z');
  assert.equal(injuryReportUpdatedAt('Tuesday, September 29, 4:00pm AEST', '2026-10-01T00:00:00.000Z'), '2026-09-29T06:00:00.000Z');
  assert.equal(injuryReportUpdatedAt('Tuesday, December 30, 9:00am AEDT', '2027-01-02T00:00:00.000Z'), '2026-12-29T22:00:00.000Z', 'year rolls back');
  assert.equal(injuryReportUpdatedAt(null, '2026-10-18T16:29:24.263Z'), null);
});

test('tennis history: only the player who lost retired; matches without serve stats are not history', () => {
  const row = (i: number, over: Partial<TennisMatchRow> = {}): TennisMatchRow =>
    ({
      date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      tour: 'ATP',
      surface: 'Hard',
      playerId: 'p',
      opponentId: `o${i}`,
      isWin: true,
      score: '6-4 6-4',
      servicePointsWonPct: 65,
      returnPointsWonPct: 38,
      serviceGamesWon: 9,
      serveGames: 10,
      ...over,
    }) as TennisMatchRow;
  const [won, lost] = historyFromRows([row(0, { score: '6-4 2-1 RET' }), row(1, { isWin: false, score: '4-6 1-2 RET' })], 'ATP');
  assert.equal(won!.retired, false);
  assert.equal(lost!.retired, true);

  const features = (rows: TennisMatchRow[]) =>
    buildMatchupFeatures({
      asOf: '2026-10-15',
      tour: 'ATP',
      surface: 'Hard',
      bestOf: 3,
      playerId: 'p',
      opponentId: 'q',
      history: historyFromRows([...rows, ...Array.from({ length: 10 }, (_, i) => row(i, { playerId: 'q', opponentId: `x${i}` }))], 'ATP'),
    });
  const itf = Array.from({ length: 12 }, (_, i) => row(i, { servicePointsWonPct: null, returnPointsWonPct: null, serviceGamesWon: null, serveGames: null }));
  assert.equal(features(itf).insufficient, true, '12 matches with no serve stats are not enough');
  assert.equal(features(Array.from({ length: 8 }, (_, i) => row(i))).insufficient, false);
});
