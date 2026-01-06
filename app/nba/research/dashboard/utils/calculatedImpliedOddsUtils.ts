/**
 * Calculated implied odds utilities
 * 
 * This file contains the logic for calculating implied probabilities
 * from odds data, preferring FanDuel and falling back to consensus.
 */

import { BookRow } from '../types';
import { getBookRowKey } from './oddsUtils';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';

export interface ImpliedOddsResult {
  overImpliedProb: number;
  underImpliedProb: number;
}

export interface CalculatedImpliedOddsParams {
  realOddsData: BookRow[];
  selectedStat: string;
}

/**
 * Calculates implied probabilities from odds data
 * Prefers FanDuel, falls back to consensus (average of all bookmakers)
 */
export function calculateImpliedOdds({
  realOddsData,
  selectedStat,
}: CalculatedImpliedOddsParams): ImpliedOddsResult | null {
  if (!realOddsData || realOddsData.length === 0 || !selectedStat) {
    return null;
  }
  
  const bookRowKey = getBookRowKey(selectedStat);
  if (!bookRowKey) {
    return null;
  }
  
  // Try FanDuel first (only real lines, not alt lines)
  const fanduelBook = realOddsData.find((book: any) => {
    const baseName = ((book as any)?.meta?.baseName || book?.name || '').toLowerCase();
    return baseName === 'fanduel';
  });
  
  if (fanduelBook) {
    const meta = (fanduelBook as any)?.meta;
    // Only use primary over/under lines, skip alt lines
    if (!meta?.variantLabel) {
      const statData = (fanduelBook as any)[bookRowKey];
      if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
        const fanduelImplied = calculateImpliedProbabilities(statData.over, statData.under);
        if (fanduelImplied) {
          return fanduelImplied;
        }
      }
    }
  }
  
  // Fallback to consensus (average of all bookmakers with valid real odds, no alt lines)
  const validBooks: Array<{ over: number; under: number }> = [];
  
  for (const book of realOddsData) {
    const meta = (book as any)?.meta;
    // Skip alt lines - only use primary over/under lines
    if (meta?.variantLabel) continue;
    
    const statData = (book as any)[bookRowKey];
    if (statData && statData.line !== 'N/A' && statData.over !== 'N/A' && statData.under !== 'N/A') {
      const bookImplied = calculateImpliedProbabilities(statData.over, statData.under);
      if (bookImplied) {
        validBooks.push({
          over: bookImplied.overImpliedProb,
          under: bookImplied.underImpliedProb,
        });
      }
    }
  }
  
  if (validBooks.length > 0) {
    const avgOver = validBooks.reduce((sum, b) => sum + b.over, 0) / validBooks.length;
    const avgUnder = validBooks.reduce((sum, b) => sum + b.under, 0) / validBooks.length;
    return {
      overImpliedProb: avgOver,
      underImpliedProb: avgUnder,
    };
  }
  
  return null;
}



