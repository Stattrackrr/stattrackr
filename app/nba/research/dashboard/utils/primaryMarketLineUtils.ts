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
  console.log('[primaryMarketLine] START calculation:', { 
    hasRealOddsData: !!realOddsData, 
    realOddsDataLength: realOddsData?.length || 0, 
    selectedStat,
    realOddsDataType: typeof realOddsData,
    isArray: Array.isArray(realOddsData)
  });
  
  if (!realOddsData || realOddsData.length === 0 || !selectedStat) {
    console.log('[primaryMarketLine] EARLY RETURN - No data:', { 
      hasRealOddsData: !!realOddsData, 
      realOddsDataLength: realOddsData?.length || 0, 
      selectedStat 
    });
    return null;
  }
  
  const bookRowKey = getBookRowKey(selectedStat);
  console.log('[primaryMarketLine] bookRowKey result:', { selectedStat, bookRowKey });
  if (!bookRowKey) {
    console.log('[primaryMarketLine] EARLY RETURN - No bookRowKey for stat:', selectedStat);
    return null;
  }
  
  console.log('[primaryMarketLine] Calculating for:', { selectedStat, bookRowKey, realOddsDataLength: realOddsData.length });
  console.log('[primaryMarketLine] Sample book structure:', realOddsData[0] ? {
    name: realOddsData[0].name,
    keys: Object.keys(realOddsData[0]),
    hasPRA: 'PRA' in realOddsData[0],
    PRA: (realOddsData[0] as any).PRA,
    hasBookRowKey: bookRowKey in realOddsData[0],
    bookRowKeyValue: (realOddsData[0] as any)[bookRowKey]
  } : null);
  
  // Collect all real lines (not alt lines) and find the most common one
  const lineCounts = new Map<number, number>();
  
  for (const book of realOddsData) {
    const meta = (book as any)?.meta;
    // Skip alt lines - only use primary over/under lines
    if (meta?.variantLabel) {
      console.log('[primaryMarketLine] Skipping alt line:', meta.variantLabel);
      continue;
    }
    
    const statData = (book as any)[bookRowKey];
    console.log('[primaryMarketLine] Checking book:', { 
      bookName: book?.name || meta?.baseName, 
      hasStatData: !!statData, 
      statDataType: typeof statData,
      statDataIsObject: statData && typeof statData === 'object',
      statDataKeys: statData && typeof statData === 'object' ? Object.keys(statData) : null,
      statDataLine: statData?.line,
      statDataOver: statData?.over,
      statDataUnder: statData?.under,
      fullStatData: statData
    });
    
    if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
      const lineStr = statData.line;
      const line = (lineStr && lineStr !== 'N/A') 
        ? (typeof lineStr === 'string' ? parseFloat(lineStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(lineStr)))
        : null;
      
      if (line !== null && Number.isFinite(line)) {
        // Round to nearest 0.5 to group similar lines together
        const roundedLine = Math.round(line * 2) / 2;
        lineCounts.set(roundedLine, (lineCounts.get(roundedLine) || 0) + 1);
        console.log('[primaryMarketLine] ✓ Found valid line:', { line, roundedLine, count: lineCounts.get(roundedLine) });
      } else {
        console.log('[primaryMarketLine] ✗ Invalid line value:', { lineStr, parsed: line, isFinite: Number.isFinite(line) });
      }
    } else {
      console.log('[primaryMarketLine] ✗ Stat data missing or N/A:', { 
        hasStatData: !!statData,
        line: statData?.line,
        over: statData?.over,
        under: statData?.under,
        lineCheck: statData?.line !== 'N/A',
        overCheck: statData?.over !== 'N/A',
        underCheck: statData?.under !== 'N/A'
      });
    }
  }
  
  if (lineCounts.size === 0) {
    console.log('[primaryMarketLine] ✗ No valid lines found after processing all books');
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
  
  console.log('[primaryMarketLine] ✓ Consensus line:', { consensusLine, maxCount, allLines: Array.from(lineCounts.entries()) });
  return consensusLine;
}


