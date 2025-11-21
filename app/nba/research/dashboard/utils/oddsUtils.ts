// Odds-related utility functions

import type { AltLineItem } from '../types';

export const partitionAltLineItems = (lines: AltLineItem[]) => {
  // Calculate consensus line (most common line value)
  const lineCounts = new Map<number, number>();
  for (const line of lines) {
    lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
  }
  
  let consensusLine: number | null = null;
  let maxCount = 0;
  for (const [line, count] of lineCounts.entries()) {
    if (count > maxCount) {
      maxCount = count;
      consensusLine = line;
    }
  }
  
  // Group lines by bookmaker
  const linesByBookmaker = new Map<string, AltLineItem[]>();
  for (const line of lines) {
    const key = (line.bookmaker || '').toLowerCase();
    if (!linesByBookmaker.has(key)) {
      linesByBookmaker.set(key, []);
    }
    linesByBookmaker.get(key)!.push(line);
  }
  
  // Identify primary line for each bookmaker (closest to consensus)
  const primaryLines = new Map<string, AltLineItem>();
  const alternate: AltLineItem[] = [];
  
  for (const [bookmaker, bookmakerLines] of linesByBookmaker.entries()) {
    if (bookmakerLines.length === 0) continue;
    
    let primaryLine = bookmakerLines[0];
    
    // If we have consensus and multiple lines, find closest to consensus
    if (consensusLine !== null && bookmakerLines.length > 1) {
      let closestLine = bookmakerLines[0];
      let minDiff = Math.abs(bookmakerLines[0].line - consensusLine);
      
      for (const line of bookmakerLines) {
        const diff = Math.abs(line.line - consensusLine);
        if (diff < minDiff) {
          minDiff = diff;
          closestLine = line;
        }
      }
      primaryLine = closestLine;
    }
    
    primaryLines.set(bookmaker, primaryLine);
    
    // All other lines for this bookmaker are alternates
    for (const line of bookmakerLines) {
      if (line.line !== primaryLine.line || 
          line.over !== primaryLine.over || 
          line.under !== primaryLine.under) {
        alternate.push(line);
      }
    }
  }
  
  const primary = Array.from(primaryLines.values());
  
  return { primary, alternate };
};





