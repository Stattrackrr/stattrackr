import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisIdentityMatch, tennisNamesMatch } from './oddsApi';

test('cached identity matches give the same answer in both directions and on repeat', () => {
  const cases: Array<[string, string, boolean]> = [
    ['A. Zverev', 'Alexander Zverev', true],
    ['Zverev Alexander', 'Alexander Zverev', true],
    ['B. Nakashima', 'Brandon Nakashima', true],
    ['Brandon Nakashima', 'Bryce Nakashima', false],
    ['Félix Auger-Aliassime', 'Felix Auger Aliassime', true],
    ['J. Reis Da Silva', 'Joao Reis da Silva', true],
    ['N. Sato', 'E. Shibahara', false],
  ];
  for (let round = 0; round < 3; round += 1) {
    for (const [a, b, want] of cases) {
      assert.equal(tennisIdentityMatch(a, b), want, `${a} vs ${b}`);
      assert.equal(tennisIdentityMatch(b, a), want, `${b} vs ${a}`);
    }
  }
  assert.equal(tennisNamesMatch('Zverev', 'Alexander Zverev'), true);
});

test('props-list scale name matching stays fast (it used to block the server for ~11s)', () => {
  const first = ['Alex', 'Ben', 'Carlos', 'Daniil', 'Emil', 'Felix', 'Gael', 'Holger', 'Ivan', 'Jannik'];
  const last = Array.from({ length: 150 }, (_, i) => `Surname${String.fromCharCode(97 + (i % 26))}${i}`);
  const rows = last.flatMap((surname, i) => [`${first[i % 10].charAt(0)}. ${surname}`]);
  const fixtures = last.flatMap((surname, i) => [`${first[i % 10]} ${surname}`, `${surname} ${first[(i + 3) % 10]}`]);
  const started = Date.now();
  let hits = 0;
  for (let pass = 0; pass < 10; pass += 1) {
    for (const row of rows) {
      for (const fixture of fixtures) if (tennisIdentityMatch(row, fixture)) hits += 1;
    }
  }
  const elapsed = Date.now() - started;
  assert.ok(hits > 0);
  assert.ok(elapsed < 3000, `450k comparisons took ${elapsed}ms`);
});
