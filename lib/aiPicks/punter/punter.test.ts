import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiCandidate } from '../candidates/types';
import { candidateKey } from '../candidates/types';
import type { NbaFinal } from '../model/nbaGames';
import type { AiPick, AiPickLeg } from '../types';
import type { NbaShotSummary } from '@/lib/nba/dash/shotSummary';
import type { NbaGameLogRow } from '@/lib/nba/dash/types';
import { isSoft, isTough, ordinal, punterCases, PUNTER_RULES, type PunterGame, type PunterInput, type PunterRank, type PunterTeammate } from './angles';
import { choosePunter, punterCandidate, punterEligible, punterMarketEv, punterOrder, punterPostedState, PUNTER_LIMITS, type PunterEntry, type PunterState } from './decide';
import { addPositionGame, defenceRanks, emptyPositionTable, playerZone, positionRanks, rankTeams, teammateSplit, zoneDefenceRanks } from './league';

/** 30 teams T01..T30; a team's number is its rank unless it is placed by hand. */
const TEAMS = Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);
function ranks(placed: Record<string, number> = {}, of = 30): Map<string, PunterRank> {
  const out = new Map<string, PunterRank>();
  TEAMS.slice(0, of).forEach((t, i) => out.set(t, { rank: i + 1, of, value: 40 + i }));
  for (const [team, rank] of Object.entries(placed)) out.set(team, { rank, of, value: 40 + rank });
  return out;
}

let seq = 0;
const game = (opponent: string, value: number, season = 2026): PunterGame => {
  seq += 1;
  return { matchId: `m${seq}`, date: `${season}-11-${String(seq).padStart(3, '0')}`, season, opponent, value };
};

/**
 * The write-up this arm is modelled on: a paint scorer off a run of top paint defences, into the
 * league's softest one, with his frontcourt partner out and a split and head-to-head that say the same.
 */
function allenCase(): PunterInput {
  seq = 0;
  // Last season: 6 with the partner (~13), 6 without (~20), including meetings with tonight's opponent.
  const withMate = [game('CHI', 10, 2025), game('CHI', 11, 2025), game('CHI', 11, 2025), game('T12', 15, 2025), game('T13', 16, 2025), game('T14', 17, 2025)];
  const without = [game('CHI', 18, 2025), game('CHI', 20, 2025), game('CHI', 19, 2025), game('CHI', 20, 2025), game('T15', 21, 2025), game('T16', 22, 2025)];
  // This season: three ordinary games, then 4 of the last 5 against top-10 paint defences.
  const early = [game('T15', 18), game('T16', 17), game('T17', 19)];
  const recent = [game('T01', 10), game('T03', 11), game('T20', 15), game('T05', 9), game('T06', 12)];
  const mate: PunterTeammate = {
    name: 'Evan Mobley',
    status: 'Out',
    played: new Set(withMate.map((g) => g.matchId)),
    missed: new Set([...without, ...early, ...recent].map((g) => g.matchId)),
  };
  return {
    stat: 'points',
    line: 13.5,
    position: 'C',
    opponent: 'CHI',
    opponentName: 'Chicago Bulls',
    currentSeason: 2026,
    games: [...withMate, ...without, ...early, ...recent],
    zone: { group: 'paint', share: 0.84 },
    zoneRanks: { paint: ranks({ CHI: 30 }) },
    positionRanks: ranks({ CHI: 28 }),
    defenceRanks: ranks({ CHI: 30 }),
    teammatesOut: [mate],
    restDays: 3,
  };
}

test('ordinals and the soft / tough bands', () => {
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 30].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '30th']);
  assert.ok(isTough({ rank: 10, of: 30, value: 1 }) && !isTough({ rank: 11, of: 30, value: 1 }));
  assert.ok(isSoft({ rank: 21, of: 30, value: 1 }) && !isSoft({ rank: 20, of: 30, value: 1 }));
  assert.ok(!isSoft({ rank: 20, of: 20, value: 1 }) && !isTough({ rank: 1, of: 20, value: 1 }), 'too few teams ranked means no band');
  assert.ok(!isSoft(null) && !isTough(undefined));
});

test('the model write-up qualifies as an over on every reason, in write-up order', () => {
  const { over, under } = punterCases(allenCase());
  assert.equal(over.qualifies, true);
  assert.deepEqual(over.angles.map((a) => a.key), ['schedule', 'zone', 'defence', 'position', 'teammate', 'history', 'rest']);
  assert.equal(over.core, 4, 'schedule, zone, position and teammate rank the case; defence, history and rest do not');
  assert.ok(over.matchup > 0 && over.matchup <= 1);
  assert.equal(over.against.length, 0);
  assert.equal(under.qualifies, false);
  assert.equal(under.angles.length, 0);
  assert.equal(under.against.length, 4);

  const text = Object.fromEntries(over.angles.map((a) => [a.key, a.text]));
  assert.match(text.schedule!, /^4 of his last 5 games were against top-10 defences in the paint \(T01 1st, T03 3rd, T05 5th, T06 6th\)/);
  assert.match(text.schedule!, /averaged 11\.4 points over those 5 against 13\.9 for the season\. Tonight's opponent ranks 30th of 30\./);
  assert.match(text.zone!, /^Chicago Bulls allow the most in the league: 70 points a game in the paint\. 84% of his field-goal points come in the paint\./);
  assert.match(text.position!, /allow the 3rd most points a game to centres/);
  assert.match(text.defence!, /have the worst defensive rating/);
  assert.match(text.teammate!, /^Teammate Evan Mobley is out\. In 14 games without Evan Mobley the player has averaged 16\.5 points, against 13\.3 in 6 games with him/);
  assert.match(text.history!, /^Against Chicago Bulls without Evan Mobley he has gone over 13\.5 in 4 of his last 4 \(19\.3 average\)\./);
  assert.equal(text.rest, "2 days off since the team's last game.");
});

test('a matchup needs a catalyst and a catalyst needs a matchup', () => {
  const base = allenCase();
  const matchupOnly = punterCases({ ...base, teammatesOut: [], games: base.games.slice(0, -5) });
  assert.equal(matchupOnly.over.qualifies, false, 'soft opponent alone is what the market already prices');
  assert.deepEqual(matchupOnly.over.angles.filter((a) => a.kind !== 'support').map((a) => a.key), ['zone', 'position']);

  // Tonight's opponent in the middle of the league: no matchup, so the run of matchups means nothing either.
  const middle = { zoneRanks: { paint: ranks({ CHI: 15 }) }, positionRanks: ranks({ CHI: 15 }), defenceRanks: ranks({ CHI: 15 }) };
  const catalystOnly = punterCases({ ...base, ...middle });
  assert.equal(catalystOnly.over.qualifies, false);
  assert.deepEqual(catalystOnly.over.angles.filter((a) => a.kind !== 'support').map((a) => a.key), ['teammate']);
});

test('support reasons never qualify a bet on their own', () => {
  const base = allenCase();
  const bare = { ...base, zone: null, position: null, positionRanks: null, zoneRanks: {}, teammatesOut: [] };
  // With nobody out his record against them is all meetings: 4 of the last 6, short of the 75% quoted.
  assert.deepEqual(punterCases(bare).over.angles.map((a) => a.key), ['defence', 'rest']);
  const onlySupport = punterCases({ ...bare, line: 10.5 });
  assert.deepEqual(onlySupport.over.angles.map((a) => a.key), ['defence', 'history', 'rest']);
  assert.match(onlySupport.over.angles[1]!.text, /^Against Chicago Bulls he has gone over 10\.5 in 6 of his last 6 \(16\.5 average\)\./);
  assert.equal(onlySupport.over.core, 0);
  assert.equal(onlySupport.over.qualifies, false);
});

test('a reason pointing the other way blocks the bet', () => {
  const base = allenCase();
  // Soft in the paint but among the toughest on centres: the matchup is split.
  const split = punterCases({ ...base, positionRanks: ranks({ CHI: 3 }) });
  assert.equal(split.over.qualifies, false);
  assert.deepEqual(split.over.against.map((a) => a.key), ['position']);
  assert.equal(split.under.qualifies, false);
});

test('the teammate reason needs enough games both ways and an average clear of the line', () => {
  const base = allenCase();
  const mate = base.teammatesOut[0]!;
  const few = punterCases({ ...base, teammatesOut: [{ ...mate, played: new Set([...mate.played].slice(0, 4)) }] });
  assert.ok(!few.over.angles.some((a) => a.key === 'teammate'), 'fewer than 5 games with him');
  const priced = punterCases({ ...base, line: 17.5 });
  assert.ok(!priced.over.angles.some((a) => a.key === 'teammate'), 'the line already sits above what he does without him');
  const stale = punterCases({ ...base, line: 10.5 });
  assert.ok(!stale.over.angles.some((a) => a.key === 'teammate'), 'a line that far under his average without him is priced on a different player');
  // The mirror: numbers drop without the teammate and sit under the line.
  seq = 0;
  const withHim = Array.from({ length: 6 }, () => game('T12', 24, 2026));
  const withoutHim = Array.from({ length: 6 }, () => game('T13', 16, 2026));
  const feeder: PunterTeammate = { name: 'Lead Guard', status: 'Doubtful', played: new Set(withHim.map((g) => g.matchId)), missed: new Set(withoutHim.map((g) => g.matchId)) };
  const under = punterCases({ ...base, line: 20.5, opponent: 'T02', opponentName: 'Tough Team', games: [...withHim, ...withoutHim], teammatesOut: [feeder], zoneRanks: { paint: ranks() }, positionRanks: ranks(), defenceRanks: ranks() }).under;
  assert.equal(under.qualifies, true);
  assert.match(under.angles.find((a) => a.key === 'teammate')!.text, /^Teammate Lead Guard is doubtful\. In 6 games without Lead Guard the player has averaged 16 points, against 24 in 6 games with him/);
  const staleUnder = punterCases({ ...base, line: 24.5, opponent: 'T02', opponentName: 'Tough Team', games: [...withHim, ...withoutHim], teammatesOut: [feeder], zoneRanks: { paint: ranks() }, positionRanks: ranks(), defenceRanks: ranks() }).under;
  assert.ok(!staleUnder.angles.some((a) => a.key === 'teammate'));
});

test('the run of matchups mirrors for unders and needs his numbers to have moved with it', () => {
  seq = 0;
  const early = [game('T12', 12), game('T13', 13), game('T14', 12)];
  const softRun = [game('T25', 20), game('T27', 22), game('T15', 14), game('T29', 21), game('T30', 19)];
  const input: PunterInput = {
    stat: 'rebounds',
    line: 9.5,
    position: 'F',
    opponent: 'T02',
    opponentName: 'Tough Team',
    currentSeason: 2026,
    games: [...early, ...softRun],
    zone: null,
    zoneRanks: {},
    positionRanks: ranks(),
    defenceRanks: ranks(),
    teammatesOut: [],
    restDays: 1,
  };
  const { under, over } = punterCases(input);
  assert.equal(under.qualifies, false, 'rebounds have no zone: a run of matchups and tonight\'s matchup are two reasons, not a stack of three');
  assert.equal(under.core, 2);
  assert.deepEqual(under.angles.map((a) => a.key), ['schedule', 'position', 'rest']);
  // The same run on a scoring stat adds where he scores: three reasons, and the under qualifies.
  const scoring = punterCases({ ...input, stat: 'points', zone: { group: 'paint', share: 0.7 }, zoneRanks: { paint: ranks() } }).under;
  assert.equal(scoring.qualifies, true);
  assert.deepEqual(scoring.angles.map((a) => a.key), ['schedule', 'zone', 'defence', 'position', 'rest']);
  assert.equal(scoring.core, PUNTER_RULES.minCore);
  assert.match(under.angles[0]!.text, /^4 of his last 5 games were against bottom-10 defences for rebounds against forwards \(T25 25th, T27 27th, T29 29th, T30 30th\)/);
  assert.equal(under.angles.at(-1)!.text, 'Second night of a back-to-back.');
  assert.ok(!under.angles.some((a) => a.key === 'defence'), 'overall defence is quoted for scoring stats only');
  assert.equal(over.qualifies, false);

  // Same run, but he did not go any better through it: nothing to come back from.
  const flat = punterCases({ ...input, games: [...early.map((g) => ({ ...g, value: 25 })), ...softRun] });
  assert.ok(!flat.under.angles.some((a) => a.key === 'schedule'));
  // Fewer than 8 games this season: his last five are most of his season.
  const thin = punterCases({ ...input, games: input.games.slice(1) });
  assert.ok(!thin.under.angles.some((a) => a.key === 'schedule'));
});

test('threes are judged on threes allowed whatever his own zone is', () => {
  const base = allenCase();
  const threes = punterCases({ ...base, stat: 'threeMade', line: 2.5, zone: null, zoneRanks: { three: ranks({ CHI: 29 }) } });
  const zone = threes.over.angles.find((a) => a.key === 'zone');
  assert.match(zone!.text, /^Chicago Bulls allow the 2nd most in the league: 23 threes a game\.$/);
});

test('league tables: ranks, zones, positions, defence and teammate splits', () => {
  const r = rankTeams(new Map([['B', 50], ['A', 50], ['C', 40]]));
  assert.deepEqual([...r].map(([t, v]) => `${t}${v.rank}/${v.of}`), ['C1/3', 'A2/3', 'B3/3']);

  const summary: NbaShotSummary = {
    season: 2026,
    generatedAt: '',
    shots: 0,
    players: {
      big: { g: 20, z: { restricted: [70, 50], paint: [20, 10], midRange: [10, 4], aboveBreak3: [9, 3] }, a: {} },
      mixed: { g: 20, z: { restricted: [30, 20], midRange: [30, 14], aboveBreak3: [50, 18] }, a: {} },
      rookie: { g: 3, z: { restricted: [10, 8] }, a: {} },
    },
    defense: {
      SOFT: { g: 10, z: { restricted: [300, 220], paint: [100, 50], aboveBreak3: [300, 100] }, a: {} },
      HARD: { g: 10, z: { restricted: [250, 150], paint: [100, 40], aboveBreak3: [350, 130] }, a: {} },
      NEW: { g: 7, z: { restricted: [10, 1] }, a: {} },
    },
  };
  const zones = zoneDefenceRanks(summary);
  assert.deepEqual(zones.paint!.get('SOFT'), { rank: 2, of: 2, value: 54 });
  assert.deepEqual(zones.three!.get('HARD'), { rank: 2, of: 2, value: 39 });
  assert.equal(zones.paint!.has('NEW'), false, 'fewer than 8 games defended is not ranked');
  assert.deepEqual(zoneDefenceRanks(null), {});

  assert.deepEqual(playerZone([summary.players.big]), { group: 'paint', share: 0.876 });
  assert.equal(playerZone([summary.players.mixed]), null, 'no zone carries half his points');
  assert.equal(playerZone([summary.players.rookie]), null, 'too few makes');
  assert.equal(playerZone([undefined, null]), null);
  assert.equal(playerZone([summary.players.rookie, summary.players.big])!.group, 'paint', 'seasons are pooled');

  const table = emptyPositionTable();
  const row = (opp: string, matchId: string, points: number) =>
    ({ opponentCode: opp, matchId, minutes: 30, points, rebounds: 5, assists: 2, threeMade: 1 }) as unknown as NbaGameLogRow;
  for (let g = 0; g < 8; g += 1) {
    addPositionGame(table, row('AAA', `a${g}`, 20), 'C');
    addPositionGame(table, row('AAA', `a${g}`, 10), 'C');
    addPositionGame(table, row('BBB', `b${g}`, 12), 'C');
    addPositionGame(table, row('BBB', `b${g}`, 30), 'G');
  }
  addPositionGame(table, row('CCC', 'c0', 50), 'C');
  const centres = positionRanks(table, 'C', 'points');
  assert.deepEqual(centres.get('AAA'), { rank: 2, of: 2, value: 30 });
  assert.deepEqual(centres.get('BBB'), { rank: 1, of: 2, value: 12 });
  assert.equal(positionRanks(table, 'C', 'pra').get('AAA')!.value, 44);

  const final = (home: string, away: string, homeScore: number, awayScore: number, over: Partial<NbaFinal> = {}): NbaFinal => ({
    matchId: `${home}${away}${homeScore}`, date: '2026-11-01', season: 2026, postseason: false, home, away, homeScore, awayScore, homePoss: 100, awayPoss: 100, minutes: 48, ...over,
  });
  const finals = Array.from({ length: 8 }, (_, i) => final('AAA', 'BBB', 110 + i, 120));
  finals.push(final('AAA', 'BBB', 200, 50, { postseason: true }), final('AAA', 'BBB', 200, 50, { season: 2025 }));
  const def = defenceRanks(finals, 2026);
  assert.deepEqual(def.get('AAA'), { rank: 2, of: 2, value: 120 });
  assert.equal(def.get('BBB')!.value, 113.5);

  const teamGames = [['x'], ['x', 'm'], ['x'], ['x', 'm'], ['x']].map((ids, i) => ({ matchId: `g${i}`, players: new Map(ids.map((id) => [id, 20])) }));
  const split = teammateSplit(teamGames, 'm')!;
  assert.deepEqual([...split.played], ['g1', 'g3']);
  assert.deepEqual([...split.missed], ['g2', 'g4'], 'games before he joined are not games he missed');
  assert.equal(teammateSplit(teamGames, 'never'), null);
});

const NOW = Date.parse('2026-11-16T22:00:00Z');
const H = 3_600_000;

function cand(over: Partial<AiCandidate> = {}): AiCandidate {
  const c: AiCandidate = {
    key: '',
    sport: 'nba',
    eventKey: 'g1',
    eventLabel: 'Chicago Bulls @ Cleveland Cavaliers',
    startsAt: new Date(NOW + 2 * H).toISOString(),
    market: 'points',
    marketKind: 'main',
    player: 'Jarrett Allen',
    playerId: '1',
    team: 'Cleveland Cavaliers',
    side: 'over',
    line: 13.5,
    bestPrice: 1.87,
    bestBook: 'Sportsbet',
    quotes: [
      { book: 'Sportsbet', price: 1.87 },
      { book: 'TAB', price: 1.8 },
    ],
    modelProb: 0.61,
    marketProb: 0.52,
    prob: 0.58,
    pushProb: 0,
    ev: 0.0846,
    projection: 16,
    support: [],
    supportScore: null,
    singleEligible: true,
    multiEligible: true,
    flags: [],
    context: { marketSource: 'main' },
    ...over,
  };
  return { ...c, key: over.key ?? candidateKey(c) };
}

const qualified = (core = 2): PunterEntry['case'] => ({ side: 'over', stat: 'points', line: 13.5, angles: [], against: [], qualifies: true, core, matchup: 0.5 });
const entry = (over: Partial<AiCandidate> = {}, core = 2): PunterEntry => ({ c: punterCandidate(cand(over))!, case: qualified(core) });
const fresh = (over: Partial<PunterState> = {}): PunterState => ({
  recent: [],
  propsByGame: {},
  games: new Set(),
  keys: new Set(),
  players: new Set(),
  slateGames: 10,
  ...over,
});

test('the arm records the market chance, not the live model', () => {
  const c = punterCandidate(cand())!;
  assert.equal(c.prob, 0.52);
  assert.equal(c.ev, -0.0276);
  assert.equal(punterMarketEv(cand({ bestPrice: 2 })), 0.04);
  assert.equal(punterCandidate(cand({ marketProb: null })), null);
});

test('price discipline and timing', () => {
  const reason = (over: Partial<AiCandidate>) => {
    const r = punterEligible(cand(over), NOW);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason({}), 'ok');
  assert.equal(reason({ startsAt: new Date(NOW + 20 * H).toISOString() }), 'ok', 'bet when the case is found, not held for tip');
  assert.equal(reason({ startsAt: new Date(NOW + 25 * H).toISOString() }), 'Outside the posting window');
  assert.equal(reason({ startsAt: new Date(NOW + 10 * 60_000).toISOString() }), 'Outside the posting window');
  assert.equal(reason({ bestPrice: 1.6 }), 'Price outside 1.65 to 2.50');
  assert.equal(reason({ bestPrice: 2.6, marketProb: 0.38 }), 'Price outside 1.65 to 2.50');
  assert.equal(reason({ bestPrice: 1.8 }), 'ok', 'an ordinary bookmaker margin is paid, as the punter pays it');
  assert.equal(reason({ bestPrice: 1.75 }), "Best price is too far under the market's fair price");
  assert.equal(reason({ bestPrice: 2.3 }), 'Price too far over the market to trust');
  assert.equal(reason({ quotes: [{ book: 'Sportsbet', price: 1.87 }, { book: 'TAB', price: 1.87 }] }), 'Fewer than 2 books price it');
  assert.equal(reason({ marketKind: 'alternate' }), 'Not the main over/under line');
  assert.equal(reason({ context: { marketSource: 'milestone' } }), 'Not the main over/under line');
  assert.equal(reason({ sport: 'nbl' }), 'Not an NBA player prop');
  assert.equal(reason({ market: 'h2h', player: null }), 'Not an NBA player prop');
  assert.equal(reason({ flags: ['Has not played in his team\'s last 4 games'] }), "Has not played in his team's last 4 games");
  assert.equal(reason({ flags: ['Model and market differ by 22%', 'Edge of 30% is too big to trust'] }), 'ok', "the live model's disagreements are not this arm's");
  // A questionable player's over waits until 90 minutes out, as it does for the live picks.
  const questionable = { context: { marketSource: 'main', listedStatus: 'Questionable' } };
  assert.match(reason(questionable), /^Questionable/);
  assert.equal(reason({ ...questionable, startsAt: new Date(NOW + H).toISOString() }), 'ok');
  assert.match(reason({ ...questionable, startsAt: new Date(NOW + 20 * H).toISOString() }), /^Questionable/, 'only a pending game-time call waits');
  assert.equal(PUNTER_LIMITS.windowMs, 24 * H);
});

test('choice: most reasons first, price last; live NBA volume (3/run, 2/game, slate cap)', () => {
  const a = entry({ player: 'A', eventKey: 'g1' }, 2);
  const b = entry({ player: 'B', eventKey: 'g1', bestPrice: 1.95 }, 3);
  const c = entry({ player: 'C', eventKey: 'g2', bestPrice: 1.9 }, 2);
  const d = entry({ player: 'D', eventKey: 'g3', bestPrice: 1.95 }, 2);
  const e2 = entry({ player: 'E', eventKey: 'g1', bestPrice: 1.88 }, 3);
  const pick = (entries: PunterEntry[], state = fresh(), closed = new Set<string>()) => choosePunter(entries, state, NOW, closed).map((e) => e.c.player);

  assert.deepEqual(pick([a, b, c, d]), ['B', 'D', 'C'], 'B strongest; up to 3 a run like live NBA');
  assert.deepEqual(pick([a, b, e2, c]), ['B', 'E', 'C'], 'two props can share a game (live max 2)');
  assert.deepEqual(pick([a, b, c, d], fresh(), new Set([b.c.key])), ['D', 'C', 'A'], 'a turned-down key frees the slot');
  assert.deepEqual(pick([a, b, c, d], fresh({ propsByGame: { 'nba|g1': 2 } })), ['D', 'C'], 'game already at 2 props');
  assert.deepEqual(pick([a, b, c, d], fresh({ keys: new Set([d.c.key]) })), ['B', 'C', 'A']);
  assert.deepEqual(pick([a, b, c, d], fresh({ players: new Set(['b']) })), ['D', 'C', 'A'], 'one pick per player in the window');
  // Slate of 2 → cap 2; three already posted fills it unless a backup-core case opens a place.
  assert.deepEqual(pick([a, c], fresh({ slateGames: 2, recent: [NOW - H, NOW - 2 * H] })), []);
  assert.deepEqual(pick([b], fresh({ slateGames: 2, recent: [NOW - H, NOW - 2 * H] })), [], 'core 3 is not a backup place');
  const strong = entry({ player: 'S', eventKey: 'g9', bestPrice: 1.9 }, 4);
  assert.deepEqual(pick([strong], fresh({ slateGames: 2, recent: [NOW - H, NOW - 2 * H] })), ['S'], 'core 4 fills a backup place');
  assert.deepEqual(pick([{ ...b, case: { ...b.case, qualifies: false } }, entry({ player: 'E', eventKey: 'g4', bestPrice: 1.7 })]), [], 'neither qualifies: no reasons, bad price');
  assert.deepEqual(pick([{ ...a, case: { ...a.case, side: 'under' } }]), [], 'a case only backs its own side');
  assert.equal(PUNTER_LIMITS.perRun, 3);
});

test('the better case is chosen, not the better price', () => {
  const pick = (entries: PunterEntry[]) => choosePunter(entries, fresh(), NOW).map((e) => `${e.c.player} ${e.c.market}`);
  // One player, same reasons on two lines: the single stat, though the combined line pays more.
  const points = entry({ player: 'A', eventKey: 'g1', bestPrice: 1.8 }, 3);
  const combined = entry({ player: 'A', eventKey: 'g1', market: 'pra', line: 24.5, bestPrice: 1.95 }, 3);
  const pra = { ...combined, case: { ...combined.case, stat: 'pra' as const } };
  assert.deepEqual(pick([pra, points]), ['A points']);
  // More reasons still come first, combined or not.
  assert.deepEqual(pick([{ ...pra, case: { ...pra.case, core: 4 } }, points]), ['A pra']);
  // The combined line is taken when the single stat cannot be bet.
  assert.deepEqual(pick([pra, entry({ player: 'A', eventKey: 'g1', bestPrice: 1.6 }, 3)]), ['A pra']);
  // Two players, same number of reasons: the softer matchup, though the other pays more.
  const soft = entry({ player: 'B', eventKey: 'g2', bestPrice: 1.8 }, 3);
  const softer = { ...soft, case: { ...soft.case, matchup: 0.9 } };
  const priced = entry({ player: 'C', eventKey: 'g3', bestPrice: 1.95 }, 3);
  assert.deepEqual(pick([priced, softer]), ['B points', 'C points']);
  assert.ok(punterOrder(softer, priced) < 0 && punterOrder(priced, softer) > 0);
});

test('posted state counts only this arm', () => {
  const leg = (eventKey: string, player: string): AiPickLeg => ({
    id: 'l', pickId: 'p', legIndex: 0, sport: 'nba', eventKey, eventLabel: 'Chicago Bulls @ Cleveland Cavaliers', startsAt: new Date(NOW + H).toISOString(),
    market: 'points', marketKind: 'main', player, playerId: '1', team: 'Cleveland Cavaliers', side: 'over', line: 13.5, price: 1.87, bookmaker: 'Sportsbet',
    modelProb: 0.52, status: 'pending', resultValue: null, resultNote: null, closingLine: null, closingPrice: null, gradedAt: null,
  });
  const pick = (track: string | null, postedAt: number, eventKey: string, player: string): AiPick => ({
    id: `${track}-${eventKey}`, kind: 'single', sport: 'nba', title: '', writeUp: '', units: 1, price: 1.87, bookmaker: 'Sportsbet', modelProb: 0.52, ev: 0,
    status: 'pending', profitUnits: null, firstStartsAt: '', postedAt: new Date(postedAt).toISOString(), settledAt: null, modelVersion: null, track,
    legs: [leg(eventKey, player)], altBooks: [],
  });
  const state = punterPostedState(
    [pick('punter-v1', NOW - H, 'g1', 'Jarrett Allen'), pick('punter-v1', NOW - 30 * H, 'g0', 'Old Pick'), pick(null, NOW - H, 'g2', 'Live Pick'), pick('other-v1', NOW - H, 'g3', 'Other Arm')],
    NOW
  );
  assert.deepEqual(state.recent, [NOW - H]);
  assert.deepEqual([...state.games].sort(), ['nba|g0', 'nba|g1']);
  assert.deepEqual(state.propsByGame, { 'nba|g1': 1 });
  assert.deepEqual([...state.players], ['jarrett allen']);
  assert.ok(state.keys.has(cand().key), 'the same key the scan gives the selection');
  assert.equal(state.keys.size, 2);
});
