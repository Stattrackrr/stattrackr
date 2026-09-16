// Shared utility for calculating implied probabilities from American odds
// Used by both Dashboard and Top Player Props page to ensure consistency

export function impliedProbabilityFromAmerican(american: number): number {
  if (american > 0) {
    return (100 / (american + 100)) * 100;
  } else {
    return (Math.abs(american) / (Math.abs(american) + 100)) * 100;
  }
}

export function calculateImpliedProbabilities(
  overOddsStr: string | number | null,
  underOddsStr: string | number | null
): { overImpliedProb: number; underImpliedProb: number } | null {
  const overOdds = (overOddsStr && overOddsStr !== 'N/A') 
    ? (typeof overOddsStr === 'string' ? parseFloat(overOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(overOddsStr)))
    : null;
  const underOdds = (underOddsStr && underOddsStr !== 'N/A')
    ? (typeof underOddsStr === 'string' ? parseFloat(underOddsStr.replace(/[^0-9.+-]/g, '')) : parseFloat(String(underOddsStr)))
    : null;
  
  if (overOdds === null || underOdds === null || !Number.isFinite(overOdds) || !Number.isFinite(underOdds)) {
    return null;
  }
  
  const overProb = impliedProbabilityFromAmerican(overOdds);
  const underProb = impliedProbabilityFromAmerican(underOdds);
  const totalProb = overProb + underProb;
  
  if (totalProb > 0) {
    return {
      overImpliedProb: (overProb / totalProb) * 100,
      underImpliedProb: (underProb / totalProb) * 100,
    };
  }
  
  return null;
}
