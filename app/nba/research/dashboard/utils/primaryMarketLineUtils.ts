/**
 * Primary market line utilities
 * 
 * This file contains the logic for calculating the primary/consensus market line
 * from odds data by finding the most common line across all bookmakers.
 */

import { BookRow } from '../types';
import { getBookRowKey } from './oddsUtils';

export interface PrimaryMarketLineParams {
  realOddsData: BookRow[];
  selectedStat: string;
}

/**
 * Calculates the primary/consensus market line from odds data
 * Returns the most common line value across all bookmakers (excluding alt lines)
 */
export function calculatePrimaryMarketLine({
  realOddsData,
  selectedStat,
}: PrimaryMarketLineParams): number | null {
  if (!realOddsData || realOddsData.length === 0 || !selectedStat) {
    return null;
  }
  
  const bookRowKey = getBookRowKey(selectedStat);
  if (!bookRowKey) {
    return null;
  }
  
  // Collect all real lines (not alt lines) and find the most common one
  const lineCounts = new Map<number, number>();
  
  for (const book of realOddsData) {
    const meta = (book as any)?.meta;
    // Skip alt lines - only use primary over/under lines
    if (meta?.variantLabel) {
      continue;
    }
    
    const statData = (book as any)[bookRowKey];
    
    if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
      const lineStr = statData.line;
      const line = (lineStr && lineStr !== 'N/A') 
        ? (typeof lineStr === 'string' ? parseFloat(lineStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(lineStr)))
        : null;
      
      if (line !== null && Number.isFinite(line)) {
        // Round to nearest 0.5 to group similar lines together
        const roundedLine = Math.round(line * 2) / 2;
        lineCounts.set(roundedLine, (lineCounts.get(roundedLine) || 0) + 1);
      }
    }
  }
  
  if (lineCounts.size === 0) {
    return null;
  }
  
  // Find the most common line (consensus)
  let consensusLine: number | null = null;
  let maxCount = 0;
  for (const [line, count] of lineCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      consensusLine = line;
    }
  }
  
  return consensusLine;
}




