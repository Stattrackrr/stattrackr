/**
 * Intraday movements final processing utilities
 * 
 * This file contains the logic for processing and filtering intraday line movements,
 * excluding alternate lines and deduplicating by bookmaker.
 */

import { BookRow, MovementRow } from '../types';
import { AltLineItem, partitionAltLineItems } from './oddsUtils';

export interface IntradayMovementFinal {
  ts: number;
  timeLabel: string;
  line: number;
  change: string;
  direction: 'up' | 'down' | 'flat';
}

export interface MergedLineMovementData {
  lineMovement?: Array<{ bookmaker: string; line: number; change: number; timestamp: string }>;
  openingLine?: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  currentLine?: { line: number; bookmaker: string; timestamp: string; overOdds?: number; underOdds?: number } | null;
  [key: string]: any;
}

export interface IntradayMovementsFinalParams {
  mergedLineMovementData: MergedLineMovementData | null;
  realOddsData: BookRow[];
  selectedStat: string;
  intradayMovements: IntradayMovementFinal[];
  LINE_MOVEMENT_ENABLED: boolean;
}

/**
 * Processes intraday movements, filtering out alternate lines and deduplicating by bookmaker
 */
export function processIntradayMovementsFinal({
  mergedLineMovementData,
  realOddsData,
  selectedStat,
  intradayMovements,
  LINE_MOVEMENT_ENABLED,
}: IntradayMovementsFinalParams): IntradayMovementFinal[] {
  if (!LINE_MOVEMENT_ENABLED || !mergedLineMovementData) {
    return [];
  }
  
  const { lineMovement = [], openingLine, currentLine } = mergedLineMovementData;

  // Build a map of alt lines to check if movements are from alt lines
  const altLinesMap = new Map<string, { variantLabel: string | null; isPickem: boolean }>();
  let primaryLines: AltLineItem[] = [];
  let primaryKeysSet = new Set<string>();
  
  if (realOddsData && realOddsData.length > 0) {
    const statToBookKey: Record<string, string> = {
      'pts': 'PTS',
      'reb': 'REB',
      'ast': 'AST',
      'fg3m': 'THREES',
      'pra': 'PRA',
      'pr': 'PR',
      'pa': 'PA',
      'ra': 'RA',
    };
    const bookKey = (selectedStat && statToBookKey[selectedStat]) || 'PTS';
    
    // Get all lines and identify primary vs alt
    const allLines: AltLineItem[] = realOddsData
      .map((book: any) => {
        const statData = (book as any)[bookKey];
        if (!statData || statData.line === 'N/A') return null;
        const lineValue = parseFloat(statData.line);
        if (isNaN(lineValue)) return null;
        const meta = (book as any).meta || {};
        return {
          bookmaker: meta.baseName || book.name,
          line: lineValue,
          over: statData.over,
          under: statData.under,
          isPickem: meta.isPickem ?? false,
          variantLabel: meta.variantLabel ?? null,
        } as AltLineItem;
      })
      .filter((item: AltLineItem | null): item is AltLineItem => item !== null);
    
    const partitioned = partitionAltLineItems(allLines);
    primaryLines = partitioned.primary;
    const alternateLines: AltLineItem[] = partitioned.alternate;
    
    // Create a set of primary line keys (bookmaker + line) for quick lookup
    primaryKeysSet = new Set(
      primaryLines.map((p: AltLineItem) => `${p.bookmaker.toLowerCase().trim()}|${p.line.toFixed(1)}`)
    );
    
    // Map alt lines for quick lookup (to filter them out)
    // Store multiple keys for each alt line to handle name variations
    for (const alt of alternateLines) {
      const bookmakerLower = alt.bookmaker.toLowerCase().trim();
      const lineKey = alt.line.toFixed(1);
      
      // Store with the exact bookmaker name
      const key1 = `${bookmakerLower}|${lineKey}`;
      altLinesMap.set(key1, {
        variantLabel: alt.variantLabel ?? null,
        isPickem: alt.isPickem ?? false,
      });
      
      // Also store with normalized bookmaker name (remove common suffixes)
      const normalizedBookmaker = bookmakerLower
        .replace(/\s+(fantasy|sportsbook|sports|betting)$/i, '')
        .replace(/^the\s+/i, '')
        .trim();
      if (normalizedBookmaker !== bookmakerLower) {
        const key2 = `${normalizedBookmaker}|${lineKey}`;
        altLinesMap.set(key2, {
          variantLabel: alt.variantLabel ?? null,
          isPickem: alt.isPickem ?? false,
        });
      }
    }
  }

  if (lineMovement.length > 0) {
    // Filter to only show primary line movements (exclude alt lines)
    // Also use a more flexible matching approach for bookmaker names
    const primaryMovements = lineMovement.filter((movement) => {
      const bookmakerLower = movement.bookmaker.toLowerCase().trim();
      const lineRounded = Math.round(movement.line * 10) / 10; // Round to 1 decimal
      
      // Check all possible key variations
      const possibleKeys = [
        `${bookmakerLower}|${lineRounded.toFixed(1)}`,
        `${bookmakerLower}|${movement.line.toFixed(1)}`,
        `${bookmakerLower}|${movement.line.toFixed(2)}`,
      ];
      
      // Also check with normalized bookmaker name (remove common suffixes/prefixes)
      const normalizedBookmaker = bookmakerLower
        .replace(/\s+(fantasy|sportsbook|sports|betting)$/i, '')
        .replace(/^the\s+/i, '')
        .trim();
      if (normalizedBookmaker !== bookmakerLower) {
        possibleKeys.push(
          `${normalizedBookmaker}|${lineRounded.toFixed(1)}`,
          `${normalizedBookmaker}|${movement.line.toFixed(1)}`
        );
      }
      
      // Check if any of these keys match an alt line
      const isAltLine = possibleKeys.some(key => altLinesMap.has(key));
      
      // Only include if it's NOT an alt line
      return !isAltLine;
    });
    
    // If we have primary movements, use them; otherwise fall back to all movements
    // But also try to deduplicate by bookmaker (keep only one movement per bookmaker, most recent)
    const movementsToDisplay = primaryMovements.length > 0 ? primaryMovements : lineMovement;
    
    // Deduplicate by bookmaker - keep only the movement that matches a primary line (or most recent if no match)
    const deduplicatedMovements = new Map<string, typeof movementsToDisplay[0]>();
    
    for (const movement of movementsToDisplay) {
      const bookmakerKey = movement.bookmaker.toLowerCase().trim();
      const movementKey = `${bookmakerKey}|${movement.line.toFixed(1)}`;
      const isPrimaryLine = primaryKeysSet.has(movementKey);
      
      const existing = deduplicatedMovements.get(bookmakerKey);
      
      // Prefer movements that match primary lines
      if (!existing) {
        deduplicatedMovements.set(bookmakerKey, movement);
      } else {
        const existingKey = `${bookmakerKey}|${existing.line.toFixed(1)}`;
        const existingIsPrimary = primaryKeysSet.has(existingKey);
        
        // If current is primary and existing is not, replace it
        if (isPrimaryLine && !existingIsPrimary) {
          deduplicatedMovements.set(bookmakerKey, movement);
        }
        // If both are primary or both are not, keep the most recent
        else if (isPrimaryLine === existingIsPrimary) {
          if (new Date(movement.timestamp).getTime() > new Date(existing.timestamp).getTime()) {
            deduplicatedMovements.set(bookmakerKey, movement);
          }
        }
        // If existing is primary and current is not, keep existing
      }
    }
    
    const finalMovements = Array.from(deduplicatedMovements.values()).filter((movement) => {
      const rawChange = (movement as any)?.change;
      let changeValue = 0;
      if (typeof rawChange === 'number') {
        changeValue = rawChange;
      } else if (typeof rawChange === 'string') {
        const normalized = rawChange.replace(/[^\d.-]/g, '');
        changeValue = normalized === '' ? 0 : parseFloat(normalized);
      }
      return Number.isFinite(changeValue) && Math.abs(changeValue) >= 0.01;
    });
    
    return finalMovements
      .map((movement) => {
        const dt = new Date(movement.timestamp);
        const timeLabel = dt.toLocaleString(undefined, {
          month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
        });
        const direction = movement.change > 0 ? 'up' : movement.change < 0 ? 'down' : 'flat';
        
        return {
          ts: new Date(movement.timestamp).getTime(),
          timeLabel: `${timeLabel} (${movement.bookmaker})`,
          line: movement.line,
          change: `${movement.change > 0 ? '+' : ''}${movement.change.toFixed(1)}`,
          direction: direction as 'up' | 'down' | 'flat',
        };
      })
      .sort((a, b) => b.ts - a.ts); // Most recent first (descending by timestamp)
  }

  const fallbackRows: IntradayMovementFinal[] = [];
  const formatLabel = (entry: typeof openingLine, label: string) => {
    if (!entry) return '';
    const dt = new Date(entry.timestamp);
    const time = dt.toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
    const suffix = entry.bookmaker ? ` (${entry.bookmaker})` : '';
    return `${time}${suffix}${label ? ` — ${label}` : ''}`;
  };

  if (openingLine) {
    fallbackRows.push({
      ts: new Date(openingLine.timestamp).getTime(),
      timeLabel: formatLabel(openingLine, 'Opening'),
      line: openingLine.line,
      change: '',
      direction: 'flat'
    });
  }

  if (currentLine) {
    const delta = openingLine ? currentLine.line - openingLine.line : 0;
    const hasDifferentTimestamp = !openingLine || currentLine.timestamp !== openingLine.timestamp;
    const hasDifferentLine = !openingLine || currentLine.line !== openingLine.line;

    if (hasDifferentTimestamp || hasDifferentLine) {
      fallbackRows.push({
        ts: new Date(currentLine.timestamp).getTime(),
        timeLabel: formatLabel(currentLine, 'Latest'),
        line: currentLine.line,
        change: openingLine ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : '',
        direction: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
      });
    }
  }

  if (fallbackRows.length > 0) {
    return fallbackRows.sort((a, b) => b.ts - a.ts);
  }
  
  // Fallback to original intradayMovements
  return intradayMovements;
}

