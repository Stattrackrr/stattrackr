/**
 * Run prediction for a single prop - used by both single-prop API and daily pick scanner
 */

import type { PredictionResult, ModelPrediction, StatLine } from './types';
import { fetchCompletePlayerData, fetchGameOdds, calculateVsOpponent, deriveFormerTeamsFromGameLogs } from './data-pipeline/bdl-fetcher';
import { fetchInjuries, isPlayerInjured, isNationalTVGame } from './data-pipeline/espn-fetcher';
import { fetchOpponentTeamStats } from './data-pipeline/team-stats-fetcher';
import { isDivisionRival } from './data-pipeline/team-divisions';
import { fetchArenaData, isContractYear, getFormerTeams, fetchRefereeData } from './data-pipeline/database-fetcher';
import { fetchRefereeFromESPN } from './data-pipeline/real-data-fetchers';
import { fetchAllNBAStatsFromCache } from './data-pipeline/nba-cache-fetcher';
import * as StatModels from './models/statistical';
import * as MatchupModels from './models/matchup';
import * as ContextModels from './models/context';
import * as PropModels from './models/prop-specific';
import { weightedEnsembleModel, modelAgreementScore, generateFinalPrediction } from './models/ensemble';

// Map stat type from prop format to engine format
const STAT_TYPE_MAP: Record<string, keyof StatLine> = {
  PTS: 'pts',
  REB: 'reb',
  AST: 'ast',
  STL: 'stl',
  BLK: 'blk',
  THREES: 'fg3m',
  TO: 'pts', // Fallback
  PRA: 'pts', // Combined - engine uses pts as proxy
  PR: 'pts',
  PA: 'pts',
  RA: 'reb',
};

export interface BookmakerLine {
  bookmaker: string;
  line: number;
  overOdds: string;
  underOdds: string;
}

export interface PropInput {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  statType: string;
  line: number;
  overOdds?: string | number;
  underOdds?: string | number;
  gameDate?: string;
  bookmaker?: string;
  bookmakerCount?: number;
  /** All bookmaker lines for this prop (for daily pick to pick best odds >= 1.65) */
  bookmakerLines?: BookmakerLine[];
}

export interface PredictionForProp {
  success: boolean;
  prop: PropInput;
  result?: PredictionResult;
  error?: string;
  /** Combined score: edgePercent * confidence (higher = better read) */
  readScore?: number;
}

/**
 * Parse American odds string to number
 */
function parseAmericanOdds(odds: string | number): number {
  if (typeof odds === 'number') return odds;
  const cleaned = String(odds).replace(/[^0-9+-]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? -110 : num;
}

/**
 * Run full prediction for a single player prop
 */
export async function runPredictionForProp(prop: PropInput): Promise<PredictionForProp> {
  const statType = STAT_TYPE_MAP[prop.statType] || 'pts';
  // American odds (e.g. -110) - used by expectedValueModel
  const overAmerican = typeof prop.overOdds === 'string'
    ? parseInt(prop.overOdds.replace(/[^0-9+-]/g, ''), 10) || -110
    : (typeof prop.overOdds === 'number' ? prop.overOdds : -110);
  const underAmerican = typeof prop.underOdds === 'string'
    ? parseInt(prop.underOdds.replace(/[^0-9+-]/g, ''), 10) || -110
    : (typeof prop.underOdds === 'number' ? prop.underOdds : -110);

  try {
    let playerStats = await fetchCompletePlayerData(prop.playerId, undefined, prop.opponent);
    if (!playerStats || !playerStats.seasonStats) {
      return {
        success: false,
        prop,
        error: 'Player data not found',
      };
    }

    const playerTeam = playerStats.team || 'UNK';
    const playerFullName = playerStats.playerName || prop.playerName;
    const playerPosition = playerStats.position || 'G';

    const recentGames = playerStats.recentGames || [];
    const vsOpponentAvg = prop.opponent
      ? calculateVsOpponent(recentGames, prop.opponent.toUpperCase())
      : undefined;

    const completePlayerStats = {
      playerId: prop.playerId,
      playerName: playerFullName,
      team: playerTeam,
      position: playerPosition,
      seasonStats: playerStats.seasonStats,
      advancedStats: playerStats.advancedStats || {
        usage: 20,
        pace: 100,
        trueShootingPct: 0.55,
        offRating: 110,
        defRating: 110,
        per: 15,
      },
      recentGames,
      last5Avg: playerStats.last5Avg || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 },
      last10Avg: playerStats.last10Avg || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 },
      last20Avg: playerStats.last20Avg || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 },
      homeAvg: playerStats.homeAvg || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 },
      awayAvg: playerStats.awayAvg || { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, fg3m: 0, minutes: 0 },
      vsOpponentAvg,
    } as any;

    const [gameOdds, opponentTeamStats, injuries] = await Promise.all([
      fetchGameOdds(playerTeam),
      prop.opponent ? fetchOpponentTeamStats(prop.opponent) : Promise.resolve(null),
      fetchInjuries([playerTeam, prop.opponent]),
    ]);

    const line = (prop.line > 0 && Number.isFinite(prop.line))
      ? prop.line
      : (completePlayerStats.seasonStats[statType as keyof typeof completePlayerStats.seasonStats] || 0);
    const seasonAvgStat = completePlayerStats.seasonStats[statType as keyof typeof completePlayerStats.seasonStats] || 0;
    const playerInjury = isPlayerInjured(prop.playerId, injuries);
    const gameDate = prop.gameDate || new Date().toISOString().split('T')[0];
    const [arena, refereeRaw] = await Promise.all([
      fetchArenaData(playerTeam),
      prop.opponent ? fetchRefereeFromESPN(playerTeam, prop.opponent, gameDate) : Promise.resolve(null),
    ]);
    // Enrich referee with DB stats when available (fouls, pace, etc.)
    const referee = refereeRaw?.name
      ? (await fetchRefereeData(refereeRaw.name)) ?? refereeRaw
      : refereeRaw;
    const [contractYear, formerTeamsFromDb, isNationalTV, nbaStatsData] = await Promise.all([
      isContractYear(prop.playerId),
      getFormerTeams(prop.playerId),
      prop.opponent ? isNationalTVGame(playerTeam, prop.opponent, gameDate) : Promise.resolve(false),
      fetchAllNBAStatsFromCache(prop.playerId, prop.opponent, undefined, playerTeam),
    ]);
    const formerTeams = formerTeamsFromDb.length > 0
      ? formerTeamsFromDb
      : deriveFormerTeamsFromGameLogs(completePlayerStats.recentGames || [], playerTeam);

    const allPredictions: ModelPrediction[] = [];

    // Statistical
    allPredictions.push(StatModels.seasonAverageModel(completePlayerStats, statType));
    allPredictions.push(StatModels.weightedRecentFormModel(completePlayerStats, statType));
    allPredictions.push(StatModels.perMinuteModel(completePlayerStats, statType, 32));
    allPredictions.push(StatModels.usageBasedModel(completePlayerStats, statType));
    allPredictions.push(StatModels.paceAdjustedModel(completePlayerStats, statType, 100));
    allPredictions.push(StatModels.trueShootingModel(completePlayerStats, statType));
    allPredictions.push(StatModels.homeAwaySplitModel(completePlayerStats, statType, true));
    allPredictions.push(StatModels.regressionToMeanModel(completePlayerStats, statType));
    allPredictions.push(StatModels.varianceConsistencyModel(completePlayerStats, statType));
    allPredictions.push(StatModels.clutchPerformanceModel(completePlayerStats, statType, Math.abs(gameOdds.spread) < 5));
    allPredictions.push(StatModels.shotQualityModel(completePlayerStats, statType, nbaStatsData.shotChart, prop.opponent));
    allPredictions.push(StatModels.playTypeScoringModel(completePlayerStats, statType, nbaStatsData.playTypes, prop.opponent));
    allPredictions.push(StatModels.playTypeEfficiencyModel(completePlayerStats, statType, nbaStatsData.playTypes));
    allPredictions.push(StatModels.shotZoneVsDefenseModel(completePlayerStats, statType, nbaStatsData.shotChart, prop.opponent));
    allPredictions.push(StatModels.assistPotentialModel(completePlayerStats, statType, nbaStatsData.trackingStats));
    allPredictions.push(StatModels.reboundPotentialModel(completePlayerStats, statType, nbaStatsData.trackingStats));

    // MATCHUP MODELS (10 models)
    if (prop.opponent) {
      allPredictions.push(await MatchupModels.dvpModel(completePlayerStats, statType, prop.opponent));
      if (opponentTeamStats) {
        allPredictions.push(MatchupModels.opponentDefensiveRatingModel(completePlayerStats, statType, opponentTeamStats));
        allPredictions.push(MatchupModels.opponentPaceModel(completePlayerStats, statType, opponentTeamStats));
        allPredictions.push(MatchupModels.opponentTurnoverModel(completePlayerStats, statType, opponentTeamStats));
      }
      allPredictions.push(MatchupModels.headToHeadModel(completePlayerStats, statType, prop.opponent));
      allPredictions.push(MatchupModels.teammateSynergyModel(completePlayerStats, statType, injuries));
      const isPrimary = (completePlayerStats.advancedStats?.usage ?? 0) >= 25;
      allPredictions.push(MatchupModels.defensiveAttentionModel(completePlayerStats, statType, isPrimary));
      allPredictions.push(MatchupModels.propCorrelationModel(completePlayerStats, statType, seasonAvgStat));
      allPredictions.push(MatchupModels.divisionRivalModel(completePlayerStats, statType, isDivisionRival(playerTeam, prop.opponent)));
    }

    allPredictions.push(ContextModels.blowoutRiskModel(completePlayerStats, statType, gameOdds.spread, 32));
    allPredictions.push(ContextModels.restDaysModel(completePlayerStats, statType, 1));
    allPredictions.push(ContextModels.travelDistanceModel(completePlayerStats, statType, 500));
    allPredictions.push(ContextModels.timezoneChangeModel(completePlayerStats, statType, 0));
    allPredictions.push(ContextModels.fatigueModel(completePlayerStats, statType, 3));
    allPredictions.push(ContextModels.injuryImpactModel(completePlayerStats, statType, playerInjury.status as any));
    allPredictions.push(ContextModels.refereeBiasModel(completePlayerStats, statType, referee ?? undefined));
    allPredictions.push(ContextModels.altitudeArenaModel(completePlayerStats, statType, arena, true));
    allPredictions.push(ContextModels.revengeGameModel(completePlayerStats, statType, prop.opponent, formerTeams));
    allPredictions.push(ContextModels.contractYearModel(completePlayerStats, statType, contractYear));
    allPredictions.push(ContextModels.milestoneChaseModel(completePlayerStats, statType));
    const isStar = (completePlayerStats.advancedStats?.usage ?? 0) >= 25;
    allPredictions.push(ContextModels.nationalTVModel(completePlayerStats, statType, isNationalTV, isStar));
    allPredictions.push(ContextModels.playoffRaceModel(completePlayerStats, statType, false, 82));
    allPredictions.push(ContextModels.tankingModel(completePlayerStats, statType, false, 82, false));

    allPredictions.push(PropModels.propHistoricalPerformanceModel(completePlayerStats, statType, line));
    allPredictions.push(PropModels.overUnderTendencyModel(completePlayerStats, statType, line));
    allPredictions.push(PropModels.bookmakerPatternModel(completePlayerStats, statType, line, prop.bookmaker || 'Default'));
    allPredictions.push(PropModels.correlationAnalysisModel(completePlayerStats, statType, seasonAvgStat, 'pts'));
    allPredictions.push(PropModels.expectedValueModel(seasonAvgStat, line, overAmerican, underAmerican));
    const stdDev = seasonAvgStat * 0.25;
    allPredictions.push(PropModels.lineValueModel(seasonAvgStat, line, stdDev));
    allPredictions.push(PropModels.bookmakerLimitModel(seasonAvgStat, prop.bookmaker || 'Default'));
    allPredictions.push(PropModels.multiBookComparisonModel(seasonAvgStat, [{
      playerId: prop.playerId,
      playerName: prop.playerName,
      team: prop.team,
      opponent: prop.opponent,
      gameDate: prop.gameDate || '',
      statType: prop.statType as any,
      line,
      overOdds: overAmerican,
      underOdds: underAmerican,
      bookmaker: prop.bookmaker || 'Default',
    }]));

    const ensemble = weightedEnsembleModel(allPredictions);
    const agreement = modelAgreementScore(allPredictions);
    const final = generateFinalPrediction(ensemble, line);

    // Add ensemble as a display model so it shows in Model Categories
    const ensembleDisplayModel: ModelPrediction = {
      modelName: 'Weighted Ensemble',
      category: 'ensemble',
      prediction: ensemble.weightedAverage,
      confidence: ensemble.confidence,
      weight: 1,
      reasoning: `Combined ${allPredictions.length} models | Agreement: ${(agreement.agreement * 100).toFixed(0)}%`,
    };
    const modelAgreementDisplay: ModelPrediction = {
      modelName: 'Model Agreement',
      category: 'ensemble',
      prediction: ensemble.weightedAverage,
      confidence: agreement.confidence,
      weight: 0.5,
      reasoning: `Agreement level: ${agreement.agreementLevel}`,
    };
    const allPredictionsWithEnsemble = [...allPredictions, ensembleDisplayModel, modelAgreementDisplay];

    const result: PredictionResult = {
      playerId: prop.playerId,
      playerName: playerFullName,
      team: playerTeam,
      opponent: prop.opponent,
      gameDate: prop.gameDate || new Date().toISOString().split('T')[0],
      statType: prop.statType,
      prediction: final.prediction,
      confidence: final.confidence,
      line,
      edge: final.edge,
      edgePercent: final.edgePercent,
      recommendation: final.recommendation,
      expectedValue: 0,
      modelPredictions: allPredictionsWithEnsemble,
      modelAgreement: agreement.agreement,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    };

    // Read score: absolute edge% * confidence (higher = best read)
    const readScore = Math.abs(final.edgePercent) * final.confidence;

    return {
      success: true,
      prop,
      result,
      readScore,
    };
  } catch (err: any) {
    return {
      success: false,
      prop,
      error: err.message || 'Prediction failed',
    };
  }
}
