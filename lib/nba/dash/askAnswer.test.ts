import assert from 'node:assert/strict';
import { test } from 'node:test';
import { nbaAskLastName, nbaAverageMismatches } from './askAnswer';

test('nbaAskLastName skips name suffixes', () => {
  assert.equal(nbaAskLastName('Jabari Smith Jr.'), 'Smith');
  assert.equal(nbaAskLastName('Gary Trent Jr'), 'Trent');
  assert.equal(nbaAskLastName('Robert Williams III'), 'Williams');
  assert.equal(nbaAskLastName('Shai Gilgeous-Alexander'), 'Gilgeous-Alexander');
});

const pack = {
  player: {
    averages: {
      last5: { points: 24, 'points + rebounds + assists': 30, 'points + rebounds': 28.6 },
      last10: { points: 22, 'points + rebounds + assists': 27.8, 'points + rebounds': 26.3 },
      thisSeason: { points: 30, rebounds: 5, assists: 1, 'points + rebounds + assists': 36, 'points + rebounds': 35 },
    },
  },
  focus: {
    market: 'points + rebounds + assists',
    hitRates: [
      { window: 'last 5 games', games: 5, overs: 5, unders: 0, average: 30 },
      { window: 'against San Antonio Spurs', games: 12, overs: 6, unders: 6, average: 19.6 },
    ],
  },
};

test('nbaAverageMismatches catches an average from the wrong window', () => {
  const wrong = 'Jr. has averaged 30 points + rebounds + assists this season, while his points + rebounds average is 35.';
  assert.deepEqual(nbaAverageMismatches(wrong, pack), ['averaged 30 points + rebounds + assists']);
  const right = 'Smith has averaged 36 points + rebounds + assists this season, while his points + rebounds average is 35.';
  assert.deepEqual(nbaAverageMismatches(right, pack), []);
});

test('nbaAverageMismatches accepts each average on its own market and window', () => {
  const text =
    'His points + rebounds + assists average is 30 over his last 5 and 27.8 over his last 10. ' +
    'Against San Antonio he went over in 6 of 12, averaging 19.6 points + rebounds + assists. ' +
    'His last 10 average is 27.8 points + rebounds + assists, while his last 10 average is 26.3 points + rebounds.';
  assert.deepEqual(nbaAverageMismatches(text, pack), []);
  assert.deepEqual(nbaAverageMismatches('He is averaging 30 points + rebounds this season.', pack), [
    'averaging 30 points + rebounds',
  ]);
});
