/**
 * NBA closing prices: the odds board keeps each game's last pre-tip prices for 6 hours after tip.
 * The closing price is the leg's own book at the leg's own line; a line the book no longer offered
 * at the close has no closing price.
 */

import { nbaAchievementQuotes, nbaPlayerLines, nbaRosterEntry, resolveNbaBoardName } from '@/lib/aiPicks/candidates/nba';
import { gameQuotes } from '@/lib/aiPicks/candidates/nbl';
import type { ClosingLine } from '@/lib/aiPicks/grade/closing';
import { isNbaAchievementMarket, isNblGameMarket, isNblPropMarket } from '@/lib/aiPicks/markets';
import type { AiPickLeg } from '@/lib/aiPicks/types';
import { normalizeNbaPropPlayerName } from '@/lib/nba/dash/odds';
import type { NbaGameOdds } from '@/lib/nba/dash/oddsTypes';
import type { NblGameOdds } from '@/lib/nbl/oddsTypes';

const bookKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Board spellings of the leg's player ("Derrick White", "D White"), the exact one first. */
function boardNames(game: NbaGameOdds, leg: AiPickLeg): string[] {
  const all = new Set<string>();
  for (const players of Object.values(game.playerProps ?? {})) for (const name of Object.keys(players ?? {})) all.add(name);
  const want = normalizeNbaPropPlayerName(leg.player ?? '');
  const roster = [nbaRosterEntry(leg.playerId ?? 'x', leg.player ?? '')];
  const exact = [...all].filter((n) => normalizeNbaPropPlayerName(n) === want);
  const fuzzy = [...all].filter((n) => !exact.includes(n) && resolveNbaBoardName(n, roster) != null);
  return [...exact, ...fuzzy];
}

export function nbaClosingFromBoard(leg: AiPickLeg, game: NbaGameOdds): ClosingLine | null {
  const book = bookKey(leg.bookmaker);
  if (isNbaAchievementMarket(leg.market)) {
    if (!leg.player) return null;
    const q = nbaAchievementQuotes(game, boardNames(game, leg), leg.market).find((x) => bookKey(x.book) === book);
    return q ? { line: leg.line ?? 0.5, price: q.yes } : null;
  }
  if (isNblPropMarket(leg.market)) {
    if (!leg.player || leg.line == null) return null;
    const names = boardNames(game, leg);
    if (!names.length) return null;
    // The book may list the leg's line as an over/under or as its "N+" (same bet for an over).
    const mine = nbaPlayerLines(game, names).filter((l) => bookKey(l.book) === book && l.stat === leg.market && l.line === leg.line);
    const order = leg.marketKind === 'milestone' ? (['milestone', 'ou'] as const) : (['ou', 'milestone'] as const);
    const line = order
      .filter((kind) => kind === 'ou' || leg.side === 'over')
      .map((kind) => mine.find((l) => l.kind === kind))
      .find(Boolean);
    if (!line) return null;
    const price = leg.side === 'under' ? line.underDecimal : line.overDecimal;
    return price ? { line: leg.line, price } : null;
  }
  if (isNblGameMarket(leg.market)) {
    const q = gameQuotes(game as unknown as NblGameOdds);
    const mine = <T extends { book: string }>(rows: T[]) => rows.filter((r) => bookKey(r.book) === book);
    if (leg.market === 'h2h') {
      const price = mine(leg.side === 'home' ? q.h2hHome : q.h2hAway)[0]?.price ?? null;
      return price ? { line: null, price } : null;
    }
    if (leg.line == null) return null;
    if (leg.market === 'spread') {
      const homeLine = leg.side === 'home' ? leg.line : -leg.line;
      const row = mine(q.spreads).find((s) => s.homeLine === homeLine);
      const price = row ? (leg.side === 'home' ? row.home : row.away) : null;
      return price ? { line: leg.line, price } : null;
    }
    const row = mine(q.totals).find((t) => t.line === leg.line);
    const price = row ? (leg.side === 'under' ? row.under : row.over) : null;
    return price ? { line: leg.line, price } : null;
  }
  return null;
}
