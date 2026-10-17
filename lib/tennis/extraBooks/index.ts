/**
 * Extra tennis bookmakers on top of API-Tennis and The Odds API: odds-api.net (all its books), Ladbrokes,
 * Neds, BetRight and PointsBet. Feeds run in parallel; a slow or blocked feed only drops its own rows.
 */

import { betrightTennisFeed } from '@/lib/tennis/extraBooks/betright';
import { ladbrokesTennisFeed, nedsTennisFeed } from '@/lib/tennis/extraBooks/entain';
import { pointsbetTennisFeed } from '@/lib/tennis/extraBooks/pointsbet';
import { runExtraBookFeed } from '@/lib/tennis/extraBooks/shared';
import type { TennisNextGame } from '@/lib/tennis/nextGame';
import { fetchTennisOddsApiNetBooks } from '@/lib/tennis/oddsApiNet';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';

const FEED_BUDGET_MS = 90_000;

function withBudget<T>(work: Promise<T>, fallback: T): Promise<T> {
  return Promise.race([
    work.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), FEED_BUDGET_MS)),
  ]);
}

export type ExtraTennisBooks = {
  bet365Au: Map<string, TennisBookRow>;
  rows: Map<string, TennisBookRow[]>;
  /** Matches each feed priced, for the refresh summary. */
  counts: Record<string, number>;
};

export async function fetchExtraTennisBooks(games: TennisNextGame[]): Promise<ExtraTennisBooks> {
  const feeds = [ladbrokesTennisFeed, nedsTennisFeed, betrightTennisFeed, pointsbetTennisFeed];
  const [net, ...siteRows] = await Promise.all([
    withBudget(fetchTennisOddsApiNetBooks(games), { bet365Au: new Map(), rows: new Map() }),
    ...feeds.map((feed) => withBudget(runExtraBookFeed(feed, games), new Map<string, TennisBookRow>())),
  ]);
  const rows = new Map<string, TennisBookRow[]>();
  const add = (matchId: string, row: TennisBookRow) => rows.set(matchId, [...(rows.get(matchId) ?? []), row]);
  for (const [matchId, list] of net.rows) for (const row of list) add(matchId, row);
  const counts: Record<string, number> = { 'odds-api.net': net.rows.size, 'bet365 AU': net.bet365Au.size };
  feeds.forEach((feed, i) => {
    counts[feed.name] = siteRows[i].size;
    for (const [matchId, row] of siteRows[i]) add(matchId, row);
  });
  return { bet365Au: net.bet365Au, rows, counts };
}
