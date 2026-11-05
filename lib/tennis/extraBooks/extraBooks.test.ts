import assert from 'node:assert/strict';
import test from 'node:test';
import { betrightEventsToSource } from './betright';
import { entainCardToSource } from './entain';
import { pointsbetEventToSource } from './pointsbet';
import { sourceMatchToBookRow } from './shared';
import { unibetOffersToSource } from './unibet';
import { tennisOddsApiNetSourceFromItems } from '../oddsApiNet';
import { bookmakerLinesFromTennisRow } from '../aggregatePropsForPaint';
import { australianBooksFirst } from '../oddsTypes';

test('props rows list Australian books first and keep every other book after them', () => {
  const line = (bookmaker: string) => ({ bookmaker, line: 21.5, overOdds: '-110', underOdds: '-110' });
  const row = {
    statType: 'totalGames',
    line: 21.5,
    bookmakerLines: [line('bet365'), line('Pinnacle'), line('Ladbrokes'), line('1xBet'), line('bet365 au'), line('BetRight')],
  };
  assert.deepEqual(
    bookmakerLinesFromTennisRow(row).map((l) => l.bookmaker),
    ['Ladbrokes', 'bet365 au', 'BetRight', 'bet365', 'Pinnacle', '1xBet']
  );
  assert.deepEqual(
    australianBooksFirst([{ name: 'Pinnacle' }, { name: 'Betfair', region: 'au' as const }, { name: 'PointsBet' }]).map((b) => b.name),
    ['Betfair', 'PointsBet', 'Pinnacle']
  );
});

const names = { home: 'Juan Manuel La Serna', away: 'Hugo Dellien' };

test('Ladbrokes: market handicap is the away line, player names resolve to sides', () => {
  const frac = (n: number, d: number) => ({ odds: { numerator: n, denominator: d } });
  const card = {
    markets: {
      m1: { name: 'Match Betting', entrant_ids: ['a', 'b'] },
      m2: { name: 'Games Handicap', handicap: -4.5, entrant_ids: ['c', 'd'] },
      m3: { name: 'Total Games 20.5', handicap: 20.5, entrant_ids: ['e', 'f'] },
      m4: { name: 'Hugo Dellien to win a set', entrant_ids: ['g', 'h'] },
      m5: { name: 'Total Sets', entrant_ids: ['i', 'j'] },
      m6: { name: 'Set 1 Total Games 8.5', handicap: 8.5, entrant_ids: ['k', 'l'] },
      m7: { name: 'Juan Manuel La Serna Total Games 8.5', handicap: 8.5, entrant_ids: ['m', 'n'] },
    },
    entrants: {
      a: { id: 'a', name: 'Juan Manuel La Serna', home_away: 'HOME' },
      b: { id: 'b', name: 'Hugo Dellien', home_away: 'AWAY' },
      c: { id: 'c', name: 'Juan Manuel La Serna', home_away: 'HOME' },
      d: { id: 'd', name: 'Hugo Dellien', home_away: 'AWAY' },
      e: { id: 'e', name: 'Over' },
      f: { id: 'f', name: 'Under' },
      g: { id: 'g', name: 'Yes' },
      h: { id: 'h', name: 'No' },
      i: { id: 'i', name: '2 Sets' },
      j: { id: 'j', name: '3 sets' },
      k: { id: 'k', name: 'Over' },
      l: { id: 'l', name: 'Under' },
      m: { id: 'm', name: 'Over' },
      n: { id: 'n', name: 'Under' },
    },
    prices: {
      'a:x:': frac(13, 5),
      'b:x:': frac(1, 4),
      'c:x:': frac(51, 50),
      'd:x:': frac(73, 100),
      'e:x:': frac(83, 100),
      'f:x:': frac(9, 10),
      'g:x:': frac(2, 25),
      'h:x:': frac(23, 4),
      'i:x:': frac(21, 50),
      'j:x:': frac(17, 10),
      'k:x:': frac(9, 25),
      'l:x:': frac(39, 20),
      'm:x:': frac(4, 5),
      'n:x:': frac(9, 10),
    },
  };
  const src = entainCardToSource(card, 'Ladbrokes', names);
  assert.deepEqual(src.h2h, { home: 3.6, away: 1.25 });
  assert.deepEqual(src.handicaps, [{ homeLine: 4.5, home: 2.02, away: 1.73 }]);
  assert.deepEqual(src.totals, [{ line: 20.5, over: 1.83, under: 1.9 }]);
  assert.deepEqual(src.awayWinSet, { yes: 1.08, no: 6.75 });
  assert.deepEqual(src.totalSets, [{ line: 2.5, over: 2.7, under: 1.42 }]);
  assert.deepEqual(src.homeGames, [{ line: 8.5, over: 1.8, under: 1.9 }]);
});

test('BetRight: lines come from outcome names; set markets leave the standard columns alone', () => {
  const src = betrightEventsToSource(
    [
      { eventName: 'Match Result', outcomes: [{ outcomeName: 'Juan Manuel La Serna', price: 3.9 }, { outcomeName: 'Hugo Dellien', price: 1.23 }] },
      { eventName: 'Games Handicap +4.5', outcomes: [{ outcomeName: 'Juan Manuel La Serna +4.5', price: 1.97 }, { outcomeName: 'Hugo Dellien -4.5', price: 1.74 }] },
      { eventName: 'Total Games Over/Under +20.5', outcomes: [{ outcomeName: 'Over 20.5', price: 1.85 }, { outcomeName: 'Under 20.5', price: 1.85 }] },
      { eventName: 'Juan Manuel La Serna To Win A Set', outcomes: [{ outcomeName: 'Yes', price: 2.05 }, { outcomeName: 'No', price: 1.7 }] },
      { eventName: 'First Set Winner', outcomes: [{ outcomeName: 'Juan Manuel La Serna', price: 3.05 }, { outcomeName: 'Hugo Dellien', price: 1.32 }] },
    ],
    names
  );
  assert.deepEqual(src.h2h, { home: 3.9, away: 1.23 });
  assert.deepEqual(src.handicaps, [{ homeLine: 4.5, home: 1.97, away: 1.74 }]);
  assert.deepEqual(src.totals, [{ line: 20.5, over: 1.85, under: 1.85 }]);
  assert.deepEqual(src.homeWinSet, { yes: 2.05, no: 1.7 });
});

test('BetRight: every other market is kept, players as home/away, and follows the row orientation', () => {
  const src = betrightEventsToSource(
    [
      { eventName: 'First Set Winner', outcomes: [{ outcomeName: 'Juan Manuel La Serna', price: 3.05 }, { outcomeName: 'Hugo Dellien', price: 1.32 }] },
      { eventName: 'Second Set Winner', outcomes: [{ outcomeName: 'Juan Manuel La Serna', price: 3.2 }, { outcomeName: 'Hugo Dellien', price: 1.3 }] },
      { eventName: 'Set Betting', outcomes: [{ outcomeName: 'Hugo Dellien 2-0', price: 1.9 }, { outcomeName: 'Juan Manuel La Serna 2-1', price: 9 }] },
      { eventName: 'First Set Correct Score', outcomes: [{ outcomeName: 'Hugo Dellien 6-3', price: 5.5 }] },
      { eventName: 'First Set Total Games Over/Under +9.5', outcomes: [{ outcomeName: 'Over 9.5', price: 2.15 }, { outcomeName: 'Under 9.5', price: 1.66 }] },
      { eventName: 'Total Games Odd/Even', outcomes: [{ outcomeName: 'Odd', price: 1.9 }, { outcomeName: 'Even', price: 1.9 }] },
      { eventName: 'First Set Score Double Chance', outcomes: [{ outcomeName: 'Either Player To Win 6-4', price: 4 }] },
      { eventName: 'Hugo Dellien To Win The Tiebreak', outcomes: [{ outcomeName: 'Yes', price: 2.2 }] },
    ],
    names
  );
  const sel = (market: string) => src.extraMarkets!.filter((m) => m.market === market).map((m) => `${m.selection}${m.line != null && Number.isFinite(m.line) ? ` ${m.line}` : ''}@${m.price}`);
  assert.deepEqual(sel('set1_winner'), ['home@3.05', 'away@1.32']);
  assert.deepEqual(sel('set2_winner'), ['home@3.2', 'away@1.3']);
  assert.deepEqual(sel('set_betting'), ['away 2-0@1.9', 'home 2-1@9']);
  assert.deepEqual(sel('set1_correct_score'), ['away 6-3@5.5']);
  assert.deepEqual(sel('set1_total_games'), ['over 9.5@2.15', 'under 9.5@1.66']);
  assert.deepEqual(sel('total_games_odd_even'), ['odd@1.9', 'even@1.9']);
  assert.equal(sel('other:set1_score double chance').length, 1, 'unknown set markets kept under their own name');
  assert.equal(sel('other:away to win the tiebreak').length, 1, 'unknown markets kept, player as away');
  // API-Tennis lists the players the other way round: home and away swap with the row.
  const row = sourceMatchToBookRow(src, false, true)!;
  const flipped = row.extraMarkets!.filter((m) => m.market === 'set_betting').map((m) => m.selection);
  assert.deepEqual(flipped, ['home 2-0', 'away 2-1']);
});

test('BetRight: per-player games outcomes lead with the player name', () => {
  const src = betrightEventsToSource(
    [
      { eventName: 'Hugo Dellien  Total Games Won Over/Under 12.5', outcomes: [{ outcomeName: 'Hugo Dellien Over 12.5', price: 1.8 }, { outcomeName: 'Hugo Dellien Under 12.5', price: 1.95 }] },
      { eventName: 'Hugo Dellien  Total Games Won Over/Under 13.5', outcomes: [{ outcomeName: 'Hugo Dellien Over 13.5', price: 2.4 }, { outcomeName: 'Hugo Dellien Under 13.5', price: 1.55 }] },
    ],
    names
  );
  assert.deepEqual(src.awayGames, [
    { line: 12.5, over: 1.8, under: 1.95 },
    { line: 13.5, over: 2.4, under: 1.55 },
  ]);
  assert.deepEqual(src.homeGames, []);
});

test('Unibet (Kambi): one offer per line, thousandths, player-named outcomes', () => {
  const p = (participant: string, line: number | undefined, odds: number) => ({ participant, englishLabel: participant, line, odds });
  const ou = (line: number, over: number, under: number) => [
    { englishLabel: 'Over', type: 'OT_OVER', line, odds: over },
    { englishLabel: 'Under', type: 'OT_UNDER', line, odds: under },
  ];
  const yn = (yes: number, no: number) => [
    { englishLabel: 'Yes', type: 'OT_YES', odds: yes },
    { englishLabel: 'No', type: 'OT_NO', odds: no },
  ];
  const offer = (englishLabel: string, outcomes: object[]) => ({ criterion: { englishLabel }, outcomes });
  const src = unibetOffersToSource(
    [
      offer('Match Odds', [p('Hugo Dellien', undefined, 1230), p('Juan Manuel La Serna', undefined, 3900)]),
      offer('Game Handicap', [p('Juan Manuel La Serna', 4500, 1970), p('Hugo Dellien', -4500, 1740)]),
      offer('Game Handicap', [p('Juan Manuel La Serna', 3500, 2300), p('Hugo Dellien', -3500, 1570)]),
      offer('Total Games', ou(20500, 1850, 1850)),
      offer('Total Games', ou(22500, 2400, 1520)),
      offer('Total Games - Set 1', ou(9500, 1900, 1800)),
      offer('Total games won by Hugo Dellien', ou(12500, 1800, 1950)),
      offer('Juan Manuel La Serna to win at least one set', yn(2050, 1700)),
      offer('Set Handicap', [p('Juan Manuel La Serna', 1500, 2050), { ...p('Hugo Dellien', -1500, 1650), status: 'SUSPENDED' }]),
      offer('Total Sets', ou(2500, 2700, 1420)),
    ],
    names
  );
  assert.equal(src.region, 'au');
  assert.deepEqual(src.h2h, { home: 3.9, away: 1.23 });
  assert.deepEqual(src.handicaps, [
    { homeLine: 4.5, home: 1.97, away: 1.74 },
    { homeLine: 3.5, home: 2.3, away: 1.57 },
  ]);
  assert.deepEqual(src.totals, [
    { line: 20.5, over: 1.85, under: 1.85 },
    { line: 22.5, over: 2.4, under: 1.52 },
  ]);
  assert.deepEqual(src.awayGames, [{ line: 12.5, over: 1.8, under: 1.95 }]);
  assert.deepEqual(src.homeWinSet, { yes: 2.05, no: 1.7 });
  assert.deepEqual(src.setHandicaps, []);
  assert.deepEqual(src.totalSets, [{ line: 2.5, over: 2.7, under: 1.42 }]);
});

test('PointsBet: several lines per market paired by side and points', () => {
  const o = (name: string, side: string, points: number, price: number) => ({ name, side, points, price });
  const src = pointsbetEventToSource(
    [
      { eventClass: 'Match Result', outcomes: [o('Juan Manuel La Serna', 'Home', 0, 4), o('Hugo Dellien', 'Away', 0, 1.24)] },
      { eventClass: 'Games Handicap', outcomes: [o('JMLS +3.5', 'Home', 3.5, 2.4), o('HD -3.5', 'Away', -3.5, 1.5), o('JMLS +4.5', 'Home', 4.5, 1.87), o('HD -4.5', 'Away', -4.5, 1.8)] },
      { eventClass: 'Total Games', outcomes: [o('Over 21.5', 'Neither', 21.5, 2.05), o('Under 21.5', 'Neither', 21.5, 1.69)] },
      { eventClass: 'Player B Total Games', outcomes: [o('Over 12.5', 'Away', 12.5, 1.9), o('Under 12.5', 'Away', 12.5, 1.77)] },
      { eventClass: 'Sets Handicap', outcomes: [o('JMLS +1.5', 'Home', 1.5, 2.05), o('HD -1.5', 'Away', -1.5, 1.65), o('JMLS -1.5', 'Home', -1.5, 5.25), o('HD +1.5', 'Away', 1.5, 1.1)] },
      { eventClass: 'Total Sets Over/Under', outcomes: [o('Over 2.5', 'Neither', 2.5, 2.75), o('Under 2.5', 'Neither', 2.5, 1.36)] },
      { eventClass: 'Player A To Win A Set', outcomes: [o('Yes', 'Home', 0, 2.1), o('No', 'Home', 0, 1.71)] },
    ],
    names
  );
  assert.deepEqual(src.h2h, { home: 4, away: 1.24 });
  assert.deepEqual(src.handicaps, [
    { homeLine: 3.5, home: 2.4, away: 1.5 },
    { homeLine: 4.5, home: 1.87, away: 1.8 },
  ]);
  assert.deepEqual(src.awayGames, [{ line: 12.5, over: 1.9, under: 1.77 }]);
  assert.deepEqual(src.setHandicaps, [
    { homeLine: 1.5, home: 2.05, away: 1.65 },
    { homeLine: -1.5, home: 5.25, away: 1.1 },
  ]);
  assert.deepEqual(src.homeWinSet, { yes: 2.1, no: 1.71 });
});

test('odds-api.net: one book, games vs sets markets, player props by name', () => {
  const it = (bet_type: string, metric: string, side: string | undefined, line: string, odds: number, extra: object = {}) => ({
    bookmaker: 'sportsbet', bet_type, metric, side, line, odds, period: 'full time', is_available: true, ...extra,
  });
  const src = tennisOddsApiNetSourceFromItems(
    [
      it('moneyline', 'standard', 'home', '', 1.62),
      it('moneyline', 'standard', 'away', '', 2.25),
      it('handicap', 'games', 'home', '-2.5', 1.87),
      it('handicap', 'games', 'away', '+2.5', 1.88),
      it('handicap', 'sets', 'home', '+1.5', 1.17),
      it('handicap', 'sets', 'away', '-1.5', 4),
      it('total', 'games', 'over', 'over 21.5', 1.9),
      it('total', 'games', 'under', 'under 21.5', 1.85),
      it('total', 'sets', undefined, 'over 2.5', 2.3),
      it('total', 'sets', undefined, 'under 2.5', 1.5),
      it('team total', 'games', 'home', 'over 12.5', 2.02),
      it('team total', 'games', 'home', 'under 12.5', 1.73),
      it('player prop', 'player set wins', undefined, 'over 0.5', 1.53, { player_name: 'lucie havlickova' }),
      it('player prop', 'player set wins', undefined, 'under 0.5', 2.37, { player_name: 'lucie havlickova' }),
      it('handicap', 'games', 'home', '-1.5', 1.5, { period: '1st set' }),
    ],
    'sportsbet',
    { home: 'Bianca Andreescu', away: 'Lucie Havlickova' }
  );
  assert.equal(src.region, 'au');
  assert.deepEqual(src.h2h, { home: 1.62, away: 2.25 });
  assert.deepEqual(src.handicaps, [{ homeLine: -2.5, home: 1.87, away: 1.88 }]);
  assert.deepEqual(src.setHandicaps, [{ homeLine: 1.5, home: 1.17, away: 4 }]);
  assert.deepEqual(src.totals, [{ line: 21.5, over: 1.9, under: 1.85 }]);
  assert.deepEqual(src.totalSets, [{ line: 2.5, over: 2.3, under: 1.5 }]);
  assert.deepEqual(src.homeGames, [{ line: 12.5, over: 2.02, under: 1.73 }]);
  assert.deepEqual(src.awayWinSet, { yes: 1.53, no: 2.37 });
});

test('book row flips to API-Tennis home and only reads set handicaps in best of 3', () => {
  const src = {
    book: 'PointsBet',
    region: 'au' as const,
    home: 'A',
    away: 'B',
    h2h: { home: 1.5, away: 2.6 },
    handicaps: [{ homeLine: -2.5, home: 1.8, away: 1.95 }],
    totals: [{ line: 21.5, over: 1.9, under: 1.9 }],
    homeGames: [{ line: 12.5, over: 1.8, under: 2 }],
    awayGames: [],
    totalSets: [{ line: 2.5, over: 2.5, under: 1.5 }],
    setHandicaps: [{ homeLine: -1.5, home: 2.2, away: 1.6 }],
  };
  const same = sourceMatchToBookRow(src, true, true)!;
  assert.deepEqual(same.SpreadLines, [{ line: '-2.5', over: '-125', under: '-105' }]);
  assert.deepEqual(same.SetsLostLines, [{ line: '0.5', over: '-167', under: '+120' }]);
  assert.deepEqual(same.SetsWonLines, []);

  const flipped = sourceMatchToBookRow(src, false, true)!;
  assert.deepEqual(flipped.H2H, { home: '+160', away: '-200' });
  assert.deepEqual(flipped.SpreadLines, [{ line: '2.5', over: '-105', under: '-125' }]);
  assert.deepEqual(flipped.GamesLostLines, [{ line: '12.5', over: '-125', under: '+100' }]);
  assert.deepEqual(flipped.SetsWonLines, [{ line: '0.5', over: '-167', under: '+120' }]);

  const bestOfFive = sourceMatchToBookRow(src, true, false)!;
  assert.deepEqual(bestOfFive.SetsLostLines, []);
  assert.deepEqual(bestOfFive.TotalSetsLines, []);
});
