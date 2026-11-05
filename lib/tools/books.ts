/**
 * Australian + sharp books for the tools board.
 * Keep the whitelist short: odds-api.net snapshots hit a row cap when too many books are requested.
 */

export const TOOLS_SOFT_BOOKS = [
  'sportsbet',
  'tab',
  'tabtouch',
  'ladbrokes',
  'neds',
  'pointsbet',
  'unibet',
  'dabble',
  'playup',
  'betright',
  'betr',
  'palmerbet',
  'picklebet',
  'bet365',
  'betgoodwin',
  'allbets',
] as const;

export const TOOLS_SHARP_BOOKS = ['pinnacle', 'betfair'] as const;

export const TOOLS_ODDS_NET_BOOKS: readonly string[] = [...TOOLS_SOFT_BOOKS, ...TOOLS_SHARP_BOOKS];

export const TOOLS_SHARP_SET: ReadonlySet<string> = new Set(TOOLS_SHARP_BOOKS);
export const TOOLS_SOFT_SET: ReadonlySet<string> = new Set(TOOLS_SOFT_BOOKS);
export const TOOLS_BOOK_SET: ReadonlySet<string> = new Set(TOOLS_ODDS_NET_BOOKS);

const DISPLAY: Record<string, string> = {
  sportsbet: 'Sportsbet',
  tab: 'TAB',
  tabtouch: 'TABtouch',
  ladbrokes: 'Ladbrokes',
  neds: 'Neds',
  pointsbet: 'PointsBet',
  unibet: 'Unibet',
  dabble: 'Dabble',
  playup: 'PlayUp',
  betright: 'BetRight',
  betr: 'Betr',
  palmerbet: 'Palmerbet',
  picklebet: 'Picklebet',
  bet365: 'Bet365',
  betgoodwin: 'BetGoodwin',
  allbets: 'AllBets',
  pinnacle: 'Pinnacle',
  betfair: 'Betfair',
};

/** Canonical lowercase slug used in scans. */
export function canonBook(raw: string | null | undefined): string {
  const s = String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/_au$/, '')
    .replace(/au$/, '');
  if (s === 'sportsbet' || s === 'sportsbetting') return 'sportsbet';
  if (s === 'pointsbetau' || s === 'pointsbet') return 'pointsbet';
  if (s === 'unibetau' || s === 'unibet') return 'unibet';
  if (s === 'bet365au' || s === 'bet365') return 'bet365';
  if (s === 'betright' || s === 'bet right') return 'betright';
  if (s === 'betfairau' || s === 'betfairexchange' || s === 'betfair') return 'betfair';
  // odds-api.net catalogs AllBets as `allbets` but returns lines under source key `goldbet`.
  if (s === 'allbet' || s === 'allbets' || s === 'goldbet') return 'allbets';
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');
}

export function displayBook(bookKey: string): string {
  return DISPLAY[canonBook(bookKey)] ?? bookKey;
}

export function isSharpBook(bookKey: string): boolean {
  return TOOLS_SHARP_SET.has(canonBook(bookKey));
}

export function isSoftBook(bookKey: string): boolean {
  return TOOLS_SOFT_SET.has(canonBook(bookKey));
}
