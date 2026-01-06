'use client';

import { useMemo, useCallback } from 'react';

export interface UseBettingLineParams {
  bettingLines: Record<string, number>;
  setBettingLines: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  selectedStat: string;
}

export function useBettingLine({
  bettingLines,
  setBettingLines,
  selectedStat,
}: UseBettingLineParams) {
  // Update betting line for current stat
  const setBettingLine = useCallback((value: number) => {
    setBettingLines(prev => {
      // Check if the value actually changed to prevent unnecessary re-renders
      const currentValue = prev[selectedStat];
      if (currentValue !== undefined && Math.abs(currentValue - value) < 0.01) {
        // Value hasn't changed, return previous object to prevent re-render
        return prev;
      }
      // Value changed, update the state
      return {
        ...prev,
        [selectedStat]: value
      };
    });
  }, [setBettingLines, selectedStat]);
  
  // Get current betting line for selected stat (defined early so it can be used in hitRateStats)
  // Use stored line if available, otherwise default to 0.5
  // Note: bestLineForStat will update bettingLines state via useEffect when it becomes available
  const bettingLine = useMemo(() => {
    // First check if we have a stored line for this stat
    if (selectedStat in bettingLines) {
      return bettingLines[selectedStat];
    }
    // Otherwise default to 0.5 (will be updated by useEffect when bestLineForStat is available)
    return 0.5;
  }, [bettingLines, selectedStat]);

  return {
    bettingLine,
    setBettingLine,
  };
}

