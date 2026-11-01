/**
 * Each book's posted tennis retirement rules (owner decision, Option A: the posted book's rule settles a
 * would-be bet; the house rule in grade.ts is the sensitivity check). Read from each book's own rules pages
 * on 1 Nov 2026; seeded into book_void_rules by migrations/tennis_book_void_rules.sql.
 * Completed matches settle normally and walkovers void at every book; these rules cover retirements and
 * defaults (disqualifications).
 */

import { gradeCompleted, setDone, type Grade, type MatchOutcome, type SetScore } from './grade';
import type { LogMarket } from './quotes';

export const BOOK_RULES_VERSION = 'book-rules-2026-11-01';

export type BookRule =
  /** Match winner: the progressing player wins once play has started; bets on the retiring player void. */
  | 'advancer_void'
  /** Match winner: needs a completed set; the progressing player wins, bets on the retiring player void. */
  | 'one_set_void'
  /** Match winner: needs a completed set; the progressing player wins, the retiring player loses. */
  | 'one_set_loss'
  /** Match winner: void on a retirement; on a disqualification the progressing player wins. */
  | 'dq_advancer'
  /** Void unless the match is completed, even if the result was already decided. */
  | 'complete'
  /** Stands if unconditionally decided: the same result however the match could have been finished. */
  | 'decided'
  /** As `decided`, but only once a set has been completed; before that everything is void. */
  | 'decided_after_set'
  /** Stands only once the line has actually been passed: Over (or Yes) can win early, Under (or No) never. */
  | 'crossed'
  /** Win a set: Yes wins only if the selected player retires having won a set; everything else void. */
  | 'set_if_retirer_won';

type Entry = { rule: BookRule; flag?: string; roundRobinNeedsSet?: boolean };
type BookEntry = { source: string; document: string; verified: boolean; markets: Record<LogMarket, Entry> };

const decidedRest = (mw: BookRule): Record<LogMarket, Entry> => ({
  match_winner: { rule: mw },
  game_handicap: { rule: 'decided' },
  total_games: { rule: 'decided' },
  games_won: { rule: 'decided' },
  win_a_set: { rule: 'decided' },
});

export const BOOK_RULES: Record<string, BookEntry> = {
  sportsbet: {
    source: 'https://helpcentre.sportsbet.com.au/hc/en-us/articles/115013564287-Sports-Novelties-Rules-Terms-Conditions',
    document: 'Sports & Novelties Rules (edited 20 Oct 2026), Tennis rules 3, 4, 7, 9',
    verified: true,
    markets: {
      ...decidedRest('advancer_void'),
      match_winner: { rule: 'advancer_void', flag: 'Round-robin events (rule 9): match bets stand only after the first set.', roundRobinNeedsSet: true },
    },
  },
  tab: {
    source: 'https://help.tab.com.au/betting-on-sports/tab-sportsbet-vic-betting-rules',
    document: 'TAB Sportsbet Betting Rules (VIC 11.1.9; ACT 11.1.9; NSW 6.2.8.1)',
    verified: true,
    markets: decidedRest('complete'),
  },
  tabtouch: {
    source: 'https://racingwa.sitefinity.cloud/media/docs/rwwalibraries/default-document-library/rwwa-fixed-odds-sports-rules528d268f-a298-4727-8e84-85e758e539a4.pdf?sfvrsn=3a83ca81_2',
    document: 'RWWA Fixed Odds Sports Rules (28 Sep 2026), rules 278, 279, 281',
    verified: true,
    markets: {
      ...decidedRest('one_set_loss'),
      win_a_set: { rule: 'decided', flag: 'Rule 281 needs one completed set but does not say how undecided bets then settle; graded as decided-only.' },
    },
  },
  ladbrokes: {
    source: 'https://www.ladbrokes.com.au/cdn/contentful/assets/6mtSwz33RmESlnDlkIuwg2/f6848c2a2283525f0ad340805fe40760/Racing_and_Sports_Betting_Rules_V64_7.10.2026__clean_.pdf',
    document: 'Racing and Sports Betting Rules V64 (7 Oct 2026), rules 38.2, 38.5, 38.6',
    verified: true,
    markets: decidedRest('one_set_void'),
  },
  neds: {
    source: 'https://www.neds.com.au/cdn/contentful/assets/1X3NvVEBCSvz3BgxVkh3GD/98f9a222294c9cd2f325e229d141fca3/Racing_and_Sports_Betting_Rules_V64_7.10.2026__clean_.pdf',
    document: 'Racing and Sports Betting Rules V64 (7 Oct 2026), identical to Ladbrokes',
    verified: true,
    markets: decidedRest('one_set_void'),
  },
  pointsbet: {
    source: 'https://support.pointsbet.com.au/hc/en-au/articles/15152059329551-PointsBet-Betting-Rules',
    document: 'PointsBet Betting Rules (22 Oct 2026), rule 2.27',
    verified: true,
    markets: {
      match_winner: { rule: 'advancer_void' },
      game_handicap: { rule: 'complete', flag: 'Older help article says void unless already known; 2.27 (22 Oct 2026) says the match must be completed.' },
      total_games: { rule: 'crossed' },
      games_won: { rule: 'crossed' },
      win_a_set: { rule: 'decided' },
    },
  },
  'bet365 au': {
    source: 'https://help.bet365.com.au/s/en-au/sportsrules/tennis',
    document: 'bet365 AU Sports Rules: Tennis',
    verified: true,
    markets: decidedRest('dq_advancer'),
  },
  unibet: {
    source: 'https://a2s.unicdn.net/polopoly_fs/1.2775969.1780319189!/menu/standard/file/Kambi%20T&C%20v2.1a%20-%20AU.pdf',
    document: 'Kambi T&C v2.1a (AU), tennis rules',
    verified: true,
    markets: {
      ...decidedRest('one_set_loss'),
      win_a_set: { rule: 'decided', flag: 'Catch-all rule needs one completed set but does not say how undecided bets then settle; graded as decided-only.' },
    },
  },
  betright: {
    source: 'https://support.betright.com.au/hc/en-au/articles/4402157103001-Rule-Book-4-Directive-on-Declared-Events-and-Contingencies',
    document: 'Rule Book 4 v3.7 (25 Aug 2026), tennis (ii), (v), (vi), (x)',
    verified: true,
    markets: {
      match_winner: { rule: 'one_set_void' },
      game_handicap: { rule: 'complete' },
      total_games: { rule: 'decided', flag: '"Provided there is not already a result to the match" read as: stands if already decided.' },
      games_won: { rule: 'complete' },
      win_a_set: { rule: 'set_if_retirer_won' },
    },
  },
  betr: {
    source: 'https://assets.ctfassets.net/bhti2hcbxafi/5mqwSgZcGWybZnITv0toSa/d2d0ca7e95524e0e6f6009cebd23df3b/Sport_Rules_-_version_1.4_-_10_September_2026.pdf',
    document: 'Sport Rules v1.4 (10 Sep 2026), rule 29.1',
    verified: true,
    markets: {
      match_winner: { rule: 'complete' },
      game_handicap: { rule: 'complete', flag: 'General rule 1.7 (decided bets stand) may override 29.1.' },
      total_games: { rule: 'crossed' },
      games_won: { rule: 'crossed' },
      win_a_set: { rule: 'complete', flag: 'General rule 1.7 (decided bets stand) may override 29.1.' },
    },
  },
  dabble: {
    source: 'https://helpdesk.dabble.com.au/en/articles/9783672-tennis',
    document: 'Dabble Tennis rules 30.2-30.12',
    verified: true,
    markets: decidedRest('complete'),
  },
  playup: {
    source: 'https://helpcentre.nextbet.com.au/hc/en-us/articles/13868150939279-NextBet-Betting-Rules-Sports-Novelties-Part-2-of-2-D-to-Z',
    document: 'NextBet Betting Rules (16 Oct 2026); PlayUp accounts moved to NextBet 1 Mar 2026',
    verified: true,
    markets: decidedRest('one_set_loss'),
  },
  picklebet: {
    source: 'https://help.picklebet.com/hc/en-us/articles/9113201478031-Individual-Sport-Esport-and-Novelty-Rules',
    document: 'Individual Sport, Esport and Novelty Rules (7 Apr 2026), rules 24.1, 24.7',
    verified: true,
    markets: decidedRest('complete'),
  },
  palmerbet: {
    source: 'https://www.palmerbet.com/content/sportrules',
    document: 'Palmerbet Sport Rules, tennis iii, viii',
    verified: true,
    markets: {
      match_winner: { rule: 'one_set_loss' },
      game_handicap: { rule: 'decided_after_set' },
      total_games: { rule: 'decided_after_set' },
      games_won: { rule: 'decided_after_set' },
      win_a_set: { rule: 'decided_after_set' },
    },
  },
  betgoodwin: {
    source: 'https://sports2.betgoodwin.co.uk/en/betting-rules',
    document: 'BetGoodwin betting rules (UK site; no Australian rules page found)',
    verified: false,
    markets: {
      match_winner: { rule: 'complete' },
      game_handicap: { rule: 'decided' },
      total_games: { rule: 'decided' },
      games_won: { rule: 'complete' },
      win_a_set: { rule: 'decided' },
    },
  },
  pinnacle: {
    source: 'https://www.pinnacle.com/en/future/betting-rules',
    document: 'Pinnacle Betting Rules: Tennis rules 1, 4',
    verified: true,
    markets: {
      match_winner: { rule: 'one_set_loss' },
      game_handicap: { rule: 'complete' },
      total_games: { rule: 'complete' },
      games_won: { rule: 'complete' },
      win_a_set: { rule: 'complete' },
    },
  },
  betfair: {
    source: 'https://www.betfair.com.au/AUS_NZL/aboutUs/Rules.and.Regulations/',
    document: 'Betfair AU Rules and Regulations (tennis) and each market\'s Rules tab',
    verified: true,
    markets: {
      match_winner: { rule: 'one_set_loss' },
      game_handicap: { rule: 'complete' },
      total_games: { rule: 'complete' },
      games_won: { rule: 'complete', flag: 'Market not offered on the exchange.' },
      win_a_set: { rule: 'decided' },
    },
  },
};

const ALIASES: Record<string, string> = { bet365: 'bet365 au', nextbet: 'playup', goodwin: 'betgoodwin' };

export function bookRule(book: string, market: LogMarket): (Entry & { verified: boolean }) | null {
  const key = String(book || '').trim().toLowerCase();
  const entry = BOOK_RULES[key] ?? BOOK_RULES[ALIASES[key] ?? ''];
  return entry ? { ...entry.markets[market], verified: entry.verified } : null;
}

type Totals = { gH: number; gA: number; sH: number; sA: number };

const SET_FINALS: ReadonlyArray<readonly [number, number]> = [
  [6, 0], [6, 1], [6, 2], [6, 3], [6, 4], [7, 5], [7, 6],
  [0, 6], [1, 6], [2, 6], [3, 6], [4, 6], [5, 7], [6, 7],
];

/**
 * Every distinct way an unfinished match could have been completed (games and sets per player). A tiebreak,
 * including a final-set match tiebreak, is one game, as the books count it.
 */
export function completions(sets: SetScore[], bestOf: number): Totals[] {
  const need = Math.floor(bestOf / 2) + 1;
  const last = sets[sets.length - 1];
  const partial = last && !setDone(last) ? last : null;
  const done = partial ? sets.slice(0, -1) : sets;
  const out = new Map<string, Totals>();
  const rec = (gH: number, gA: number, sH: number, sA: number, cur: readonly [number, number]) => {
    if (sH >= need || sA >= need) {
      out.set(`${gH}|${gA}|${sH}|${sA}`, { gH, gA, sH, sA });
      return;
    }
    for (const [H, A] of SET_FINALS) {
      if (H < cur[0] || A < cur[1]) continue;
      rec(gH + H - cur[0], gA + A - cur[1], sH + (H > A ? 1 : 0), sA + (A > H ? 1 : 0), [0, 0]);
    }
  };
  const gH = sets.reduce((a, s) => a + s.home, 0);
  const gA = sets.reduce((a, s) => a + s.away, 0);
  rec(gH, gA, done.filter((s) => s.home > s.away).length, done.filter((s) => s.away > s.home).length, partial ? [partial.home, partial.away] : [0, 0]);
  return [...out.values()];
}

/** The grade if the result is the same however the match could have been completed; otherwise void. */
function decided(market: LogMarket, line: number | null, selection: string, sets: SetScore[], bestOf: number): Grade {
  const grades = new Set(completions(sets, bestOf).map((t) => gradeCompleted(market, line, selection, t)));
  return grades.size === 1 ? [...grades][0]! : 'void';
}

/** Only results already reached by the games and sets played: Over / Yes can win early, nothing else. */
function crossed(market: LogMarket, line: number | null, selection: string, sets: SetScore[]): Grade {
  const gH = sets.reduce((a, s) => a + s.home, 0);
  const gA = sets.reduce((a, s) => a + s.away, 0);
  const won = (who: 'home' | 'away') => sets.filter(setDone).some((s) => (who === 'home' ? s.home > s.away : s.away > s.home));
  if (market === 'total_games' && line != null && gH + gA > line) return selection === 'over' ? 'win' : 'loss';
  if (market === 'games_won' && line != null) {
    const [who, side] = selection.split(' ') as ['home' | 'away', 'over' | 'under'];
    if ((who === 'home' ? gH : gA) > line) return side === 'over' ? 'win' : 'loss';
  }
  if (market === 'win_a_set') {
    const [who, yesNo] = selection.split(' ') as ['home' | 'away', 'yes' | 'no'];
    if (won(who)) return yesNo === 'yes' ? 'win' : 'loss';
  }
  return 'void';
}

export type BookGrade = { grade: Grade; rule: BookRule | 'house'; verified: boolean };

/**
 * A selection graded under the posted rules of the book it was priced at. Books without verified rules fall
 * back to the house grade (flagged unverified). `outcome.winner` is the player who progressed.
 */
export function gradeForBook(book: string, market: LogMarket, line: number | null, selection: string, outcome: MatchOutcome, bestOf: number, house: Grade): BookGrade {
  const entry = bookRule(book, market);
  if (!entry) return { grade: house, rule: 'house', verified: false };
  const out = (grade: Grade): BookGrade => ({ grade, rule: entry.rule, verified: entry.verified });
  if (outcome.status === 'walkover' || !outcome.sets.length) return out('void');
  if (outcome.status === 'completed') return out(house);
  const setsDone = outcome.sets.filter(setDone).length;
  const winner = outcome.winner ?? null;
  const pickedWinner = selection === winner;
  if (entry.roundRobinNeedsSet && outcome.roundRobin && setsDone < 1) return out('void');
  switch (entry.rule) {
    case 'advancer_void':
      return out(!winner ? 'void' : pickedWinner ? 'win' : 'void');
    case 'one_set_void':
      return out(!winner || setsDone < 1 ? 'void' : pickedWinner ? 'win' : 'void');
    case 'one_set_loss':
      return out(!winner || setsDone < 1 ? 'void' : pickedWinner ? 'win' : 'loss');
    case 'dq_advancer':
      return out(outcome.status === 'default' && winner ? (pickedWinner ? 'win' : 'loss') : 'void');
    case 'complete':
      return out('void');
    case 'decided':
      return out(decided(market, line, selection, outcome.sets, bestOf));
    case 'decided_after_set':
      return out(setsDone < 1 ? 'void' : decided(market, line, selection, outcome.sets, bestOf));
    case 'crossed':
      return out(crossed(market, line, selection, outcome.sets));
    case 'set_if_retirer_won': {
      const [who, yesNo] = selection.split(' ') as ['home' | 'away', 'yes' | 'no'];
      const retirer = winner === 'home' ? 'away' : winner === 'away' ? 'home' : null;
      const wonSet = outcome.sets.filter(setDone).some((s) => (who === 'home' ? s.home > s.away : s.away > s.home));
      return out(who === retirer && wonSet && yesNo === 'yes' ? 'win' : 'void');
    }
  }
}
