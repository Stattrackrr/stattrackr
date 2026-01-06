import { useEffect } from 'react';

export interface UsePredictedPaceParams {
  propsMode: 'player' | 'team';
  realOddsData: any[];
  selectedTeam: string;
  opponentTeam: string;
  setPredictedPace: (pace: number | null) => void;
}

/**
 * Custom hook to calculate predicted pace from total points line in odds data
 */
export function usePredictedPace({
  propsMode,
  realOddsData,
  selectedTeam,
  opponentTeam,
  setPredictedPace,
}: UsePredictedPaceParams) {
  useEffect(() => {
    // Only calculate for team mode
    if (propsMode !== 'team' || !realOddsData || realOddsData.length === 0) {
      setPredictedPace(null);
      return;
    }

    // Find total points line from odds data
    let totalLine: number | null = null;
    for (const book of realOddsData) {
      const totalData = (book as any)?.Total;
      if (totalData && totalData.line && totalData.line !== 'N/A') {
        const lineValue = parseFloat(totalData.line);
        if (!isNaN(lineValue) && lineValue > 0) {
          // Use the first valid total line found (or could average them)
          totalLine = lineValue;
          break;
        }
      }
    }

    if (totalLine === null) {
      setPredictedPace(null);
      return;
    }

    // Convert total points to predicted pace
    // Formula: Pace ≈ Total / (2 * avg_points_per_possession)
    // Average NBA points per possession is ~1.12
    // So: Pace ≈ Total / 2.24
    // We'll use a more accurate formula based on historical data
    // Typical range: Total 200-240, Pace 95-105
    // Linear relationship: Pace = (Total - 200) * (10/40) + 95 = (Total - 200) * 0.25 + 95
    // Or more accurate: Pace = Total / 2.2 (simpler)
    const calculatedPace = totalLine / 2.2;
    
    // Clamp to reasonable NBA pace range (90-110)
    const clampedPace = Math.max(90, Math.min(110, calculatedPace));
    
    console.log('[Dashboard] Calculated predicted pace from total:', { totalLine, calculatedPace, clampedPace });
    setPredictedPace(clampedPace);
  }, [realOddsData, selectedTeam, opponentTeam, propsMode, setPredictedPace]);
}

