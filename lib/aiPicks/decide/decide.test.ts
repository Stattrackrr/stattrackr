import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { AiCandidate } from '../candidates/types';
import { candidateKey } from '../candidates/types';
import { DEFAULT_AI_PICKS_PARAMS as P } from '../params';
import type { AiPick } from '../types';
import { aiDayKey, gameIdentity, readiness, type WatchPoint } from './timing';
import { chooseMulti, chooseSingles, multiKey, qualifiesSingle, subjectId, type PostedState, type Watched } from './select';
import { isClosedRow, nextWatchRow, postedState, watchBatches } from './watch';
import { parseReview } from './review';
import { pickTitle } from '../format';

const NOW = Date.parse('2026-10-14T02:00:00Z');
const H = 3_600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function cand(over: Partial<AiCandidate> = {}): AiCandidate {
  const c: AiCandidate = {
    key: '',
    sport: 'tennis',
    eventKey: 'm1',
    eventLabel: 'A. One vs B. Two',
    startsAt: iso(NOW + 4 * H),
    market: 'total_games',
    marketKind: 'main',
    player: null,
    playerId: 'p1',
    team: 'B. Two',
    side: 'over',
    line: 21.5,
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
    ev: 0.0725,
    projection: null,
    support: [],
    supportScore: 0.6,
    singleEligible: true,
    multiEligible: true,
    flags: [],
    context: {},
    ...over,
  };
  return { ...c, key: over.key ?? candidateKey(c) };
}

const held = (price = 1.95, ev = 0.07): WatchPoint[] => [
  { at: iso(NOW - 15 * 60_000), price, prob: 0.55, ev },
  { at: iso(NOW), price, prob: 0.55, ev },
];

const empty = (): PostedState => ({
  singlesRecent: {},
  multisRecent: [],
  usedKeys: new Set(),
  singleGamesRecent: new Set(),
  playersRecent: new Set(),
  selectionsBacked: new Set(),
  subjectsUsed: new Set(),
});

test('day boundary is Sydney time', () => {
  assert.equal(aiDayKey('2026-10-14T12:59:00Z'), '2026-10-14');
  assert.equal(aiDayKey('2026-10-14T13:01:00Z'), '2026-10-15');
});

test('NBL game identity ignores source naming; tennis uses the match id', () => {
  const props = { sport: 'nbl', eventKey: 'x', eventLabel: 'New Zealand Breakers @ Sydney Kings', startsAt: '2026-10-14T08:30:00Z' };
  const lines = { ...props, eventKey: 'y', eventLabel: 'NZ Breakers @ Sydney Kings', startsAt: '2026-10-14T08:35:00Z' };
  assert.equal(gameIdentity(props), gameIdentity(lines));
  assert.notEqual(gameIdentity({ ...props, sport: 'tennis' }), gameIdentity({ ...lines, sport: 'tennis' }));
});

test('readiness: second look, window, shortening price, strong edge', () => {
  const opts = { nowMs: NOW, postWindowHours: 6, minEv: 0.03 };
  const far = { startsAt: iso(NOW + 12 * H), ev: 0.05, bestPrice: 1.95 };
  assert.equal(readiness(far, held().slice(-1), opts).reason, 'Waiting for a second look');
  assert.equal(readiness(far, held(), opts).ready, false);
  assert.equal(readiness({ ...far, startsAt: iso(NOW + 3 * H) }, held(), opts).ready, true);
  const shortening = [{ at: iso(NOW - 2 * H), price: 2.1, prob: 0.5, ev: 0.05 }, ...held()];
  assert.match(readiness(far, shortening, opts).reason, /shortening/);
  const strong = [{ at: iso(NOW - 30 * 60_000), price: 1.95, prob: 0.6, ev: 0.08 }, ...held(1.95, 0.08)];
  assert.match(readiness({ ...far, ev: 0.08 }, strong, opts).reason, /Strong/);
  assert.equal(readiness({ ...far, startsAt: iso(NOW + 10 * 60_000) }, held(), opts).ready, false);
});

test('singles: NBL props wait for over/under lines; two books needed', () => {
  const prop = cand({ sport: 'nbl', market: 'points', player: 'X', context: { marketSource: 'milestone' } });
  assert.equal(qualifiesSingle(prop, P, NOW).ok, false);
  assert.equal(qualifiesSingle({ ...prop, context: { marketSource: 'main' } }, P, NOW).ok, true);
  assert.equal(qualifiesSingle(cand({ quotes: [{ book: 'A', price: 1.95 }] }), P, NOW).ok, false);
  const copied = qualifiesSingle(cand({ quotes: [{ book: 'Sportsbet', price: 1.95 }, { book: 'Palmerbet', price: 1.95 }] }), P, NOW);
  assert.deepEqual(copied, { ok: false, reason: 'Fewer than 2 books price it' }, 'two books on one feed are one price');
  assert.equal(qualifiesSingle(cand({ ev: 0.01 }), P, NOW).ok, false);
  assert.equal(qualifiesSingle(cand({ startsAt: iso(NOW + 30 * H) }), P, NOW).ok, false);
});

test('singles: one per sport per run, one per game, no opposite side', () => {
  const near = iso(NOW + 2 * H);
  const a = cand({ eventKey: 'm1', startsAt: near, ev: 0.08 });
  const b = cand({ eventKey: 'm2', startsAt: near, ev: 0.06 });
  const w: Watched[] = [a, b].map((c) => ({ c, history: held() }));
  assert.deepEqual(chooseSingles(w, P, empty(), NOW).map((p) => p.key), [a.key]);

  const sameGame = { ...empty(), singleGamesRecent: new Set([gameIdentity(a)]) };
  assert.deepEqual(chooseSingles(w, P, sameGame, NOW).map((p) => p.key), [b.key]);

  const under = cand({ eventKey: 'm1', startsAt: near, side: 'under' });
  const backed = { ...empty(), selectionsBacked: new Set<string>() };
  backed.selectionsBacked.add(`${gameIdentity(under)}|total_games|`);
  assert.deepEqual(chooseSingles(w, P, backed, NOW).map((p) => p.key), [b.key]);
});

test('singles: spaced through the day, capped per 24h, standouts get the shorter gap and the ceiling', () => {
  const near = iso(NOW + 2 * H);
  const normal = cand({ eventKey: 'm1', startsAt: near, ev: 0.05 });
  const standout = cand({ eventKey: 'm2', startsAt: near, ev: 0.07 });
  const pick = (cs: AiCandidate[], singlesRecent: Record<string, number[]>) =>
    chooseSingles(cs.map((c) => ({ c, history: held() })), P, { ...empty(), singlesRecent }, NOW).map((p) => p.key);

  assert.deepEqual(pick([normal], { tennis: [NOW - 2 * H] }), [], 'normal single waits 3h after the last');
  assert.deepEqual(pick([normal], { tennis: [NOW - 3 * H] }), [normal.key]);
  assert.deepEqual(pick([normal, standout], { tennis: [NOW - 90 * 60_000] }), [standout.key], 'standout only needs 1h');
  assert.deepEqual(pick([standout], { tennis: [NOW - 30 * 60_000] }), []);

  const three = [NOW - 20 * H, NOW - 12 * H, NOW - 4 * H];
  assert.deepEqual(pick([normal], { tennis: three }), [], 'normal cap of 3 in 24h');
  assert.deepEqual(pick([standout], { tennis: three }), [standout.key], 'standout may go past the cap');
  assert.deepEqual(pick([standout], { tennis: [NOW - 22 * H, NOW - 18 * H, ...three] }), [], 'hard ceiling of 5');
  assert.deepEqual(pick([normal], { nbl: three }), [normal.key], 'caps are per sport');
});

test('multis: capped per 24h and spaced', () => {
  const a = cand({ eventKey: 'm1', startsAt: iso(NOW + 2 * H), bestPrice: 1.45, prob: 0.74, ev: 0.073, quotes: [{ book: 'Bet365', price: 1.45 }, { book: 'TAB', price: 1.4 }] });
  const b = cand({ eventKey: 'm2', startsAt: iso(NOW + 5 * H), bestPrice: 1.4, prob: 0.76, ev: 0.064, quotes: [{ book: 'TAB', price: 1.4 }, { book: 'bet365', price: 1.38 }] });
  const w: Watched[] = [a, b].map((c) => ({ c, history: held() }));
  const multi = (multisRecent: number[]) => chooseMulti(w, P, { ...empty(), multisRecent }, NOW, { keys: new Set(), rejected: new Set() });
  assert.ok(multi([NOW - 4 * H]));
  assert.equal(multi([NOW - 2 * H]), null);
  assert.equal(multi([NOW - 20 * H, NOW - 12 * H, NOW - 4 * H]), null);
});

test('multi: separate games, priced at one book, at least 1.65', () => {
  const near = iso(NOW + 2 * H);
  const a = cand({ eventKey: 'm1', startsAt: near, bestPrice: 1.45, prob: 0.74, ev: 0.073, quotes: [{ book: 'Bet365', price: 1.45 }, { book: 'TAB', price: 1.4 }] });
  const b = cand({ eventKey: 'm2', startsAt: iso(NOW + 5 * H), bestPrice: 1.4, prob: 0.76, ev: 0.064, quotes: [{ book: 'TAB', price: 1.4 }, { book: 'bet365', price: 1.38 }] });
  const sameGame = cand({ eventKey: 'm1', market: 'player_games', player: 'A. One', startsAt: near, prob: 0.8, ev: 0.12, quotes: [{ book: 'Bet365', price: 1.4 }, { book: 'TAB', price: 1.38 }] });
  const w: Watched[] = [a, b, sameGame].map((c) => ({ c, history: held() }));
  const m = chooseMulti(w, P, empty(), NOW, { keys: new Set(), rejected: new Set() })!;
  assert.ok(m);
  assert.deepEqual(m.legs.map((l) => l.c.eventKey).sort(), ['m1', 'm2']);
  assert.equal(new Set(m.legs.map((l) => l.book.toLowerCase())).size, 1);
  assert.ok(m.price >= 1.65);
  assert.equal(m.key, multiKey(m.legs.map((l) => l.c.key)));

  assert.equal(chooseMulti(w, P, empty(), NOW, { keys: new Set(), rejected: new Set([m.key]) })?.key === m.key, false);
  assert.equal(chooseMulti(w, P, { ...empty(), multisRecent: [NOW - 20 * H, NOW - 12 * H, NOW - 4 * H] }, NOW, { keys: new Set(), rejected: new Set() }), null);

  const short = [a, cand({ ...b, key: undefined, eventKey: 'm3', bestPrice: 1.1, prob: 0.95, ev: 0.045, quotes: [{ book: 'TAB', price: 1.1 }, { book: 'Bet365', price: 1.09 }] })];
  assert.equal(chooseMulti(short.map((c) => ({ c, history: held() })), P, empty(), NOW, { keys: new Set(), rejected: new Set() }), null);
});

test('one pick per subject: a tennis match, an NBL player in a game, an NBL game', () => {
  const near = iso(NOW + 2 * H);
  const handicap = cand({ eventKey: 'm1', market: 'game_handicap', player: 'A. One', side: 'yes', line: 5.5, startsAt: near });
  const games = cand({ eventKey: 'm1', market: 'player_games', player: 'A. One', side: 'over', line: 7.5, startsAt: near });
  const opponent = cand({ eventKey: 'm1', market: 'player_games', player: 'B. Two', side: 'under', line: 9.5, startsAt: near });
  assert.equal(subjectId(handicap), subjectId(games));
  assert.equal(subjectId(handicap), subjectId(opponent));

  const nbl = { sport: 'nbl', eventKey: 'g', eventLabel: 'NZ Breakers @ Sydney Kings', startsAt: near };
  const pts = subjectId({ ...nbl, market: 'points', player: 'Jaylin Galloway' });
  assert.equal(pts, subjectId({ ...nbl, market: 'pra', player: 'jaylin galloway' }));
  assert.notEqual(pts, subjectId({ ...nbl, market: 'points', player: 'Kendric Davis' }));
  assert.equal(subjectId({ ...nbl, market: 'h2h', player: null }), subjectId({ ...nbl, market: 'total', player: null }));
  assert.notEqual(pts, subjectId({ ...nbl, market: 'h2h', player: null }));

  const used = { ...empty(), subjectsUsed: new Set([subjectId(handicap)]) };
  assert.equal(chooseSingles([{ c: games, history: held() }], P, used, NOW).length, 0);

  const other = cand({ eventKey: 'm2', startsAt: iso(NOW + 5 * H), bestPrice: 1.4, prob: 0.76, ev: 0.064, quotes: [{ book: 'TAB', price: 1.4 }, { book: 'Bet365', price: 1.38 }] });
  const leg = cand({ ...games, key: undefined, bestPrice: 1.45, prob: 0.74, ev: 0.073, quotes: [{ book: 'Bet365', price: 1.45 }, { book: 'TAB', price: 1.4 }] });
  const w: Watched[] = [leg, other].map((c) => ({ c, history: held() }));
  assert.ok(chooseMulti(w, P, empty(), NOW, { keys: new Set(), rejected: new Set() }));
  assert.equal(chooseMulti(w, P, used, NOW, { keys: new Set(), rejected: new Set() }), null);
  assert.equal(chooseMulti(w, P, empty(), NOW, { keys: new Set(), rejected: new Set(), subjects: new Set([subjectId(handicap)]) }), null);
});

test('watchlist saves: new and existing rows never share a batch', () => {
  const fresh = nextWatchRow(cand({ eventKey: 'm1' }), undefined, iso(NOW))!.row;
  const old = nextWatchRow(cand({ eventKey: 'm2' }), { ...fresh, candidate_key: 'x' }, iso(NOW))!.row;
  assert.ok('first_seen_at' in fresh);
  assert.ok(!('first_seen_at' in old));
  const batches = watchBatches([fresh, old, fresh, old, fresh], 2);
  for (const b of batches) assert.equal(new Set(b.map((r) => Object.keys(r).sort().join(','))).size, 1);
  assert.equal(batches.flat().length, 5);
  assert.ok(batches.every((b) => b.length <= 2));
});

test('watchlist: history grows, posted and review-rejected rows stay closed', () => {
  const c = cand();
  const first = nextWatchRow(c, undefined, iso(NOW))!;
  assert.equal(first.history.length, 1);
  assert.equal(first.row.first_seen_at, iso(NOW));
  const second = nextWatchRow(c, first.row, iso(NOW + 15 * 60_000))!;
  assert.equal(second.history.length, 2);
  assert.equal(second.row.first_seen_at, undefined);
  assert.equal(nextWatchRow(c, { ...first.row, status: 'posted' }, iso(NOW)), null);
  assert.equal(isClosedRow({ status: 'dropped', reason: 'AI review: thin minutes' }), true);
  assert.equal(isClosedRow({ status: 'dropped', reason: 'No longer qualifies' }), false);
});

test('posted state counts the last 24 hours and remembers used selections', () => {
  const leg = {
    id: 'l',
    pickId: 'p',
    legIndex: 0,
    sport: 'tennis',
    eventKey: 'm1',
    eventLabel: 'A. One vs B. Two',
    startsAt: iso(NOW + H),
    market: 'match_winner',
    marketKind: 'main' as const,
    player: 'A. One',
    playerId: 'p1',
    team: 'B. Two',
    side: 'yes' as const,
    line: null,
    price: 1.8,
    bookmaker: 'TAB',
    modelProb: 0.6,
    status: 'pending' as const,
    resultValue: null,
    resultNote: null,
    closingLine: null,
    closingPrice: null,
    gradedAt: null,
  };
  const pick = (postedAt: string, kind: 'single' | 'multi'): AiPick => ({
    id: postedAt,
    kind,
    sport: 'tennis',
    title: 't',
    writeUp: null,
    units: 1,
    price: 1.8,
    bookmaker: 'TAB',
    modelProb: 0.6,
    ev: 0.08,
    status: 'pending',
    profitUnits: null,
    firstStartsAt: leg.startsAt,
    postedAt,
    settledAt: null,
    modelVersion: 'v1',
    legs: [leg],
    altBooks: [],
  });
  const s = postedState(
    [pick(iso(NOW), 'single'), pick(iso(NOW - 23 * H), 'single'), pick(iso(NOW - 30 * H), 'single'), pick(iso(NOW), 'multi')],
    NOW
  );
  assert.deepEqual(s.singlesRecent.tennis, [NOW, NOW - 23 * H]);
  assert.deepEqual(s.multisRecent, [NOW]);
  assert.ok(s.usedKeys.has(candidateKey(leg)));
  assert.ok(s.playersRecent.has('tennis|a. one'));
  assert.ok(s.subjectsUsed.has(subjectId(leg)));
});

test('review parsing fails closed', () => {
  const ok = parseReview('{"reviews":[{"id":"P1","approve":true,"reason":"solid","writeUp":"Backing the over here, both have gone long lately."},{"id":"P2","approve":true,"writeUp":""}]}', 3);
  assert.equal(ok.get('P1')?.approve, true);
  assert.equal(ok.get('P2')?.approve, false);
  assert.equal(ok.has('P3'), false);
  assert.equal(parseReview('not json', 1).size, 0);
  assert.equal(parseReview('{"reviews":[{"id":"P9","approve":true,"writeUp":"xxxxxxxxxxxxxxxxxxxxxxxxx"}]}', 1).size, 0);
});

test('titles name the match for match-level tennis bets', () => {
  assert.equal(pickTitle([cand()]), 'A. One vs B. Two: over 21.5 total games');
  assert.equal(pickTitle([cand({ market: 'match_winner', player: 'A. One', side: 'yes', line: null })]), 'A. One to win');
});
