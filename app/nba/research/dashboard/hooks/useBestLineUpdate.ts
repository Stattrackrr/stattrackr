import { useEffect } from 'react';

export interface UseBestLineUpdateParams {
  bestLineForStat: number | null;
  selectedStat: string;
  bettingLine: number;
  bettingLines: Record<string, number>;
  setBettingLines: (lines: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
}

/**
 * Custom hook to update bettingLines state when bestLineForStat becomes available
 */
export function useBestLineUpdate({
  bestLineForStat,
  selectedStat,
  bettingLine,
  bettingLines,
  setBettingLines,
}: UseBestLineUpdateParams) {
  useEffect(() => {
    // Only update if:
    // 1. bestLineForStat is available
    // 2. We don't already have a stored line for this stat
    // 3. The current bettingLine is the default 0.5
    if (bestLineForStat !== null && !(selectedStat in bettingLines)) {
      const currentLine = bettingLine;
      if (Math.abs(currentLine - 0.5) < 0.01) {
        // Only update if it's still at the default
        setBettingLines(prev => ({
          ...prev,
          [selectedStat]: bestLineForStat
        }));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestLineForStat, selectedStat]);
}


