/**
 * Extra tennis bookmakers on top of API-Tennis and The Odds API: odds-api.net (the Australian books
 * plus Pinnacle and Betfair), Ladbrokes, Neds, BetRight, PointsBet and Unibet. Feeds run in parallel;
 * a slow or blocked feed only drops its own rows. The direct scrapers stay on until their prices match
 * odds-api.net's for the same books (tallied daily in parity.ts), then retire.
 */

import { betrightTennisFeed } from '@/lib/tennis/extraBooks/betright';
import { ladbrokesTennisFeed, nedsTennisFeed } from '@/lib/tennis/extraBooks/entain';
import { pointsbetTennisFeed } from '@/lib/tennis/extraBooks/pointsbet';
import { runExtraBookFeed } from '@/lib/tennis/extraBooks/shared';
import { unibetTennisFeed } from '@/lib/tennis/extraBooks/unibet';
import type { TennisNextGame } from '@/lib/tennis/nextGame';
import { fetchTennisOddsApiNetBooks, type TennisOddsNetStats } from '@/lib/tennis/oddsApiNet';
import { addToDay, tallyBook, type ParityDay, type ParityTally } from '@/lib/tennis/extraBooks/parity';
import sharedCache from '@/lib/sharedCache';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';

const FEED_BUDGET_MS = 90_000;
const PARITY_KEY = 'tennis_feed_parity_v1';
const PARITY_TTL_S = 45 * 24 * 60 * 60;

async function recordParity(books: Record<string, ParityTally>, rowCapHits: number): Promise<void> {
  const key = `${PARITY_KEY}:${new Date().toISOString().slice(0, 10)}`;
  const day = (await sharedCache.getJSON<ParityDay>(key)) ?? { runs: 0, rowCapHits: 0, books: {} };
  await sharedCache.setJSON(key, addToDay(day, books, rowCapHits), PARITY_TTL_S);
}

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), FEED_BUDGET_MS)),
  ]);
}

export type ExtraTennisBooks = {
  rows: Map<string, TennisBookRow[]>;
  /** Matches each feed priced, for the refresh summary. */
  counts: Record<string, number>;
};

export async function fetchExtraTennisBooks(games: TennisNextGame[]): Promise<ExtraTennisBooks> {
  const feeds = [ladbrokesTennisFeed, nedsTennisFeed, betrightTennisFeed, pointsbetTennisFeed, unibetTennisFeed];
  const netStats: TennisOddsNetStats = { matches: 0, rowCapHits: [] };
  const [net, ...siteRows] = await Promise.all([
    withBudget(fetchTennisOddsApiNetBooks(games, netStats), new Map<string, TennisBookRow[]>()),
    ...feeds.map((feed) => withBudget(runExtraBookFeed(feed, games), new Map<string, TennisBookRow>())),
  ]);
  const rows = new Map<string, TennisBookRow[]>();
  const add = (matchId: string, row: TennisBookRow) => rows.set(matchId, [...(rows.get(matchId) ?? []), row]);
  for (const [matchId, list] of net) for (const row of list) add(matchId, row);
  const counts: Record<string, number> = { 'odds-api.net': net.size, 'odds-api.net row cap hits': netStats.rowCapHits.length };
  const parity: Record<string, ParityTally> = {};
  feeds.forEach((feed, i) => {
    counts[feed.name] = siteRows[i].size;
    for (const [matchId, row] of siteRows[i]) add(matchId, row);
    parity[feed.name] = tallyBook(net, siteRows[i], feed.name);
  });
  await recordParity(parity, netStats.rowCapHits.length).catch(() => undefined);
  return { rows, counts };
}
