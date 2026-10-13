import assert from 'node:assert/strict';
import test from 'node:test';
import { findLiveTennisEventForPlayers, type TennisLiveEventIndex } from './nextGame';

const machac = '2981';
const muller = '374';

function index(nextEventByPlayer?: Map<string, string>): TennisLiveEventIndex {
  const events = [
    { tour: 'ATP' as const, tournamentKey: '1667', tournamentName: 'Shanghai', playerIds: [machac, muller], qualifyingPlayerIds: [] },
    { tour: 'ATP' as const, tournamentKey: '2770', tournamentName: 'Jinan', playerIds: [machac, muller], qualifyingPlayerIds: [] },
    { tour: 'ATP' as const, tournamentKey: '13259', tournamentName: 'Jingshan', playerIds: [], qualifyingPlayerIds: [] },
    { tour: 'WTA' as const, tournamentKey: '13250', tournamentName: 'Jingshan', playerIds: [], qualifyingPlayerIds: [] },
  ];
  return {
    keys: new Set(),
    names: new Set(),
    playerIdsByKey: new Map(),
    playerIdsByName: new Map(),
    events,
    nextEventByPlayer,
  };
}

test('the odds feed tournament wins over a finished event that still lists both players', () => {
  const event = findLiveTennisEventForPlayers(index(), {
    playerId: machac,
    opponentId: muller,
    tournamentName: 'Jinan',
    tour: 'ATP',
  });
  assert.equal(event?.tournamentName, 'Jinan');
  assert.equal(event?.tournamentKey, '2770');
});

test('a named tournament that is not in the index is never swapped for another one', () => {
  const event = findLiveTennisEventForPlayers(index(), {
    playerId: machac,
    opponentId: muller,
    tournamentName: 'Stockholm',
    tour: 'ATP',
  });
  assert.equal(event, null);
});

test('with no tournament name, players resolve through their next unplayed match', () => {
  const next = new Map([
    [machac, 'ATP|2770'],
    [muller, 'ATP|2770'],
  ]);
  const event = findLiveTennisEventForPlayers(index(next), { playerId: machac, opponentId: muller, tour: 'ATP' });
  assert.equal(event?.tournamentName, 'Jinan');
});

test('with no name and no next match, an ambiguous player match returns nothing', () => {
  const event = findLiveTennisEventForPlayers(index(), { playerId: machac, opponentId: muller, tour: 'ATP' });
  assert.equal(event, null);
});

test('book names with extra words still find the event, and tour keeps ATP/WTA apart', () => {
  assert.equal(
    findLiveTennisEventForPlayers(index(), { tournamentName: 'ATP Shanghai Masters', tour: 'ATP' })?.tournamentKey,
    '1667'
  );
  assert.equal(findLiveTennisEventForPlayers(index(), { tournamentName: 'Jingshan', tour: 'WTA' })?.tournamentKey, '13250');
  assert.equal(findLiveTennisEventForPlayers(index(), { tournamentName: 'Jinan', tour: 'ATP' })?.tournamentKey, '2770');
});
