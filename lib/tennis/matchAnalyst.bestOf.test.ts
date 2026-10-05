import assert from 'node:assert/strict';
import { tennisRowsForBestOf } from './chartStats';
import { loadPlayerMatches } from './data';
import { buildTennisMatchAnalysis, compactTennisAnalysis, tennisFormFraction, tennisFormSampleLabel } from './matchAnalyst';

const mixed = [
  { bestOf: 3, totalGames: 22, tour: 'ATP' },
  { bestOf: 5, totalGames: 41, tour: 'ATP', isGrandSlam: true },
  { bestOf: 3, totalGames: 24, tour: 'ATP' },
];

assert.equal(tennisRowsForBestOf(mixed, 3).length, 2);
assert.equal(tennisRowsForBestOf(mixed, 5).length, 1);

const analysis = buildTennisMatchAnalysis({
  playerName: 'Novak Djokovic',
  opponentName: 'Daniil Medvedev',
  tour: 'ATP',
  isGrandSlam: false,
  tournamentName: 'Beijing',
});

if (analysis) {
  const rows = tennisRowsForBestOf(
    loadPlayerMatches({ playerName: 'Novak Djokovic', tour: 'ATP' }),
    3
  ).slice(-15);
  const avg =
    rows.reduce((sum, row) => sum + Number(row.totalGames || 0), 0) / Math.max(1, rows.length);
  assert.ok(analysis.player.l15.totalGames != null);
  assert.ok(
    analysis.player.l15.totalGames < 32,
    `BO3 L15 total games should not include slams, got ${analysis.player.l15.totalGames}`
  );
  assert.ok(
    Math.abs((analysis.player.l15.totalGames ?? 0) - avg) < 0.2,
    `pack L15 ${analysis.player.l15.totalGames} vs BO3 last 15 ${avg.toFixed(1)}`
  );
  console.log(`Djokovic BO3 L15 total games ${analysis.player.l15.totalGames} (n=${analysis.player.l15.matches})`);
}

assert.equal(tennisFormFraction('2-3'), '2/5');
assert.equal(tennisFormFraction('1-4'), '1/5');
assert.equal(tennisFormFraction('11-4'), '11/15');
assert.equal(tennisFormSampleLabel(5, 3, 'hard'), 'last 5 hard best-of-3 matches');
assert.equal(tennisFormSampleLabel(10, 5, null), 'last 10 best-of-5 matches');

if (analysis) {
  const compact = compactTennisAnalysis(analysis);
  assert.equal(analysis.surface, 'hard');
  assert.equal(compact.player.last5Sample, 'last 5 hard best-of-3 matches');
  console.log(`Djokovic last 5 hard BO3 ${compact.player.last5} (${analysis.player.l5.record})`);
}

console.log('matchAnalyst best-of filter ok');
