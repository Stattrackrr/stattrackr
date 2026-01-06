/**
 * Best line for stat utilities
 * 
 * This file contains the logic for finding the best (lowest) betting line
 * for a selected stat across all bookmakers, using consensus line calculation.
 */

import { BookRow } from '../types';
import { getBookRowKey } from './oddsUtils';

export interface BestLineForStatParams {
  realOddsData: BookRow[];
  selectedStat: string;
}

/**
 * Finds the best (lowest) betting line for a selected stat
 * Uses consensus line calculation to identify primary lines, then returns the lowest
 */
export function calculateBestLineForStat({
  realOddsData,
  selectedStat,
}: BestLineForStatParams): number | null {
  if (!realOddsData || realOddsData.length === 0) {
    return null;
  }

  const bookRowKey = getBookRowKey(selectedStat);
  if (!bookRowKey) {
    return null;
  }
  
  // Collect all lines per bookmaker
  const allLinesByBookmaker = new Map<string, number[]>();
  for (const book of realOddsData) {
    const meta = (book as any)?.meta;
    const baseName = (meta?.baseName || book?.name || '').toLowerCase();
    const statKey: string = meta?.stat || bookRowKey;
    
    if (statKey !== bookRowKey) continue;
    
    const statData = (book as any)[bookRowKey];
    if (!statData || statData.line === 'N/A') continue;
    const lineValue = parseFloat(statData.line);
    if (isNaN(lineValue)) continue;
    
    if (!allLinesByBookmaker.has(baseName)) {
      allLinesByBookmaker.set(baseName, []);
    }
    allLinesByBookmaker.get(baseName)!.push(lineValue);
  }
  
  // Calculate consensus line (most common line value across ALL bookmakers)
  const lineCounts = new Map<number, number>();
  for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
    for (const line of lines) {
      lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
    }
  }
  
  let consensusLine: number | null = null;
  let maxCount = 0;
  for (const [line, count] of lineCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      consensusLine = line;
    }
  }
  
  // Find primary lines (closest to consensus) and get the lowest
  let bestLine = Infinity;
  for (const [baseName, lines] of allLinesByBookmaker.entries()) {
    if (lines.length === 0) continue;
    
    let primaryLine = lines[0];
    if (consensusLine !== null && lines.length > 1) {
      let closestLine = lines[0];
      let minDiff = Math.abs(lines[0] - consensusLine);
      for (const line of lines) {
        const diff = Math.abs(line - consensusLine);
        if (diff < minDiff) {
          minDiff = diff;
          closestLine = line;
        }
      }
      // Always use closest to consensus (no threshold)
      primaryLine = closestLine;
    }
    
    if (primaryLine < bestLine) {
      bestLine = primaryLine;
    }
  }
  
  return bestLine !== Infinity ? bestLine : null;
}



