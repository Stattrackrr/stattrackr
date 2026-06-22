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

const WC_ODDS_LINE_TOL = 0.01;

export function worldCupOddsLinesMatch(a: number | null | undefined, b: number | null | undefined): boolean {
  return a != null && b != null && Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < WC_ODDS_LINE_TOL;
}

/** Pick the closest available O/U line to a target (never jumps to an unrelated minimum). */
export function pickNearestWorldCupOddsLine(
  lines: number[],
  targetLine: number | null | undefined
): number | null {
  if (!lines.length) return null;
  if (targetLine == null || !Number.isFinite(targetLine)) return lines[0] ?? null;
  const exact = lines.find((line) => worldCupOddsLinesMatch(line, targetLine));
  if (exact != null) return exact;
  let best = lines[0]!;
  let bestDist = Math.abs(best - targetLine);
  for (const line of lines) {
    const dist = Math.abs(line - targetLine);
    if (dist < bestDist) {
      best = line;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Map a chart/props line to the book line that carries odds.
 * Whole numbers (2, 3, …) map to O/U equivalents (1.5, 2.5, …) when no exact line exists.
 */
export function resolveWorldCupOddsLineForTarget(
  statId: string,
  availableLines: number[],
  targetLine: number | null | undefined
): number | null {
  if (!availableLines.length) return null;
  if (targetLine == null || !Number.isFinite(targetLine)) {
    return availableLines[0] ?? null;
  }

  const exact = availableLines.find((line) => worldCupOddsLinesMatch(line, targetLine));
  if (exact != null) return exact;

  const isYesNo = statId === 'goals' || statId === 'yellow_cards';
  if (isYesNo) {
    if (worldCupOddsLinesMatch(targetLine, 0.5)) {
      return availableLines.find((line) => worldCupOddsLinesMatch(line, 0.5)) ?? null;
    }
    return null;
  }

  if (targetLine <= 0) return null;

  // Integer targets like 2 or 3 (no .5) → O/U line N-0.5 (2→1.5, 3→2.5).
  if (Number.isInteger(targetLine) && targetLine >= 1) {
    const ouEquivalent = targetLine - 0.5;
    const ouMatch = availableLines.find((line) => worldCupOddsLinesMatch(line, ouEquivalent));
    if (ouMatch != null) return ouMatch;
  }

  return null;
}

function worldCupOddsMarketIsDisplayable(
  market: WorldCupPlayerOddsMarket | { yes?: string; no?: string } | null
): boolean {
  if (!market) return false;
  if ('over' in market) return Boolean(market.over && market.over !== 'N/A');
  if ('yes' in market) return Boolean(market.yes && market.yes !== 'N/A');
  return false;
}

/** True when at least one book has displayable odds for the target line (exact or integer O/U map). */
export function hasWorldCupOddsForTargetLine(
  statId: string,
  books: WorldCupPlayerOddsBook[],
  targetLine: number | null | undefined
): boolean {
  if (!books.length) return false;
  if (targetLine == null || !Number.isFinite(targetLine)) return false;

  const available = getAvailableWorldCupOddsLines(statId, books);
  const resolved = resolveWorldCupOddsLineForTarget(statId, available, targetLine);
  if (resolved == null) return false;

  return books.some((book) =>
    worldCupOddsMarketIsDisplayable(getOddsMarketForStat(statId, book, targetLine))
  );
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
  const lineNumbers = lines
    .map((market) => parseWorldCupOddsLine(market.line))
    .filter((line): line is number => line != null);

  if (!lines.length) {
    if (statId === 'goals' && book.AnytimeGoalScorer?.yes && book.AnytimeGoalScorer.yes !== 'N/A') {
      return book.AnytimeGoalScorer;
    }
    if (statId === 'yellow_cards' && book.ToBeBooked?.yes && book.ToBeBooked.yes !== 'N/A') {
      return book.ToBeBooked;
    }
    return null;
  }

  const resolvedLine =
    lineValue != null && Number.isFinite(lineValue)
      ? resolveWorldCupOddsLineForTarget(statId, lineNumbers, lineValue)
      : null;

  if (resolvedLine != null) {
    const matched = lines.find((market) => {
      const line = parseWorldCupOddsLine(market.line);
      return line != null && worldCupOddsLinesMatch(line, resolvedLine);
    });
    if (matched) {
      if (statId === 'goals' && worldCupOddsLinesMatch(resolvedLine, 0.5) && book.AnytimeGoalScorer?.yes) {
        return book.AnytimeGoalScorer;
      }
      if (statId === 'yellow_cards' && worldCupOddsLinesMatch(resolvedLine, 0.5) && book.ToBeBooked?.yes) {
        return book.ToBeBooked;
      }
      return matched;
    }
  }

  if (statId === 'goals' && book.AnytimeGoalScorer?.yes && book.AnytimeGoalScorer.yes !== 'N/A') {
    if (lineValue == null || !Number.isFinite(lineValue) || worldCupOddsLinesMatch(lineValue, 0.5)) {
      return book.AnytimeGoalScorer;
    }
  }
  if (statId === 'yellow_cards' && book.ToBeBooked?.yes && book.ToBeBooked.yes !== 'N/A') {
    if (lineValue == null || !Number.isFinite(lineValue) || worldCupOddsLinesMatch(lineValue, 0.5)) {
      return book.ToBeBooked;
    }
  }

  if (lineValue != null && Number.isFinite(lineValue)) {
    return null;
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

  const isSameLine = (a: number | null, b: number | null, tol = WC_ODDS_LINE_TOL) =>
    a != null && b != null && Math.abs(a - b) < tol;

  const impliedRows: Array<{ over: number; under: number }> = [];
  const resolvedLine = resolveWorldCupOddsLineForTarget(
    statId,
    getAvailableWorldCupOddsLines(statId, books),
    lineValue
  );
  if (resolvedLine == null) return null;

  for (const book of books) {
    const market = getOddsMarketForStat(statId, book, resolvedLine ?? lineValue);
    if (!market) continue;

    if ('yes' in market && market.yes) {
      const implied = calculateImplied(market.yes ?? null, market.no ?? '+100');
      if (implied) impliedRows.push({ over: implied.overImpliedProb, under: implied.underImpliedProb });
      continue;
    }

    const ou = market as WorldCupPlayerOddsMarket;
    const marketLine = parseWorldCupOddsLine(ou.line);
    const compareLine = resolvedLine ?? lineValue;
    if (marketLine != null && compareLine != null && !isSameLine(marketLine, compareLine)) continue;
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
