import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BOOK_RULES, completions, gradeForBook } from './bookRules';
import { gradeSelection, type MatchOutcome } from './grade';
import { LOG_MARKETS, type LogMarket } from './quotes';

const ret = (sets: Array<[number, number]>, winner: 'home' | 'away', status: MatchOutcome['status'] = 'retired'): MatchOutcome => ({
  status,
  sets: sets.map(([home, away]) => ({ home, away })),
  winner,
});
const g = (book: string, market: LogMarket, line: number | null, selection: string, o: MatchOutcome, bestOf = 3) =>
  gradeForBook(book, market, line, selection, o, bestOf, gradeSelection(market, line, selection, o)).grade;

test('every book has a rule for all five markets', () => {
  for (const [book, entry] of Object.entries(BOOK_RULES)) for (const m of LOG_MARKETS) assert.ok(entry.markets[m]?.rule, `${book} ${m}`);
});

test('completions add the fewest games still needed', () => {
  const totals = completions([{ home: 7, away: 6 }, { home: 5, away: 0 }], 3).map((t) => t.gH + t.gA);
  assert.equal(Math.min(...totals), 19);
});

test("books' own total-games examples", () => {
  // Sportsbet rule 7: retirement at 7-6 5-0, Over 18.5 wins.
  assert.equal(g('sportsbet', 'total_games', 18.5, 'over', ret([[7, 6], [5, 0]], 'home')), 'win');
  assert.equal(g('sportsbet', 'total_games', 18.5, 'under', ret([[7, 6], [5, 0]], 'home')), 'loss');
  // Ladbrokes 38.6: abandoned 6-4 4-4, Over/Under 19.5 or fewer settled.
  assert.equal(g('ladbrokes', 'total_games', 19.5, 'over', ret([[6, 4], [4, 4]], 'home')), 'win');
  assert.equal(g('ladbrokes', 'total_games', 20.5, 'over', ret([[6, 4], [4, 4]], 'home')), 'void');
  // TABtouch / Unibet 279: 7-6 4-4, 22.5 and lower settle Over; higher void.
  assert.equal(g('tabtouch', 'total_games', 22.5, 'over', ret([[7, 6], [4, 4]], 'home')), 'win');
  assert.equal(g('unibet', 'total_games', 23.5, 'over', ret([[7, 6], [4, 4]], 'home')), 'void');
  // bet365: 6-4 2-6, 23.5 or fewer settled, 24.5 or more void.
  assert.equal(g('bet365 au', 'total_games', 23.5, 'over', ret([[6, 4], [2, 6]], 'home')), 'win');
  assert.equal(g('bet365 au', 'total_games', 24.5, 'over', ret([[6, 4], [2, 6]], 'home')), 'void');
});

test('totals that must actually be crossed never project, and strict books void', () => {
  // PointsBet: 7-6 5-0 is 18 games played; Over 18.5 not yet reached, so void (no projection).
  assert.equal(g('pointsbet', 'total_games', 18.5, 'over', ret([[7, 6], [5, 0]], 'home')), 'void');
  assert.equal(g('pointsbet', 'total_games', 17.5, 'over', ret([[7, 6], [5, 0]], 'home')), 'win');
  // Pinnacle and Betfair void totals and handicaps on any retirement, even when decided.
  assert.equal(g('pinnacle', 'total_games', 17.5, 'over', ret([[7, 6], [5, 0]], 'home')), 'void');
  assert.equal(g('betfair', 'game_handicap', -1.5, 'home', ret([[6, 0], [5, 0]], 'home')), 'void');
});

test('match winner on a retirement follows each book', () => {
  const early = ret([[3, 2]], 'home');
  const afterSet = ret([[6, 4], [2, 1]], 'home');
  // Sportsbet / PointsBet: progressing player wins from the first ball; bets on the retiring player void.
  assert.equal(g('sportsbet', 'match_winner', null, 'home', early), 'win');
  assert.equal(g('sportsbet', 'match_winner', null, 'away', early), 'void');
  // Ladbrokes: needs a completed set; retiring player's bets void.
  assert.equal(g('ladbrokes', 'match_winner', null, 'home', early), 'void');
  assert.equal(g('ladbrokes', 'match_winner', null, 'home', afterSet), 'win');
  assert.equal(g('ladbrokes', 'match_winner', null, 'away', afterSet), 'void');
  // Unibet / Pinnacle: needs a completed set; retiring player loses.
  assert.equal(g('unibet', 'match_winner', null, 'away', afterSet), 'loss');
  assert.equal(g('pinnacle', 'match_winner', null, 'home', early), 'void');
  // TAB, Dabble: void. bet365: void, except a disqualification.
  assert.equal(g('tab', 'match_winner', null, 'home', afterSet), 'void');
  assert.equal(g('bet365 au', 'match_winner', null, 'home', afterSet), 'void');
  assert.equal(g('bet365 au', 'match_winner', null, 'away', ret([[6, 4], [2, 1]], 'home', 'default')), 'loss');
});

test('win a set and handicap', () => {
  const o = ret([[4, 6], [3, 1]], 'home');
  // Away already won set one: decided Yes at most books.
  assert.equal(g('sportsbet', 'win_a_set', null, 'away yes', o), 'win');
  // Home hasn't won a set yet: undecided, void.
  assert.equal(g('sportsbet', 'win_a_set', null, 'home yes', o), 'void');
  // BetRight: Yes only when the selected player retires having won a set. Here away retired after winning one.
  const awayRetires = ret([[4, 6], [3, 1]], 'home');
  assert.equal(g('betright', 'win_a_set', null, 'away yes', awayRetires), 'win');
  // Home won a set and the opponent retired: not covered by BetRight's rule, so void.
  assert.equal(g('betright', 'win_a_set', null, 'home yes', ret([[6, 4], [1, 3]], 'home')), 'void');
  // Handicap decided only if no finish could change it.
  // 6-0 5-0: the worst finish for home is 5-7 0-6 (two games down), so +2.5 is decided but -1.5 isn't.
  assert.equal(g('sportsbet', 'game_handicap', 2.5, 'home', ret([[6, 0], [5, 0]], 'home')), 'win');
  assert.equal(g('sportsbet', 'game_handicap', -1.5, 'home', ret([[6, 0], [5, 0]], 'home')), 'void');
  assert.equal(g('sportsbet', 'game_handicap', -12.5, 'home', ret([[6, 0], [1, 0]], 'home')), 'loss');
  assert.equal(g('sportsbet', 'game_handicap', -3.5, 'home', ret([[6, 0], [1, 0]], 'home')), 'void');
});

test('walkovers void, completed matches settle normally, unknown books use the house grade', () => {
  assert.equal(g('sportsbet', 'match_winner', null, 'home', { status: 'walkover', sets: [] }), 'void');
  const done: MatchOutcome = { status: 'completed', sets: [{ home: 6, away: 4 }, { home: 6, away: 3 }], winner: 'home' };
  assert.equal(g('pinnacle', 'total_games', 18.5, 'over', done), 'win');
  const unknown = gradeForBook('someone', 'total_games', 17.5, 'over', ret([[7, 6], [5, 0]], 'home'), 3, 'win');
  assert.deepEqual(unknown, { grade: 'win', rule: 'house', verified: false });
});

test('Palmerbet voids everything before the first set completes', () => {
  assert.equal(g('palmerbet', 'total_games', 7.5, 'over', ret([[5, 4]], 'home')), 'void');
  assert.equal(g('sportsbet', 'total_games', 7.5, 'over', ret([[5, 4]], 'home')), 'win');
});
