import assert from 'node:assert/strict';
import { parseUserStatLine } from './askUserLine';

const xiao = {
  playerLast: 'Xiao',
  playerName: 'Lingjun Xiao',
  opponentLast: 'Cina',
  opponentName: 'Federico Cina',
  viewingStat: 'gamesWon',
  viewingLine: 6.5,
  bestOf: 3 as const,
};

const underXiao = parseUserStatLine('is under 6.5 games for Xiao the lean here', xiao);
assert.equal(underXiao?.stat, 'gamesWon');
assert.equal(underXiao?.threshold, 6.5);
assert.equal(underXiao?.rule, 'lt');

const misspelled = parseUserStatLine('is under 6.5 gamer for xiao the lean hgere', xiao);
assert.equal(misspelled?.stat, 'gamesWon');
assert.equal(misspelled?.threshold, 6.5);

const chartOnly = parseUserStatLine('is under 6.5 the lean here', xiao);
assert.equal(chartOnly?.stat, 'gamesWon');
assert.equal(chartOnly?.threshold, 6.5);

const matchTotal = parseUserStatLine('is under 22.5 games a good bet');
assert.equal(matchTotal?.stat, 'totalGames');
assert.equal(matchTotal?.threshold, 22.5);

const namedTotal = parseUserStatLine('is the match total under 22.5 games');
assert.equal(namedTotal?.stat, 'totalGames');

const aces = parseUserStatLine('over 8.5 aces for Xiao', xiao);
assert.equal(aces?.stat, 'aces');
assert.equal(aces?.threshold, 8.5);

const whyLow = parseUserStatLine('why is xiaos games line so low', xiao);
assert.equal(whyLow?.stat, 'gamesWon');
assert.equal(whyLow?.threshold, 6.5);

const runLong = parseUserStatLine('Is under 18.5 games the side, or does this one run long?', xiao);
assert.equal(runLong?.stat, 'totalGames');
assert.equal(runLong?.threshold, 18.5);

const bo3Player18 = parseUserStatLine('is under 18.5 games for Xiao the lean', xiao);
assert.equal(bo3Player18?.stat, 'gamesWon');
assert.equal(bo3Player18?.threshold, 18.5);

const bo3Chart18 = parseUserStatLine('is under 18.5 the lean here', xiao);
assert.equal(bo3Chart18?.stat, 'gamesWon');
assert.equal(bo3Chart18?.threshold, 18.5);

const bo3Match22 = parseUserStatLine('is under 22.5 games a good bet', { ...xiao, viewingStat: null });
assert.equal(bo3Match22?.stat, 'totalGames');

const slamPlayer = parseUserStatLine('under 18.5 games', { ...xiao, bestOf: 5, viewingStat: null });
assert.equal(slamPlayer?.stat, 'gamesWon');

const slamTotal = parseUserStatLine('under 38.5 games', { ...xiao, bestOf: 5, viewingStat: 'gamesWon' });
assert.equal(slamTotal?.stat, 'totalGames');

const coverDog = parseUserStatLine(
  'Does Djokovic cover +1.5 games against Medvedev, or is that too many?',
  { playerLast: 'Djokovic', opponentLast: 'Medvedev', viewingStat: 'spread', viewingLine: 1.5, bestOf: 3 }
);
assert.equal(coverDog?.stat, 'spread');
assert.equal(coverDog?.threshold, 1.5);
assert.equal(coverDog?.rule, 'lte');
assert.equal(/too many/i.test(coverDog?.display || ''), false);

const coverFav = parseUserStatLine(
  'Does Djokovic cover -2.5 games against Medvedev, or is that too many games to win by?',
  { playerLast: 'Djokovic', opponentLast: 'Medvedev', viewingStat: 'spread', viewingLine: -2.5, bestOf: 3 }
);
assert.equal(coverFav?.stat, 'spread');
assert.equal(coverFav?.threshold, -2.5);
assert.equal(coverFav?.rule, 'lte');

console.log('askUserLine player-games parse ok');
