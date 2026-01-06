import { getBookRowKey } from './oddsUtils';

export interface AvailableBookmaker {
  name: string;
  displayName: string;
}

/**
 * Get available bookmakers with valid over/under odds for selected stat
 */
export function calculateAvailableBookmakers(
  realOddsData: any[],
  selectedStat: string
): AvailableBookmaker[] {
  if (!realOddsData || realOddsData.length === 0 || !selectedStat) return [];
  
  const bookRowKey = getBookRowKey(selectedStat);
  if (!bookRowKey) return [];
  
  const bookmakers = new Map<string, { name: string; displayName: string }>();
  
  for (const book of realOddsData) {
    const statData = (book as any)[bookRowKey];
    if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
      const meta = (book as any)?.meta;
      // Exclude alternate lines (variantLabel indicates alternate)
      if (!meta?.variantLabel) {
        const baseName = (meta?.baseName || book?.name || '').toLowerCase();
        const displayName = meta?.baseName || book?.name || 'Unknown';
        if (!bookmakers.has(baseName)) {
          bookmakers.set(baseName, { name: baseName, displayName });
        }
      }
    }
  }
  
  return Array.from(bookmakers.values());
}

export interface SelectedBookmakerData {
  line: number | null;
  name: string | null;
  overOdds: string | null;
  underOdds: string | null;
}

/**
 * Extract FanDuel's line and odds for selected stat
 */
export function calculateSelectedBookmakerData(
  realOddsData: any[],
  selectedStat: string
): SelectedBookmakerData {
  if (!realOddsData || realOddsData.length === 0 || !selectedStat) {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  const bookRowKey = getBookRowKey(selectedStat);
  if (!bookRowKey) {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  // Always use FanDuel, main line only (no alternates)
  const fanduelBook = realOddsData.find((book: any) => {
    const baseName = ((book as any)?.meta?.baseName || book?.name || '').toLowerCase();
    return baseName === 'fanduel';
  });
  
  if (!fanduelBook) {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  const meta = (fanduelBook as any)?.meta;
  // Exclude alternate lines (variantLabel indicates alternate)
  if (meta?.variantLabel) {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  const statData = (fanduelBook as any)[bookRowKey];
  if (!statData || statData.line === 'N/A' || statData.over === 'N/A' || statData.under === 'N/A') {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  const lineValue = parseFloat(statData.line);
  if (isNaN(lineValue)) {
    return { line: null, name: null, overOdds: null, underOdds: null };
  }
  
  return {
    line: lineValue,
    name: meta?.baseName || fanduelBook?.name || 'FanDuel',
    overOdds: statData.over,
    underOdds: statData.under,
  };
}

