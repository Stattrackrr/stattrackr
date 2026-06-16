// Shared utility for calculating implied probabilities from American odds
// Used by both Dashboard and Top Player Props page to ensure consistency

export function impliedProbabilityFromAmerican(american: number): number {
  if (american > 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

export function calculateImpliedProbabilities(
  overOddsStr: string | number | null,
  underOddsStr: string | number | null
): { overImpliedProb: number; underImpliedProb: number } | null {
  const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
    ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
    : null;
  const underOdds = (underOddsStr && underOddsStr !== 'N/A')
    ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
    : null;
  
  if (overOdds === null || underOdds === null || !Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
    return null;
  }
  
  const overProb = impliedProbabilityFromAmerican(overOdds);
  const underProb = impliedProbabilityFromAmerican(underOdds);
  const totalProb = overProb + underProb;
  
  if (totalProb > 0) {
    return {
      overImpliedProb: (overProb / totalProb) * 100,
      underImpliedProb: (underProb / totalProb) * 100,
    };
  }
  
  return null;
}

export type WorldCupPlayerOddsMarket = {
  line?: string;
  over?: string;
  under?: string;
};

export type WorldCupPlayerOddsBook = {
  name: string;
  AnytimeGoalScorer?: { yes?: string; no?: string };
  GoalsOver?: WorldCupPlayerOddsMarket;
  GoalsOverLines?: WorldCupPlayerOddsMarket[];
  Assists?: WorldCupPlayerOddsMarket;
  AssistsLines?: WorldCupPlayerOddsMarket[];
  Shots?: WorldCupPlayerOddsMarket;
  ShotsLines?: WorldCupPlayerOddsMarket[];
  ShotsOnTarget?: WorldCupPlayerOddsMarket;
  ShotsOnTargetLines?: WorldCupPlayerOddsMarket[];
  FoulsCommitted?: WorldCupPlayerOddsMarket;
  FoulsCommittedLines?: WorldCupPlayerOddsMarket[];
  ToBeBooked?: { yes?: string; no?: string };
};

export type WorldCupPlayerOddsStatColumn =
  | 'GoalsOver'
  | 'Assists'
  | 'Shots'
  | 'ShotsOnTarget'
  | 'FoulsCommitted';

export function getWorldCupOddsStatColumn(statId: string): WorldCupPlayerOddsStatColumn | null {
  if (statId === 'assists') return 'Assists';
  if (statId === 'total_shots' || statId === 'derived_shots_total' || statId === 'shots_total') return 'Shots';
  if (statId === 'shots_on_target') return 'ShotsOnTarget';
  if (statId === 'fouls_committed' || statId === 'fouls') return 'FoulsCommitted';
  if (statId === 'goals') return 'GoalsOver';
  return null;
}

function worldCupOddsLinesFromBookColumn(
  book: WorldCupPlayerOddsBook,
  column: WorldCupPlayerOddsStatColumn
): WorldCupPlayerOddsMarket[] {
  const linesKey = `${column}Lines` as keyof WorldCupPlayerOddsBook;
  const multi = book[linesKey] as WorldCupPlayerOddsMarket[] | undefined;
  if (Array.isArray(multi) && multi.length) {
    return [...multi].sort(
      (a, b) => (parseWorldCupOddsLine(a.line) ?? 0) - (parseWorldCupOddsLine(b.line) ?? 0)
    );
  }
  const single = book[column] as WorldCupPlayerOddsMarket | undefined;
  if (single?.over && single.over !== 'N/A') return [single];
  return [];
}

export function getWorldCupOddsLinesForStat(
  statId: string,
  book: WorldCupPlayerOddsBook
): WorldCupPlayerOddsMarket[] {
  if (statId === 'goals') {
    const out: WorldCupPlayerOddsMarket[] = [];
    const anytime = book.AnytimeGoalScorer;
    if (anytime?.yes && anytime.yes !== 'N/A') {
      out.push({ line: '0.5', over: anytime.yes, under: anytime.no ?? 'N/A' });
    }
    for (const row of worldCupOddsLinesFromBookColumn(book, 'GoalsOver')) {
      const line = parseWorldCupOddsLine(row.line);
      if (line != null && !out.some((entry) => Math.abs((parseWorldCupOddsLine(entry.line) ?? -1) - line) < 0.01)) {
        out.push(row);
      }
    }
    return out.sort((a, b) => (parseWorldCupOddsLine(a.line) ?? 0) - (parseWorldCupOddsLine(b.line) ?? 0));
  }

  if (statId === 'yellow_cards') {
    const booked = book.ToBeBooked;
    if (booked?.yes && booked.yes !== 'N/A') {
      return [{ line: '0.5', over: booked.yes, under: booked.no ?? 'N/A' }];
    }
    return [];
  }

  const column = getWorldCupOddsStatColumn(statId);
  if (!column || column === 'GoalsOver') return [];
  return worldCupOddsLinesFromBookColumn(book, column);
}

export function getAvailableWorldCupOddsLines(statId: string, books: WorldCupPlayerOddsBook[]): number[] {
  const lines = new Set<number>();
  for (const book of books) {
    for (const market of getWorldCupOddsLinesForStat(statId, book)) {
      const line = parseWorldCupOddsLine(market.line);
      if (line != null) lines.add(line);
    }
  }
  return [...lines].sort((a, b) => a - b);
}

export function parseWorldCupOddsLine(value: string | undefined): number | null {
  const n = Number.parseFloat(String(value ?? '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function getPrimaryOddsLineForStat(statId: string, books: WorldCupPlayerOddsBook[]): number | null {
  const available = getAvailableWorldCupOddsLines(statId, books);
  if (available.length) return available[0] ?? 0.5;
  if (statId === 'goals' || statId === 'yellow_cards') return 0.5;
  return null;
}

export function getOddsMarketForStat(
  statId: string,
  book: WorldCupPlayerOddsBook,
  lineValue?: number | null
): WorldCupPlayerOddsMarket | { yes?: string; no?: string } | null {
  const lines = getWorldCupOddsLinesForStat(statId, book);
  if (!lines.length) {
    if (statId === 'goals' && book.AnytimeGoalScorer?.yes && book.AnytimeGoalScorer.yes !== 'N/A') {
      return book.AnytimeGoalScorer;
    }
    if (statId === 'yellow_cards' && book.ToBeBooked?.yes && book.ToBeBooked.yes !== 'N/A') {
      return book.ToBeBooked;
    }
    return null;
  }

  if (lineValue != null && Number.isFinite(lineValue)) {
    const matched = lines.find((market) => {
      const line = parseWorldCupOddsLine(market.line);
      return line != null && Math.abs(line - lineValue) < 0.01;
    });
    if (matched) {
      if (statId === 'goals' && Math.abs(lineValue - 0.5) < 0.01 && book.AnytimeGoalScorer?.yes) {
        return book.AnytimeGoalScorer;
      }
      if (statId === 'yellow_cards' && Math.abs(lineValue - 0.5) < 0.01 && book.ToBeBooked?.yes) {
        return book.ToBeBooked;
      }
      return matched;
    }
  }

  if (statId === 'goals' && book.AnytimeGoalScorer?.yes && book.AnytimeGoalScorer.yes !== 'N/A') {
    return book.AnytimeGoalScorer;
  }
  if (statId === 'yellow_cards' && book.ToBeBooked?.yes && book.ToBeBooked.yes !== 'N/A') {
    return book.ToBeBooked;
  }
  return lines[0] ?? null;
}

export function calculateWorldCupImpliedOdds(
  statId: string,
  lineValue: number,
  books: WorldCupPlayerOddsBook[],
  calculateImplied: (
    over: string | number | null,
    under: string | number | null
  ) => { overImpliedProb: number; underImpliedProb: number } | null
): { overImpliedProb: number; underImpliedProb: number } | null {
  if (!books.length) return null;

  const isSameLine = (a: number | null, b: number | null, tol = 0.01) =>
    a != null && b != null && Math.abs(a - b) < tol;

  const impliedRows: Array<{ over: number; under: number }> = [];

  for (const book of books) {
    const market = getOddsMarketForStat(statId, book, lineValue);
    if (!market) continue;

    if ('yes' in market && market.yes) {
      const implied = calculateImplied(market.yes ?? null, market.no ?? '+100');
      if (implied) impliedRows.push({ over: implied.overImpliedProb, under: implied.underImpliedProb });
      continue;
    }

    const ou = market as WorldCupPlayerOddsMarket;
    const marketLine = parseWorldCupOddsLine(ou.line);
    if (marketLine != null && !isSameLine(marketLine, lineValue)) continue;
    const implied = calculateImplied(ou.over ?? null, ou.under ?? null);
    if (implied) impliedRows.push({ over: implied.overImpliedProb, under: implied.underImpliedProb });
  }

  if (!impliedRows.length) return null;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  };
  return {
    overImpliedProb: median(impliedRows.map((row) => row.over)),
    underImpliedProb: median(impliedRows.map((row) => row.under)),
  };
}
