// Types and utilities for odds/alt lines

export type AltLineItem = {
  bookmaker: string;
  line: number;
  over: string;
  under: string;
  isPickem?: boolean;
  variantLabel?: string | null;
};

/**
 * Maps a stat key to its corresponding bookmaker row key
 */
export function getBookRowKey(stat: string | null | undefined): string | null {
  if (!stat) return null;
  
  const statToBookKey: Record<string, string> = {
    'pts': 'PTS',
    'reb': 'REB',
    'ast': 'AST',
    'fg3m': 'THREES',
    'stl': 'STL',
    'blk': 'BLK',
    'to': 'TO',
    'pra': 'PRA',
    'pr': 'PR',
    'pa': 'PA',
    'ra': 'RA',
    'spread': 'Spread',
    'total_pts': 'Total',
    'moneyline': 'H2H',
  };
  return statToBookKey[stat] || null;
}

// Performs shallow clone with nested object cloning for BookRow structure
export function cloneBookRow(book: any): any {
  const clone: any = { ...book };
  // Clone nested objects (H2H, Spread, Total, etc.)
  if (book.H2H) clone.H2H = { ...book.H2H };
  if (book.Spread) clone.Spread = { ...book.Spread };
  if (book.Total) clone.Total = { ...book.Total };
  if (book.PTS) clone.PTS = { ...book.PTS };
  if (book.REB) clone.REB = { ...book.REB };
  if (book.AST) clone.AST = { ...book.AST };
  if (book.THREES) clone.THREES = { ...book.THREES };
  if (book.PRA) clone.PRA = { ...book.PRA };
  if (book.PR) clone.PR = { ...book.PR };
  if (book.PA) clone.PA = { ...book.PA };
  if (book.RA) clone.RA = { ...book.RA };
  if (book.BLK) clone.BLK = { ...book.BLK };
  if (book.STL) clone.STL = { ...book.STL };
  if (book.TO) clone.TO = { ...book.TO };
  if (book.DD) clone.DD = { ...book.DD };
  if (book.TD) clone.TD = { ...book.TD };
  if (book.FIRST_BASKET) clone.FIRST_BASKET = { ...book.FIRST_BASKET };
  // Clone metadata if present
  if (book.meta) clone.meta = { ...book.meta };
  // Clone any other nested objects
  for (const key in book) {
    if (book[key] && typeof book[key] === 'object' && !Array.isArray(book[key]) && 
        !clone[key] && key !== 'meta' && 
        !['H2H', 'Spread', 'Total', 'PTS', 'REB', 'AST', 'THREES', 'PRA', 'PR', 'PA', 'RA', 'BLK', 'STL', 'TO', 'DD', 'TD', 'FIRST_BASKET'].includes(key)) {
      clone[key] = { ...book[key] };
    }
  }
  return clone;
}

export function mergeBookRowsByBaseName(books: any[], skipMerge = false): any[] {
  if (skipMerge) return books;

  const MERGE_KEYS = [
    'H2H',
    'Spread',
    'Total',
    'PTS',
    'REB',
    'AST',
    'THREES',
    'BLK',
    'STL',
    'TO',
    'PRA',
    'PR',
    'PA',
    'RA',
    'DD',
    'TD',
    'FIRST_BASKET',
  ];

  const mergedMap = new Map<string, any>();
  const order: string[] = [];

  for (const book of books || []) {
    const baseNameRaw = (book as any)?.meta?.baseName || book?.name || '';
    const baseKey = baseNameRaw.toLowerCase();
    const displayName = baseNameRaw || book?.name || 'Book';

    if (!mergedMap.has(baseKey)) {
      const clone = cloneBookRow(book);
      clone.name = displayName;
      // Preserve metadata (including gameHomeTeam/gameAwayTeam)
      if (book.meta && !clone.meta) {
        clone.meta = { ...book.meta };
      }
      mergedMap.set(baseKey, clone);
      order.push(baseKey);
      continue;
    }

    const target = mergedMap.get(baseKey);
    
    // Preserve metadata from source if target doesn't have it
    if (book.meta && !target.meta) {
      target.meta = { ...book.meta };
    } else if (book.meta && target.meta) {
      // Merge metadata, preserving gameHomeTeam/gameAwayTeam
      target.meta = { ...target.meta, ...book.meta };
    }

    for (const key of MERGE_KEYS) {
      const sourceVal = book[key];
      const targetVal = target[key];

      if (!sourceVal) continue;

      if (key === 'H2H') {
        if (targetVal?.home === 'N/A' && sourceVal.home !== 'N/A') {
          targetVal.home = sourceVal.home;
        }
        if (targetVal?.away === 'N/A' && sourceVal.away !== 'N/A') {
          targetVal.away = sourceVal.away;
        }
        continue;
      }

      const needsLine =
        sourceVal &&
        typeof sourceVal === 'object' &&
        ('line' in sourceVal || 'yes' in sourceVal);

      if (!needsLine) {
        if (!targetVal && sourceVal) {
          // Clone object if it's a nested object, otherwise use spread
          target[key] = typeof sourceVal === 'object' && sourceVal !== null && !Array.isArray(sourceVal)
            ? { ...sourceVal }
            : sourceVal;
        }
        continue;
      }

      const shouldReplaceLine =
        targetVal?.line === 'N/A' && sourceVal.line !== 'N/A';

      if (shouldReplaceLine) {
        target[key] = { ...sourceVal };
        continue;
      }

      if (sourceVal.over && targetVal?.over === 'N/A') {
        targetVal.over = sourceVal.over;
      }
      if (sourceVal.under && targetVal?.under === 'N/A') {
        targetVal.under = sourceVal.under;
      }
      if (sourceVal.yes && targetVal?.yes === 'N/A') {
        targetVal.yes = sourceVal.yes;
      }
      if (sourceVal.no && targetVal?.no === 'N/A') {
        targetVal.no = sourceVal.no;
      }
    }
  }

  return order.map((key) => mergedMap.get(key));
}

export const partitionAltLineItems = (lines: AltLineItem[]): { primary: AltLineItem[]; alternate: AltLineItem[]; milestones: AltLineItem[] } => {
  // Separate milestones from over/under lines
  const milestones: AltLineItem[] = [];
  const overUnderLines: AltLineItem[] = [];
  
  for (const line of lines) {
    if (line.variantLabel === 'Milestone') {
      milestones.push(line);
    } else {
      overUnderLines.push(line);
    }
  }
  
  // USER REQUEST: Show ALL over/under lines (not just one per bookmaker)
  // Don't separate into primary/alternate - show everything except milestones
  // Sort all over/under lines by line value
  overUnderLines.sort((a, b) => a.line - b.line);
  
  // Sort milestones by line value
  milestones.sort((a, b) => a.line - b.line);
  
  // Return all over/under lines as "primary" (they'll all be shown)
  // Keep alternate empty (no separation needed)
  // Milestones are excluded as requested
  return { primary: overUnderLines, alternate: [] as AltLineItem[], milestones: [] as AltLineItem[] };
};
