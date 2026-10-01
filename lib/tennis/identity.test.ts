import assert from 'node:assert/strict';
import test from 'node:test';
import { tennisIdentityMatch, tennisSamePersonRecords } from './oddsApi';

test('reversed and abbreviated names are the same player', () => {
  const same: Array<[string, string]> = [
    ['Novak Djokovic', 'N. Djokovic'],
    ['Bu Yunchaokete', 'Yunchaokete Bu'],
    ['Y. Bu', 'Yunchaokete Bu'],
    ['Y. Bu', 'Bu Yunchaokete'],
    ['B. Yunchaokete', 'Yunchaokete Bu'],
    ['J. Hallquist Lithen', 'John Hallquist Lithen'],
    ['M. Dahlin', 'Max Dahlin'],
    ['A. de Minaur', 'Alex de Minaur'],
    ['K. van Wyk', 'Kris van Wyk'],
    ['F. J. Planinsek', 'Jeff Planinsek Filip'],
    ['E. K. Malmkjaer', 'Kamper Malmkjaer Emma'],
    ['Z. Y. Ruan', 'Ying Ruan Zi'],
    ['Dar. Blanch', 'Darwin Blanch'],
    ['Dar. Blanch', 'Dali Blanch'],
    ['B. Nakashima', 'Brandon Nakashima'],
    ['B. Nakashima', 'Bryce Nakashima'],
    ['Ma. Sheldon', 'Max Sheldon'],
    ['Y. Bu', 'Bu Yifan'],
  ];
  for (const [left, right] of same) {
    assert.equal(tennisIdentityMatch(left, right), true, `${left} = ${right}`);
  }
});

test('a shared surname is not the same player', () => {
  const different: Array<[string, string]> = [
    ['Brandon Nakashima', 'Bryce Nakashima'],
    ['Y. Bu', 'Novak Djokovic'],
    ['C. Hernandez', 'B. Hernandez Cortes'],
    ['A. M. Coromina Boluda', 'Angela Fita Boluda'],
    ['Maria Camila Osorio Serrano', 'Camila Osorio'],
    ['M. Alves', 'Felipe Meligeni Alves'],
    ['S. Ma', 'Ma. Sheldon'],
    ['Ma. Sheldon', 'S. Ma'],
    ['Mateus Alves', 'Felipe Meligeni Alves'],
  ];
  for (const [left, right] of different) {
    assert.equal(tennisIdentityMatch(left, right), false, `${left} != ${right}`);
  }
});

test('B. Nakashima stays ambiguous and a duplicate stub does not', () => {
  const nakashima = tennisSamePersonRecords([
    { playerId: '2838', name: 'Brandon Nakashima' },
    { playerId: '1249', name: 'Bryce Nakashima' },
  ]);
  assert.equal(nakashima, null);
  const yifan = tennisSamePersonRecords([
    { playerId: '796', name: 'Yunchaokete Bu' },
    { playerId: '1', name: 'Bu Yifan' },
  ]);
  assert.equal(yifan, null);
  const hallquist = tennisSamePersonRecords([
    { playerId: '53232', name: 'John Hallquist Lithen' },
    { playerId: '53241', name: 'J. Hallquist Lithen' },
  ]);
  assert.equal(hallquist?.length, 2);
});
