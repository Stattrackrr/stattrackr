/**
 * Context Models (15 models)
 * Predictions based on game context, rest, travel, injuries, etc.
 */

import type { PlayerStats, GameContext, ModelPrediction, StatLine, CoachData, ArenaData, RefereeData } from '../../types';

/**
 * Model 23: Blowout Risk Model
 * If spread > 10, starters sit
 */
export function blowoutRiskModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  spread: number,
  projectedMinutes: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const blowoutRisk = Math.abs(spread) / 15; // 0-1 scale
  
  // Reduce minutes projection in blowouts
  let minutesMultiplier = 1.0;
  if (blowoutRisk > 0.67) {
    // High blowout risk (spread > 10)
    minutesMultiplier = 0.75;
  } else if (blowoutRisk > 0.40) {
    // Moderate blowout risk (spread > 6)
    minutesMultiplier = 0.90;
  }
  
  const prediction = seasonAvg * minutesMultiplier;
  const confidence = blowoutRisk > 0.67 ? 0.8 : 0.65;
  
  return {
    modelName: 'Blowout Risk',
    category: 'context',
    prediction,
    confidence,
    weight: 0.10,
    reasoning: `Spread: ${spread.toFixed(1)}, blowout risk: ${(blowoutRisk * 100).toFixed(0)}%`,
  };
}

/**
 * Model 24: Rest Days Model
 * Fresh legs = better performance
 */
export function restDaysModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  restDays: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  let restMultiplier = 1.0;
  let reasoning = '';
  
  if (restDays === 0) {
    restMultiplier = 0.92; // Back-to-back (8% reduction)
    reasoning = 'Back-to-back game (8% reduction)';
  } else if (restDays === 1) {
    restMultiplier = 0.97; // 1 day rest (3% reduction)
    reasoning = '1 day rest (3% reduction)';
  } else if (restDays >= 3) {
    restMultiplier = 1.03; // Well rested (3% boost)
    reasoning = `${restDays} days rest (3% boost)`;
  } else {
    reasoning = '2 days rest (normal)';
  }
  
  const prediction = seasonAvg * restMultiplier;
  const confidence = restDays === 0 ? 0.8 : 0.7;
  
  return {
    modelName: 'Rest Days',
    category: 'context',
    prediction,
    confidence,
    weight: 0.08,
    reasoning,
  };
}

/**
 * Model 25: Travel Distance Model
 * Long travel = fatigue
 */
export function travelDistanceModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  travelDistance: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  let travelMultiplier = 1.0;
  let reasoning = '';
  
  if (travelDistance > 2500) {
    travelMultiplier = 0.90; // Cross-country (10% reduction)
    reasoning = `${travelDistance.toFixed(0)} miles (cross-country, 10% reduction)`;
  } else if (travelDistance > 1500) {
    travelMultiplier = 0.95; // Long distance (5% reduction)
    reasoning = `${travelDistance.toFixed(0)} miles (long distance, 5% reduction)`;
  } else if (travelDistance < 500) {
    reasoning = `${travelDistance.toFixed(0)} miles (short distance)`;
  } else {
    reasoning = `${travelDistance.toFixed(0)} miles (moderate distance)`;
  }
  
  const prediction = seasonAvg * travelMultiplier;
  const confidence = travelDistance > 2500 ? 0.75 : 0.65;
  
  return {
    modelName: 'Travel Distance',
    category: 'context',
    prediction,
    confidence,
    weight: 0.06,
    reasoning,
  };
}

/**
 * Model 26: Time Zone Change Model
 * East to West coast (or vice versa)
 */
export function timezoneChangeModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  timezoneChange: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  let tzMultiplier = 1.0;
  let reasoning = '';
  
  if (timezoneChange >= 3) {
    tzMultiplier = 0.93; // 3+ hour change (7% reduction)
    reasoning = `${timezoneChange} hour timezone change (7% reduction)`;
  } else if (timezoneChange >= 2) {
    tzMultiplier = 0.97; // 2 hour change (3% reduction)
    reasoning = `${timezoneChange} hour timezone change (3% reduction)`;
  } else {
    reasoning = `${timezoneChange} hour timezone change (minimal impact)`;
  }
  
  const prediction = seasonAvg * tzMultiplier;
  const confidence = timezoneChange >= 3 ? 0.75 : 0.65;
  
  return {
    modelName: 'Timezone Change',
    category: 'context',
    prediction,
    confidence,
    weight: 0.05,
    reasoning,
  };
}

/**
 * Model 27: Games in Last 7 Days (Fatigue)
 * More games = more fatigue
 */
export function fatigueModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  gamesInLast7Days: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  let fatigueMultiplier = 1.0;
  let reasoning = '';
  
  if (gamesInLast7Days >= 4) {
    fatigueMultiplier = 0.92; // Heavy schedule (8% reduction)
    reasoning = `${gamesInLast7Days} games in 7 days (heavy schedule, 8% reduction)`;
  } else if (gamesInLast7Days >= 3) {
    fatigueMultiplier = 0.97; // Moderate schedule (3% reduction)
    reasoning = `${gamesInLast7Days} games in 7 days (moderate schedule, 3% reduction)`;
  } else {
    reasoning = `${gamesInLast7Days} games in 7 days (normal)`;
  }
  
  const prediction = seasonAvg * fatigueMultiplier;
  const confidence = gamesInLast7Days >= 4 ? 0.75 : 0.65;
  
  return {
    modelName: 'Fatigue (Games in L7)',
    category: 'context',
    prediction,
    confidence,
    weight: 0.07,
    reasoning,
  };
}

/**
 * Model 28: Injury Impact Model
 * Player returning from injury
 */
export function injuryImpactModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  injuryStatus?: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE'
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!injuryStatus || injuryStatus === 'PROBABLE') {
    return {
      modelName: 'Injury Impact',
      category: 'context',
      prediction: seasonAvg,
      confidence: 0.9,
      weight: 0.08,
      reasoning: 'No injury concerns',
    };
  }
  
  let injuryMultiplier = 1.0;
  let confidence = 0.5;
  let reasoning = '';
  
  switch (injuryStatus) {
    case 'OUT':
      injuryMultiplier = 0; // Won't play
      confidence = 1.0;
      reasoning = 'Player OUT (will not play)';
      break;
    case 'DOUBTFUL':
      injuryMultiplier = 0.20; // Likely won't play
      confidence = 0.8;
      reasoning = 'Player DOUBTFUL (80% chance sits)';
      break;
    case 'QUESTIONABLE':
      injuryMultiplier = 0.70; // Might play limited
      confidence = 0.5;
      reasoning = 'Player QUESTIONABLE (limited if plays)';
      break;
  }
  
  const prediction = seasonAvg * injuryMultiplier;
  
  return {
    modelName: 'Injury Impact',
    category: 'context',
    prediction,
    confidence,
    weight: 0.08,
    reasoning,
  };
}

/**
 * Model 29: Referee Bias Model
 * Some refs call more fouls
 */
export function refereeBiasModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  referee?: RefereeData
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!referee) {
    return {
      modelName: 'Referee Bias',
      category: 'context',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.05,
      reasoning: 'Neutral (referee TBD)',
    };
  }
  
  const leagueAvgFouls = 40;
  const isPointsStat = statType === 'pts';
  
  let refMultiplier = 1.0;
  if (isPointsStat && referee.foulsPerGame > leagueAvgFouls) {
    // More fouls = more free throws = more points
    refMultiplier = 1.05;
  }
  
  const prediction = seasonAvg * refMultiplier;
  
  return {
    modelName: 'Referee Bias',
    category: 'context',
    prediction,
    confidence: 0.65,
    weight: 0.05,
    reasoning: `${referee.name}: ${referee.foulsPerGame.toFixed(1)} fouls/game (league: ${leagueAvgFouls})`,
  };
}

/**
 * Model 30: Altitude/Arena Model
 * Denver altitude affects stamina
 */
export function altitudeArenaModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  arena?: ArenaData,
  isHome?: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!arena) {
    return {
      modelName: 'Altitude/Arena',
      category: 'context',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.04,
      reasoning: 'Neutral venue',
    };
  }
  
  let arenaMultiplier = 1.0;
  let reasoning = '';
  
  // Denver altitude effect (only for away teams)
  if (arena.altitude > 5000 && !isHome) {
    arenaMultiplier = 0.95; // 5% reduction for away teams in Denver
    reasoning = `High altitude (${arena.altitude}ft) - away team penalty`;
  } else if (arena.shootingFactor !== 1.0) {
    arenaMultiplier = arena.shootingFactor;
    reasoning = `Arena shooting factor: ${arena.shootingFactor.toFixed(2)}x`;
  } else {
    reasoning = arena.name && !arena.name.includes('UNK') ? `${arena.name} (no special factors)` : 'Neutral venue (no altitude factor)';
  }
  
  const prediction = seasonAvg * arenaMultiplier;
  
  return {
    modelName: 'Altitude/Arena',
    category: 'context',
    prediction,
    confidence: 0.65,
    weight: 0.04,
    reasoning,
  };
}

/**
 * Model 31: Coaching Tendency Model
 * Doc Rivers rests players on back-to-backs
 */
export function coachingTendencyModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  coach?: CoachData,
  isBackToBack?: boolean,
  blowoutRisk?: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!coach) {
    return {
      modelName: 'Coaching Tendency',
      category: 'context',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.06,
      reasoning: 'Baseline (no coach data)',
    };
  }
  
  let coachMultiplier = 1.0;
  let reasoning = '';
  
  // Rest tendency on back-to-backs
  if (isBackToBack && coach.restTendency > 0.70) {
    coachMultiplier = 0.85; // 15% reduction
    reasoning = `${coach.name} often rests players on B2B (${(coach.restTendency * 100).toFixed(0)}% tendency)`;
  }
  // Blowout tendency
  else if (blowoutRisk && blowoutRisk > 0.67 && coach.blowoutTendency > 0.70) {
    coachMultiplier = 0.80; // 20% reduction
    reasoning = `${coach.name} pulls starters in blowouts (${(coach.blowoutTendency * 100).toFixed(0)}% tendency)`;
  } else {
    reasoning = coach.name && coach.name !== 'Unknown' ? `${coach.name} (no special tendencies)` : 'Baseline (no special tendencies)';
  }
  
  const prediction = seasonAvg * coachMultiplier;
  const confidence = coachMultiplier < 1.0 ? 0.75 : 0.6;
  
  return {
    modelName: 'Coaching Tendency',
    category: 'context',
    prediction,
    confidence,
    weight: 0.06,
    reasoning,
  };
}

/**
 * Model 32: Revenge Game Model
 * Player vs former team
 */
export function revengeGameModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  opponent: string,
  formerTeams: string[]
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const isRevengeGame = formerTeams.includes(opponent);
  
  const revengeMultiplier = isRevengeGame ? 1.08 : 1.0; // 8% boost
  const prediction = seasonAvg * revengeMultiplier;
  
  return {
    modelName: 'Revenge Game',
    category: 'context',
    prediction,
    confidence: isRevengeGame ? 0.7 : 0.5,
    weight: 0.05,
    reasoning: isRevengeGame ? `Revenge game vs former team (8% boost)` : 'Not a revenge game',
  };
}

/**
 * Model 33: Contract Year Model
 * Players perform better in contract years
 */
export function contractYearModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isContractYear: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const contractMultiplier = isContractYear ? 1.03 : 1.0; // 3% boost
  const prediction = seasonAvg * contractMultiplier;
  
  return {
    modelName: 'Contract Year',
    category: 'context',
    prediction,
    confidence: isContractYear ? 0.65 : 0.5,
    weight: 0.04,
    reasoning: isContractYear ? 'Contract year (3% boost)' : 'Not a contract year',
  };
}

/**
 * Model 34: Milestone Chase Model
 * Player chasing record/milestone
 */
export function milestoneChaseModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  careerTotal?: number,
  milestoneTarget?: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  if (!careerTotal || !milestoneTarget) {
    return {
      modelName: 'Milestone Chase',
      category: 'context',
      prediction: seasonAvg,
      confidence: 0.5,
      weight: 0.03,
      reasoning: 'No milestone being chased',
    };
  }
  
  const isNearMilestone = careerTotal >= milestoneTarget - 100 && careerTotal < milestoneTarget;
  const milestoneMultiplier = isNearMilestone ? 1.10 : 1.0; // 10% boost
  const prediction = seasonAvg * milestoneMultiplier;
  
  return {
    modelName: 'Milestone Chase',
    category: 'context',
    prediction,
    confidence: isNearMilestone ? 0.75 : 0.5,
    weight: 0.03,
    reasoning: isNearMilestone 
      ? `Chasing milestone (${careerTotal}/${milestoneTarget}, 10% boost)` 
      : 'No milestone being chased',
  };
}

/**
 * Model 35: National TV Model
 * Stars perform better on national TV
 */
export function nationalTVModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isNationalTV: boolean,
  isStar: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const tvMultiplier = (isNationalTV && isStar) ? 1.05 : 1.0; // 5% boost for stars
  const prediction = seasonAvg * tvMultiplier;
  
  return {
    modelName: 'National TV',
    category: 'context',
    prediction,
    confidence: (isNationalTV && isStar) ? 0.65 : 0.5,
    weight: 0.04,
    reasoning: (isNationalTV && isStar) 
      ? 'National TV game + star player (5% boost)' 
      : isNationalTV ? 'National TV but not a star' : 'Not on national TV',
  };
}

/**
 * Model 36: Playoff Race Model
 * Teams fighting for playoffs play harder
 */
export function playoffRaceModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isPlayoffBubble: boolean,
  gamesRemaining: number
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const isLateSeasonBubble = isPlayoffBubble && gamesRemaining < 20;
  const playoffMultiplier = isLateSeasonBubble ? 1.03 : 1.0; // 3% boost
  const prediction = seasonAvg * playoffMultiplier;
  
  return {
    modelName: 'Playoff Race',
    category: 'context',
    prediction,
    confidence: isLateSeasonBubble ? 0.7 : 0.5,
    weight: 0.04,
    reasoning: isLateSeasonBubble 
      ? `Playoff bubble team, ${gamesRemaining} games left (3% boost)` 
      : 'Not in playoff race',
  };
}

/**
 * Model 37: Tanking Model
 * Teams tanking rest stars
 */
export function tankingModel(
  playerStats: PlayerStats,
  statType: keyof StatLine,
  isEliminated: boolean,
  gamesRemaining: number,
  isStar: boolean
): ModelPrediction {
  const seasonAvg = playerStats.seasonStats[statType as keyof typeof playerStats.seasonStats] || 0;
  
  const isLateSeasonTanking = isEliminated && gamesRemaining < 15 && isStar;
  const tankingMultiplier = isLateSeasonTanking ? 0.80 : 1.0; // 20% reduction
  const prediction = seasonAvg * tankingMultiplier;
  
  return {
    modelName: 'Tanking',
    category: 'context',
    prediction,
    confidence: isLateSeasonTanking ? 0.75 : 0.5,
    weight: 0.05,
    reasoning: isLateSeasonTanking 
      ? `Eliminated team, ${gamesRemaining} games left, star likely rested (20% reduction)` 
      : 'Not tanking',
  };
}
