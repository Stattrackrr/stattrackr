/**
 * Australian lag measurement, pure rules (agreed build spec, section 3 item 5 and Part B): DraftKings
 * and FanDuel lines from BallDontLie, US moves (both books moving the same way, by line or by at least
 * 2.5 points of fair probability), and whether an Australian book has followed.
 */

import type { NblPropMarket } from '@/lib/aiPicks/markets';
import { fairTwoWay } from '@/lib/aiPicks/model/math';

export const US_BOOKS = ['draftkings', 'fanduel'] as const;
export type UsBookName = (typeof US_BOOKS)[number];

const BDL_PROP_TO_STAT: Record<string, NblPropMarket> = {
  points: 'points',
  rebounds: 'rebounds',
  assists: 'assists',
  threes: 'threeMade',
  points_rebounds_assists: 'pra',
  points_rebounds: 'pr',
  points_assists: 'pa',
  rebounds_assists: 'ra',
};

export type BdlPropRow = {
  player_id: number;
  vendor: string;
  prop_type: string;
  line_value: string | number;
  market: { type: string; over_odds?: number | null; under_odds?: number | null };
  updated_at?: string | null;
};

export type BookLine = { line: number; over: number; under: number; fairOver: number; updatedAt: string | null };
export type UsLine = { playerId: string; stat: NblPropMarket; books: Partial<Record<UsBookName, BookLine>> };

export const americanToDecimal = (a: number) => (a > 0 ? 1 + a / 100 : 1 + 100 / Math.abs(a));

/** Each US book's own main over/under (its most balanced pair) per player and stat. */
export function usLines(rows: BdlPropRow[]): Map<string, UsLine> {
  const out = new Map<string, UsLine>();
  for (const r of rows) {
    const vendor = String(r.vendor || '').toLowerCase() as UsBookName;
    const stat = BDL_PROP_TO_STAT[r.prop_type];
    if (!US_BOOKS.includes(vendor) || !stat || r.market?.type !== 'over_under') continue;
    const o = r.market.over_odds;
    const u = r.market.under_odds;
    const line = Number(r.line_value);
    if (o == null || u == null || !Number.isFinite(line)) continue;
    const over = americanToDecimal(o);
    const under = americanToDecimal(u);
    const fair = fairTwoWay(over, under)?.[0];
    if (fair == null) continue;
    const key = `${r.player_id}|${stat}`;
    const entry = out.get(key) ?? { playerId: String(r.player_id), stat, books: {} };
    const prev = entry.books[vendor];
    if (!prev || Math.abs(over - under) < Math.abs(prev.over - prev.under)) {
      entry.books[vendor] = { line, over, under, fairOver: fair, updatedAt: r.updated_at ?? null };
    }
    out.set(key, entry);
  }
  return out;
}

/** +1 when a book now makes the over more likely (line down, or fair over up at the same line), -1 the other way, 0 none. */
export function bookDirection(before: BookLine, after: BookLine, minFairMove = 0.025): -1 | 0 | 1 {
  if (after.line !== before.line) return after.line < before.line ? 1 : -1;
  const d = after.fairOver - before.fairOver;
  if (Math.abs(d) < minFairMove) return 0;
  return d > 0 ? 1 : -1;
}

export type UsMove = {
  key: string;
  playerId: string;
  stat: NblPropMarket;
  direction: -1 | 1;
  /** Latest scrape time among the moving books: when the move was visible in the US. */
  movedAt: string | null;
  from: Record<string, { line: number; fairOver: number }>;
  to: Record<string, { line: number; fairOver: number }>;
};

/** Moves where both US books moved the same way since the previous poll (one book alone is noise). */
export function detectUsMoves(prev: Map<string, UsLine>, next: Map<string, UsLine>): UsMove[] {
  const moves: UsMove[] = [];
  for (const [key, now] of next) {
    const before = prev.get(key);
    if (!before) continue;
    const dirs = US_BOOKS.map((b) => (before.books[b] && now.books[b] ? bookDirection(before.books[b]!, now.books[b]!) : 0));
    if (dirs.some((d) => d === 0) || dirs[0] !== dirs[1]) continue;
    const times = US_BOOKS.map((b) => now.books[b]?.updatedAt).filter((t): t is string => Boolean(t)).sort();
    moves.push({
      key,
      playerId: now.playerId,
      stat: now.stat,
      direction: dirs[0] as -1 | 1,
      movedAt: times.at(-1) ?? null,
      from: Object.fromEntries(US_BOOKS.map((b) => [b, { line: before.books[b]!.line, fairOver: before.books[b]!.fairOver }])),
      to: Object.fromEntries(US_BOOKS.map((b) => [b, { line: now.books[b]!.line, fairOver: now.books[b]!.fairOver }])),
    });
  }
  return moves;
}

export type AuQuote = { line: number; over: number | null; under: number | null };

/** The Australian book has moved the way the US did: its line, or its price at the same line by at least 1 point of implied probability. */
export function auFollowed(before: AuQuote, now: AuQuote, direction: -1 | 1, minImplied = 0.01): boolean {
  if (now.line !== before.line) return (now.line < before.line ? 1 : -1) === direction;
  const shorter = (a: number | null, b: number | null) => (a && b ? 1 / b - 1 / a : 0);
  const overMove = shorter(before.over, now.over);
  const underMove = shorter(before.under, now.under);
  return direction === 1 ? overMove >= minImplied || underMove <= -minImplied : underMove >= minImplied || overMove <= -minImplied;
}
