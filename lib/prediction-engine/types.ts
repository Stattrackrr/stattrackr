/**
 * Type definitions for the NBA Prediction Engine
 */

// ==================== CORE DATA TYPES ====================

export interface PlayerStats {
  playerId: number;
  playerName: string;
  team: string;
  position: string;
  
  // Season averages
  seasonStats: {
    gamesPlayed: number;
    pts: number;
    reb: number;
    ast: number;
    stl: number;
    blk: number;
    fg3m: number;
    fgPct: number;
    ftPct: number;
    toPct: number;
    minutes: number;
  };
  
  // Advanced stats
  advancedStats: {
    usage: number; // USG%
    pace: number;
    trueShootingPct: number; // TS%
    offRating: number;
    defRating: number;
    per: number; // Player Efficiency Rating
  };
  
  // Recent form
  recentGames: GameLog[];
  last5Avg: StatLine;
  last10Avg: StatLine;
  last20Avg: StatLine;
  
  // Splits
  homeAvg: StatLine;
  awayAvg: StatLine;
  vsOpponentAvg?: StatLine; // Head-to-head history
}

export interface GameLog {
  gameId: string;
  date: string;
  opponent: string;
  isHome: boolean;
  /** Player's team in this game (for revenge-game derivation) */
  teamInGame?: string;
  minutes: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  fgPct: number;
  ftPct: number;
  to: number;
  plusMinus: number;
}

export interface StatLine {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  minutes: number;
}

export interface TeamStats {
  team: string;
  pace: number;
  offRating: number;
  defRating: number;
  turnoverRate: number;
  reboundRate: number;
  record: {
    wins: number;
    losses: number;
    isPlayoffBubble: boolean;
    isEliminated: boolean;
  };
}

export interface GameContext {
  gameId: string;
  gameDate: string;
  homeTeam: string;
  awayTeam: string;
  spread: number; // negative = home favored
  total: number;
  isNationalTV: boolean;
  
  // Player context
  playerTeam: string;
  isHome: boolean;
  opponent: string;
  
  // Rest & travel
  restDays: number;
  isBackToBack: boolean;
  travelDistance: number; // miles
  timezoneChange: number; // hours
  gamesInLast7Days: number;
  
  // Injuries
  injuries: InjuryReport[];
  
  // Referee
  referee?: RefereeData;
  
  // Arena
  arena?: ArenaData;
  
  // Coach
  coach?: CoachData;
}

export interface InjuryReport {
  playerId: number;
  playerName: string;
  team: string;
  status: 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'PROBABLE';
  description: string;
  returnDate?: string;
}

export interface RefereeData {
  name: string;
  foulsPerGame: number;
  pace: number;
  homeBias: number; // positive = favors home
  totalGames: number;
}

export interface ArenaData {
  name: string;
  team: string;
  city: string;
  altitude: number; // feet
  shootingFactor: number; // multiplier
  homeCourtAdvantage: number; // multiplier
  timezone: string;
}

export interface CoachData {
  name: string;
  team: string;
  restTendency: number; // 0-1
  blowoutTendency: number; // 0-1
  minutesRestrictionTendency: number; // 0-1
  system: string;
  avgStarterMinutes: number;
}

export interface PlayerProp {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  gameDate: string;
  statType: 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'PRA' | 'PR' | 'PA' | 'RA';
  line: number;
  overOdds: number;
  underOdds: number;
  bookmaker: string;
}

export interface DVPRanking {
  team: string;
  position: string;
  statType: string;
  rank: number; // 1-30 (1 = best defense, 30 = worst)
  valueAllowed: number; // actual stat value allowed
}

// ==================== MODEL TYPES ====================

export interface ModelPrediction {
  modelName: string;
  category: 'statistical' | 'matchup' | 'context' | 'prop-specific' | 'ensemble';
  prediction: number;
  confidence: number; // 0-1
  weight: number; // model weight in ensemble
  reasoning?: string;
}

export interface PredictionResult {
  playerId: number;
  playerName: string;
  team: string;
  opponent: string;
  gameDate: string;
  statType: string;
  
  // Final prediction
  prediction: number;
  confidence: number; // 0-1
  
  // Line comparison
  line: number;
  edge: number; // prediction - line
  edgePercent: number; // (prediction - line) / line * 100
  
  // Recommendation
  recommendation: 'STRONG BET' | 'MODERATE BET' | 'LEAN' | 'PASS';
  expectedValue: number; // EV calculation
  
  // Model breakdown
  modelPredictions: ModelPrediction[];
  modelAgreement: number; // 0-1 (low std dev = high agreement)
  
  // Metadata
  createdAt: string;
  expiresAt: string;
}

export interface EnsemblePrediction {
  weightedAverage: number;
  median: number;
  mode: number;
  standardDeviation: number;
  agreement: number; // 0-1
  confidence: number; // 0-1
}

// ==================== DATA PIPELINE TYPES ====================

export interface BDLPlayerData {
  player: {
    id: number;
    first_name: string;
    last_name: string;
    position: string;
    team: {
      id: number;
      abbreviation: string;
      full_name: string;
    };
  };
  stats: any;
  advancedStats: any;
  gameLogs: any[];
}

export interface ESPNInjuryData {
  team: string;
  injuries: Array<{
    playerId: number;
    playerName: string;
    status: string;
    description: string;
    returnDate?: string;
  }>;
}

export interface BettingProsDVPData {
  team: string;
  position: string;
  statType: string;
  rank: number;
  value: number;
}

export interface NBAStatsTrackingData {
  playerId: number;
  passing: any;
  rebounding: any;
  defense: any;
  shotChart: any;
}

// ==================== NBA STATS CACHE DATA TYPES ====================

export interface ShotZoneData {
  fgm: number;
  fga: number;
  fgPct: number;
  pts: number;
}

export interface ShotChartData {
  playerId: string;
  season: string;
  shotZones: {
    restrictedArea: ShotZoneData;
    paint: ShotZoneData;
    midRange: ShotZoneData;
    leftCorner3: ShotZoneData;
    rightCorner3: ShotZoneData;
    aboveBreak3: ShotZoneData;
  };
  opponentTeam?: string;
  opponentDefense?: {
    restrictedArea: ShotZoneData;
    paint: ShotZoneData;
    midRange: ShotZoneData;
    corner3: ShotZoneData;
    aboveBreak3: ShotZoneData;
  };
  opponentRankings?: {
    restrictedArea: { rank: number; fgPct: number };
    paint: { rank: number; fgPct: number };
    midRange: { rank: number; fgPct: number };
    leftCorner3: { rank: number; fgPct: number };
    rightCorner3: { rank: number; fgPct: number };
    aboveBreak3: { rank: number; fgPct: number };
  };
  cachedAt?: string;
}

export interface PlayTypeEntry {
  playType: string;
  displayName: string;
  points: number;
  pointsPct: number;
  possessions?: number;
  ppp?: number;
  oppRank?: number | null;
}

export interface PlayTypeData {
  playerId: string | number;
  season: string;
  opponentTeam?: string | null;
  totalPoints: number;
  playTypes: PlayTypeEntry[];
  cachedAt?: string;
}

export interface TrackingStatsData {
  playerId: number;
  season: string;
  passesMade?: number;
  passesReceived?: number;
  potentialAssists?: number;
  astPointsCreated?: number;
  contestedRebounds?: number;
  reboundChances?: number;
  /** Last 5 games potential assists (tracking_stats_TEAM_season_passing_last5) */
  potentialAssistsLast5?: number;
  /** Last 5 games rebound chances (tracking_stats_TEAM_season_rebounding_last5) */
  reboundChancesLast5?: number;
  deflections?: number;
  contestedShots?: number;
  avgSpeed?: number;
  distanceMiles?: number;
  cachedAt?: string;
}

export interface NBAStatsFromCache {
  shotChart: ShotChartData | null;
  playTypes: PlayTypeData | null;
  trackingStats: TrackingStatsData | null;
  teamDefenseRankings: any | null;
  playTypeDefenseRankings: any | null;
}

// ==================== API REQUEST/RESPONSE TYPES ====================

export interface PredictionRequest {
  playerId?: number;
  playerName?: string;
  statType?: string;
  gameDate?: string;
  opponent?: string;
  forceRefresh?: boolean;
}

export interface PredictionResponse {
  success: boolean;
  data: PredictionResult[];
  error?: string;
  cached?: boolean;
  timestamp: string;
}

export interface ModelPerformance {
  modelName: string;
  date: string;
  predictions: number;
  correct: number;
  accuracy: number;
  avgError: number;
  roi: number;
}

// ==================== UTILITY TYPES ====================

export type StatType = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m' | 'PRA' | 'PR' | 'PA' | 'RA';
export type Position = 'PG' | 'SG' | 'SF' | 'PF' | 'C';
export type ModelCategory = 'statistical' | 'matchup' | 'context' | 'prop-specific' | 'ensemble';

export interface ModelWeights {
  [modelName: string]: number;
}

export interface ModelConfig {
  enabled: boolean;
  weight: number;
  minConfidence: number;
  maxConfidence: number;
}
