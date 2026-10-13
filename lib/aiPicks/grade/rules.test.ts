import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gradeHandicap, gradeNblGame, gradeNblProp, gradeOverUnder, gradeTennis } from './rules';
import { settlePick } from '../settle';
import { closingFromSnapLines } from './closing';
import { rosettaUtcMs } from './nbl';
import type { AiPickLeg } from '../types';
import type { NblSnapLine } from '@/lib/nbl/playerPropSnapshots';

const box = { minutes: 30, points: 18, rebounds: 7, assists: 4, threeMade: 2 };

test('Rosetta times without a zone are UTC', () => {
  assert.equal(rosettaUtcMs('2026-10-11T04:00:00'), Date.parse('2026-10-11T04:00:00Z'));
  assert.equal(rosettaUtcMs('2026-10-11T15:00:00+11:00'), Date.parse('2026-10-11T04:00:00Z'));
});

test('over/under: whole-line landing is a push', () => {
  assert.equal(gradeOverUnder(16, 15.5, 'over'), 'win');
  assert.equal(gradeOverUnder(15, 15.5, 'over'), 'loss');
  assert.equal(gradeOverUnder(15, 15.5, 'under'), 'win');
  assert.equal(gradeOverUnder(15, 15, 'over'), 'push');
});

test('handicap covers on margin plus line', () => {
  assert.equal(gradeHandicap(5, -4.5), 'win');
  assert.equal(gradeHandicap(4, -4.5), 'loss');
  assert.equal(gradeHandicap(-3, 4.5), 'win');
  assert.equal(gradeHandicap(-4, 4), 'push');
});

test('NBL props: combos and DNP', () => {
  assert.deepEqual(gradeNblProp({ side: 'over', line: 28.5 }, 'pra', box), { status: 'win', value: 29, note: '29 pra' });
  assert.equal(gradeNblProp({ side: 'under', line: 6.5 }, 'rebounds', box).status, 'loss');
  assert.equal(gradeNblProp({ side: 'over', line: 1.5 }, 'threeMade', box).status, 'win');
  assert.equal(gradeNblProp({ side: 'over', line: 10.5 }, 'points', { ...box, minutes: 0 }).status, 'void');
  assert.equal(gradeNblProp({ side: 'over', line: 10.5 }, 'points', null).status, 'void');
});

test('NBL game lines from the final score', () => {
  assert.equal(gradeNblGame({ market: 'h2h', side: 'away', line: null }, 88, 91).status, 'win');
  assert.equal(gradeNblGame({ market: 'spread', side: 'home', line: -4.5 }, 95, 90).status, 'win');
  assert.equal(gradeNblGame({ market: 'spread', side: 'away', line: 4.5 }, 95, 90).status, 'loss');
  assert.equal(gradeNblGame({ market: 'total', side: 'under', line: 180.5 }, 95, 90).status, 'loss');
  assert.equal(gradeNblGame({ market: 'total', side: 'over', line: 185 }, 95, 90).status, 'push');
});

test('tennis markets from the player view', () => {
  const r = { won: true, gamesWon: 13, gamesLost: 9, setsWon: 2, setsLost: 1, score: '6-4 3-6 6-3' };
  assert.equal(gradeTennis({ market: 'match_winner', side: 'yes', line: null }, r).status, 'win');
  assert.equal(gradeTennis({ market: 'match_winner', side: 'no', line: null }, r).status, 'loss');
  assert.equal(gradeTennis({ market: 'game_handicap', side: 'yes', line: -3.5 }, r).status, 'win');
  assert.equal(gradeTennis({ market: 'game_handicap', side: 'yes', line: -4.5 }, r).status, 'loss');
  assert.equal(gradeTennis({ market: 'total_games', side: 'over', line: 21.5 }, r).status, 'win');
  assert.equal(gradeTennis({ market: 'player_games', side: 'under', line: 12.5 }, r).status, 'loss');
  assert.equal(gradeTennis({ market: 'total_sets', side: 'over', line: 2.5 }, r).status, 'win');
  assert.equal(gradeTennis({ market: 'player_sets', side: 'over', line: 1.5 }, r).status, 'win');
  const lost = { won: false, gamesWon: 7, gamesLost: 12, setsWon: 0, setsLost: 2, score: '4-6 3-6' };
  assert.equal(gradeTennis({ market: 'win_a_set', side: 'yes', line: null }, lost).status, 'loss');
  assert.equal(gradeTennis({ market: 'win_a_set', side: 'no', line: null }, lost).status, 'win');
});

test('settle: singles, multis, and void legs dropping out', () => {
  assert.deepEqual(settlePick({ kind: 'single', units: 2, price: 1.9 }, [{ status: 'win', price: 1.9 }]), {
    status: 'win',
    profitUnits: 1.8,
    settledPrice: 1.9,
  });
  assert.equal(settlePick({ kind: 'single', units: 2, price: 1.9 }, [{ status: 'loss', price: 1.9 }]).profitUnits, -2);
  assert.equal(settlePick({ kind: 'single', units: 1, price: 1.9 }, [{ status: 'pending', price: 1.9 }]).status, 'pending');

  const multi = { kind: 'multi' as const, units: 1, price: 3.5 };
  assert.equal(settlePick(multi, [{ status: 'loss', price: 1.8 }, { status: 'pending', price: 1.9 }]).status, 'loss');
  assert.equal(settlePick(multi, [{ status: 'win', price: 1.8 }, { status: 'pending', price: 1.9 }]).status, 'pending');
  assert.equal(settlePick(multi, [{ status: 'win', price: 1.8 }, { status: 'win', price: 1.9 }]).profitUnits, 2.5);
  const oneVoid = settlePick(multi, [{ status: 'win', price: 1.8 }, { status: 'void', price: 1.9 }]);
  assert.equal(oneVoid.status, 'win');
  assert.equal(oneVoid.settledPrice, 1.842);
  assert.equal(settlePick(multi, [{ status: 'void', price: 1.8 }, { status: 'void', price: 1.9 }]).status, 'void');
});

test('closing line: same book, balanced main O/U, side price', () => {
  const line = (l: Partial<NblSnapLine>): NblSnapLine => ({
    player: 'Xavier Cooks',
    playerKey: 'xavier cooks',
    book: 'Sportsbet',
    stat: 'points',
    kind: 'ou',
    line: 15.5,
    label: '',
    over: '',
    under: '',
    overDecimal: 1.87,
    underDecimal: 1.87,
    ...l,
  });
  const leg = {
    player: 'Xavier Cooks',
    market: 'points',
    marketKind: 'main',
    bookmaker: 'sportsbet',
    side: 'under',
    line: 15.5,
  } as AiPickLeg;
  const lines = [
    line({ line: 14.5, overDecimal: 1.6, underDecimal: 2.25 }),
    line({ line: 16.5, overDecimal: 1.9, underDecimal: 1.85 }),
    line({ book: 'TAB', line: 17.5 }),
    line({ kind: 'milestone', line: 19.5, overDecimal: 2.6, underDecimal: null }),
  ];
  assert.deepEqual(closingFromSnapLines(leg, lines), { line: 16.5, price: 1.85 });
  assert.deepEqual(closingFromSnapLines({ ...leg, marketKind: 'milestone', side: 'over', line: 19.5 }, lines), {
    line: 19.5,
    price: 2.6,
  });
  assert.equal(closingFromSnapLines({ ...leg, bookmaker: 'bet365' }, lines), null);
});
