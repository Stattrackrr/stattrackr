/**
 * Statistical Models (12+ models)
 * Core statistical predictions based on player performance data
 * Now includes shot chart and play type data from NBA Stats cache
 */

import type { PlayerStats, GameLog, StatLine, ModelPrediction, GameContext, ShotChartData, PlayTypeData, TrackingStatsData } from '../../types';

/**
 * Model 1: Season Average Baseline
 * Simple season average - the foundation
 */
export function seasonAverageModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  const prediction = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  return {
    modelName: 'Season Average Baseline',
    category: 'statistical',
    prediction,
    confidence: 0.65, // Baseline confidence for season average
    weight: 0.10,
    reasoning: `Season average: ${prediction.toFixed(1)} ${statType}`,
  };
}

/**
 * Model 2: Weighted Recent Form (L5, L10, L20)
 * Weight recent games more heavily than older games
 */
export function weightedRecentFormModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  const l5 = playerStats.last5Avg[statType];
  const l10 = playerStats.last10Avg[statType];
  const l20 = playerStats.last20Avg[statType];
  
  // Weight: 50% L5, 30% L10, 20% L20
  const prediction = (l5 * 0.5) + (l10 * 0.3) + (l20 * 0.2);
  
  // Confidence: less strict on variance — was 0.9 - variance/20, now 0.85 - variance/50
  const variance = Math.abs(l5 - l10) + Math.abs(l10 - l20);
  const confidence = Math.max(0.68, 0.85 - (variance / 50));
  
  return {
    modelName: 'Weighted Recent Form',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.15,
    reasoning: `L5: ${l5.toFixed(1)}, L10: ${l10.toFixed(1)}, L20: ${l20.toFixed(1)}`,
  };
}

/**
 * Model 3: Per-Minute Projection
 * Scale stats by projected minutes
 */
export function perMinuteModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  projectedMinutes: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const avgMinutes = playerStats.seasonStats.minutes || 30;
  
  // Calculate per-minute rate
  const perMinuteRate = avgMinutes > 0 ? seasonAvg / avgMinutes : 0;
  
  // Project for expected minutes
  const prediction = perMinuteRate * projectedMinutes;
  
  // Confidence based on minutes consistency
  const minutesVariance = calculateMinutesVariance(playerStats.recentGames);
  const confidence = Math.max(0.65, 0.88 - minutesVariance * 0.8);
  
  return {
    modelName: 'Per-Minute Projection',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.12,
    reasoning: `${perMinuteRate.toFixed(2)} per min × ${projectedMinutes} min = ${prediction.toFixed(1)}`,
  };
}

/**
 * Model 4: Usage-Based Projection
 * Adjust for changes in usage rate
 */
export function usageBasedModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  currentUsage?: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const seasonUsage = playerStats.advancedStats.usage || 20;
  const usage = currentUsage || seasonUsage;
  
  // Adjust prediction based on usage change
  const usageMultiplier = usage / seasonUsage;
  const prediction = seasonAvg * usageMultiplier;
  
  // Confidence based on how drastic the usage change is
  const usageChange = Math.abs(usage - seasonUsage);
  const confidence = Math.max(0.65, 0.85 - (usageChange / 150));
  
  return {
    modelName: 'Usage-Based Projection',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.11,
    reasoning: `USG: ${usage.toFixed(1)}% (season: ${seasonUsage.toFixed(1)}%)`,
  };
}

/**
 * Model 5: Pace-Adjusted Projection
 * Adjust for game pace
 */
export function paceAdjustedModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponentPace: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const leagueAvgPace = 100; // NBA average pace
  
  // Adjust for opponent's pace
  const paceMultiplier = opponentPace / leagueAvgPace;
  const prediction = seasonAvg * paceMultiplier;
  
  // Confidence based on pace difference
  const paceDiff = Math.abs(opponentPace - leagueAvgPace);
  const confidence = Math.max(0.6, 0.85 - (paceDiff / 100));
  
  return {
    modelName: 'Pace-Adjusted Projection',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `Opponent pace: ${opponentPace.toFixed(1)} (league avg: ${leagueAvgPace})`,
  };
}

/**
 * Model 6: True Shooting Efficiency
 * Weight by shooting efficiency
 */
export function trueShootingModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const playerTS = playerStats.advancedStats.trueShootingPct || 0.55;
  const leagueAvgTS = 0.57; // NBA average TS%
  
  // Only adjust for scoring stats
  const isScoringStat = statType === 'pts' || statType === 'fg3m';
  const tsMultiplier = isScoringStat ? (playerTS / leagueAvgTS) : 1.0;
  
  const prediction = seasonAvg * tsMultiplier;
  
  return {
    modelName: 'True Shooting Efficiency',
    category: 'statistical',
    prediction,
    confidence: 0.7,
    weight: 0.09,
    reasoning: `TS%: ${(playerTS * 100).toFixed(1)}% (league: ${(leagueAvgTS * 100).toFixed(1)}%)`,
  };
}

/**
 * Model 7: Home/Away Split
 * Adjust for location
 */
export function homeAwaySplitModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isHome: boolean
): ModelPrediction {
  const prediction = isHome 
    ? playerStats.homeAvg[statType]
    : playerStats.awayAvg[statType];
  
  // Calculate split differential
  const homeStat = playerStats.homeAvg[statType];
  const awayStat = playerStats.awayAvg[statType];
  const splitDiff = Math.abs(homeStat - awayStat);
  
  // Higher confidence if there's a significant split
  const confidence = splitDiff > 2 ? 0.75 : 0.65;
  
  return {
    modelName: 'Home/Away Split',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.11,
    reasoning: `${isHome ? 'Home' : 'Away'}: ${prediction.toFixed(1)} (split: ${splitDiff.toFixed(1)})`,
  };
}

/**
 * Model 8: Regression to Mean
 * Pull outlier performances back to average
 */
export function regressionToMeanModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const l5Avg = playerStats.last5Avg[statType];
  
  // Calculate standard deviation from recent games
  const stdDev = calculateStdDev(playerStats.recentGames, statType);
  
  // If L5 is more than 2 std devs from season avg, regress it
  const zScore = Math.abs(l5Avg - seasonAvg) / (stdDev || 1);
  
  let prediction: number;
  if (zScore > 2) {
    // Strong regression (60% season, 40% recent)
    prediction = (seasonAvg * 0.6) + (l5Avg * 0.4);
  } else if (zScore > 1) {
    // Moderate regression (40% season, 60% recent)
    prediction = (seasonAvg * 0.4) + (l5Avg * 0.6);
  } else {
    // No regression needed
    prediction = l5Avg;
  }
  
  const confidence = zScore > 2 ? 0.8 : 0.65;
  
  return {
    modelName: 'Regression to Mean',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `Z-score: ${zScore.toFixed(2)}, regressing ${zScore > 2 ? 'strongly' : zScore > 1 ? 'moderately' : 'not'}`,
  };
}

/**
 * Model 9: Variance/Consistency Model
 * Penalize inconsistent players
 */
export function varianceConsistencyModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const stdDev = calculateStdDev(playerStats.recentGames, statType);
  
  // Calculate coefficient of variation (CV)
  const cv = seasonAvg > 0 ? stdDev / seasonAvg : 0;
  
  // Consistency score (0-1, higher = more consistent)
  const consistency = Math.max(0, 1 - cv);
  
  // Use consistency as confidence — less strict floor
  const confidence = Math.max(0.6, Math.min(0.9, consistency + 0.1));
  
  return {
    modelName: 'Variance/Consistency',
    category: 'statistical',
    prediction: seasonAvg,
    confidence,
    weight: 0.08,
    reasoning: `Consistency: ${(consistency * 100).toFixed(0)}% (CV: ${cv.toFixed(2)})`,
  };
}

/**
 * Model 10: Quarter-by-Quarter Model
 * Predict based on quarter performance (requires NBA Stats API data)
 */
export function quarterByQuarterModel(
  playerStats: PlayerStats,
  statType: keyof StatLine
): ModelPrediction {
  // This would require quarter-by-quarter data from NBA Stats API
  // For now, use season average as placeholder
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  return {
    modelName: 'Quarter-by-Quarter',
    category: 'statistical',
    prediction: seasonAvg,
    confidence: 0.6,
    weight: 0.06,
    reasoning: 'Using season average (quarter data not yet implemented)',
  };
}

/**
 * Model 11: Clutch Performance Model
 * Adjust for clutch situations (requires NBA Stats API data)
 */
export function clutchPerformanceModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isClutchGame: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Placeholder - would use clutch stats from NBA Stats API
  const clutchMultiplier = isClutchGame ? 1.05 : 1.0;
  const prediction = seasonAvg * clutchMultiplier;
  
  return {
    modelName: 'Clutch Performance',
    category: 'statistical',
    prediction,
    confidence: 0.65,
    weight: 0.05,
    reasoning: isClutchGame ? 'Close game expected' : 'Not a clutch situation',
  };
}

/**
 * Model 12: Shot Quality Model
 * Uses cached shot chart data to adjust predictions based on shot distribution
 * Players who shoot more at the rim (high efficiency) vs mid-range (low efficiency)
 */
export function shotQualityModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  shotChart?: ShotChartData | null,
  opponentTeam?: string
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Only applies to scoring stats
  if (statType !== 'pts' && statType !== 'fg3m') {
    return {
      modelName: 'Shot Quality',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Not applicable to non-scoring stats',
    };
  }
  
  // If no shot chart data, return season average with low confidence
  if (!shotChart || !shotChart.shotZones) {
    return {
      modelName: 'Shot Quality',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No shot chart data available',
    };
  }
  
  const zones = shotChart.shotZones;
  
  // Calculate total attempts
  const totalAttempts = 
    zones.restrictedArea.fga +
    zones.paint.fga +
    zones.midRange.fga +
    zones.leftCorner3.fga +
    zones.rightCorner3.fga +
    zones.aboveBreak3.fga;
  
  if (totalAttempts === 0) {
    return {
      modelName: 'Shot Quality',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No shot attempts in cache',
    };
  }
  
  // Calculate shot distribution (where they get their shots)
  const rimPct = zones.restrictedArea.fga / totalAttempts;
  const paintPct = zones.paint.fga / totalAttempts;
  const midRangePct = zones.midRange.fga / totalAttempts;
  const corner3Pct = (zones.leftCorner3.fga + zones.rightCorner3.fga) / totalAttempts;
  const above3Pct = zones.aboveBreak3.fga / totalAttempts;
  
  // Calculate expected points per shot (efficiency score)
  // Rim shots are most efficient (~65% FG = 1.3 pts/shot)
  // Mid-range is least efficient (~40% FG = 0.8 pts/shot)
  // 3PT varies but corner 3s are most efficient (~38% FG = 1.14 pts/shot)
  const expectedPtsPerShot = 
    (zones.restrictedArea.fgPct / 100) * 2 * rimPct +
    (zones.paint.fgPct / 100) * 2 * paintPct +
    (zones.midRange.fgPct / 100) * 2 * midRangePct +
    (zones.leftCorner3.fgPct / 100) * 3 * (corner3Pct / 2) +
    (zones.rightCorner3.fgPct / 100) * 3 * (corner3Pct / 2) +
    (zones.aboveBreak3.fgPct / 100) * 3 * above3Pct;
  
  // League average is about 1.1 pts/shot
  const leagueAvgPtsPerShot = 1.1;
  const efficiencyMultiplier = expectedPtsPerShot / leagueAvgPtsPerShot;
  
  // Adjust for opponent defense if available
  let defenseMultiplier = 1.0;
  let defenseReasoning = '';
  
  if (opponentTeam && shotChart.opponentRankings) {
    const oppRankings = shotChart.opponentRankings;
    
    // Calculate weighted opponent defense factor based on player's shot profile
    // Rank 1 = best defense, 30 = worst defense
    // We weight by how often the player shoots from each zone
    const avgOppRank = 
      (oppRankings.restrictedArea?.rank || 15) * rimPct +
      (oppRankings.paint?.rank || 15) * paintPct +
      (oppRankings.midRange?.rank || 15) * midRangePct +
      (oppRankings.leftCorner3?.rank || 15) * (corner3Pct / 2) +
      (oppRankings.rightCorner3?.rank || 15) * (corner3Pct / 2) +
      (oppRankings.aboveBreak3?.rank || 15) * above3Pct;
    
    // Convert rank to multiplier (rank 30 = 1.1x, rank 1 = 0.9x)
    defenseMultiplier = 0.9 + (avgOppRank / 30) * 0.2;
    defenseReasoning = ` | vs ${opponentTeam} defense rank: ${avgOppRank.toFixed(0)}`;
  }
  
  const prediction = seasonAvg * efficiencyMultiplier * defenseMultiplier;
  
  // Confidence based on sample size
  const confidence = Math.min(0.85, 0.6 + (totalAttempts / 1000) * 0.25);
  
  return {
    modelName: 'Shot Quality',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.12, // Higher weight since we have real data
    reasoning: `Efficiency: ${expectedPtsPerShot.toFixed(2)} pts/shot (rim: ${(rimPct * 100).toFixed(0)}%, mid: ${(midRangePct * 100).toFixed(0)}%, 3PT: ${((corner3Pct + above3Pct) * 100).toFixed(0)}%)${defenseReasoning}`,
  };
}

/**
 * Model 13 (NEW): Play Type Scoring Model
 * Uses cached play type data to predict based on how player scores (ISO, PNR, Spot-up, etc.)
 */
export function playTypeScoringModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  playTypes?: PlayTypeData | null,
  opponentTeam?: string
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Only applies to points
  if (statType !== 'pts') {
    return {
      modelName: 'Play Type Scoring',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Not applicable to non-scoring stats',
    };
  }
  
  if (!playTypes || !playTypes.playTypes || playTypes.playTypes.length === 0) {
    return {
      modelName: 'Play Type Scoring',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No play type data available',
    };
  }
  
  // Sum up play type points (this is PPG from each play type)
  const playTypeTotal = playTypes.totalPoints || 
    playTypes.playTypes.reduce((sum, pt) => sum + pt.points, 0);
  
  // If play type total is close to season average, use it directly
  // Otherwise, use the ratio to adjust
  let prediction = seasonAvg;
  let reasoning = '';
  
  // Get top play types
  const topPlayTypes = playTypes.playTypes
    .filter(pt => pt.playType !== 'FreeThrows')
    .sort((a, b) => b.points - a.points)
    .slice(0, 3);
  
  // Check opponent defensive rankings for play types
  let defenseMultiplier = 1.0;
  let weakDefenseBonus = 0;
  let strongDefensePenalty = 0;
  
  if (opponentTeam) {
    for (const pt of topPlayTypes) {
      const oppRank = pt.oppRank;
      if (oppRank !== null && oppRank !== undefined) {
        // Rank 30 = worst defense (good for offense)
        // Rank 1 = best defense (bad for offense)
        if (oppRank >= 25) {
          // Opponent is weak at defending this play type
          weakDefenseBonus += pt.points * 0.08; // 8% boost
        } else if (oppRank <= 5) {
          // Opponent is strong at defending this play type
          strongDefensePenalty += pt.points * 0.06; // 6% penalty
        }
      }
    }
  }
  
  prediction = seasonAvg + weakDefenseBonus - strongDefensePenalty;
  
  // Build reasoning
  const topPlayTypeNames = topPlayTypes.map(pt => {
    const rankStr = pt.oppRank ? ` (opp: #${pt.oppRank})` : '';
    return `${pt.displayName || pt.playType}: ${pt.points.toFixed(1)}${rankStr}`;
  }).join(', ');
  
  reasoning = `Top play types: ${topPlayTypeNames}`;
  if (weakDefenseBonus > 0) {
    reasoning += ` | +${weakDefenseBonus.toFixed(1)} vs weak defense`;
  }
  if (strongDefensePenalty > 0) {
    reasoning += ` | -${strongDefensePenalty.toFixed(1)} vs strong defense`;
  }
  
  // Confidence based on play type coverage
  const confidence = Math.min(0.8, 0.6 + (topPlayTypes.length / 5) * 0.2);
  
  return {
    modelName: 'Play Type Scoring',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.12, // High weight since this is real data
    reasoning,
  };
}

/**
 * Model 14 (NEW): Play Type Efficiency Model
 * Players who score efficiently (cuts, transition) vs inefficiently (isolation, post-up)
 */
export function playTypeEfficiencyModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  playTypes?: PlayTypeData | null
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (statType !== 'pts') {
    return {
      modelName: 'Play Type Efficiency',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Not applicable to non-scoring stats',
    };
  }
  
  if (!playTypes || !playTypes.playTypes || playTypes.playTypes.length === 0) {
    return {
      modelName: 'Play Type Efficiency',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No play type data available',
    };
  }
  
  // Weight play types by their typical efficiency
  // Higher weight = more efficient play type
  const efficiencyWeights: { [key: string]: number } = {
    'Cut': 1.35,           // ~1.35 PPP
    'Transition': 1.15,    // ~1.15 PPP
    'OffRebound': 1.15,    // Putbacks ~1.15 PPP
    'PRRollman': 1.10,     // Roll man ~1.10 PPP
    'Spotup': 1.05,        // Spot-up ~1.05 PPP
    'Handoff': 1.00,       // ~1.00 PPP
    'PRBallHandler': 0.95, // PNR handler ~0.95 PPP
    'OffScreen': 0.90,     // ~0.90 PPP
    'Isolation': 0.85,     // ~0.85 PPP
    'Postup': 0.85,        // ~0.85 PPP
    'Misc': 0.80,
  };
  
  let weightedEfficiency = 0;
  let totalPts = 0;
  const breakdown: string[] = [];
  
  for (const pt of playTypes.playTypes) {
    if (pt.playType === 'FreeThrows') continue;
    const weight = efficiencyWeights[pt.playType] || 1.0;
    weightedEfficiency += pt.points * weight;
    totalPts += pt.points;
    
    if (pt.points >= 2 && (weight >= 1.1 || weight <= 0.9)) {
      breakdown.push(`${pt.playType}: ${pt.points.toFixed(1)} (${weight >= 1.1 ? '+' : '-'}eff)`);
    }
  }
  
  // Calculate efficiency score (1.0 = average)
  const efficiencyScore = totalPts > 0 ? weightedEfficiency / totalPts : 1.0;
  
  // Apply efficiency multiplier (score > 1 = above average efficiency)
  const prediction = seasonAvg * efficiencyScore;
  
  const confidence = totalPts > 5 ? 0.75 : 0.55;
  
  return {
    modelName: 'Play Type Efficiency',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `Efficiency score: ${efficiencyScore.toFixed(2)}x | ${breakdown.slice(0, 2).join(', ')}`,
  };
}

/**
 * Model: Assist Potential
 * Uses potentialAssists from tracking stats — season + last5 when available
 */
export function assistPotentialModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  trackingStats?: TrackingStatsData | null
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;

  if (statType !== 'ast') {
    return {
      modelName: 'Assist Potential',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'N/A — only affects assists',
    };
  }

  const potAst = trackingStats?.potentialAssists;
  const potAstLast5 = trackingStats?.potentialAssistsLast5;
  if (potAst == null || potAst <= 0) {
    return {
      modelName: 'Assist Potential',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No potential assists data',
    };
  }

  const last5Ast = (playerStats as any)?.last5Avg?.ast ?? 0;
  const hasLast5 = potAstLast5 != null && potAstLast5 > 0;

  // Season conversion: actual ast / potential ast
  const seasonConv = seasonAvg > 0 && potAst > 0 ? seasonAvg / potAst : 0.6;
  let prediction = potAst * Math.min(seasonConv, 0.85);
  let reasoning = `Potential: ${potAst.toFixed(1)} (${(seasonConv * 100).toFixed(0)}% conversion)`;

  if (hasLast5) {
    const last5Conv = last5Ast > 0 && potAstLast5 > 0 ? last5Ast / potAstLast5 : seasonConv;
    const last5Pred = potAstLast5 * Math.min(last5Conv, 0.85);
    prediction = 0.6 * last5Pred + 0.4 * prediction;
    reasoning += ` | L5: ${potAstLast5.toFixed(1)} (${(last5Conv * 100).toFixed(0)}%)`;
  }

  const effectivePot = hasLast5 ? 0.6 * potAstLast5 + 0.4 * potAst : potAst;
  const confidence = Math.min(0.8, 0.6 + (effectivePot / 15) * 0.2);

  return {
    modelName: 'Assist Potential',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning,
  };
}

/**
 * Model: Rebound Potential
 * Uses reboundChances from tracking stats — season + last5 when available
 */
export function reboundPotentialModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  trackingStats?: TrackingStatsData | null
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;

  if (statType !== 'reb') {
    return {
      modelName: 'Rebound Potential',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'N/A — only affects rebounds',
    };
  }

  const rebChances = trackingStats?.reboundChances;
  const rebChancesLast5 = trackingStats?.reboundChancesLast5;
  if (rebChances == null || rebChances <= 0) {
    return {
      modelName: 'Rebound Potential',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No rebound chances data',
    };
  }

  const last5Reb = (playerStats as any)?.last5Avg?.reb ?? 0;
  const hasLast5 = rebChancesLast5 != null && rebChancesLast5 > 0;

  const seasonConv = seasonAvg > 0 && rebChances > 0 ? seasonAvg / rebChances : 0.5;
  let prediction = rebChances * Math.min(seasonConv, 0.75);
  let reasoning = `Chances: ${rebChances.toFixed(1)} (${(seasonConv * 100).toFixed(0)}% conversion)`;

  if (hasLast5) {
    const last5Conv = last5Reb > 0 && rebChancesLast5 > 0 ? last5Reb / rebChancesLast5 : seasonConv;
    const last5Pred = rebChancesLast5 * Math.min(last5Conv, 0.75);
    prediction = 0.6 * last5Pred + 0.4 * prediction;
    reasoning += ` | L5: ${rebChancesLast5.toFixed(1)} (${(last5Conv * 100).toFixed(0)}%)`;
  }

  const effectiveChances = hasLast5 ? 0.6 * rebChancesLast5 + 0.4 * rebChances : rebChances;
  const confidence = Math.min(0.8, 0.6 + (effectiveChances / 20) * 0.2);

  return {
    modelName: 'Rebound Potential',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning,
  };
}

/**
 * Model 15 (NEW): Shot Zone vs Defense Model
 * Matches player's shot zones against opponent's zone defense weaknesses
 */
export function shotZoneVsDefenseModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  shotChart?: ShotChartData | null,
  opponentTeam?: string
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (statType !== 'pts' && statType !== 'fg3m') {
    return {
      modelName: 'Shot Zone vs Defense',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Not applicable to non-scoring stats',
    };
  }
  
  if (!shotChart?.shotZones || !opponentTeam || !shotChart.opponentRankings) {
    return {
      modelName: 'Shot Zone vs Defense',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: shotChart?.shotZones ? 'No opponent defense data' : 'No shot chart data',
    };
  }
  
  const zones = shotChart.shotZones;
  const oppRankings = shotChart.opponentRankings;
  
  // Calculate total attempts
  const totalAttempts = 
    zones.restrictedArea.fga +
    zones.paint.fga +
    zones.midRange.fga +
    zones.leftCorner3.fga +
    zones.rightCorner3.fga +
    zones.aboveBreak3.fga;
  
  if (totalAttempts === 0) {
    return {
      modelName: 'Shot Zone vs Defense',
      category: 'statistical',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'No shot attempts',
    };
  }
  
  // Find zones where player shoots a lot AND opponent is weak
  // Rank 30 = worst defense at that zone (good for offense)
  const zoneMatchups: Array<{ zone: string; pct: number; rank: number; pts: number }> = [];
  
  const addZone = (zone: string, fga: number, pts: number, rank: number) => {
    const pct = (fga / totalAttempts) * 100;
    if (pct >= 5) { // Only consider zones with 5%+ of shots
      zoneMatchups.push({ zone, pct, rank, pts });
    }
  };
  
  addZone('Rim', zones.restrictedArea.fga, zones.restrictedArea.pts, oppRankings.restrictedArea?.rank || 15);
  addZone('Paint', zones.paint.fga, zones.paint.pts, oppRankings.paint?.rank || 15);
  addZone('Mid', zones.midRange.fga, zones.midRange.pts, oppRankings.midRange?.rank || 15);
  addZone('L Corner 3', zones.leftCorner3.fga, zones.leftCorner3.pts, oppRankings.leftCorner3?.rank || 15);
  addZone('R Corner 3', zones.rightCorner3.fga, zones.rightCorner3.pts, oppRankings.rightCorner3?.rank || 15);
  addZone('Above 3', zones.aboveBreak3.fga, zones.aboveBreak3.pts, oppRankings.aboveBreak3?.rank || 15);
  
  // Calculate advantage: zones where player shoots a lot AND defense is weak
  let advantageBonus = 0;
  let disadvantagePenalty = 0;
  const advantageZones: string[] = [];
  const disadvantageZones: string[] = [];
  
  for (const zm of zoneMatchups) {
    if (zm.rank >= 25) {
      // Weak defense at this zone
      const bonus = (zm.pct / 100) * seasonAvg * 0.08; // 8% boost weighted by shot frequency
      advantageBonus += bonus;
      advantageZones.push(`${zm.zone}(#${zm.rank})`);
    } else if (zm.rank <= 5) {
      // Strong defense at this zone
      const penalty = (zm.pct / 100) * seasonAvg * 0.06;
      disadvantagePenalty += penalty;
      disadvantageZones.push(`${zm.zone}(#${zm.rank})`);
    }
  }
  
  const prediction = seasonAvg + advantageBonus - disadvantagePenalty;
  
  let reasoning = `vs ${opponentTeam}`;
  if (advantageZones.length > 0) {
    reasoning += ` | Weak zones: ${advantageZones.join(', ')}`;
  }
  if (disadvantageZones.length > 0) {
    reasoning += ` | Strong zones: ${disadvantageZones.join(', ')}`;
  }
  
  const confidence = zoneMatchups.length >= 3 ? 0.75 : 0.6;
  
  return {
    modelName: 'Shot Zone vs Defense',
    category: 'statistical',
    prediction,
    confidence,
    weight: 0.10,
    reasoning,
  };
}

// ==================== HELPER FUNCTIONS ====================

function calculateStdDev(games: GameLog[], statType: keyof StatLine): number {
  if (games.length === 0) return 0;
  
  const values = games.map(g => g[statType]);
  const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
  const squaredDiffs = values.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / values.length;
  
  return Math.sqrt(variance);
}

function calculateMinutesVariance(games: GameLog[]): number {
  if (games.length === 0) return 0;
  
  const minutes = games.map(g => g.minutes);
  const mean = minutes.reduce((sum, val) => sum + val, 0) / minutes.length;
  const squaredDiffs = minutes.map(val => Math.pow(val - mean, 2));
  const variance = squaredDiffs.reduce((sum, val) => sum + val, 0) / minutes.length;
  
  return Math.sqrt(variance) / mean; // Return as ratio
}
