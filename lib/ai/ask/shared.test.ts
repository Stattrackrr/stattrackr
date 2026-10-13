import assert from 'node:assert/strict';
import test from 'node:test';
import { askInventedNumbers, askMismatchedPrices, soundsLikeModelPitch } from './guards';
import { parseAskReply } from './llm';
import { askAgo, askMonthYear, askRunFromNewest } from './timeline';

const NOW = Date.parse('2026-10-13T12:00:00Z');

test('ago wording is the same for every sport', () => {
  assert.equal(askAgo('2026-10-12', NOW)?.ago, 'yesterday');
  assert.equal(askAgo('2026-09-16', NOW)?.ago, '4 weeks ago');
  assert.equal(askAgo('2025-09-01', NOW)?.months, 13);
  assert.equal(askMonthYear('2024-01-14T00:00:00Z'), 'January 2024');
});

test('run counts back from the newest result', () => {
  assert.deepEqual(askRunFromNewest([true, false, true, true, true]), { value: true, count: 3 });
  assert.equal(askRunFromNewest([]), null);
});

test('numbers in the reply must come from the stats or the question', () => {
  const pack = { last10: { overs: 6, games: 10, average: 11.24 }, price: 1.87, when: '3 weeks ago' };
  assert.deepEqual(askInventedNumbers('Over in 6 of his last 10 at 1.87, averaging 11.2, 3 weeks ago.', pack), []);
  assert.deepEqual(askInventedNumbers('He has gone over in 8 of 10.', pack), ['8']);
  assert.deepEqual(askInventedNumbers('Will he get 25?', pack, 'can he get 25'), []);
  assert.deepEqual(askInventedNumbers('last 15 best-of-3 matches', { sample: 'last 15 best-of-3 matches' }), []);
});

test('a price must belong to the side and line it is quoted for', () => {
  const offers = [
    { side: 'over' as const, line: 5.5, price: 1.75 },
    { side: 'under' as const, line: 9.5, price: 1.9 },
  ];
  assert.deepEqual(askMismatchedPrices("I'd take the under 5.5 rebounds + assists at 1.75 with Picklebet.", offers), [
    'under 5.5 at 1.75',
  ]);
  assert.deepEqual(askMismatchedPrices("I'd take over 5.5 rebounds + assists at 1.75.", offers), []);
  assert.deepEqual(askMismatchedPrices('Under 9.5 points at 1.90 (TAB).', offers), []);
});

test('engine labels read as a model pitch', () => {
  assert.equal(soundsLikeModelPitch('STRONG OVER on points'), true);
  assert.equal(soundsLikeModelPitch('no edge here'), true);
  assert.equal(soundsLikeModelPitch("I'd lean over, he has gone over in 7 of 10."), false);
});

test('reply parsing accepts JSON or plain lines', () => {
  assert.deepEqual(parseAskReply('{"answer":"**Over** it","breakdown":["- one","two"]}'), {
    answer: 'Over it',
    breakdown: ['one', 'two'],
  });
  assert.deepEqual(parseAskReply('Lean under\nfact one'), { answer: 'Lean under', breakdown: ['fact one'] });
});
