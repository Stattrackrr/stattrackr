/**
 * Full-universe NBA prop logging: one game on the odds board turned into the lines we log. Every
 * player on the board, every stat, at its main (consensus) line, with each book's quote and source
 * time, fair over probabilities by book group, the best Australian prices, and the game's market
 * spread and total. Names that match no player are kept (unmatched), never dropped.
 */

import { NBL_PROP_MARKETS, type NblPropMarket } from '@/lib/aiPicks/markets';
import { nbaPlayerLines, nbaRosterEntry, resolveNbaBoardName } from '@/lib/aiPicks/candidates/nba';
import { gameQuotes } from '@/lib/aiPicks/candidates/nbl';
import { isAussieBook } from '@/lib/aiPicks/candidates/types';
import { coherentPair, fairTwoWay, median, round } from '@/lib/aiPicks/model/math';
import { consensusLine } from '@/lib/nbl/lineMovement';
import type { NblGameOdds } from '@/lib/nbl/oddsTypes';
import type { NblSnapLine } from '@/lib/nbl/playerPropSnapshots';
import type { NbaGameOdds } from '@/lib/nba/dash/oddsTypes';

export type PropLogPlayer = { id: string; name: string; teamCode: string };

export type LoggedQuote = {
  book: string;
  line: number;
  over: number | null;
  under: number | null;
  sourceTs: string | null;
  coherent: boolean | null;
};

export type LoggedLine = {
  boardName: string;
  player: PropLogPlayer | null;
  stat: NblPropMarket;
  mainLine: number;
  quotes: LoggedQuote[];
  nBooks: number;
  bookDispersion: number | null;
  fairOverAll: number | null;
  fairOverAllMult: number | null;
  fairOverUs: number | null;
  fairOverPinnacle: number | null;
  fairOverAu: number | null;
  bestAuOver: { price: number; book: string } | null;
  bestAuUnder: { price: number; book: string } | null;
};

export type GameMarket = { homeSpread: number | null; total: number | null };

/** The US reference books; other US books count toward the all-books fair only. */
const US_REFERENCE = new Set(['draftkings', 'fanduel']);
const bookGroup = (book: string): 'au' | 'pinnacle' | 'us' | 'other' => {
  const k = book.toLowerCase();
  return isAussieBook(book) ? 'au' : k === 'pinnacle' ? 'pinnacle' : US_REFERENCE.has(k) ? 'us' : 'other';
};

function sd(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/** Consensus main spread (home side) and total from the game-line books. */
export function gameMarket(odds: NbaGameOdds): GameMarket {
  const q = gameQuotes(odds as unknown as NblGameOdds);
  return {
    homeSpread: consensusLine(q.spreads.filter((s) => s.main).map((s) => s.homeLine)),
    total: consensusLine(q.totals.filter((t) => t.main).map((t) => t.line)),
  };
}

/** A team's expected points from the market: half the total, less half its own handicap. */
export function impliedTeamTotal(market: GameMarket, isHome: boolean): number | null {
  if (market.total == null || market.homeSpread == null) return null;
  const line = isHome ? market.homeSpread : -market.homeSpread;
  return round(market.total / 2 - line / 2, 2);
}

/** One book's quote for the log: its two-way price at the main line, else its two-way line nearest it, else a milestone at it. */
function bookQuote(book: string, lines: NblSnapLine[], main: number, sourceTs: string | null): LoggedQuote | null {
  const twoWay = lines.filter((l) => l.book === book && l.kind === 'ou' && l.overDecimal && l.underDecimal);
  const atMain = twoWay.find((l) => l.line === main);
  const nearest = atMain ?? [...twoWay].sort((a, b) => Math.abs(a.line - main) - Math.abs(b.line - main))[0];
  if (nearest) {
    return {
      book,
      line: nearest.line,
      over: nearest.overDecimal,
      under: nearest.underDecimal,
      sourceTs,
      coherent: coherentPair(nearest.overDecimal, nearest.underDecimal),
    };
  }
  const milestone = lines.find((l) => l.book === book && l.kind === 'milestone' && l.line === main && l.overDecimal);
  return milestone ? { book, line: main, over: milestone.overDecimal, under: null, sourceTs, coherent: null } : null;
}

export function lineForStat(
  boardName: string,
  player: PropLogPlayer | null,
  stat: NblPropMarket,
  lines: NblSnapLine[],
  times: Record<string, string>
): LoggedLine | null {
  const twoWay = lines.filter((l) => l.kind === 'ou' && l.overDecimal && l.underDecimal);
  const mainLine = consensusLine(twoWay.map((l) => l.line));
  if (mainLine == null) return null;
  const quotes = [...new Set(lines.map((l) => l.book))]
    .map((book) => bookQuote(book, lines, mainLine, times[book] ?? null))
    .filter((q): q is LoggedQuote => q != null);
  const atMain = quotes.filter((q) => q.line === mainLine && q.over && q.under && q.coherent);
  const power = atMain.map((q) => ({ book: q.book, p: fairTwoWay(q.over!, q.under!)?.[0] ?? NaN })).filter((f) => Number.isFinite(f.p));
  const mult = atMain.map((q) => (1 / q.over!) / (1 / q.over! + 1 / q.under!));
  const groupFair = (g: ReturnType<typeof bookGroup>) => median(power.filter((f) => bookGroup(f.book) === g).map((f) => f.p));
  const best = (side: 'over' | 'under') => {
    const au = quotes.filter((q) => q.line === mainLine && isAussieBook(q.book) && q[side] != null && q[side]! > 1);
    const top = au.sort((a, b) => b[side]! - a[side]!)[0];
    return top ? { price: top[side]!, book: top.book } : null;
  };
  const r = (v: number | null) => (v == null ? null : round(v, 4));
  return {
    boardName,
    player,
    stat,
    mainLine,
    quotes,
    nBooks: power.length,
    bookDispersion: r(sd(power.map((f) => f.p))),
    fairOverAll: r(median(power.map((f) => f.p))),
    fairOverAllMult: r(median(mult)),
    fairOverUs: r(groupFair('us')),
    fairOverPinnacle: r(groupFair('pinnacle')),
    fairOverAu: r(groupFair('au')),
    bestAuOver: best('over'),
    bestAuUnder: best('under'),
  };
}

/**
 * Every logged line in one game. Board spellings of the same player are grouped (the exact roster
 * spelling leads); a name no roster player matches is logged on its own, unmatched.
 */
export function gameLines(odds: NbaGameOdds, roster: PropLogPlayer[]): LoggedLine[] {
  const entries = roster.map((p) => nbaRosterEntry(p.id, p.name));
  const byId = new Map(roster.map((p) => [p.id, p]));
  const groups = new Map<string, { player: PropLogPlayer | null; names: string[] }>();
  const boardNames = new Set<string>();
  for (const players of Object.values(odds.playerProps ?? {})) for (const name of Object.keys(players ?? {})) boardNames.add(name);
  for (const name of [...boardNames].sort()) {
    const id = resolveNbaBoardName(name, entries);
    const key = id ? `id:${id}` : `name:${name}`;
    const g = groups.get(key) ?? { player: id ? byId.get(id) ?? null : null, names: [] };
    if (g.player && g.player.name.toLowerCase() === name.toLowerCase()) g.names.unshift(name);
    else g.names.push(name);
    groups.set(key, g);
  }
  const times = odds.propBookTimes ?? {};
  const out: LoggedLine[] = [];
  for (const { player, names } of groups.values()) {
    const all = nbaPlayerLines(odds, names);
    for (const stat of NBL_PROP_MARKETS) {
      const line = lineForStat(names[0]!, player, stat, all.filter((l) => l.stat === stat), times);
      if (line) out.push(line);
    }
  }
  return out;
}
