import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ARMS, type Arm } from './arms';
import type { LoggedLine, LoggedQuote } from './lines';
import { dropRepeatNews, memoryKey, wouldBeBets, type Trigger } from './shadowBets';
import { closingValue, decide, MODEL_V0, type PriceMemory } from './shadowRules';

const NOW = Date.parse('2026-11-15T00:05:00.000Z');
const TIP = '2026-11-15T01:00:00.000Z';
const q = (book: string, over: number, under: number): LoggedQuote => ({ book, line: 8.5, over, under, sourceTs: '2026-11-15T00:03:00.000Z', coherent: true });

function line(stat: LoggedLine['stat'], au: LoggedQuote[]): LoggedLine {
  const quotes = [q('draftkings', 1.91, 1.91), q('fanduel', 1.91, 1.91), q('caesars', 1.91, 1.91), q('betmgm', 1.91, 1.91), ...au];
  const top = (side: 'over' | 'under') => [...au].sort((a, b) => b[side]! - a[side]!)[0];
  return {
    boardName: 'Test Player',
    player: { id: '7', name: 'Test Player', teamCode: 'PHI' },
    stat,
    mainLine: 8.5,
    quotes,
    nBooks: quotes.length,
    bookDispersion: 0.01,
    fairOverAll: 0.5,
    fairOverAllMult: 0.5,
    fairOverUs: 0.56,
    fairOverPinnacle: null,
    fairOverAu: null,
    bestAuOver: top('over') ? { price: top('over')!.over!, book: top('over')!.book } : null,
    bestAuUnder: top('under') ? { price: top('under')!.under!, book: top('under')!.book } : null,
  };
}

function trigger(id: string, kind: Trigger['kind'], l: LoggedLine, features: Record<string, unknown> = {}, extra: Partial<Trigger> = {}): Trigger {
  return {
    snapshotId: id,
    kind,
    row: { game_id: 'g1', tip_at: TIP, player_id: l.player?.id ?? null, stat: l.stat, main_line: l.mainLine, n_books: l.nBooks, bookDispersion: undefined, book_dispersion: l.bookDispersion, features, model_version: 'none', feature_version: 'inputs-v6' } as Trigger['row'],
    line: l,
    ...extra,
  };
}

/** Every Australian price was up, unchanged, ten minutes ago. */
function memoryFor(lines: LoggedLine[]): Record<string, PriceMemory> {
  const seenAt = new Date(NOW - 10 * 60_000).toISOString();
  return Object.fromEntries(lines.map((l) => [memoryKey('g1', l.boardName, l.stat), Object.fromEntries(l.quotes.map((x) => [x.book, { over: x.over, under: x.under, seenAt }]))]));
}

const conflictKey = (b: { policy: string; policy_version: string; trigger_snapshot_id: string; side: string }) => `${b.policy}|${b.policy_version}|${b.trigger_snapshot_id}|${b.side}`;

test('one trigger, several arms: each records its own row and none overwrites another', () => {
  const l = line('points', [q('sportsbet', 2.12, 1.72)]);
  const t = trigger('snap-1', 't2h', l, { minutes_new_info_z: 0.4, usage_shift_z: 0 });
  const { bets, errors } = wouldBeBets([t], memoryFor([l]), NOW);
  assert.deepEqual(errors, []);
  // A (control), B (role shock up, over at a fair-or-better price) and D (confirmed +EV) all bet it; C never bets t2h.
  assert.deepEqual(bets.map((b) => b.features.arm).sort(), ['A', 'B', 'D']);
  assert.equal(new Set(bets.map(conflictKey)).size, bets.length, 'the table key (policy, policy_version, trigger, side) is distinct per arm');
  for (const b of bets) {
    const arm = ARMS.find((a) => a.id === b.features.arm)!;
    assert.equal(b.policy, 'main');
    assert.equal(b.policy_version, arm.policyVersion);
    assert.equal(b.model_version, arm.coefs.version);
    assert.equal(b.trigger_snapshot_id, 'snap-1');
    assert.equal(b.features.trigger, 't2h');
    assert.equal(b.features.minutes_new_info_z, 0.4, 'every arm keeps the same logged inputs');
  }
});

test("arm A's row is what the single-policy code recorded before", () => {
  const l = line('points', [q('sportsbet', 2.12, 1.72)]);
  const t = trigger('snap-1', 't2h', l, { minutes_new_info_z: 0.4 });
  const a = wouldBeBets([t], {}, NOW).bets.find((b) => b.features.arm === 'A')!;
  const before = decide({ coefs: MODEL_V0, line: { stat: 'points', features: t.row.features, nBooks: l.nBooks, bookDispersion: l.bookDispersion, mainLine: 8.5, quotes: l.quotes }, best: { over: l.bestAuOver, under: l.bestAuUnder }, confirmed: () => false })!;
  assert.equal(a.policy_version, 'shadow-v0.1');
  assert.equal(a.model_version, 'v0-market');
  assert.equal(a.side, before.side);
  assert.equal(a.price, before.price);
  assert.equal(a.book, before.book);
  assert.equal(a.price_confirmed, false, 'with no price memory the bet is recorded unconfirmed, as before');
  assert.equal(a.model_prob, Math.round(before.prob * 10000) / 10000);
  assert.equal(a.fair_at_decision, Math.round(before.fair * 10000) / 10000);
  assert.equal(a.features.ev, Math.round(before.ev * 10000) / 10000);
});

test('an arm that throws loses only its own rows', () => {
  const l = line('points', [q('sportsbet', 2.12, 1.72)]);
  const t = trigger('snap-1', 't2h', l, { minutes_new_info_z: 0.4 });
  const broken: Arm = { ...ARMS[1]!, decide: () => { throw new Error('boom'); } };
  const { bets, errors } = wouldBeBets([t], memoryFor([l]), NOW, [ARMS[0]!, broken, ARMS[3]!]);
  assert.deepEqual(bets.map((b) => b.features.arm).sort(), ['A', 'D']);
  assert.deepEqual(errors, ['arm B: boom']);
});

test('each arm only sees its own kinds of trigger; event bets are filed as news', () => {
  const l = line('points', [q('sportsbet', 2.12, 1.72)]);
  const usMove = { movedAt: new Date(NOW - 60_000).toISOString(), books: [0, 1].map(() => ({ from: { line: 8.5, fairOver: 0.5 }, to: { line: 8.5, fairOver: 0.56 } })) };
  const triggers = [
    trigger('snap-us', 'us_move', l, {}, { usMove }),
    trigger('snap-inj', 'injury_change', l, { teammate_news_age_ln: 0, teammate_news_dir: 1 }),
  ];
  const { bets } = wouldBeBets(triggers, memoryFor([l]), NOW);
  const of = (id: string) => bets.filter((b) => b.trigger_snapshot_id === id).map((b) => b.features.arm).sort();
  assert.deepEqual(of('snap-us'), ['C'], 'only the news-lag arm takes US moves');
  assert.deepEqual(of('snap-inj'), ['A', 'C'], 'the control keeps its news policy; B and D are main-only');
  assert.ok(bets.every((b) => b.policy === 'news'));
  assert.equal(bets.find((b) => b.trigger_snapshot_id === 'snap-us')!.features.trigger, 'us_move');
  assert.equal(new Set(bets.map(conflictKey)).size, bets.length);
});

test('unmatched names are never bet', () => {
  const l = { ...line('points', [q('sportsbet', 2.12, 1.72)]), player: null };
  assert.deepEqual(wouldBeBets([trigger('s', 't2h', l)], {}, NOW).bets, []);
});

test('news: one bet per arm, player, stat and side per game, whatever triggered it', () => {
  const l = line('points', [q('sportsbet', 2.12, 1.72)]);
  const usMove = { movedAt: new Date(NOW - 60_000).toISOString(), books: [0, 1].map(() => ({ from: { line: 8.5, fairOver: 0.5 }, to: { line: 8.5, fairOver: 0.56 } })) };
  const triggers = [
    trigger('snap-inj', 'injury_change', l, { teammate_news_age_ln: 0, teammate_news_dir: 1 }),
    trigger('snap-us', 'us_move', l, {}, { usMove }),
    trigger('snap-main', 't2h', l),
  ];
  const { bets } = wouldBeBets(triggers, memoryFor([l]), NOW);
  const armC = ARMS.find((a) => a.id === 'C')!;
  assert.equal(bets.filter((b) => b.features.arm === 'C').length, 2);
  const kept = dropRepeatNews(bets, []);
  assert.equal(kept.filter((b) => b.features.arm === 'C').length, 1, 'the US move does not bet the line the injury news already bet');
  assert.equal(kept.filter((b) => b.features.arm === 'C')[0]!.trigger_snapshot_id, 'snap-inj');
  assert.equal(kept.filter((b) => b.policy === 'main').length, bets.filter((b) => b.policy === 'main').length, 'main bets are never dropped');
  // Arm C already bet this line earlier in the game; arm A did not. Only C's repeat is dropped.
  const prior = [{ policy_version: armC.policyVersion, game_id: 'g1', player_id: '7', stat: 'points', side: 'over' }];
  const after = dropRepeatNews(bets, prior);
  assert.equal(after.filter((b) => b.features.arm === 'C').length, 0);
  assert.equal(after.filter((b) => b.features.arm === 'A' && b.policy === 'news').length, 1, "another arm's earlier bet does not block this arm");
});

test('closing value: same-line bet scored against the close with the bet book left out', () => {
  const close = [q('draftkings', 1.8, 2.02), q('fanduel', 1.8, 2.02), q('sportsbet', 2.3, 1.6)];
  const bet = { side: 'over' as const, line: 8.5, price: 2.1, book: 'sportsbet', fairAtDecision: 0.5, projection: { mean: 9, sd: 4 } };
  const clv = closingValue(bet, 8.5, close) as { total: number; a: number; b: number; sameLine: boolean; closeFair: number };
  assert.equal(clv.sameLine, true);
  assert.ok(clv.closeFair > 0.5, "the close moved toward the over, without the bet book's own price");
  assert.ok(Math.abs(clv.a - (0.5 * 2.1 - 1)) < 1e-3, '(a) is the price against the decision-time fair');
  assert.ok(clv.b > 0 && Math.abs(clv.total - (clv.a + clv.b)) < 2e-4);
  assert.deepEqual(closingValue(bet, 8.5, [q('sportsbet', 2.3, 1.6)]), { missing: 'no close fair' });
  assert.deepEqual(closingValue({ ...bet, projection: null }, 8.5, close), { missing: 'no projection spread' });
});
