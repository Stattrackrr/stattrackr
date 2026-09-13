/**
 * Book totals / moneyline for the tennis ask pack — format-aware, not the BO3 default.
 */

import { americanToDecimal } from '@/lib/currencyUtils';
import type { TennisMatchOdds, TennisOuLine } from '@/lib/tennis/oddsTypes';
import { tennisParseLineNumber } from '@/lib/tennis/oddsTypes';

export type TennisAskPrice = {
  book: string;
  line: number | null;
  over: number | null;
  under: number | null;
};

export type TennisAskMoneyline = {
  book: string;
  player: number | null;
  opponent: number | null;
};

export type TennisAskMarketOdds = {
  listedTotalLine: number | null;
  pickemTotalLine: number | null;
  formatMin: number;
  formatMax: number;
  totals: TennisAskPrice[];
  totalsAtListed: TennisAskPrice[];
  moneyline: TennisAskMoneyline[];
};

function pct1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function impliedPct(dec: number | null | undefined): number | null {
  if (dec == null || dec <= 1) return null;
  return pct1((1 / dec) * 100);
}

export function noVigTwoWay(
  a: number | null | undefined,
  b: number | null | undefined
): { a: number | null; b: number | null } {
  const ia = a != null && a > 1 ? 1 / a : null;
  const ib = b != null && b > 1 ? 1 / b : null;
  if (ia == null || ib == null) return { a: impliedPct(a), b: impliedPct(b) };
  const sum = ia + ib;
  return { a: pct1((ia / sum) * 100), b: pct1((ib / sum) * 100) };
}

function sideEdge(modelPct: number, implied: number | null): number | null {
  if (implied == null) return null;
  return pct1(modelPct - implied);
}

export function buildTennisAskEdge(
  market: TennisAskMarketOdds | null | undefined,
  model: { playerWinPct: number; opponentWinPct: number; totalsOverPct: number; totalsLine: number }
) {
  const moneyline = (market?.moneyline || []).map((row) => {
    const raw = { player: impliedPct(row.player), opponent: impliedPct(row.opponent) };
    const fair = noVigTwoWay(row.player, row.opponent);
    return {
      book: row.book,
      playerDec: row.player,
      opponentDec: row.opponent,
      playerImplied: raw.player,
      opponentImplied: raw.opponent,
      playerNoVig: fair.a,
      opponentNoVig: fair.b,
      playerEdge: sideEdge(model.playerWinPct, fair.a ?? raw.player),
      opponentEdge: sideEdge(model.opponentWinPct, fair.b ?? raw.opponent),
    };
  });
  const totals = (market?.totalsAtListed?.length ? market.totalsAtListed : market?.totals || []).map((row) => {
    const raw = { over: impliedPct(row.over), under: impliedPct(row.under) };
    const fair = noVigTwoWay(row.over, row.under);
    const modelUnder = pct1(100 - model.totalsOverPct);
    return {
      book: row.book,
      line: row.line,
      overDec: row.over,
      underDec: row.under,
      overImplied: raw.over,
      underImplied: raw.under,
      overNoVig: fair.a,
      underNoVig: fair.b,
      overEdge: sideEdge(model.totalsOverPct, fair.a ?? raw.over),
      underEdge: sideEdge(modelUnder, fair.b ?? raw.under),
    };
  });

  const best = <T extends { book: string; edge: number | null; dec: number | null; noVig: number | null }>(
    rows: T[]
  ) => {
    const ranked = rows.filter((row) => row.edge != null && row.dec != null) as Array<
      T & { edge: number; dec: number }
    >;
    ranked.sort((a, b) => b.edge - a.edge || b.dec - a.dec);
    const top = ranked[0];
    if (!top) return null;
    return { book: top.book, decimal: top.dec, noVig: top.noVig, edge: top.edge };
  };

  return {
    moneyline: {
      modelPlayerPct: model.playerWinPct,
      modelOpponentPct: model.opponentWinPct,
      books: moneyline,
      bestPlayer: best(
        moneyline.map((row) => ({
          book: row.book,
          edge: row.playerEdge,
          dec: row.playerDec,
          noVig: row.playerNoVig,
        }))
      ),
      bestOpponent: best(
        moneyline.map((row) => ({
          book: row.book,
          edge: row.opponentEdge,
          dec: row.opponentDec,
          noVig: row.opponentNoVig,
        }))
      ),
    },
    totals: {
      line: market?.listedTotalLine ?? model.totalsLine,
      modelOverPct: model.totalsOverPct,
      modelUnderPct: pct1(100 - model.totalsOverPct),
      books: totals,
      bestOver: best(
        totals.map((row) => ({
          book: row.book,
          edge: row.overEdge,
          dec: row.overDec,
          noVig: row.overNoVig,
        }))
      ),
      bestUnder: best(
        totals.map((row) => ({
          book: row.book,
          edge: row.underEdge,
          dec: row.underDec,
          noVig: row.underNoVig,
        }))
      ),
    },
  };
}

export function tennisFormatTotalRange(bestOf: 3 | 5): { min: number; max: number } {
  if (bestOf === 5) return { min: 32.5, max: 56.5 };
  return { min: 18.5, max: 28.5 };
}

function toDecimal(raw: string | null | undefined): number | null {
  if (raw == null || raw === 'N/A') return null;
  const text = String(raw).trim();
  const n = parseFloat(text.replace(/[^0-9.+-]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (text.includes('+') || n >= 100 || n <= -100) {
    return Math.round(americanToDecimal(n) * 100) / 100;
  }
  if (n > 1) return Math.round(n * 100) / 100;
  return null;
}

function evenness(over: number | null, under: number | null): number {
  if (over != null && under != null) return Math.abs(over - under);
  const only = over ?? under;
  if (only == null) return Number.POSITIVE_INFINITY;
  return 10 + Math.abs(only - 1.9);
}

function inRange(line: number | null, min: number, max: number): line is number {
  return line != null && line >= min && line <= max;
}

function postedHalfNear(pickem: number, posted: number[]): number {
  const low = pickem - 0.5;
  const high = pickem + 0.5;
  const hasLow = posted.includes(low);
  const hasHigh = posted.includes(high);
  if (hasHigh && !hasLow) return high;
  if (hasLow && !hasHigh) return low;
  if (hasHigh) return high;
  return high;
}

export function inferBestOfFromOdds(
  declared: 3 | 5,
  odds: TennisMatchOdds | null | undefined
): 3 | 5 {
  if (declared === 5) return 5;
  const books = odds?.bookmakers || [];
  const slamMains = books.filter((book) => {
    const line = tennisParseLineNumber(book.Total?.line);
    return line != null && line >= 32.5;
  }).length;
  return slamMains >= 1 ? 5 : declared;
}

export function summarizeTennisAskOdds(
  odds: TennisMatchOdds | null | undefined,
  bestOf: 3 | 5
): TennisAskMarketOdds {
  const { min, max } = tennisFormatTotalRange(bestOf);
  const books = odds?.bookmakers || [];
  const totals: TennisAskMarketOdds['totals'] = [];
  const moneyline: TennisAskMarketOdds['moneyline'] = [];
  const posted: number[] = [];
  const mains: number[] = [];
  const twoWay: Array<{ line: number; even: number }> = [];

  for (const book of books) {
    const mainLine = tennisParseLineNumber(book.Total?.line);
    const mainOver = toDecimal(book.Total?.over);
    const mainUnder = toDecimal(book.Total?.under);
    if (inRange(mainLine, min, max)) {
      mains.push(mainLine);
      totals.push({ book: book.name, line: mainLine, over: mainOver, under: mainUnder });
    }

    const player = toDecimal(book.H2H?.home);
    const opponent = toDecimal(book.H2H?.away);
    if (player != null || opponent != null) {
      moneyline.push({ book: book.name, player, opponent });
    }

    const rows: TennisOuLine[] = [
      ...(book.TotalLines || []),
      ...(book.Total && book.Total.line !== 'N/A' ? [book.Total] : []),
    ];
    for (const row of rows) {
      const line = tennisParseLineNumber(row.line);
      if (!inRange(line, min, max)) continue;
      posted.push(line);
      const over = toDecimal(row.over);
      const under = toDecimal(row.under);
      if (over != null && under != null) {
        twoWay.push({ line, even: evenness(over, under) });
      }
    }
  }

  const uniquePosted = [...new Set(posted)].sort((a, b) => a - b);
  twoWay.sort((a, b) => a.even - b.even || a.line - b.line);
  const pickem = twoWay[0]?.line ?? (mains.length ? mains.slice().sort((a, b) => a - b)[Math.floor(mains.length / 2)] : null);
  const listed =
    pickem == null
      ? null
      : Math.abs(pickem % 1 - 0.5) < 0.01
        ? pickem
        : postedHalfNear(pickem, uniquePosted);

  const totalsAtListed: TennisAskPrice[] = [];
  if (listed != null) {
    for (const book of books) {
      const rows: TennisOuLine[] = [
        ...(book.TotalLines || []),
        ...(book.Total && book.Total.line !== 'N/A' ? [book.Total] : []),
      ];
      const hit = rows.find((row) => {
        const line = tennisParseLineNumber(row.line);
        return line != null && Math.abs(line - listed) < 0.01;
      });
      if (!hit) continue;
      totalsAtListed.push({
        book: book.name,
        line: listed,
        over: toDecimal(hit.over),
        under: toDecimal(hit.under),
      });
    }
  }

  return {
    listedTotalLine: listed,
    pickemTotalLine: pickem,
    formatMin: min,
    formatMax: max,
    totals,
    totalsAtListed,
    moneyline,
  };
}

export function defaultTennisTotalsLine(tour: 'ATP' | 'WTA', bestOf: 3 | 5): number {
  if (bestOf === 5) return 38.5;
  return tour === 'WTA' ? 21.5 : 22.5;
}
