/**
 * Shared shape for the extra tennis bookmaker feeds (Ladbrokes, Neds, BetRight, PointsBet, TAB, odds-api.net).
 * Each feed reads one match into a SourceMatch in its own home/away order; this file turns that into a
 * TennisBookRow in API-Tennis home orientation so it merges with the existing books unchanged.
 */

import type { BookmakerRegion } from '@/lib/bookmakers';
import { decimalToAmerican } from '@/lib/currencyUtils';
import type { TennisNextGame } from '@/lib/tennis/nextGame';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';
import { filterTennisOuLines, type TennisBookRow, type TennisExtraMarket, type TennisOuLine } from '@/lib/tennis/oddsTypes';

/** Decimal prices. `line` is the over/under line. */
export type SourceOu = { line: number; over: number; under: number };
/** Game or set handicap from the home player's side: home gets `homeLine`, away gets `-homeLine`. */
export type SourceHandicap = { homeLine: number; home: number; away: number };
export type SourceYesNo = { yes: number; no: number };

export type SourceMatch = {
  book: string;
  region?: BookmakerRegion;
  home: string;
  away: string;
  h2h?: { home: number; away: number };
  handicaps: SourceHandicap[];
  totals: SourceOu[];
  homeGames: SourceOu[];
  awayGames: SourceOu[];
  totalSets: SourceOu[];
  homeWinSet?: SourceYesNo;
  awayWinSet?: SourceYesNo;
  /** ±1.5 set handicaps; only read as win-a-set when the match is best of 3. */
  setHandicaps: SourceHandicap[];
  /** Every other market the book prices, player selections as "home" / "away" in this source's order. */
  extraMarkets?: TennisExtraMarket[];
};

export type ListedEvent = { id: string; home: string; away: string; startsAt: string | null };

export function emptySourceMatch(book: string, home: string, away: string, region?: BookmakerRegion): SourceMatch {
  return { book, region, home, away, handicaps: [], totals: [], homeGames: [], awayGames: [], totalSets: [], setHandicaps: [] };
}

export const validPrice = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 1;

export function parseNumber(value: unknown): number | null {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** "La Serna, Juan Manuel" -> "Juan Manuel La Serna". */
export function tennisDisplayName(name: string): string {
  const s = String(name || '').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  return m ? `${m[2]} ${m[1]}` : s;
}

export function samePlayer(a: string, b: string): boolean {
  return tennisIdentityMatch(tennisDisplayName(a), tennisDisplayName(b));
}

/** Which side of the source match a player name is on. */
export function sideOf(name: string, match: { home: string; away: string }): 'home' | 'away' | null {
  const home = samePlayer(name, match.home);
  const away = samePlayer(name, match.away);
  if (home === away) return null;
  return home ? 'home' : 'away';
}

const START_TOLERANCE_MS = 24 * 60 * 60 * 1000;

/** The listed event for an API-Tennis match, and whether its home is API-Tennis home. */
export function findListedEvent(
  events: ListedEvent[],
  game: TennisNextGame
): { event: ListedEvent; homeIsHome: boolean } | null {
  const tip = Date.parse(String(game.tipoff || ''));
  for (const event of events) {
    const start = Date.parse(String(event.startsAt || ''));
    if (Number.isFinite(start) && Number.isFinite(tip) && Math.abs(start - tip) > START_TOLERANCE_MS) continue;
    if (samePlayer(event.home, game.homeName) && samePlayer(event.away, game.awayName)) return { event, homeIsHome: true };
    if (samePlayer(event.home, game.awayName) && samePlayer(event.away, game.homeName)) return { event, homeIsHome: false };
  }
  return null;
}

/** Best of 3 unless a men's slam; set handicaps and "2 sets / 3 sets" only translate in best of 3. */
export function tennisGameIsBestOfThree(game: Pick<TennisNextGame, 'isGrandSlam' | 'tour'>): boolean {
  return !(game.isGrandSlam && game.tour === 'ATP');
}

function american(decimal: number | undefined): string {
  return validPrice(decimal) ? decimalToAmerican(decimal) : 'N/A';
}

const EMPTY: TennisOuLine = { line: 'N/A', over: 'N/A', under: 'N/A' };

function ouLines(stat: string, rows: SourceOu[]): TennisOuLine[] {
  return filterTennisOuLines(
    stat,
    rows
      .filter((r) => validPrice(r.over) && validPrice(r.under))
      .map((r) => ({ line: String(r.line), over: american(r.over), under: american(r.under) }))
  );
}

/** Line whose two prices are closest together. */
function mainLine(lines: TennisOuLine[]): TennisOuLine {
  let best: TennisOuLine | null = null;
  let gap = Number.POSITIVE_INFINITY;
  for (const row of lines) {
    const o = parseNumber(row.over);
    const u = parseNumber(row.under);
    if (o == null || u == null) continue;
    const d = Math.abs(Math.abs(o) - Math.abs(u)) + (Math.sign(o) === Math.sign(u) ? 0 : 1000);
    if (d < gap) {
      gap = d;
      best = row;
    }
  }
  return best ?? lines[0] ?? EMPTY;
}

/** "home 2-1" <-> "away 2-1": the same selection seen from the other orientation. */
const flipSelection = (s: string) => s.replace(/\b(home|away)\b/g, (side) => (side === 'home' ? 'away' : 'home'));

function flip(src: SourceMatch): SourceMatch {
  const handicap = (h: SourceHandicap): SourceHandicap => ({ homeLine: -h.homeLine, home: h.away, away: h.home });
  return {
    ...src,
    extraMarkets: src.extraMarkets?.map((m) => ({ ...m, selection: flipSelection(m.selection) })),
    home: src.away,
    away: src.home,
    h2h: src.h2h ? { home: src.h2h.away, away: src.h2h.home } : undefined,
    handicaps: src.handicaps.map(handicap),
    homeGames: src.awayGames,
    awayGames: src.homeGames,
    homeWinSet: src.awayWinSet,
    awayWinSet: src.homeWinSet,
    setHandicaps: src.setHandicaps.map(handicap),
  };
}

/** Win-a-set from a ±1.5 set handicap: home +1.5 is "home wins a set", away -1.5 is its "no". */
function winSetFromHandicaps(handicaps: SourceHandicap[], side: 'home' | 'away'): SourceYesNo | undefined {
  const want = side === 'home' ? 1.5 : -1.5;
  const row = handicaps.find((h) => Math.abs(h.homeLine - want) < 0.01);
  if (!row) return undefined;
  return side === 'home' ? { yes: row.home, no: row.away } : { yes: row.away, no: row.home };
}

function yesNoLine(v: SourceYesNo | undefined): TennisOuLine[] {
  return v && validPrice(v.yes) && validPrice(v.no) ? [{ line: '0.5', over: american(v.yes), under: american(v.no) }] : [];
}

/** One book row in API-Tennis home orientation, or null when nothing usable was priced. */
export function sourceMatchToBookRow(
  source: SourceMatch,
  homeIsHome: boolean,
  bestOfThree: boolean
): TennisBookRow | null {
  const src = homeIsHome ? source : flip(source);
  const spread = filterTennisOuLines(
    'spread',
    src.handicaps
      .filter((h) => validPrice(h.home) && validPrice(h.away))
      .map((h) => ({ line: String(h.homeLine), over: american(h.home), under: american(h.away) }))
  );
  const total = ouLines('totalGames', src.totals);
  const gamesWon = ouLines('gamesWon', src.homeGames);
  const gamesLost = ouLines('gamesLost', src.awayGames);
  const totalSets = bestOfThree ? ouLines('totalSets', src.totalSets.filter((r) => r.line === 2.5)) : ouLines('totalSets', src.totalSets.filter((r) => r.line !== 2.5));
  const setsWon = yesNoLine(src.homeWinSet ?? (bestOfThree ? winSetFromHandicaps(src.setHandicaps, 'home') : undefined));
  const setsLost = yesNoLine(src.awayWinSet ?? (bestOfThree ? winSetFromHandicaps(src.setHandicaps, 'away') : undefined));
  const h2h = src.h2h && validPrice(src.h2h.home) && validPrice(src.h2h.away) ? src.h2h : undefined;
  const extraMarkets = (src.extraMarkets ?? []).filter((m) => validPrice(m.price));
  if (!h2h && !spread.length && !total.length && !gamesWon.length && !gamesLost.length && !totalSets.length && !setsWon.length && !setsLost.length && !extraMarkets.length) {
    return null;
  }
  return {
    name: src.book,
    region: src.region,
    ...(extraMarkets.length ? { extraMarkets } : {}),
    H2H: { home: american(h2h?.home), away: american(h2h?.away) },
    Spread: mainLine(spread),
    Total: mainLine(total),
    GamesWon: mainLine(gamesWon),
    GamesLost: mainLine(gamesLost),
    TotalSets: mainLine(totalSets),
    SpreadLines: spread,
    TotalLines: total,
    GamesWonLines: gamesWon,
    GamesLostLines: gamesLost,
    TotalSetsLines: totalSets,
    SetsWon: setsWon[0] ?? EMPTY,
    SetsLost: setsLost[0] ?? EMPTY,
    SetsWonLines: setsWon,
    SetsLostLines: setsLost,
  };
}

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  Accept: 'application/json, text/plain, */*',
};

export async function fetchSiteJson(url: string, headers: Record<string, string> = {}, timeoutMs = 12_000): Promise<any> {
  try {
    const res = await fetch(url, {
      headers: { ...BROWSER_HEADERS, ...headers },
      cache: 'no-store',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

export type ExtraBookFeed = {
  name: string;
  list: () => Promise<ListedEvent[]>;
  detail: (event: ListedEvent) => Promise<SourceMatch | null>;
};

/** Book rows per API-Tennis match id from one feed; only matched events get a detail request. */
export async function runExtraBookFeed(
  feed: ExtraBookFeed,
  games: TennisNextGame[],
  concurrency = 4
): Promise<Map<string, TennisBookRow>> {
  const out = new Map<string, TennisBookRow>();
  const events = (await feed.list()).filter((e) => !e.home.includes('/') && !e.away.includes('/'));
  if (!events.length) return out;
  const jobs: Array<{ game: TennisNextGame; event: ListedEvent; homeIsHome: boolean }> = [];
  for (const game of games) {
    if (!game.matchId) continue;
    const hit = findListedEvent(events, game);
    if (hit) jobs.push({ game, ...hit });
  }
  await mapLimit(jobs, concurrency, async ({ game, event, homeIsHome }) => {
    const source = await feed.detail(event).catch(() => null);
    const row = source ? sourceMatchToBookRow(source, homeIsHome, tennisGameIsBestOfThree(game)) : null;
    if (row) out.set(String(game.matchId), row);
  });
  return out;
}
