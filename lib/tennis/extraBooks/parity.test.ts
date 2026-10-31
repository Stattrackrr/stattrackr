import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';
import { addToDay, emptyTally, impliedFromPrice, tallyBook } from './parity';

const row = (name: string, home: string, away: string) => ({ name, H2H: { home, away } }) as TennisBookRow;

test('prices read as implied probabilities', () => {
  assert.ok(Math.abs(impliedFromPrice('-150')! - 0.6) < 1e-9);
  assert.ok(Math.abs(impliedFromPrice('+150')! - 0.4) < 1e-9);
  assert.ok(Math.abs(impliedFromPrice('2.5')! - 0.4) < 1e-9);
  assert.equal(impliedFromPrice('N/A'), null);
});

test('one book: matched, only one feed, close prices and swapped player order', () => {
  const net = new Map([
    ['m1', [row('ladbrokes', '-150', '+125'), row('sportsbet', '-140', '+120')]],
    ['m2', [row('ladbrokes', '+200', '-250')]],
    ['m3', [row('ladbrokes', '-120', '+100')]],
  ]);
  const scraper = new Map([
    ['m1', row('Ladbrokes', '-150', '+125')],
    ['m2', row('Ladbrokes', '-250', '+200')],
    ['m4', row('Ladbrokes', '+110', '-130')],
  ]);
  const t = tallyBook(net, scraper, 'Ladbrokes');
  assert.equal(t.both, 2);
  assert.equal(t.onlyNet, 1);
  assert.equal(t.onlyScraper, 1);
  assert.equal(t.close, 1);
  assert.equal(t.flipped, 1);
  const day = addToDay(addToDay({ runs: 0, rowCapHits: 0, books: {} }, { Ladbrokes: t }, 0), { Ladbrokes: t, Neds: emptyTally() }, 2);
  assert.equal(day.runs, 2);
  assert.equal(day.rowCapHits, 2);
  assert.equal(day.books.Ladbrokes!.both, 4);
});
