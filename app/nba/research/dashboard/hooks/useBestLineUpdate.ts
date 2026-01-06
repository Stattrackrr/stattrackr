import { useEffect, startTransition } from 'react';

export interface UseBestLineUpdateParams {
  bestLineForStat: number | null;
  selectedStat: string;
  bettingLine: number;
  bettingLines: Record<string, number>;
  setBettingLines: (lines: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
}

/**
 * Custom hook to update bettingLines state when bestLineForStat becomes available
 * Only updates if the current stat doesn't already have a stored line
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
    // 2. selectedStat is valid
    // 3. We don't already have a stored line for this stat (use functional update to get latest state)
    // 4. The current bettingLine is the default 0.5
    if (bestLineForStat !== null && selectedStat) {
      // Use startTransition to prevent blocking chart render when odds finish loading
      startTransition(() => {
        // Use functional update to get the latest bettingLines state (avoids stale closure)
        setBettingLines(prev => {
          // Check if this stat already has a line stored (use current state, not closure)
          if (selectedStat in prev) {
            // Stat already has a line, don't update - this prevents overwriting existing lines
            return prev;
          }
          
          // Get the current betting line for this stat from the current state
          const currentLine = prev[selectedStat] ?? bettingLine;
          
          // Only update if it's still at the default (0.5) - this prevents overwriting manually set lines
          if (Math.abs(currentLine - 0.5) < 0.01) {
            return {
              ...prev,
              [selectedStat]: bestLineForStat
            };
          }
          
          return prev;
        });
      });
    }
  }, [bestLineForStat, selectedStat, bettingLine, setBettingLines]);
}


