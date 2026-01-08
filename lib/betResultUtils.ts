/**
 * Utility functions for calculating bet results (win/loss)
 */

/**
 * Check if a line is a whole number
 */
export function isWholeNumber(line: number): boolean {
  return line % 1 === 0;
}

/**
 * Calculate if an over/under bet should win
 * 
 * Rules:
 * - For whole number lines (e.g., 4): "over 4" means >= 4, "under 4" means <= 4
 * - For decimal lines (e.g., 3.5): "over 3.5" means > 3.5, "under 3.5" means < 3.5
 * 
 * @param actualValue - The actual value achieved
 * @param line - The betting line
 * @param overUnder - Either 'over' or 'under'
 * @returns true if the bet should win, false if it should lose
 */
export function calculateOverUnderWin(
  actualValue: number,
  line: number,
  overUnder: 'over' | 'under'
): boolean {
  const isWhole = isWholeNumber(line);
  
  if (overUnder === 'over') {
    return isWhole ? actualValue >= line : actualValue > line;
  } else {
    return isWhole ? actualValue <= line : actualValue < line;
  }
}

/**
 * Calculate bet result for standard over/under bets
 * 
 * @param actualValue - The actual value achieved
 * @param line - The betting line
 * @param overUnder - Either 'over' or 'under'
 * @returns 'win' or 'loss'
 */
export function calculateBetResult(
  actualValue: number,
  line: number,
  overUnder: 'over' | 'under'
): 'win' | 'loss' {
  return calculateOverUnderWin(actualValue, line, overUnder) ? 'win' : 'loss';
}

/**
 * Calculate bet result for moneyline bets
 * 
 * @param actualValue - Should be 1 if team won, 0 if team lost
 * @returns 'win' or 'loss'
 */
export function calculateMoneylineResult(actualValue: number): 'win' | 'loss' {
  return actualValue === 1 ? 'win' : 'loss';
}

/**
 * Calculate bet result for spread bets
 * 
 * @param actualValue - The actual point difference (positive if team won, negative if lost)
 * @param line - The spread line (negative for favored team, positive for underdog)
 * @returns 'win' or 'loss'
 * 
 * Example:
 * - Line: -5.5 (team favored by 5.5)
 * - If team wins by 6: actualValue = 6, 6 > 5.5 = win
 * - If team wins by 5: actualValue = 5, 5 < 5.5 = loss
 * - If team loses: actualValue = -3, -3 < -5.5 = loss
 */
export function calculateSpreadResult(actualValue: number, line: number): 'win' | 'loss' {
  // For spread bets, we compare the actual margin to the line
  // If line is negative (team favored), they need to win by more than |line|
  // If line is positive (team underdog), they need to lose by less than |line| or win
  if (line < 0) {
    // Team is favored - they need to win by more than |line|
    return actualValue > Math.abs(line) ? 'win' : 'loss';
  } else {
    // Team is underdog - they need to not lose by more than line, or win
    return actualValue > -line ? 'win' : 'loss';
  }
}

/**
 * Universal function to calculate bet result based on bet type
 * 
 * @param actualValue - The actual value achieved
 * @param line - The betting line (not used for moneyline/spread)
 * @param overUnder - Either 'over' or 'under' (not used for moneyline/spread)
 * @param statType - The type of bet: 'moneyline', 'spread', or other (for over/under)
 * @returns 'win' or 'loss'
 */
export function calculateUniversalBetResult(
  actualValue: number,
  line: number,
  overUnder: 'over' | 'under',
  statType: string
): 'win' | 'loss' {
  if (statType === 'moneyline') {
    return calculateMoneylineResult(actualValue);
  } else if (statType === 'spread') {
    return calculateSpreadResult(actualValue, line);
  } else {
    return calculateBetResult(actualValue, line, overUnder);
  }
}

