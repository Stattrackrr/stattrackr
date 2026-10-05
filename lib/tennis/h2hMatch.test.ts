import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeTennisH2hRows, tennisH2hPairKey, tennisIsH2hMatch, tennisResolveOpponentId } from './h2hMatch';
import { mapApiFixtureToRows, type ApiPlayerInfo, type ApiTennisFixture } from './apiTennis';

test('pair key is order-independent', () => {
  assert.equal(tennisH2hPairKey('1905', '1093'), tennisH2hPairKey('1093', '1905'));
});

test('H2H matches by player id even when names differ', () => {
  assert.equal(
    tennisIsH2hMatch({ opponent: 'D. Medvedev', opponentId: '1093' }, 'Daniil Medvedev', '1093'),
    true
  );
  assert.equal(
    tennisIsH2hMatch({ opponent: 'Daniil Medvedev', opponentId: '1093' }, 'D. Medvedev', null),
    true
  );
  assert.equal(
    tennisIsH2hMatch({ opponent: 'Carlos Alcaraz', opponentId: '900' }, 'Daniil Medvedev', '1093'),
    false
  );
});

test('resolve prefers a numeric opponent id', () => {
  const id = tennisResolveOpponentId(
    [{ playerId: '1', name: 'Novak Djokovic', tour: 'ATP' }],
    'Daniil Medvedev',
    '1093',
    'ATP'
  );
  assert.equal(id, '1093');
});

test('get_H2H fixtures map into scored player rows', () => {
  const players = new Map<string, ApiPlayerInfo>([
    [
      '1905',
      {
        playerId: '1905',
        name: 'Novak Djokovic',
        tour: 'ATP',
        ioc: 'SRB',
        rank: 1,
        rankPoints: null,
        imageUrl: null,
      },
    ],
    [
      '1093',
      {
        playerId: '1093',
        name: 'Daniil Medvedev',
        tour: 'ATP',
        ioc: 'RUS',
        rank: 5,
        rankPoints: null,
        imageUrl: null,
      },
    ],
  ]);
  const fx: ApiTennisFixture = {
    event_key: 123,
    event_date: '2023-09-10',
    event_first_player: 'D. Medvedev',
    first_player_key: 1093,
    event_second_player: 'N. Djokovic',
    second_player_key: 1905,
    event_final_result: '0 - 3',
    event_winner: 'Second Player',
    event_status: 'Finished',
    event_type_type: 'Atp Singles',
    tournament_name: 'ATP US Open',
    tournament_season: '2023',
    scores: [
      { score_first: 3, score_second: 6, score_set: '1' },
      { score_first: 6.7, score_second: 7, score_set: '2' },
      { score_first: 3, score_second: 6, score_set: '3' },
    ],
  };
  const rows = mapApiFixtureToRows(fx, players);
  const djoko = rows.find((row) => row.playerId === '1905');
  assert.ok(djoko);
  assert.equal(djoko?.opponentId, '1093');
  assert.equal(djoko?.opponent, 'Daniil Medvedev');
  assert.equal(djoko?.isWin, true);
  assert.ok((djoko?.totalGames || 0) > 0);
  assert.equal(tennisIsH2hMatch(djoko!, 'Daniil Medvedev', '1093'), true);
});

test('merging H2H keeps recent logs and older meetings', () => {
  const recent = {
    matchId: '2026-1-1905',
    tour: 'ATP' as const,
    season: 2026,
    tourneyId: '1',
    tourneyName: 'Beijing',
    tourneyLevel: 'A',
    isGrandSlam: false,
    surface: 'Hard',
    date: '2026-09-01',
    tourneyDate: '2026-09-01',
    round: 'R16',
    score: '6-4 6-4',
    bestOf: 3 as const,
    minutes: null,
    drawSize: null,
    playerId: '1905',
    playerName: 'Novak Djokovic',
    opponentId: '99',
    opponent: 'M. Navone',
    opponentIoc: null,
    opponentRank: null,
    opponentRankPoints: null,
    playerRank: null,
    rankPoints: null,
    seed: null,
    entry: null,
    height: null,
    age: null,
    isWin: true,
    result: 'W',
    team: 'ATP',
    teamCode: 'ATP',
    venue: 'Hard',
    isHome: false,
    moneyline: 1,
    gamesWon: 12,
    gamesLost: 8,
    totalGames: 20,
    spread: -4,
  };
  const h2h = {
    ...recent,
    matchId: '123-1905',
    season: 2023,
    date: '2023-09-10',
    tourneyDate: '2023-09-10',
    tourneyName: 'ATP US Open',
    opponentId: '1093',
    opponent: 'Daniil Medvedev',
    gamesWon: 19,
    gamesLost: 12,
    totalGames: 31,
  };
  const merged = mergeTennisH2hRows([recent as never], [h2h as never]);
  assert.equal(merged.length, 2);
  assert.equal(
    merged.filter((row) => tennisIsH2hMatch(row, 'Daniil Medvedev', '1093')).length,
    1
  );
});
