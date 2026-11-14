import assert from 'node:assert/strict';
import { test } from 'node:test';
import { armById, ARMS, ARM_MIN_BOOKS, B_MINUTES_Z_MIN, B_MIN_EV, B_USAGE_Z_MIN, bestAuPrice, C_MIN_EV, C_NEWS_MAX_AGE_MIN, D_MAX_EV, D_MIN_EV, roleShock, usFairAtLine, usInfoDirection, type ArmInput, type UsMoveInfo } from './arms';
import type { LoggedQuote } from './lines';
import { decide, MODEL_V0 } from './shadowRules';

const NOW = Date.parse('2026-11-15T00:05:00.000Z');
const q = (book: string, over: number, under: number, line = 8.5): LoggedQuote => ({ book, line, over, under, sourceTs: '2026-11-15T00:03:00.000Z', coherent: true });

/** Four offshore books at an even 1.91 / 1.91 (fair 0.5), plus the Australian quotes given. */
const board = (...au: LoggedQuote[]) => [q('draftkings', 1.91, 1.91), q('fanduel', 1.91, 1.91), q('caesars', 1.91, 1.91), q('betmgm', 1.91, 1.91), ...au];

function input(opts: {
  quotes: LoggedQuote[];
  trigger?: ArmInput['trigger'];
  features?: Record<string, unknown>;
  nBooks?: number;
  /** Books whose current price fails the phantom-price rule. */
  unconfirmed?: string[];
  /** When each book's current price was first seen (default: ten minutes ago). */
  seen?: Record<string, number | null>;
  fairOverUs?: number | null;
  usMove?: UsMoveInfo;
}): ArmInput {
  const quotes = opts.quotes;
  const top = (side: 'over' | 'under') => bestAuPrice({ stat: 'points', features: {}, nBooks: 0, bookDispersion: null, mainLine: 8.5, quotes }, side, () => true);
  return {
    trigger: opts.trigger ?? 't2h',
    line: { stat: 'points', features: opts.features ?? {}, nBooks: opts.nBooks ?? quotes.length, bookDispersion: 0.01, mainLine: 8.5, quotes },
    best: { over: top('over'), under: top('under') },
    confirmed: (_side, book) => !(opts.unconfirmed ?? []).includes(book),
    seenSince: (_side, book) => (opts.seen && book in opts.seen ? opts.seen[book]! : NOW - 10 * 60_000),
    fairOverUs: opts.fairOverUs ?? null,
    usMove: opts.usMove ?? null,
    nowMs: NOW,
  };
}

const A = armById('A');
const B = armById('B');
const C = armById('C');
const D = armById('D');

test('registry: four arms, each with its own versions, so their rows never collide', () => {
  assert.deepEqual(ARMS.map((a) => a.id), ['A', 'B', 'C', 'D']);
  assert.equal(new Set(ARMS.map((a) => a.policyVersion)).size, 4);
  assert.equal(new Set(ARMS.map((a) => a.coefs.version)).size, 4);
});

test('arm A is the sample that was already running: same versions, same triggers, same rule', () => {
  assert.equal(A.policyVersion, 'shadow-v0.1');
  assert.equal(A.coefs.version, 'v0-market');
  assert.equal(A.coefs, MODEL_V0);
  assert.deepEqual(A.triggers, ['t2h', 'injury_change']);
  const quotes = [q('sportsbet', 2.2, 1.7), q('draftkings', 1.9, 1.9), q('fanduel', 1.92, 1.88)];
  const inp = input({ quotes, unconfirmed: ['sportsbet'] });
  const before = decide({ coefs: MODEL_V0, line: inp.line, best: inp.best, confirmed: inp.confirmed });
  const now = A.decide(inp);
  assert.ok(before && now);
  assert.deepEqual({ ...now, tags: undefined }, { ...before, tags: undefined });
  assert.equal(now!.confirmed, false, 'an unconfirmed price is still recorded, flagged, as before');
  assert.equal(A.decide(input({ quotes: board(q('sportsbet', 1.9, 1.9)) })), null, 'no edge, no bet');
});

test('arm D: best confirmed price against a real consensus, one flat bar and a ceiling', () => {
  assert.equal(D.coefs.minEv, D_MIN_EV);
  assert.deepEqual(D.triggers, ['t2h']);
  const quotes = board(q('sportsbet', 2.12, 1.72), q('tab', 2.08, 1.75));
  const bet = D.decide(input({ quotes }))!;
  assert.equal(bet.book, 'sportsbet');
  assert.equal(bet.side, 'over');
  assert.ok(bet.ev >= D_MIN_EV && bet.confirmed);
  // The top price is a phantom: the next confirmed price is the bet, judged with that book left out.
  const next = D.decide(input({ quotes, unconfirmed: ['sportsbet'] }))!;
  assert.equal(next.book, 'tab');
  assert.equal(next.price, 2.08);
  assert.equal(D.decide(input({ quotes, unconfirmed: ['sportsbet', 'tab'] })), null, 'nothing confirmed, nothing bet');
  assert.equal(D.decide(input({ quotes, nBooks: ARM_MIN_BOOKS - 1 })), null, 'too few books for a consensus');
  assert.equal(D.decide(input({ quotes: board(q('sportsbet', 1.98, 1.8)) })), null, 'below the bar');
  const tooGood = D.decide(input({ quotes: board(q('sportsbet', 2.6, 1.5)) }));
  assert.equal(tooGood, null, `an edge above ${D_MAX_EV} over four books is a feed error`);
  // No inputs: a role shock changes nothing for D.
  assert.deepEqual(D.decide(input({ quotes, features: { minutes_new_info_z: -1 } }))!.side, 'over');
});

test('arm B: role shock picks the side; no shock, no bet', () => {
  assert.deepEqual(B.triggers, ['t2h']);
  assert.equal(roleShock({}), null, 'no inputs logged');
  assert.equal(roleShock({ minutes_new_info_z: B_MINUTES_Z_MIN - 0.01, usage_shift_z: B_USAGE_Z_MIN - 0.01 }), null);
  assert.equal(roleShock({ minutes_new_info_z: B_MINUTES_Z_MIN })!.shock, 'minutes_up');
  assert.equal(roleShock({ minutes_new_info_z: 0.02, usage_shift_z: B_USAGE_Z_MIN })!.shock, 'usage_up');
  assert.equal(roleShock({ minutes_new_info_z: -B_MINUTES_Z_MIN })!.side, 'under');
  assert.equal(roleShock({ minutes_new_info_z: -0.3, usage_shift_z: 0.2 }), null, 'minutes down and usage up disagree');

  // A big price on the under, but the shock points up: only the over is considered.
  const quotes = board(q('sportsbet', 2.0, 2.3), q('tab', 1.95, 1.8));
  assert.equal(B.decide(input({ quotes, features: { minutes_new_info_z: 0.01, usage_shift_z: 0 } })), null, 'an ordinary night');
  const up = B.decide(input({ quotes, features: { minutes_new_info_z: 0.4, usage_shift_z: 0 } }))!;
  assert.equal(up.side, 'over');
  assert.equal(up.book, 'sportsbet');
  assert.ok(up.ev >= B_MIN_EV);
  assert.equal(up.tags.reason, 'minutes_up');
  const down = B.decide(input({ quotes, features: { minutes_new_info_z: -0.4 } }))!;
  assert.equal(down.side, 'under');
  assert.equal(down.tags.reason, 'minutes_down');
});

test('arm B: the price must be confirmed and no worse than fair', () => {
  const features = { minutes_new_info_z: 0.4 };
  assert.equal(B.decide(input({ quotes: board(q('sportsbet', 1.95, 1.85)), features })), null, 'a price under fair is not taken');
  const quotes = board(q('sportsbet', 2.05, 1.75), q('tab', 2.0, 1.8));
  assert.equal(B.decide(input({ quotes, features, unconfirmed: ['sportsbet', 'tab'] })), null);
  assert.equal(B.decide(input({ quotes, features, unconfirmed: ['sportsbet'] }))!.book, 'tab', 'falls to the best confirmed price');
  assert.equal(B.decide(input({ quotes, features, nBooks: ARM_MIN_BOOKS - 1 })), null);
});

const move = (from: [number, number], to: [number, number], other?: { from: [number, number]; to: [number, number] }): UsMoveInfo => ({
  movedAt: new Date(NOW - 60_000).toISOString(),
  books: [
    { from: { line: from[0], fairOver: from[1] }, to: { line: to[0], fairOver: to[1] } },
    { from: { line: (other?.from ?? from)[0], fairOver: (other?.from ?? from)[1] }, to: { line: (other?.to ?? to)[0], fairOver: (other?.to ?? to)[1] } },
  ],
});

test('US move information: line up or over shorter is more, and both books must agree', () => {
  assert.equal(usInfoDirection(move([8.5, 0.5], [8.5, 0.56])), 1);
  assert.equal(usInfoDirection(move([8.5, 0.5], [9.5, 0.5])), 1, 'a higher line expects more');
  assert.equal(usInfoDirection(move([8.5, 0.5], [7.5, 0.5])), -1, 'a lower line expects less');
  assert.equal(usInfoDirection(move([8.5, 0.5], [8.5, 0.44])), -1);
  // One book drops its line while the other shortens the over: they say opposite things.
  assert.equal(usInfoDirection(move([8.5, 0.5], [7.5, 0.5], { from: [8.5, 0.5], to: [8.5, 0.56] })), 0);
  assert.equal(usInfoDirection({ movedAt: null, books: [{ from: { line: 8.5, fairOver: 0.5 }, to: { line: 8.5, fairOver: 0.56 } }] }), 0, 'one book alone is noise');
});

test('US fair carried to the Australian line', () => {
  assert.equal(usFairAtLine(move([8.5, 0.5], [8.5, 0.56]), 8.5, undefined), 0.56, 'same line needs no projection');
  const carried = usFairAtLine(move([8.5, 0.5], [9.5, 0.5]), 8.5, { mean: 9, sd: 4 })!;
  assert.ok(carried > 0.5 && carried < 0.75, `even money at 9.5 is odds-on at 8.5 (${carried})`);
  assert.equal(usFairAtLine(move([8.5, 0.5], [9.5, 0.5]), 8.5, undefined), null, 'a moved line needs the spread to carry it');
});

test('arm C on a US move: bets the side the US moved to, at an Australian price that predates the move', () => {
  assert.deepEqual(C.triggers, ['injury_change', 'us_move']);
  const quotes = board(q('sportsbet', 2.0, 1.8), q('tab', 1.9, 1.9));
  const usMove = move([8.5, 0.5], [8.5, 0.56]);
  const bet = C.decide(input({ quotes, trigger: 'us_move', usMove }))!;
  assert.equal(bet.side, 'over');
  assert.equal(bet.book, 'sportsbet');
  assert.ok(Math.abs(bet.prob - 0.56) < 1e-9, 'scored with the US fair after the move');
  assert.ok(Math.abs(bet.ev - (0.56 * 2.0 - 1)) < 1e-9 && bet.ev >= C_MIN_EV);
  assert.ok(Math.abs(bet.fair - 0.5) < 1e-6, 'the consensus fair at decision is still recorded for CLV');
  assert.equal(bet.tags.reason, 'us_move');

  const afterMove = { sportsbet: NOW - 10_000, tab: NOW - 10_000 };
  assert.equal(C.decide(input({ quotes, trigger: 'us_move', usMove, seen: afterMove })), null, 'a price posted after the move has already reacted');
  assert.equal(C.decide(input({ quotes, trigger: 'us_move', usMove, seen: { sportsbet: null, tab: null } })), null, 'a new or changed price is not stale');
  assert.equal(C.decide(input({ quotes, trigger: 'us_move', usMove, unconfirmed: ['sportsbet', 'tab'] })), null, 'phantom prices do not count');
  assert.equal(C.decide(input({ quotes, trigger: 'us_move', usMove: move([8.5, 0.5], [7.5, 0.5], { from: [8.5, 0.5], to: [8.5, 0.56] }) })), null, 'US books disagree');
  assert.equal(C.decide(input({ quotes, trigger: 'us_move' })), null, 'no move detail, no bet');
  assert.equal(C.decide(input({ quotes: board(q('sportsbet', 1.8, 2.0)), trigger: 'us_move', usMove })), null, `under ${C_MIN_EV} against the US fair`);
  const down = C.decide(input({ quotes: board(q('sportsbet', 1.8, 2.0)), trigger: 'us_move', usMove: move([8.5, 0.5], [8.5, 0.44]) }))!;
  assert.equal(down.side, 'under');
  assert.equal(C.decide(input({ quotes, trigger: 'us_move', usMove, nBooks: ARM_MIN_BOOKS - 1 })), null);
});

test('arm C on injury news: fresh teammate news only, in its direction, against the US fair', () => {
  const quotes = board(q('sportsbet', 2.0, 1.8));
  const fresh = { teammate_news_age_ln: Math.log1p(5), teammate_news_dir: 1, teammate_news_id: '77' };
  const bet = C.decide(input({ quotes, trigger: 'injury_change', features: fresh, fairOverUs: 0.55 }))!;
  assert.equal(bet.side, 'over', 'a teammate moving toward out points to the over');
  assert.ok(Math.abs(bet.prob - 0.55) < 1e-9);
  assert.equal(bet.tags.reason, 'teammate_news');
  assert.equal(bet.tags.news_player, '77');
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: { ...fresh, teammate_news_age_ln: 0 }, fairOverUs: 0.55 }))!.side, 'over', 'news seen this run has age zero');

  const stale = { ...fresh, teammate_news_age_ln: Math.log1p(C_NEWS_MAX_AGE_MIN + 1) };
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: stale, fairOverUs: 0.55 })), null, 'old news');
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: {}, fairOverUs: 0.55 })), null, 'a snapshot for someone else in the game');
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: fresh, fairOverUs: null })), null, 'no US price to measure the lag against');
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: fresh, fairOverUs: 0.5 })), null, 'the US has not moved: nothing to lag');
  // The price went up after the news was seen: not a stale price.
  assert.equal(C.decide(input({ quotes, trigger: 'injury_change', features: fresh, fairOverUs: 0.55, seen: { sportsbet: NOW - 60_000 } })), null);
  const back = C.decide(input({ quotes: board(q('sportsbet', 1.8, 2.0)), trigger: 'injury_change', features: { ...fresh, teammate_news_dir: -1 }, fairOverUs: 0.45 }))!;
  assert.equal(back.side, 'under', 'a teammate coming back points to the under');
  assert.equal(C.decide(input({ quotes, trigger: 't2h', features: fresh, fairOverUs: 0.55 })), null, 'never on the scheduled snapshot');
});
