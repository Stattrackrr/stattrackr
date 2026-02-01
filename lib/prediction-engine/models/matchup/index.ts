/**
 * Matchup Models (10 models)
 * Predictions based on opponent matchups and defensive matchups
 */

import type { PlayerStats, TeamStats, ModelPrediction, StatLine, GameLog, InjuryReport } from '../../types';
import { getDVPAdjustment } from '../../data-pipeline/bettingpros-fetcher';

/**
 * Model 13: DVP (Defense vs Position)
 * Adjust based on opponent's defense vs player's position
 */
export async function dvpModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponent: string
): Promise<ModelPrediction> {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Get DVP adjustment from BettingPros
  const dvp = await getDVPAdjustment(opponent, playerStats.position, statType);
  
  const prediction = seasonAvg * dvp.multiplier;
  
  return {
    modelName: 'DVP (Defense vs Position)',
    category: 'matchup',
    prediction,
    confidence: dvp.confidence,
    weight: 0.20, // High weight - DVP is very reliable
    reasoning: `Opponent rank: ${dvp.rank}/30, multiplier: ${dvp.multiplier.toFixed(2)}x`,
  };
}

/**
 * Model 14: Opponent Defensive Rating
 * Adjust based on opponent's overall defensive efficiency
 */
export function opponentDefensiveRatingModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponentTeam: TeamStats
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const leagueAvgDefRating = 112; // NBA average
  
  // Better defense (lower rating) = harder to score
  const defMultiplier = leagueAvgDefRating / opponentTeam.defRating;
  const prediction = seasonAvg * defMultiplier;
  
  const confidence = 0.75;
  
  return {
    modelName: 'Opponent Defensive Rating',
    category: 'matchup',
    prediction,
    confidence,
    weight: 0.12,
    reasoning: `Opponent def rating: ${opponentTeam.defRating.toFixed(1)} (league avg: ${leagueAvgDefRating})`,
  };
}

/**
 * Model 15: Head-to-Head History
 * Use player's historical performance vs this opponent
 */
export function headToHeadModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponent: string
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const vsOpponent = playerStats.vsOpponentAvg;
  
  if (!vsOpponent) {
    return {
      modelName: 'Head-to-Head History',
      category: 'matchup',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.10,
      reasoning: 'Limited H2H data',
    };
  }
  
  const h2hAvg = vsOpponent[statType];
  
  // Weight: 40% H2H, 60% season average
  const prediction = (h2hAvg * 0.4) + (seasonAvg * 0.6);
  
  // Higher confidence if H2H sample size is good
  const confidence = 0.75;
  
  return {
    modelName: 'Head-to-Head History',
    category: 'matchup',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `vs ${opponent}: ${h2hAvg.toFixed(1)} avg`,
  };
}

/**
 * Model 16: Defensive Matchup (Individual)
 * Who's guarding the player?
 */
export function defensiveMatchupModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  defenderDefRating?: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!defenderDefRating) {
    return {
      modelName: 'Defensive Matchup',
      category: 'matchup',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.08,
      reasoning: 'Neutral (no matchup data)',
    };
  }
  
  const leagueAvgDefRating = 112;
  const defMultiplier = leagueAvgDefRating / defenderDefRating;
  const prediction = seasonAvg * defMultiplier;
  
  return {
    modelName: 'Defensive Matchup',
    category: 'matchup',
    prediction,
    confidence: 0.7,
    weight: 0.08,
    reasoning: `Defender def rating: ${defenderDefRating.toFixed(1)}`,
  };
}

/**
 * Model 17: Teammate Synergy
 * How player performs with/without key teammates
 */
export function teammateSynergyModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  injuries: InjuryReport[]
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Check if star teammates are out
  const teamInjuries = injuries.filter(inj => 
    inj.team === playerStats.team && 
    inj.playerId !== playerStats.playerId &&
    (inj.status === 'OUT' || inj.status === 'DOUBTFUL')
  );
  
  // More usage when stars are out
  let usageBoost = 1.0;
  if (teamInjuries.length > 0) {
    usageBoost = 1.0 + (teamInjuries.length * 0.08); // 8% boost per injured star
  }
  
  const prediction = seasonAvg * usageBoost;
  const confidence = teamInjuries.length > 0 ? 0.75 : 0.6;
  
  return {
    modelName: 'Teammate Synergy',
    category: 'matchup',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `${teamInjuries.length} key teammate(s) out, ${((usageBoost - 1) * 100).toFixed(0)}% usage boost`,
  };
}

/**
 * Model 18: Defensive Attention Model
 * Is player primary option or secondary?
 */
export function defensiveAttentionModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isPrimaryOption: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Primary options face more defensive attention
  const attentionMultiplier = isPrimaryOption ? 0.95 : 1.05;
  const prediction = seasonAvg * attentionMultiplier;
  
  return {
    modelName: 'Defensive Attention',
    category: 'matchup',
    prediction,
    confidence: 0.65,
    weight: 0.08,
    reasoning: isPrimaryOption ? 'Primary option (more attention)' : 'Secondary option (less attention)',
  };
}

/**
 * Model 19: Prop Correlation Model
 * If pts line is high, rebounds might be lower (negative correlation)
 */
export function propCorrelationModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  primaryStatProjection?: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!primaryStatProjection) {
    return {
      modelName: 'Prop Correlation',
      category: 'matchup',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.06,
      reasoning: 'Baseline (no primary projection)',
    };
  }
  
  // Calculate correlation (simplified)
  const correlation = calculateCorrelation(playerStats.recentGames, 'pts', statType);
  
  // Adjust based on correlation
  let prediction = seasonAvg;
  if (correlation < -0.3) {
    // Negative correlation: if pts up, other stat down
    prediction = seasonAvg * 0.95;
  } else if (correlation > 0.3) {
    // Positive correlation: if pts up, other stat up
    prediction = seasonAvg * 1.05;
  }
  
  return {
    modelName: 'Prop Correlation',
    category: 'matchup',
    prediction,
    confidence: 0.6,
    weight: 0.06,
    reasoning: `Correlation with pts: ${correlation.toFixed(2)}`,
  };
}

/**
 * Model 20: Division Rival Model
 * Players perform differently vs division rivals
 */
export function divisionRivalModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isDivisionRival: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Rivalry games tend to be more intense
  const rivalMultiplier = isDivisionRival ? 1.03 : 1.0;
  const prediction = seasonAvg * rivalMultiplier;
  
  return {
    modelName: 'Division Rival',
    category: 'matchup',
    prediction,
    confidence: isDivisionRival ? 0.65 : 0.5,
    weight: 0.05,
    reasoning: isDivisionRival ? 'Division rival (3% boost)' : 'Not a rival',
  };
}

/**
 * Model 21: Opponent Pace Model
 * Fast teams = more possessions = more opportunities
 */
export function opponentPaceModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponentTeam: TeamStats
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  const leagueAvgPace = 100;
  
  const paceMultiplier = opponentTeam.pace / leagueAvgPace;
  const prediction = seasonAvg * paceMultiplier;
  
  const confidence = 0.75;
  
  return {
    modelName: 'Opponent Pace',
    category: 'matchup',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `Opponent pace: ${opponentTeam.pace.toFixed(1)} (league: ${leagueAvgPace})`,
  };
}

/**
 * Model 22: Opponent Turnover Rate
 * Teams that turn it over = more steals/blocks
 */
export function opponentTurnoverModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponentTeam: TeamStats
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  // Only affects steals and blocks
  const isDefensiveStat = statType === 'stl' || statType === 'blk';
  
  if (!isDefensiveStat) {
    return {
      modelName: 'Opponent Turnover Rate',
      category: 'matchup',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'N/A — only affects steals/blocks',
    };
  }
  
  const leagueAvgTO = 14; // League average turnovers per game
  const toMultiplier = opponentTeam.turnoverRate / leagueAvgTO;
  const prediction = seasonAvg * toMultiplier;
  
  return {
    modelName: 'Opponent Turnover Rate',
    category: 'matchup',
    prediction,
    confidence: 0.7,
    weight: 0.05,
    reasoning: `Opponent TO rate: ${opponentTeam.turnoverRate.toFixed(1)} (league: ${leagueAvgTO})`,
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
