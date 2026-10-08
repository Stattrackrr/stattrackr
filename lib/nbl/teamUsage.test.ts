import assert from 'node:assert/strict';
import { nblAssistsPerPossession, nblPointsPerPossession, nblPossessionsUsed, round1, round2 } from './advancedRates';
import type { NblGameLogRow } from './rosettaTypes';
import { aggregateNblTeamUsageStats } from './teamUsage';

function game(partial: Partial<NblGameLogRow>): NblGameLogRow {
  return {
    matchId: '1',
    date: '2026-01-01',
    season: 2026,
    round: 1,
    opponent: 'Melbourne United',
    opponentCode: 'MEL',
    isHome: true,
    team: 'Tasmania JackJumpers',
    teamCode: 'TAS',
    result: 'W',
    minutes: 30,
    points: 20,
    rebounds: 10,
    offensiveRebounds: 4,
    defensiveRebounds: 6,
    assists: 5,
    steals: 1,
    blocks: 1,
    turnovers: 2,
    fouls: 2,
    fgMade: 8,
    fgAttempted: 16,
    fgPct: 50,
    twoMade: 6,
    twoAttempted: 10,
    twoPct: 60,
    threeMade: 2,
    threeAttempted: 6,
    threePct: 33.3,
    ftMade: 2,
    ftAttempted: 2,
    ftPct: 100,
    plusMinus: 5,
    efficiency: 20,
    pra: 35,
    pr: 30,
    pa: 25,
    ra: 15,
    usgPct: 25,
    trebOnCourt: 40,
    orebOnCourt: 15,
    drebOnCourt: 25,
    ...partial,
  };
}

const g1 = game({
  matchId: 'a',
  minutes: 32,
  points: 18,
  rebounds: 10,
  offensiveRebounds: 4,
  defensiveRebounds: 6,
  assists: 4,
  fgAttempted: 16,
  ftAttempted: 2,
  turnovers: 2,
  usgPct: 28,
  trebOnCourt: 40,
  orebOnCourt: 16,
  drebOnCourt: 24,
});
const g2 = game({
  matchId: 'b',
  minutes: 24,
  points: 12,
  rebounds: 6,
  offensiveRebounds: 2,
  defensiveRebounds: 4,
  assists: 2,
  fgAttempted: 10,
  ftAttempted: 0,
  turnovers: 1,
  usgPct: 22,
  trebOnCourt: 30,
  orebOnCourt: 10,
  drebOnCourt: 20,
});

const agg = aggregateNblTeamUsageStats([g1, g2]);
assert.ok(agg);
assert.equal(agg.games, 2);

const poss1 = nblPossessionsUsed(16, 2, 2) ?? 0;
const poss2 = nblPossessionsUsed(10, 0, 1) ?? 0;
assert.equal(agg.stats.possUsed, round1((poss1 + poss2) / 2));
assert.ok(agg.stats.possUsed < 40, 'POSS must be per game, not season total');

assert.equal(agg.stats.ptsPerPoss, round2(nblPointsPerPossession(30, poss1 + poss2) ?? 0));
assert.equal(agg.stats.astPerPoss, round2(nblAssistsPerPossession(6, poss1 + poss2) ?? 0));
assert.equal(agg.stats.usgPct, round1((28 * 32 + 22 * 24) / 56));

assert.equal(agg.stats.trebGot, round1(16 / 2));
assert.equal(agg.stats.trebOnCourt, round1(70 / 2));
assert.equal(agg.stats.orebGot, round1(6 / 2));
assert.equal(agg.stats.orebOnCourt, round1(26 / 2));
assert.equal(agg.stats.drebGot, round1(10 / 2));
assert.equal(agg.stats.drebOnCourt, round1(44 / 2));
assert.equal(agg.stats.trebPct, round1((100 * 16) / 70));
assert.equal(agg.stats.orebPct, round1((100 * 6) / 26));
assert.equal(agg.stats.drebPct, round1((100 * 10) / 44));

console.log('teamUsage per-game advanced averages ok');
