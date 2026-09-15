import { tennisOuEvenness } from '@/lib/tennis/oddsTypes';

type TennisMarketLineRow = {
  playerName?: string | null;
  gameId?: string | null;
  opponent?: string | null;
  statType?: string | null;
  line?: number | null;
  overOdds?: string | null;
  underOdds?: string | null;
  bookmaker?: string | null;
  bookmakerLines?: Array<{
    bookmaker?: string;
    line?: number;
    overOdds?: string;
    underOdds?: string;
  }>;
};

function tennisMarketCollapseKey(row: TennisMarketLineRow): string {
  const player = String(row.playerName || '').trim().toLowerCase();
  const game = String(row.gameId || '').trim();
  const opp = String(row.opponent || '').trim().toLowerCase();
  const stat = String(row.statType || '').trim().toLowerCase();
  return `${player}|${game || opp}|${stat}`;
}

function snapTennisLine(line: number | null | undefined): number {
  const n = Number(line);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}

function tennisRowBookCount(row: TennisMarketLineRow): number {
  if (Array.isArray(row.bookmakerLines) && row.bookmakerLines.length > 0) {
    return row.bookmakerLines.length;
  }
  return String(row.bookmaker || '').trim() ? 1 : 0;
}

function tennisRowEvennessScore(row: TennisMarketLineRow): number {
  const lines =
    Array.isArray(row.bookmakerLines) && row.bookmakerLines.length
      ? row.bookmakerLines
      : [{ line: row.line, overOdds: row.overOdds, underOdds: row.underOdds }];
  let best = Number.POSITIVE_INFINITY;
  for (const line of lines) {
    const even = tennisOuEvenness({
      line: String(line.line ?? row.line ?? ''),
      over: String(line.overOdds || 'N/A'),
      under: String(line.underOdds || 'N/A'),
    });
    if (even < best) best = even;
  }
  return best;
}

/**
 * One displayed line per player / match / market.
 * The same player can still appear on moneyline, totals, and opponent games.
 */
export function collapseTennisRowsToPrimaryMarketLine<T extends TennisMarketLineRow>(
  rows: T[],
  opts?: { keepAllWinningLineRows?: boolean }
): T[] {
  const keepAll = opts?.keepAllWinningLineRows === true;
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = tennisMarketCollapseKey(row);
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }
  const out: T[] = [];
  for (const list of groups.values()) {
    if (list.length === 1) {
      out.push(list[0]!);
      continue;
    }
    const byLine = new Map<number, T[]>();
    for (const row of list) {
      const n = snapTennisLine(row.line);
      const bucket = byLine.get(n);
      if (bucket) bucket.push(row);
      else byLine.set(n, [row]);
    }
    let bestBucket: T[] | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const bucket of byLine.values()) {
      const books = bucket.reduce((sum, row) => sum + tennisRowBookCount(row), 0);
      const even = Math.min(...bucket.map(tennisRowEvennessScore));
      const score = books * 1000 - even;
      if (score > bestScore) {
        bestScore = score;
        bestBucket = bucket;
      }
    }
    if (!bestBucket?.length) continue;
    if (keepAll) {
      out.push(...bestBucket);
      continue;
    }
    out.push(
      bestBucket.reduce((winner, row) =>
        tennisRowBookCount(row) > tennisRowBookCount(winner) ? row : winner
      )
    );
  }
  return out;
}
