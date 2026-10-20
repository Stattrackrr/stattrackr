import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nbaAchievementFair,
  nbaAchievementQuotes,
  nbaPlayerLines,
  nbaRosterEntry,
  resolveNbaBoardName,
  saneSpreads,
} from './candidates/nba';
import { propSelections } from './candidates/nbl';
import { sharpSplit } from './candidates/sharp';
import type { AiCandidate } from './candidates/types';
import { candidateKey } from './candidates/types';
import { chooseSingles, isNbaGameTimeCall, qualifiesSingle, singleSlotKind, subjectId, type PostedState, type Watched } from './decide/select';
import { gameIdentity, type WatchPoint } from './decide/timing';
import { nextWatchRow, postedState } from './decide/watch';
import { legBet, legSelection } from './format';
import { gradeNbaLeg, type NbaBoxRow, type NbaGameRow, type NbaResults } from './grade/nba';
import { nbaClosingFromBoard } from './grade/nbaClosing';
import { adjustNbaGame, type NbaGameProjection } from './model/nbaGames';
import { NBA_VOLUME, nbaTenPlusCount, nbaTenPlusProb, projectNbaProp } from './model/nbaProps';
import type { NblPropProjection } from './model/nblProps';
import { DEFAULT_AI_PICKS_PARAMS as P, modelGroup } from './params';
import { rescheduledStart } from './reschedule';
import type { AiPick, AiPickLeg } from './types';
import { swapNbaBookRowSides } from '@/lib/nba/dash/oddsApiNet';
import type { NbaBookRow, NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';

const NOW = Date.parse('2026-10-21T02:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function cand(over: Partial<AiCandidate> = {}): AiCandidate {
  const c: AiCandidate = {
    key: '',
    sport: 'nba',
    eventKey: 'g1',
    eventLabel: 'Boston Celtics @ Detroit Pistons',
    startsAt: iso(NOW + 2 * H),
    market: 'points',
    marketKind: 'main',
    player: 'Jayson Tatum',
    playerId: '1',
    team: 'Boston Celtics',
    side: 'over',
    line: 26.5,
    bestPrice: 1.95,
    bestBook: 'Bet365',
    quotes: [
      { book: 'Bet365', price: 1.95 },
      { book: 'Sportsbet', price: 1.9 },
    ],
    modelProb: 0.56,
    marketProb: 0.52,
    prob: 0.55,
    pushProb: 0,
    ev: 0.07,
    projection: 28,
    support: [],
    supportScore: 0.6,
    singleEligible: true,
    multiEligible: true,
    flags: [],
    context: { marketSource: 'main' },
    ...over,
  };
  return { ...c, key: over.key ?? candidateKey(c) };
}

const held: WatchPoint[] = [
  { at: iso(NOW - 15 * 60_000), price: 1.95, prob: 0.55, ev: 0.07 },
  { at: iso(NOW), price: 1.95, prob: 0.55, ev: 0.07 },
];

const empty = (): PostedState => ({
  singlesRecent: {},
  multisRecent: [],
  usedKeys: new Set(),
  singleGamesRecent: new Set(),
  playersRecent: new Set(),
  selectionsBacked: new Set(),
  subjectsUsed: new Set(),
  singlesByGame: {},
});

const pick = (cs: AiCandidate[], state = empty()) =>
  chooseSingles(cs.map((c): Watched => ({ c, history: held })), P, state, NOW).map((p) => p.key);

const prop = (player: string, ev: number, eventKey = 'g1') => cand({ player, playerId: player, ev, eventKey });
const line = (market: 'h2h' | 'spread' | 'total', ev: number, eventKey = 'g1') =>
  cand({ market, player: null, playerId: null, side: market === 'total' ? 'over' : 'home', line: market === 'h2h' ? null : -4.5, ev, eventKey, projection: null });

test('NBA singles: up to 2 props and 1 game line per game; the limit is a ceiling, not a quota', () => {
  const a = prop('A', 0.09);
  const b = prop('B', 0.08);
  const c = prop('C', 0.075);
  const total = line('total', 0.05);
  const spread = line('spread', 0.04);
  assert.deepEqual(pick([a, b, c, total, spread]), [a.key, b.key, total.key]);
  assert.deepEqual(pick([a]), [a.key], 'one good prop alone still posts');
  assert.deepEqual(pick([prop('A', 0.01)]), [], 'nothing posts without the edge');
});

test('NBA singles: at most 3 a run across games, and no daily cap or gap', () => {
  const four = ['g1', 'g2', 'g3', 'g4'].map((g, i) => prop(`P${i}`, 0.09 - i * 0.01, g));
  assert.deepEqual(pick(four), four.slice(0, 3).map((c) => c.key));
  const busy = { ...empty(), singlesRecent: { nba: [NOW - 10 * 60_000, NOW - H, NOW - 2 * H, NOW - 3 * H, NOW - 4 * H, NOW - 5 * H] } };
  assert.deepEqual(pick([four[3]!], busy), [four[3]!.key], 'six NBA singles in the last 6h do not block a seventh');
});

test('NBA singles: earlier picks count against the game; NBL in the same run is unaffected', () => {
  const a = prop('A', 0.09);
  const total = line('total', 0.05);
  const state = { ...empty(), singlesByGame: { [gameIdentity(a)]: { prop: 2, game: 0 } } };
  assert.deepEqual(pick([a, total], state), [total.key]);
  const nbl = cand({ sport: 'nbl', eventKey: 'n1', eventLabel: 'Perth Wildcats @ Sydney Kings', player: 'Z', playerId: 'z', ev: 0.06 });
  assert.deepEqual(pick([a, nbl]).sort(), [a.key, nbl.key].sort());
  assert.deepEqual(pick([a, cand({ ...a, key: undefined, side: 'under', line: 22.5 })]), [a.key], 'one pick per player in a game');
});

test('NBA posted state counts singles per game by kind', () => {
  const leg = (over: Partial<AiPickLeg>) =>
    ({ sport: 'nba', eventKey: 'g1', eventLabel: 'Boston Celtics @ Detroit Pistons', startsAt: iso(NOW + H), market: 'points', player: 'A', side: 'over', line: 20.5, ...over }) as AiPickLeg;
  const single = (l: AiPickLeg): AiPick => ({ id: String(Math.random()), kind: 'single', sport: 'nba', postedAt: iso(NOW - H), price: 1.9, legs: [l] }) as unknown as AiPick;
  const s = postedState([single(leg({})), single(leg({ player: 'B' })), single(leg({ market: 'total', player: null, line: 221.5 }))], NOW);
  assert.deepEqual(s.singlesByGame?.['nba|g1'], { prop: 2, game: 1 });
});

test('board names: surname first, initials, middle names, short first names; ambiguity resolves to nothing', () => {
  const roster = [
    nbaRosterEntry('1', 'Jalen Duren'),
    nbaRosterEntry('2', 'Derrick White'),
    nbaRosterEntry('3', 'Duncan Robinson'),
    nbaRosterEntry('4', 'Ronald Holland II'),
    nbaRosterEntry('5', 'Jayson Tatum'),
    nbaRosterEntry('6', 'Jaylen Brown'),
    nbaRosterEntry('7', 'Jalen Brown'),
  ];
  assert.equal(resolveNbaBoardName('Jalen Duren', roster), '1');
  assert.equal(resolveNbaBoardName('Duren Jalen', roster), '1');
  assert.equal(resolveNbaBoardName('D White', roster), '2');
  assert.equal(resolveNbaBoardName('Duncan Mcbryde Robinson', roster), '3');
  assert.equal(resolveNbaBoardName('Ron Holland', roster), '4');
  assert.equal(resolveNbaBoardName('J Brown', roster), null, 'two J. Browns');
  assert.equal(resolveNbaBoardName('Jay Tatum', roster), '5');
  assert.equal(resolveNbaBoardName('Tatum', roster), null);
  assert.equal(resolveNbaBoardName('Someone Else', roster), null);

  const more = [
    nbaRosterEntry('10', 'A.J. Green'),
    nbaRosterEntry('11', 'Rudy Gobert'),
    nbaRosterEntry('12', 'Max Christie'),
    nbaRosterEntry('13', 'Airious Bailey'),
    nbaRosterEntry('14', 'Bennedict Mathurin'),
    nbaRosterEntry('15', 'Cade Cunningham'),
    nbaRosterEntry('16', 'Jalen Williams'),
    nbaRosterEntry('17', 'Jaylin Williams'),
  ];
  assert.equal(resolveNbaBoardName('Aj Green', more), '10');
  assert.equal(resolveNbaBoardName('Rudy Gobert-Bourgarel', more), '11');
  assert.equal(resolveNbaBoardName('Cormac Karl Max Christie', more), '12');
  assert.equal(resolveNbaBoardName('Ace Bailey', more), '13');
  assert.equal(resolveNbaBoardName('Mathurin Bennedi', more), '14');
  assert.equal(resolveNbaBoardName('C Cuningham', more), '15');
  assert.equal(resolveNbaBoardName('Jaylin Williams', more), '17');
  assert.equal(resolveNbaBoardName('J Williams', more), null, 'two J. Williamses');
  assert.equal(resolveNbaBoardName('Jalen Wiliams', more), null, 'a typo that fits both stays unmatched');
});

test('player lines: milestones become over (n - 0.5), spellings merge without double counting a book', () => {
  const odds = {
    gameId: 'g1',
    homeTeam: 'Detroit Pistons',
    awayTeam: 'Boston Celtics',
    commenceTime: iso(NOW + 2 * H),
    bookmakers: [],
    playerProps: {
      Sportsbet: { 'Derrick White': { PTS: [{ line: '15.5', over: '-110', under: '-110' }, { line: '20', over: '+250', under: 'N/A', milestone: true }] } },
      Ladbrokes: { 'D White': { PTS: [{ line: '15.5', over: '+100', under: '-120' }] }, 'Derrick White': { PTS: [{ line: '15.5', over: '-105', under: '-115' }] } },
    },
  } as unknown as NbaGameOdds;
  const lines = nbaPlayerLines(odds, ['Derrick White', 'D White']);
  assert.equal(lines.length, 3);
  const milestone = lines.find((l) => l.kind === 'milestone')!;
  assert.equal(milestone.line, 19.5);
  assert.equal(milestone.label, '20+');
  assert.equal(milestone.overDecimal, 3.5);
  const lad = lines.filter((l) => l.book === 'Ladbrokes');
  assert.equal(lad.length, 1);
  assert.equal(lad[0]!.over, '-105', 'the exact spelling wins');
  assert.ok(lines.every((l) => l.player === 'Derrick White'));
});

test('spreads on the wrong side of the book’s own favourite are dropped; H2H and totals stay', () => {
  const row: NbaBookRow = {
    name: 'X',
    H2H: { home: '-250', away: '+200' },
    Spread: { line: '6.5', over: '-110', under: '-110' },
    Total: { line: '221.5', over: '-110', under: '-110' },
    SpreadLines: [{ line: '6.5', over: '-110', under: '-110' }],
  };
  const fixed = saneSpreads(row);
  assert.equal(fixed.Spread.line, 'N/A');
  assert.equal(fixed.SpreadLines, undefined);
  assert.deepEqual(fixed.Total, row.Total);
  assert.deepEqual(fixed.H2H, row.H2H);
  const sane = { ...row, Spread: { line: '-6.5', over: '-110', under: '-110' } };
  assert.equal(saneSpreads(sane), sane);
  assert.equal(saneSpreads({ ...row, Spread: { line: '1.5', over: '-110', under: '-110' } }).Spread.line, '1.5', 'near pick-em lines are left alone');
});

test('odds-api.net listed the other way round: prices and spread lines swap to our home side', () => {
  const row: NbaBookRow = {
    name: 'Sportsbet',
    H2H: { home: '-250', away: '+200' },
    Spread: { line: '-6.5', over: '-105', under: '-115' },
    Total: { line: '221.5', over: '-110', under: '-110' },
    SpreadLines: [
      { line: '-6.5', over: '-105', under: '-115' },
      { line: '-3.5', over: '-150', under: '+120' },
    ],
  };
  const s = swapNbaBookRowSides(row);
  assert.deepEqual(s.H2H, { home: '+200', away: '-250' });
  assert.deepEqual(s.Spread, { line: '6.5', over: '-115', under: '-105' });
  assert.deepEqual(s.SpreadLines, [
    { line: '3.5', over: '+120', under: '-150' },
    { line: '6.5', over: '-115', under: '-105' },
  ]);
  assert.deepEqual(s.Total, row.Total);
});

test('reschedule: an NBA leg follows its game id', () => {
  const leg = { id: 'l', sport: 'nba', eventKey: '123', eventLabel: 'Boston Celtics @ Detroit Pistons', startsAt: '2026-10-21T23:00:00Z', status: 'pending' } as AiPickLeg;
  const times = { tennis: new Map<string, string>(), nbl: [], nba: new Map([['123', '2026-10-22T23:30:00Z']]) };
  assert.equal(rescheduledStart(leg, times), '2026-10-22T23:30:00.000Z');
  assert.equal(rescheduledStart({ ...leg, eventKey: '999' }, times), null);
});

function fakeResults(game: Partial<NbaGameRow> | null, box: Partial<NbaBoxRow>[] = []): NbaResults {
  return {
    game: async () => (game ? ({ id: 1, status_state: 'final', postponed: false, home_score: 110, visitor_score: 104, ...game } as NbaGameRow) : null),
    box: async () => box as NbaBoxRow[],
  };
}

test('NBA grading: waits for final and box scores, DNP voids, game lines from the final score', async () => {
  const start = NOW - 5 * H;
  const leg = (over: Partial<AiPickLeg>) =>
    ({ sport: 'nba', eventKey: '1', startsAt: iso(start), market: 'points', playerId: '7', side: 'over', line: 24.5, ...over }) as AiPickLeg;
  assert.equal(await gradeNbaLeg(leg({}), fakeResults({ status_state: 'in_progress' }), NOW), null);
  assert.equal(await gradeNbaLeg(leg({}), fakeResults({}, []), NOW), null, 'final but box scores not synced yet');
  assert.equal((await gradeNbaLeg(leg({}), fakeResults({}, []), start + 4 * 24 * H))?.status, 'void');
  const box = [{ player_id: 7, minutes: '34', pts: 27, reb: 5, ast: 4, fg3m: 3 }, { player_id: 8, minutes: '20', pts: 4, reb: 1, ast: 1, fg3m: 0 }];
  assert.equal((await gradeNbaLeg(leg({}), fakeResults({}, box), NOW))?.status, 'win');
  assert.equal((await gradeNbaLeg(leg({ market: 'pra', line: 36.5, side: 'under' }), fakeResults({}, box), NOW))?.status, 'win');
  assert.equal((await gradeNbaLeg(leg({ playerId: '9' }), fakeResults({}, box), NOW))?.status, 'void', 'not in the box score: did not play');
  assert.equal((await gradeNbaLeg(leg({ market: 'spread', side: 'home', line: -5.5, playerId: null }), fakeResults({}, box), NOW))?.status, 'win');
  assert.equal((await gradeNbaLeg(leg({ market: 'spread', side: 'home', line: -6, playerId: null }), fakeResults({}, box), NOW))?.status, 'push');
  assert.equal((await gradeNbaLeg(leg({ market: 'total', side: 'over', line: 215.5, playerId: null }), fakeResults({}, box), NOW))?.status, 'loss');
  assert.equal((await gradeNbaLeg(leg({ market: 'h2h', side: 'away', line: null, playerId: null }), fakeResults({}, box), NOW))?.status, 'loss');
  assert.equal((await gradeNbaLeg(leg({}), fakeResults({ status_state: 'scheduled', postponed: true }), start + 25 * H))?.status, 'void');
});

test('a "30+" milestone and over 29.5 are one bet: one selection carrying every book at its best price', () => {
  const odds = {
    playerProps: {
      sportsbet: { 'Jalen Brunson': { PR: [{ line: '29.5', over: '-114', under: '-114' }] } },
      ladbrokes: { 'Jalen Brunson': { PR: [{ line: '29.5', over: '-118', under: '-111' }, { line: '30', over: '-110', under: 'N/A', milestone: true }] } },
      betright: { 'Jalen Brunson': { PR: [{ line: '30', over: '-118', under: 'N/A', milestone: true }] } },
      picklebet: { 'Jalen Brunson': { PR: [{ line: '35', over: '+200', under: 'N/A', milestone: true }] } },
    },
  } as unknown as NbaGameOdds;
  const sels = propSelections(nbaPlayerLines(odds, 'Jalen Brunson'));
  const overs = sels.filter((s) => s.line === 29.5 && s.side === 'over');
  assert.equal(overs.length, 1, 'no second "30+" selection under the same key');
  assert.equal(overs[0]!.kind, 'ou');
  assert.deepEqual(
    [...overs[0]!.quotes].sort((a, b) => a.book.localeCompare(b.book)),
    [
      { book: 'betright', price: 1.85 },
      { book: 'ladbrokes', price: 1.91 },
      { book: 'sportsbet', price: 1.88 },
    ],
    "Ladbrokes' better 30+ price counts once"
  );
  assert.ok(sels.some((s) => s.kind === 'milestone' && s.line === 34.5), 'a milestone with no matching over/under stays');
});

test('a questionable player: his overs wait until 90 minutes before tip, his unders post early (sitting voids them)', () => {
  assert.ok(isNbaGameTimeCall('Questionable'));
  assert.ok(isNbaGameTimeCall('Day-To-Day'));
  assert.ok(isNbaGameTimeCall('Doubtful'));
  assert.ok(!isNbaGameTimeCall('Out'));
  assert.ok(!isNbaGameTimeCall(null));
  const q = cand({ context: { marketSource: 'main', listedStatus: 'Day-To-Day' } });
  const res = qualifiesSingle(q, P, NOW);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /Questionable/);
  assert.equal(qualifiesSingle({ ...q, startsAt: iso(NOW + 80 * 60_000) }, P, NOW).ok, true, 'inside 90 minutes it can post');
  assert.equal(qualifiesSingle({ ...q, side: 'under' }, P, NOW).ok, true, 'his under posts early');
  assert.equal(qualifiesSingle({ ...q, market: 'doubleDouble' }, P, NOW).ok, false, 'a double-double is an over');
  assert.equal(qualifiesSingle(cand({ startsAt: iso(NOW + 10 * H) }), P, NOW).ok, true, 'not listed: no wait');
  assert.equal(qualifiesSingle({ ...q, sport: 'nbl', startsAt: iso(NOW + 10 * H) }, P, NOW).ok, true, 'NBL is unaffected');
});

test('sharp books (Pinnacle, DraftKings, FanDuel) get half the say in the fair price', () => {
  const s = sharpSplit([
    { book: 'pinnacle', p: 0.6 },
    { book: 'draftkings', p: 0.54 },
    { book: 'Sportsbet', p: 0.5 },
    { book: 'Ladbrokes', p: 0.52 },
    { book: 'TAB', p: 0.48 },
  ]);
  assert.ok(Math.abs(s.sharp! - (2 * 0.6 + 0.54) / 3) < 1e-9);
  assert.equal(s.rest, 0.5);
  assert.ok(Math.abs(s.fair! - (0.5 * s.sharp! + 0.25)) < 1e-9);
  assert.deepEqual(sharpSplit([{ book: 'Sportsbet', p: 0.5 }, { book: 'TAB', p: 0.6 }]), { fair: 0.55, sharp: null, rest: 0.55 });
  assert.equal(sharpSplit([{ book: 'FanDuel', p: 0.45 }]).fair, 0.45, 'sharp alone');
  assert.equal(sharpSplit([]).fair, null);
});

test('watch history keeps the sharp and the other books’ fair price apart', () => {
  const c = cand({ context: { marketSource: 'main', sharpProb: 0.57, restProb: 0.52 } });
  const next = nextWatchRow(c, undefined, iso(NOW))!;
  assert.equal(next.history.at(-1)!.sharp, 0.57);
  assert.equal(next.history.at(-1)!.rest, 0.52);
  const plain = nextWatchRow(cand(), undefined, iso(NOW))!;
  assert.equal('sharp' in plain.history.at(-1)!, false);
});

test('game lines: a team missing its starters loses margin; the total moves by game score and minutes', () => {
  const base: NbaGameProjection = { homeMargin: 4, total: 226, marginSd: 13, totalSd: 18, pace: 99, home: null, away: null, league: { rtg: 114, pace: 99 } };
  const none = { players: [], points: 0, gameScore: 0, minutes: 0 };
  const ctx = { homeMissing: none, awayMissing: none, homeRestDays: 2, awayRestDays: 2, strength: 1 };
  const same = adjustNbaGame(base, ctx);
  assert.equal(same.homeMargin, 4);
  assert.equal(same.total, 226);
  const star = { players: ['Star'], points: 28, gameScore: 22, minutes: 35 };
  const homeOut = adjustNbaGame(base, { ...ctx, homeMissing: star });
  assert.ok(Math.abs(homeOut.homeMargin - (4 - 0.156 * 22)) < 0.06, `margin ${homeOut.homeMargin}`);
  assert.ok(Math.abs(homeOut.total - (226 - 0.405 * 22 + 0.156 * 35)) < 0.06, `total ${homeOut.total}`);
  const awayOut = adjustNbaGame(base, { ...ctx, awayMissing: star });
  assert.ok(Math.abs(awayOut.homeMargin - (4 + 0.156 * 22)) < 0.06);
  assert.ok(homeOut.notes.some((n) => /Home missing Star/.test(n)));
});

function logRow(i: number, over: Partial<NbaGameLogRow>): NbaGameLogRow {
  return {
    matchId: String(i),
    date: new Date(Date.parse('2025-11-01T00:00:00Z') + i * 2 * 86_400_000).toISOString(),
    season: 2025,
    round: null,
    opponent: 'X',
    opponentCode: 'X',
    isHome: i % 2 === 0,
    team: 'T',
    teamCode: 'T',
    result: null,
    minutes: 32,
    points: 18,
    rebounds: 5,
    offensiveRebounds: 1,
    defensiveRebounds: 4,
    assists: 4,
    steals: 1,
    blocks: 0,
    turnovers: 2,
    fouls: 2,
    fgMade: 6,
    fgAttempted: 14,
    fgPct: null,
    twoMade: 3,
    twoAttempted: 6,
    twoPct: null,
    threeMade: 3,
    threeAttempted: 8,
    threePct: null,
    ftMade: 3,
    ftAttempted: 4,
    ftPct: null,
    plusMinus: 0,
    efficiency: null,
    pra: null,
    pr: null,
    pa: null,
    ra: null,
    ...over,
  };
}

test('volume projection: a hot shooting run is pulled back toward his usual percentage; steady shooting is left alone', () => {
  const off = { ...NBA_VOLUME, weight: { points: 0, rebounds: 0, assists: 0, threeMade: 0 } };
  const cold = Array.from({ length: 30 }, (_, i) => logRow(i, { threeMade: 2, fgMade: 5, points: 15 }));
  const hot = Array.from({ length: 6 }, (_, i) => logRow(30 + i, { threeMade: 6, fgMade: 9, points: 27 }));
  const games = [...cold, ...hot];
  const boxOnly = projectNbaProp(games, 'threeMade', 2025, undefined, off)!;
  const volume = projectNbaProp(games, 'threeMade', 2025)!;
  assert.ok(volume.mean < boxOnly.mean, `${volume.mean} < ${boxOnly.mean}`);
  assert.ok(volume.mean > 8 * 0.25 * (boxOnly.expectedMinutes / 32), 'still credits some of the hot run');
  const steady = Array.from({ length: 30 }, (_, i) => logRow(i, {}));
  const a = projectNbaProp(steady, 'threeMade', 2025, undefined, off)!.mean;
  const b = projectNbaProp(steady, 'threeMade', 2025)!.mean;
  assert.ok(Math.abs(a - b) < 0.35, `steady ${a} vs ${b}`);
});

const fakeProj = (mean: number, minutes = 34): NblPropProjection => ({
  mean,
  variance: mean * 1.3,
  dispersion: 1.3,
  ratePerMinute: mean / minutes,
  expectedMinutes: minutes,
  sample: 20,
  currentSeasonGames: 20,
  lastGameDate: null,
});

test('double-double / triple-double model: big averages make them likely, small ones rule them out', () => {
  const jokic = [fakeProj(27), fakeProj(12.5), fakeProj(9.5)];
  const dd = nbaTenPlusProb(jokic, 4, 2);
  const td = nbaTenPlusProb(jokic, 4, 3);
  assert.ok(dd > 0.75 && dd < 0.98, `dd ${dd}`);
  assert.ok(td > 0.25 && td < 0.6, `td ${td}`);
  assert.ok(td < dd);
  const guard = [fakeProj(14), fakeProj(3), fakeProj(4)];
  assert.ok(nbaTenPlusProb(guard, 4, 2) < 0.08);
  assert.ok(nbaTenPlusProb(guard, 4, 3) < 0.005);
  assert.ok(nbaTenPlusProb(jokic, 9, 2) < dd, 'shakier minutes, lower chance');
  assert.equal(nbaTenPlusCount({ points: 20, rebounds: 10, assists: 9, steals: 1, blocks: 10 }), 3);
});

test('double-double odds: yes-only prices lose a one-way margin; shared-feed copies count once', () => {
  const odds = {
    gameId: 'g1',
    homeTeam: 'Detroit Pistons',
    awayTeam: 'Boston Celtics',
    commenceTime: iso(NOW + 2 * H),
    bookmakers: [],
    playerProps: {
      betright: { 'Ausar Thompson': { DD: [{ line: '1', over: '+525', under: 'N/A', milestone: true }] } },
      playup: { 'Ausar Thompson': { DD: [{ line: '1', over: '+525', under: 'N/A', milestone: true }] } },
      sportsbet: { 'Ausar Thompson': { DD: [{ line: '1', over: '+550', under: 'N/A', milestone: true }] } },
      draftkings: { 'A Thompson': { DD: [{ line: '0.5', over: '+400', under: '-600' }] } },
    },
  } as unknown as NbaGameOdds;
  const quotes = nbaAchievementQuotes(odds, ['Ausar Thompson', 'A Thompson'], 'doubleDouble');
  assert.equal(quotes.length, 4);
  assert.equal(quotes.find((q) => q.book === 'draftkings')!.no! > 1, true);
  assert.equal(nbaAchievementQuotes(odds, ['Ausar Thompson'], 'tripleDouble').length, 0);
  const fair = nbaAchievementFair(quotes, 1.08);
  assert.ok(fair.rest! < 1 / 6.25 && fair.rest! > 0.12, `rest ${fair.rest}`);
  assert.ok(fair.sharp! < 0.2 && fair.sharp! > 0.15, `sharp ${fair.sharp}`);
  assert.ok(fair.fair! > fair.rest! && fair.fair! < fair.sharp!);
});

test('double-double legs: one per player per game, own model group, titled as a yes bet, graded on 10+ stats', async () => {
  const dd = cand({ market: 'doubleDouble', side: 'over', line: 0.5, projection: null });
  assert.equal(singleSlotKind(dd), 'prop');
  assert.equal(subjectId(dd), subjectId(cand()), 'same subject as his points over');
  assert.equal(modelGroup(dd), 'doubleDouble');
  assert.equal(qualifiesSingle(dd, P, NOW).ok, true, 'no over/under board needed');
  const legLike = { sport: 'nba', market: 'doubleDouble', marketKind: 'main', player: 'Ausar Thompson', team: 'Detroit Pistons', side: 'over', line: 0.5 } as const;
  assert.equal(legSelection(legLike as unknown as AiPickLeg), 'Ausar Thompson to record a double-double');
  assert.equal(legBet({ ...legLike, market: 'tripleDouble' } as unknown as AiPickLeg), 'To record a triple-double');

  const start = NOW - 5 * H;
  const leg = (market: string, playerId = '7') =>
    ({ sport: 'nba', eventKey: '1', startsAt: iso(start), market, playerId, side: 'over', line: 0.5 }) as AiPickLeg;
  const box = [
    { player_id: 7, minutes: '36', pts: 18, reb: 11, ast: 7, fg3m: 0, stl: 2, blk: 1 },
    { player_id: 8, minutes: '30', pts: 12, reb: 9, ast: 3, fg3m: 1, stl: 0, blk: 10 },
    { player_id: 9, minutes: '0', pts: 0, reb: 0, ast: 0, fg3m: 0, stl: 0, blk: 0 },
  ];
  const r = await gradeNbaLeg(leg('doubleDouble'), fakeResults({}, box), NOW);
  assert.equal(r?.status, 'win');
  assert.equal(r?.note, '18 pts, 11 reb, 7 ast');
  assert.equal((await gradeNbaLeg(leg('tripleDouble'), fakeResults({}, box), NOW))?.status, 'loss');
  assert.equal((await gradeNbaLeg(leg('doubleDouble', '8'), fakeResults({}, box), NOW))?.status, 'win', 'blocks count');
  assert.equal((await gradeNbaLeg(leg('doubleDouble', '9'), fakeResults({}, box), NOW))?.status, 'void', 'DNP');
  assert.equal((await gradeNbaLeg(leg('doubleDouble', '10'), fakeResults({}, box), NOW))?.status, 'void', 'not in the box score');
});

test('a questionable big-minutes regular holds only the bets his call could hurt', () => {
  const waiting = { marketSource: 'main', waitingOn: ['Cade Cunningham (Questionable)'] };
  const over = cand({ context: waiting });
  assert.equal(qualifiesSingle(over, P, NOW).ok, true, "a teammate's over only gains if he sits");
  assert.equal(qualifiesSingle({ ...over, market: 'doubleDouble' }, P, NOW).ok, true);
  const under = { ...over, side: 'under' as const };
  const res = qualifiesSingle(under, P, NOW);
  assert.equal(res.ok, false);
  assert.match((res as { reason: string }).reason, /Waiting on Cade Cunningham \(Questionable\): unders/);
  assert.equal(qualifiesSingle({ ...under, startsAt: iso(NOW + 80 * 60_000) }, P, NOW).ok, true, 'inside 90 minutes it can post');
  assert.equal(
    qualifiesSingle({ ...under, context: { ...waiting, listedStatus: 'Questionable' }, side: 'over' }, P, NOW).ok,
    false,
    'his own over still waits'
  );

  const homeQ = { waitingOnHome: ['Bam Adebayo (Day-To-Day)'], waitingOnAway: [] };
  const spread = line('spread', 0.06);
  assert.equal(qualifiesSingle({ ...spread, context: homeQ }, P, NOW).ok, false, 'backing his team waits');
  assert.equal(qualifiesSingle({ ...spread, side: 'away', context: homeQ }, P, NOW).ok, true, 'backing the other team posts');
  assert.equal(qualifiesSingle({ ...line('h2h', 0.06), side: 'away', context: homeQ }, P, NOW).ok, true);
  assert.equal(qualifiesSingle({ ...line('total', 0.06), context: homeQ }, P, NOW).ok, false, 'totals wait either way');
  assert.equal(qualifiesSingle({ ...line('total', 0.06), context: { waitingOnHome: [], waitingOnAway: [] } }, P, NOW).ok, true);
});

test('NBA closing price: the leg’s own book at the leg’s own line from the frozen board', () => {
  const game = {
    gameId: '1',
    homeTeam: 'Detroit Pistons',
    awayTeam: 'Boston Celtics',
    commenceTime: iso(NOW - H),
    bookmakers: [
      {
        name: 'Sportsbet',
        H2H: { home: '-150', away: '+130' },
        Spread: { line: '-3.5', over: '-110', under: '-110' },
        Total: { line: '221.5', over: '-105', under: '-115' },
        SpreadLines: [{ line: '-3.5', over: '-110', under: '-110' }, { line: '-5.5', over: '+120', under: '-140' }],
        TotalLines: [{ line: '221.5', over: '-105', under: '-115' }],
      },
    ],
    playerProps: {
      sportsbet: {
        'D White': { PTS: [{ line: '15.5', over: '-120', under: '+100' }, { line: '20', over: '+250', under: 'N/A', milestone: true }] },
        'Ausar Thompson': { DD: [{ line: '1', over: '+500', under: 'N/A', milestone: true }] },
      },
      tab: { 'Derrick White': { PTS: [{ line: '16.5', over: '-110', under: '-110' }] } },
    },
  } as unknown as NbaGameOdds;
  const leg = (over: Partial<AiPickLeg>) =>
    ({ sport: 'nba', eventKey: '1', market: 'points', marketKind: 'main', player: 'Derrick White', playerId: '2', side: 'over', line: 15.5, bookmaker: 'sportsbet', ...over }) as AiPickLeg;
  assert.deepEqual(nbaClosingFromBoard(leg({}), game), { line: 15.5, price: 1.83 }, 'the other spelling at Sportsbet');
  assert.deepEqual(nbaClosingFromBoard(leg({ side: 'under' }), game), { line: 15.5, price: 2 });
  assert.deepEqual(nbaClosingFromBoard(leg({ marketKind: 'milestone', line: 19.5 }), game), { line: 19.5, price: 3.5 });
  assert.equal(nbaClosingFromBoard(leg({ line: 16.5 }), game), null, 'Sportsbet no longer offered 16.5');
  assert.equal(nbaClosingFromBoard(leg({ bookmaker: 'TAB', line: 16.5 }), game)?.price, 1.91, 'exact spelling at TAB');
  assert.deepEqual(nbaClosingFromBoard(leg({ market: 'doubleDouble', player: 'Ausar Thompson', line: 0.5 }), game), { line: 0.5, price: 6 });
  const g = (over: Partial<AiPickLeg>) => leg({ player: null, playerId: null, bookmaker: 'Sportsbet', ...over });
  assert.deepEqual(nbaClosingFromBoard(g({ market: 'h2h', side: 'away', line: null }), game), { line: null, price: 2.3 });
  assert.deepEqual(nbaClosingFromBoard(g({ market: 'spread', side: 'away', line: 5.5 }), game), { line: 5.5, price: 1.71 });
  assert.deepEqual(nbaClosingFromBoard(g({ market: 'total', side: 'under', line: 221.5 }), game), { line: 221.5, price: 1.87 });
  assert.equal(nbaClosingFromBoard(g({ market: 'total', side: 'under', line: 225.5 }), game), null);
});
