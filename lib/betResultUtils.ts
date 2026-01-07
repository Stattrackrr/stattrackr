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
 * @param actualValue - Negative means team covered (win), positive means didn't cover (loss)
 * @returns 'win' or 'loss'
 */
export function calculateSpreadResult(actualValue: number): 'win' | 'loss' {
  return actualValue < 0 ? 'win' : 'loss';
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
    return calculateSpreadResult(actualValue);
  } else {
    return calculateBetResult(actualValue, line, overUnder);
  }
}

