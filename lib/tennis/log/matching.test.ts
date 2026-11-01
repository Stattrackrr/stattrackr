import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tennisInitialKey } from '@/lib/tennis/hands';
import { tennisShortFullMatch } from '@/lib/tennis/oddsApiNet';

test('short fixture names match full odds names with extra given names and particles', () => {
  assert.ok(tennisShortFullMatch('J. Reis Da Silva', 'Joao Lucas Reis Da Silva'));
  assert.ok(tennisShortFullMatch('Joaquin Aguilar Cardozo', 'J. Aguilar Cardozo'));
  assert.ok(tennisShortFullMatch('T. A. Tirante', 'Tirante, Thiago Agustin'));
  assert.ok(tennisShortFullMatch('A. De Minaur', 'Alex de Minaur'));
  assert.ok(tennisShortFullMatch('M. Damm', 'Martin Damm Jr'));
});

test('short-name match never takes a different initial or a partial surname', () => {
  assert.ok(!tennisShortFullMatch('M. Zverev', 'Alexander Zverev'));
  assert.ok(!tennisShortFullMatch('J. Silva', 'Joao Lucas Reis Da Silva Junior'));
  assert.ok(!tennisShortFullMatch('Alexander Zverev', 'Mischa Zverev'));
  assert.ok(!tennisShortFullMatch('A. Zverev', 'A. Zverev Jr'));
});

test('initial keys for the hands lookup', () => {
  assert.equal(tennisInitialKey('A. Zverev'), 'a|zverev');
  assert.equal(tennisInitialKey('J. Reis Da Silva'), 'j|reis silva');
  assert.equal(tennisInitialKey('O. J. Gutierrez'), 'o|gutierrez');
  assert.equal(tennisInitialKey('Alexander Zverev'), null);
});
