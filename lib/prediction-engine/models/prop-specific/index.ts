/**
 * Prop-Specific Models (8 models)
 * Models specific to betting props and lines
 */

import type { PlayerStats, GameLog, ModelPrediction, StatLine, PlayerProp } from '../../types';

/**
 * Model 38: Prop Historical Performance
 * How often does player go over this line?
 */
export function propHistoricalPerformanceModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  line: number
): ModelPrediction {
  const recentGames = playerStats.recentGames.slice(0, 20); // Last 20 games
  
  if (recentGames.length === 0) {
    return {
      modelName: 'Prop Historical Performance',
      category: 'prop-specific',
      prediction: line,
      confidence: 0.5,
      weight: 0.10,
      reasoning: 'No game history available',
    };
  }
  
  // Count how many times player went over the line
  const overCount = recentGames.filter(g => g[statType] > line).length;
  const hitRate = overCount / recentGames.length;
  
  // Calculate average when going over
  const overGames = recentGames.filter(g => g[statType] > line);
  const avgWhenOver = overGames.length > 0
    ? overGames.reduce((sum, g) => sum + g[statType], 0) / overGames.length
    : line;
  
  // If hit rate > 65%, predict over
  const prediction = hitRate > 0.65 ? avgWhenOver : line * 0.95;
  
  // Confidence based on hit rate
  const confidence = Math.abs(hitRate - 0.5) * 2; // 0.5 = no edge, 1.0 = always over/under
  
  return {
    modelName: 'Prop Historical Performance',
    category: 'prop-specific',
    prediction,
    confidence: Math.max(0.5, Math.min(0.9, confidence)),
    weight: 0.10,
    reasoning: `Hit rate: ${(hitRate * 100).toFixed(0)}% (${overCount}/${recentGames.length} games over ${line})`,
  };
}

/**
 * Model 39: Over/Under Tendency
 * Does this player consistently go over or under?
 */
export function overUnderTendencyModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  line: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const recentGames = playerStats.recentGames.slice(0, 20);
  
  if (recentGames.length === 0) {
    return {
      modelName: 'Over/Under Tendency',
      category: 'prop-specific',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.08,
      reasoning: 'No game history',
    };
  }
  
  // Calculate over rate for season average
  const overRate = recentGames.filter(g => g[statType] > seasonAvg).length / recentGames.length;
  
  let prediction = seasonAvg;
  let reasoning = '';
  
  if (overRate > 0.60) {
    prediction = seasonAvg * 1.05; // Tends to go over
    reasoning = `Tends to exceed average (${(overRate * 100).toFixed(0)}% over rate)`;
  } else if (overRate < 0.40) {
    prediction = seasonAvg * 0.95; // Tends to go under
    reasoning = `Tends to fall short of average (${(overRate * 100).toFixed(0)}% over rate)`;
  } else {
    reasoning = `Consistent with average (${(overRate * 100).toFixed(0)}% over rate)`;
  }
  
  const confidence = Math.abs(overRate - 0.5) * 2;
  
  return {
    modelName: 'Over/Under Tendency',
    category: 'prop-specific',
    prediction,
    confidence: Math.max(0.5, Math.min(0.85, confidence)),
    weight: 0.08,
    reasoning,
  };
}

/**
 * Model 40: Bookmaker-Specific Pattern
 * Some bookmakers shade lines
 */
export function bookmakerPatternModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  line: number,
  bookmaker: string
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Known bookmaker tendencies
  const bookmakerAdjustments: Record<string, number> = {
    'DraftKings': -0.5, // DK tends to shade star players higher
    'FanDuel': -0.3,
    'BetMGM': 0,
    'Caesars': 0.2,
  };
  
  const adjustment = bookmakerAdjustments[bookmaker] || 0;
  const adjustedLine = line + adjustment;
  
  // Predict based on adjusted line
  const prediction = seasonAvg > adjustedLine ? seasonAvg : adjustedLine * 0.95;
  
  return {
    modelName: 'Bookmaker Pattern',
    category: 'prop-specific',
    prediction,
    confidence: Math.abs(adjustment) > 0 ? 0.65 : 0.5,
    weight: 0.06,
    reasoning: adjustment !== 0 
      ? `${bookmaker} typically shades ${adjustment > 0 ? 'lower' : 'higher'} (adj: ${adjustment})` 
      : `${bookmaker} (no known bias)`,
  };
}

/**
 * Model 41: Correlation Analysis
 * If player goes over points, likely goes over assists too
 */
export function correlationAnalysisModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  primaryStatProjection: number,
  primaryStatType: keyof StatLine
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (statType === primaryStatType) {
    return {
      modelName: 'Correlation Analysis',
      category: 'prop-specific',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Same stat type',
    };
  }
  
  // Calculate correlation from recent games
  const correlation = calculateCorrelation(playerStats.recentGames, primaryStatType, statType);
  
  let correlationMultiplier = 1.0;
  let reasoning = '';
  
  if (correlation > 0.5) {
    correlationMultiplier = 1.05; // Strong positive correlation
    reasoning = `Strong positive correlation with ${primaryStatType} (${correlation.toFixed(2)})`;
  } else if (correlation < -0.5) {
    correlationMultiplier = 0.95; // Strong negative correlation
    reasoning = `Strong negative correlation with ${primaryStatType} (${correlation.toFixed(2)})`;
  } else {
    reasoning = `Weak correlation with ${primaryStatType} (${correlation.toFixed(2)})`;
  }
  
  const prediction = seasonAvg * correlationMultiplier;
  
  return {
    modelName: 'Correlation Analysis',
    category: 'prop-specific',
    prediction,
    confidence: Math.abs(correlation) > 0.5 ? 0.7 : 0.5,
    weight: 0.05,
    reasoning,
  };
}

/**
 * Model 42: Expected Value (EV) Calculator
 * Calculate true odds vs bookmaker odds
 */
export function expectedValueModel(
  prediction: number,
  line: number,
  overOdds: number,
  underOdds: number
): ModelPrediction {
  // Convert American odds to decimal
  const overDecimal = overOdds > 0 ? (overOdds / 100) + 1 : (100 / Math.abs(overOdds)) + 1;
  const underDecimal = underOdds > 0 ? (underOdds / 100) + 1 : (100 / Math.abs(underOdds)) + 1;
  
  // Estimate probability of going over (simplified normal distribution)
  const stdDev = prediction * 0.25; // Assume 25% coefficient of variation
  const zScore = (line - prediction) / stdDev;
  const probOver = 1 - normalCDF(zScore);
  
  // Calculate EV for over bet
  const evOver = (probOver * overDecimal) - 1;
  
  // Calculate EV for under bet
  const evUnder = ((1 - probOver) * underDecimal) - 1;
  
  // Use the bet with positive EV
  const bestBet = evOver > evUnder ? 'over' : 'under';
  const bestEV = Math.max(evOver, evUnder);
  
  // Adjust prediction based on EV
  const finalPrediction = bestBet === 'over' ? prediction : line * 0.95;
  
  return {
    modelName: 'Expected Value',
    category: 'prop-specific',
    prediction: finalPrediction,
    confidence: bestEV > 0.05 ? 0.8 : 0.5,
    weight: 0.12,
    reasoning: `EV: ${(bestEV * 100).toFixed(1)}% (${bestBet}), prob over: ${(probOver * 100).toFixed(0)}%`,
  };
}

/**
 * Model 43: Line Value Model
 * How far is projection from line?
 */
export function lineValueModel(
  prediction: number,
  line: number,
  stdDev: number
): ModelPrediction {
  const edge = prediction - line;
  const edgeInStdDevs = stdDev > 0 ? edge / stdDev : 0;
  
  let confidence = 0.5;
  let reasoning = '';
  
  if (Math.abs(edgeInStdDevs) > 2) {
    confidence = 0.9;
    reasoning = `STRONG EDGE: ${edge.toFixed(1)} pts (${edgeInStdDevs.toFixed(1)} std devs)`;
  } else if (Math.abs(edgeInStdDevs) > 1) {
    confidence = 0.75;
    reasoning = `MODERATE EDGE: ${edge.toFixed(1)} pts (${edgeInStdDevs.toFixed(1)} std devs)`;
  } else {
    confidence = 0.5;
    reasoning = `SMALL EDGE: ${edge.toFixed(1)} pts (${edgeInStdDevs.toFixed(1)} std devs)`;
  }
  
  return {
    modelName: 'Line Value',
    category: 'prop-specific',
    prediction,
    confidence,
    weight: 0.15,
    reasoning,
  };
}

/**
 * Model 44: Bookmaker Limit Model
 * Some books limit winners
 */
export function bookmakerLimitModel(
  prediction: number,
  bookmaker: string,
  userWinRate?: number
): ModelPrediction {
  // Books that are known to limit sharp bettors
  const limitingBooks = ['Pinnacle', 'Circa', 'BetMGM'];
  const isLimitingBook = limitingBooks.includes(bookmaker);
  
  // If user is winning and book limits, lower priority
  const isLikelyLimited = userWinRate && userWinRate > 0.55 && isLimitingBook;
  
  return {
    modelName: 'Bookmaker Limits',
    category: 'prop-specific',
    prediction,
    confidence: isLikelyLimited ? 0.4 : 0.6,
    weight: 0.03,
    reasoning: isLikelyLimited 
      ? `${bookmaker} likely limits winners (win rate: ${(userWinRate! * 100).toFixed(0)}%)` 
      : `${bookmaker} (no limit concerns)`,
  };
}

/**
 * Model 45: Multi-Book Comparison
 * Find the best line across all books
 */
export function multiBookComparisonModel(
  prediction: number,
  props: PlayerProp[]
): ModelPrediction {
  if (props.length === 0) {
    return {
      modelName: 'Multi-Book Comparison',
      category: 'prop-specific',
      prediction,
      confidence: 0.5,
      weight: 0.08,
      reasoning: 'No props available',
    };
  }
  
  // Find best line (highest for over bets, lowest for under bets)
  const bestOverLine = Math.max(...props.map(p => p.line));
  const bestUnderLine = Math.min(...props.map(p => p.line));
  
  // Determine which is better value
  const overEdge = prediction - bestOverLine;
  const underEdge = bestUnderLine - prediction;
  
  const bestLine = overEdge > underEdge ? bestOverLine : bestUnderLine;
  const bestBook = props.find(p => p.line === bestLine)?.bookmaker || 'Unknown';
  
  const edge = Math.abs(prediction - bestLine);
  
  return {
    modelName: 'Multi-Book Comparison',
    category: 'prop-specific',
    prediction,
    confidence: edge > 1 ? 0.75 : 0.6,
    weight: 0.08,
    reasoning: `Best line: ${bestLine} at ${bestBook} (edge: ${edge.toFixed(1)} pts)`,
  };
}

// ==================== HELPER FUNCTIONS ====================

function calculateCorrelation(
  games: GameLog[],
  stat1: keyof StatLine,
  stat2: keyof StatLine
): number {
  if (games.length < 5) return 0;
  
  const values1 = games.map(g => g[stat1]);
  const values2 = games.map(g => g[stat2]);
  
  const mean1 = values1.reduce((sum, val) => sum + val, 0) / values1.length;
  const mean2 = values2.reduce((sum, val) => sum + val, 0) / values2.length;
  
  let numerator = 0;
  let denom1 = 0;
  let denom2 = 0;
  
  for (let i = 0; i < values1.length; i++) {
    const diff1 = values1[i] - mean1;
    const diff2 = values2[i] - mean2;
    numerator += diff1 * diff2;
    denom1 += diff1 * diff1;
    denom2 += diff2 * diff2;
  }
  
  if (denom1 === 0 || denom2 === 0) return 0;
  
  return numerator / Math.sqrt(denom1 * denom2);
}

// Simplified normal CDF approximation
function normalCDF(z: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - prob : prob;
}
