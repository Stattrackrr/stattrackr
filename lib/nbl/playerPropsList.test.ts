import assert from 'node:assert/strict';
import { nblListConsensusLine, nblListSnapshotForGame } from './playerPropsList';
import type { NblBookRow } from './oddsTypes';
import type { NblPlayerPropSnapshot } from './playerPropSnapshots';

function book(name: string, lines: Array<{ line: string; over: string; under: string; kind: 'ou' | 'milestone' }>): NblBookRow {
  const main = lines[0];
  return {
    name,
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: main.line, over: main.over, under: main.under },
    lines: lines.map((line) => ({ ...line, label: line.line })),
  };
}

assert.equal(
  nblListConsensusLine(
    [
      book('Sportsbet', [{ line: '13.5', over: '-109', under: '-122', kind: 'ou' }]),
      book('PointsBet', [{ line: '13.5', over: '-115', under: '-115', kind: 'ou' }]),
      book('Unibet', [{ line: '14.5', over: '+135', under: 'N/A', kind: 'milestone' }]),
      book('TABtouch', [{ line: '14.5', over: '+135', under: 'N/A', kind: 'milestone' }]),
      book('Betrivers', [{ line: '14.5', over: '+135', under: 'N/A', kind: 'milestone' }]),
    ],
    'points'
  ),
  13.5
);

assert.equal(
  nblListConsensusLine(
    [
      book('Betr', [{ line: '2.5', over: '+145', under: 'N/A', kind: 'milestone' }]),
      book('PlayUp', [{ line: '2.5', over: '+140', under: 'N/A', kind: 'milestone' }]),
    ],
    'assists'
  ),
  2.5
);

function snap(partial: Partial<NblPlayerPropSnapshot> & Pick<NblPlayerPropSnapshot, 'gameId' | 'homeTeam' | 'awayTeam' | 'commenceTime'>): NblPlayerPropSnapshot {
  return {
    gameKey: `${String(partial.commenceTime).slice(0, 10)}_${partial.homeTeam}_vs_${partial.awayTeam}`,
    capturedAt: partial.commenceTime,
    closing: false,
    source: 'odds-api-net',
    books: [],
    lineCount: partial.lineCount ?? 1,
    lines: [],
    ...partial,
  };
}

const lastWeek = snap({
  gameId: 'old',
  homeTeam: 'Melbourne United',
  awayTeam: 'South East Melbourne Phoenix',
  commenceTime: '2026-09-24T09:30:00.000Z',
  lineCount: 40,
});
const thisWeek = snap({
  gameId: 'new',
  homeTeam: 'South East Melbourne Phoenix',
  awayTeam: 'Melbourne United',
  commenceTime: '2026-10-04T09:30:00.000Z',
  lineCount: 8,
});

assert.equal(
  nblListSnapshotForGame([lastWeek, thisWeek], {
    gameId: 'new',
    homeTeam: 'Melbourne United',
    awayTeam: 'South East Melbourne Phoenix',
    commenceTime: '2026-10-04T09:30:00.000Z',
  })?.gameId,
  'new'
);

assert.equal(
  nblListSnapshotForGame([lastWeek], {
    gameId: 'new',
    homeTeam: 'Melbourne United',
    awayTeam: 'South East Melbourne Phoenix',
    commenceTime: '2026-10-04T09:30:00.000Z',
  }),
  null
);

console.log('playerPropsList consensus ok');
