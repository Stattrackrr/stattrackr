/**
 * NBA Stats Cache Fetcher
 * Reads shot chart, play type, and tracking stats from Supabase cache
 * Data is populated daily by cron jobs - we only read from cache, never call NBA API directly
 */

import { getNBACache } from '@/lib/nbaCache';
import { cache } from '@/lib/cache';
import { currentNbaSeason } from '@/lib/nbaUtils';
import { getNbaStatsId } from '@/lib/playerIdMapping';

// ==================== SHOT CHART DATA ====================

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

/**
 * Fetch shot chart data from cache
 * Returns null if no cache exists
 */
export async function fetchShotChartFromCache(
  playerId: number | string,
  opponentTeam?: string,
  season?: number
): Promise<ShotChartData | null> {
  const seasonYear = season || currentNbaSeason();
  
  // Convert BDL ID to NBA Stats ID if needed
  const nbaPlayerId = getNbaStatsId(String(playerId)) || String(playerId);
  
  // Try cache key with opponent first
  const cacheKeyWithOpponent = `shot_enhanced_${nbaPlayerId}_${opponentTeam || 'none'}_${seasonYear}`;
  const cacheKeyNoOpponent = `shot_enhanced_${nbaPlayerId}_none_${seasonYear}`;
  
  // Check in-memory cache first (fastest)
  let cached = cache.get<ShotChartData>(cacheKeyWithOpponent);
  if (cached) {
    console.log(`[NBA Cache Fetcher] Shot chart hit (in-memory with opponent): ${nbaPlayerId}`);
    return cached;
  }
  
  // Try Supabase cache with opponent
  cached = await getNBACache<ShotChartData>(cacheKeyWithOpponent);
  if (cached && cached.shotZones) {
    console.log(`[NBA Cache Fetcher] Shot chart hit (Supabase with opponent): ${nbaPlayerId}`);
    return cached;
  }
  
  // Try without opponent
  cached = cache.get<ShotChartData>(cacheKeyNoOpponent);
  if (cached) {
    console.log(`[NBA Cache Fetcher] Shot chart hit (in-memory no opponent): ${nbaPlayerId}`);
    return cached;
  }
  
  cached = await getNBACache<ShotChartData>(cacheKeyNoOpponent);
  if (cached && cached.shotZones) {
    console.log(`[NBA Cache Fetcher] Shot chart hit (Supabase no opponent): ${nbaPlayerId}`);
    return cached;
  }
  
  console.log(`[NBA Cache Fetcher] Shot chart miss: ${nbaPlayerId}`);
  return null;
}

// ==================== PLAY TYPE DATA ====================

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

/**
 * Fetch play type analysis from cache
 * Returns null if no cache exists
 */
export async function fetchPlayTypeFromCache(
  playerId: number | string,
  season?: number
): Promise<PlayTypeData | null> {
  const seasonYear = season || currentNbaSeason();
  
  // Play type cache key doesn't include opponent - player stats are the same
  const cacheKey = `playtype_analysis_${playerId}_${seasonYear}`;
  
  // Check in-memory cache first
  let cached = cache.get<PlayTypeData>(cacheKey);
  if (cached) {
    console.log(`[NBA Cache Fetcher] Play type hit (in-memory): ${playerId}`);
    return cached;
  }
  
  // Try Supabase cache
  cached = await getNBACache<PlayTypeData>(cacheKey);
  if (cached && cached.playTypes) {
    console.log(`[NBA Cache Fetcher] Play type hit (Supabase): ${playerId}`);
    return cached;
  }
  
  console.log(`[NBA Cache Fetcher] Play type miss: ${playerId}`);
  return null;
}

// ==================== TRACKING STATS DATA ====================

export interface TrackingStatsData {
  playerId: number;
  season: string;
  
  // Passing
  passesMade?: number;
  passesReceived?: number;
  potentialAssists?: number;
  astPointsCreated?: number;
  
  // Rebounding
  contestedRebounds?: number;
  reboundChances?: number;
  adjustedReboundChance?: number;
  
  // Defense
  deflections?: number;
  contestedShots?: number;
  blockedShotPct?: number;
  
  // Speed & Distance
  avgSpeed?: number;
  distanceMiles?: number;
  
  cachedAt?: string;
}

/**
 * Fetch tracking stats from cache
 * Uses team-based lookup: tracking_stats_TEAM_season_passing and tracking_stats_TEAM_season_rebounding
 * Finds the player by playerId in each team's players array and merges into TrackingStatsData
 */
export async function fetchTrackingStatsFromCache(
  playerId: number | string,
  season?: number,
  teamAbbr?: string
): Promise<TrackingStatsData | null> {
  const seasonYear = season || currentNbaSeason();
  const seasonStr = `${seasonYear}-${String((seasonYear || 0) + 1).slice(-2)}`;
  const nbaPlayerId = getNbaStatsId(String(playerId)) || String(playerId);
  const playerIdStr = String(playerId);

  // 1) Try per-player cache key (legacy)
  const playerCacheKey = `tracking_stats_${nbaPlayerId}_${seasonYear}`;
  let cached = cache.get<TrackingStatsData>(playerCacheKey);
  if (cached) return cached;
  cached = await getNBACache<TrackingStatsData>(playerCacheKey);
  if (cached) return cached;

  // 2) Team-based lookup: get passing + rebounding (season + last5) for player's team
  // Keys: tracking_stats_TEAM_SEASON_passing, _rebounding, _passing_last5, _rebounding_last5
  if (teamAbbr && teamAbbr !== 'UNK') {
    const team = teamAbbr.toUpperCase().trim();
    const passKey = `tracking_stats_${team}_${seasonYear}_passing`;
    const rebKey = `tracking_stats_${team}_${seasonYear}_rebounding`;
    const passKeyLast5 = `tracking_stats_${team}_${seasonYear}_passing_last5`;
    const rebKeyLast5 = `tracking_stats_${team}_${seasonYear}_rebounding_last5`;

    const [passingData, reboundingData, passLast5Data, rebLast5Data] = await Promise.all([
      getNBACache<any>(passKey),
      getNBACache<any>(rebKey),
      getNBACache<any>(passKeyLast5),
      getNBACache<any>(rebKeyLast5),
    ]);
    const passing = passingData || cache.get<any>(passKey);
    const rebounding = reboundingData || cache.get<any>(rebKey);
    const passingLast5 = passLast5Data || cache.get<any>(passKeyLast5);
    const reboundingLast5 = rebLast5Data || cache.get<any>(rebKeyLast5);

    const findPlayer = (arr: any[]) =>
      Array.isArray(arr) ? arr.find((p: any) => String(p?.playerId) === playerIdStr || String(p?.playerId) === nbaPlayerId) : null;
    const passPlayer = passing?.players ? findPlayer(passing.players) : null;
    const rebPlayer = rebounding?.players ? findPlayer(rebounding.players) : null;
    const passPlayerLast5 = passingLast5?.players ? findPlayer(passingLast5.players) : null;
    const rebPlayerLast5 = reboundingLast5?.players ? findPlayer(reboundingLast5.players) : null;

    if (passPlayer || rebPlayer) {
      const merged: TrackingStatsData = {
        playerId: parseInt(playerIdStr, 10) || 0,
        season: seasonStr,
        passesMade: passPlayer?.passesMade,
        passesReceived: undefined,
        potentialAssists: passPlayer?.potentialAst ?? passPlayer?.potentialAssists,
        astPointsCreated: passPlayer?.astPtsCreated ?? passPlayer?.astPtsCreated,
        contestedRebounds: rebPlayer?.rebContest ?? rebPlayer?.contestedRebounds,
        reboundChances: rebPlayer?.rebChances ?? rebPlayer?.reboundChances,
        potentialAssistsLast5: passPlayerLast5?.potentialAst ?? passPlayerLast5?.potentialAssists,
        reboundChancesLast5: rebPlayerLast5?.rebChances ?? rebPlayerLast5?.reboundChances,
      };
      console.log(`[NBA Cache Fetcher] Tracking stats hit (team ${team}): ${playerIdStr}${merged.potentialAssistsLast5 != null || merged.reboundChancesLast5 != null ? ' + last5' : ''}`);
      return merged;
    }
  }

  console.log(`[NBA Cache Fetcher] Tracking stats miss: ${nbaPlayerId}`);
  return null;
}

// ==================== TEAM DEFENSE RANKINGS ====================

export interface TeamDefenseRankings {
  [teamAbbr: string]: {
    restrictedArea: { rank: number; fgPct: number; fga: number; fgm: number };
    paint: { rank: number; fgPct: number; fga: number; fgm: number };
    midRange: { rank: number; fgPct: number; fga: number; fgm: number };
    leftCorner3: { rank: number; fgPct: number; fga: number; fgm: number };
    rightCorner3: { rank: number; fgPct: number; fga: number; fgm: number };
    aboveBreak3: { rank: number; fgPct: number; fga: number; fgm: number };
  };
}

/**
 * Fetch team defense rankings from cache
 * Used for shot chart opponent analysis
 */
export async function fetchTeamDefenseRankings(
  season?: number
): Promise<TeamDefenseRankings | null> {
  const seasonYear = season || currentNbaSeason();
  const cacheKey = `team_defense_rankings_${seasonYear}`;
  
  // Check in-memory cache first
  let cached = cache.get<TeamDefenseRankings>(cacheKey);
  if (cached) {
    console.log(`[NBA Cache Fetcher] Team defense rankings hit (in-memory)`);
    return cached;
  }
  
  // Try Supabase cache
  const supabaseData = await getNBACache<any>(cacheKey);
  if (supabaseData) {
    // Handle both formats: direct rankings or wrapped in rankings property
    const rankings = supabaseData.rankings || supabaseData;
    if (rankings && Object.keys(rankings).length > 0) {
      console.log(`[NBA Cache Fetcher] Team defense rankings hit (Supabase)`);
      return rankings as TeamDefenseRankings;
    }
  }
  
  console.log(`[NBA Cache Fetcher] Team defense rankings miss`);
  return null;
}

// ==================== PLAY TYPE DEFENSE RANKINGS ====================

export interface PlayTypeDefenseRankings {
  [playType: string]: Array<{ team: string; points: number }>;
}

/**
 * Fetch play type defensive rankings from cache
 * Used for play type opponent analysis
 */
export async function fetchPlayTypeDefenseRankings(
  season?: number
): Promise<PlayTypeDefenseRankings | null> {
  const seasonYear = season || currentNbaSeason();
  const seasonStr = `${seasonYear}-${String(seasonYear + 1).slice(-2)}`;
  const cacheKey = `playtype_defensive_rankings_${seasonStr}`;
  
  // Check in-memory cache first
  let cached = cache.get<PlayTypeDefenseRankings>(cacheKey);
  if (cached) {
    console.log(`[NBA Cache Fetcher] Play type defense rankings hit (in-memory)`);
    return cached;
  }
  
  // Try Supabase cache
  cached = await getNBACache<PlayTypeDefenseRankings>(cacheKey);
  if (cached && Object.keys(cached).length > 0) {
    console.log(`[NBA Cache Fetcher] Play type defense rankings hit (Supabase)`);
    return cached;
  }
  
  console.log(`[NBA Cache Fetcher] Play type defense rankings miss`);
  return null;
}

// ==================== COMBINED DATA FETCH ====================

export interface NBAStatsData {
  shotChart: ShotChartData | null;
  playTypes: PlayTypeData | null;
  trackingStats: TrackingStatsData | null;
  teamDefenseRankings: TeamDefenseRankings | null;
  playTypeDefenseRankings: PlayTypeDefenseRankings | null;
}

/**
 * Fetch all NBA Stats data from cache in parallel
 * This is the main function to call from the prediction engine
 * @param teamAbbr - Player's team (needed for tracking stats lookup)
 */
export async function fetchAllNBAStatsFromCache(
  playerId: number | string,
  opponentTeam?: string,
  season?: number,
  teamAbbr?: string
): Promise<NBAStatsData> {
  console.log(`[NBA Cache Fetcher] Fetching all NBA Stats data for player ${playerId}, opponent: ${opponentTeam || 'N/A'}, team: ${teamAbbr || 'N/A'}`);
  
  // Fetch all data in parallel
  const [shotChart, playTypes, trackingStats, teamDefenseRankings, playTypeDefenseRankings] = await Promise.all([
    fetchShotChartFromCache(playerId, opponentTeam, season),
    fetchPlayTypeFromCache(playerId, season),
    fetchTrackingStatsFromCache(playerId, season, teamAbbr),
    fetchTeamDefenseRankings(season),
    fetchPlayTypeDefenseRankings(season),
  ]);
  
  console.log(`[NBA Cache Fetcher] Results: shotChart=${!!shotChart}, playTypes=${!!playTypes}, tracking=${!!trackingStats}`);
  
  return {
    shotChart,
    playTypes,
    trackingStats,
    teamDefenseRankings,
    playTypeDefenseRankings,
  };
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Calculate shot profile percentages
 * Returns where a player gets their shots from
 */
export function calculateShotProfile(shotChart: ShotChartData): {
  rimPct: number;      // % of shots at rim
  paintPct: number;    // % in paint (non-RA)
  midRangePct: number; // % mid-range
  corner3Pct: number;  // % corner 3s
  above3Pct: number;   // % above break 3s
  totalAttempts: number;
} {
  const zones = shotChart.shotZones;
  const totalAttempts = 
    zones.restrictedArea.fga +
    zones.paint.fga +
    zones.midRange.fga +
    zones.leftCorner3.fga +
    zones.rightCorner3.fga +
    zones.aboveBreak3.fga;
  
  if (totalAttempts === 0) {
    return { rimPct: 0, paintPct: 0, midRangePct: 0, corner3Pct: 0, above3Pct: 0, totalAttempts: 0 };
  }
  
  return {
    rimPct: (zones.restrictedArea.fga / totalAttempts) * 100,
    paintPct: (zones.paint.fga / totalAttempts) * 100,
    midRangePct: (zones.midRange.fga / totalAttempts) * 100,
    corner3Pct: ((zones.leftCorner3.fga + zones.rightCorner3.fga) / totalAttempts) * 100,
    above3Pct: (zones.aboveBreak3.fga / totalAttempts) * 100,
    totalAttempts,
  };
}

/**
 * Calculate weighted expected points based on shot profile and zone efficiency
 * This is used by the shot quality model
 */
export function calculateExpectedPointsPerShot(shotChart: ShotChartData): number {
  const zones = shotChart.shotZones;
  const profile = calculateShotProfile(shotChart);
  
  if (profile.totalAttempts === 0) return 0;
  
  // Calculate expected points per shot attempt based on zone efficiency
  const expectedPts = 
    (zones.restrictedArea.fgPct / 100) * 2 * (profile.rimPct / 100) +
    (zones.paint.fgPct / 100) * 2 * (profile.paintPct / 100) +
    (zones.midRange.fgPct / 100) * 2 * (profile.midRangePct / 100) +
    (zones.leftCorner3.fgPct / 100) * 3 * (profile.corner3Pct / 200) +
    (zones.rightCorner3.fgPct / 100) * 3 * (profile.corner3Pct / 200) +
    (zones.aboveBreak3.fgPct / 100) * 3 * (profile.above3Pct / 100);
  
  return expectedPts;
}

/**
 * Get primary play type for a player
 * Returns the play type with the highest points
 */
export function getPrimaryPlayType(playTypes: PlayTypeData): PlayTypeEntry | null {
  if (!playTypes.playTypes || playTypes.playTypes.length === 0) return null;
  
  // Filter out free throws and find highest points
  const filtered = playTypes.playTypes.filter(pt => pt.playType !== 'FreeThrows');
  if (filtered.length === 0) return null;
  
  return filtered.reduce((max, pt) => pt.points > max.points ? pt : max, filtered[0]);
}

/**
 * Get top N play types for a player
 */
export function getTopPlayTypes(playTypes: PlayTypeData, n: number = 3): PlayTypeEntry[] {
  if (!playTypes.playTypes || playTypes.playTypes.length === 0) return [];
  
  // Filter out free throws and sort by points
  return playTypes.playTypes
    .filter(pt => pt.playType !== 'FreeThrows')
    .sort((a, b) => b.points - a.points)
    .slice(0, n);
}

/**
 * Calculate play type efficiency score
 * Higher score = player is efficient in high-value play types
 */
export function calculatePlayTypeEfficiency(playTypes: PlayTypeData): number {
  if (!playTypes.playTypes || playTypes.playTypes.length === 0) return 0;
  
  // Weight play types by their typical efficiency
  const efficiencyWeights: { [key: string]: number } = {
    'Cut': 1.3,           // Most efficient
    'Transition': 1.2,
    'OffRebound': 1.15,   // Putbacks
    'PRRollman': 1.1,     // Roll man
    'Spotup': 1.0,
    'PRBallHandler': 0.95,
    'Handoff': 0.95,
    'OffScreen': 0.9,
    'Isolation': 0.85,
    'Postup': 0.8,
    'Misc': 0.75,
  };
  
  let weightedScore = 0;
  let totalPts = 0;
  
  for (const pt of playTypes.playTypes) {
    if (pt.playType === 'FreeThrows') continue;
    const weight = efficiencyWeights[pt.playType] || 1.0;
    weightedScore += pt.points * weight;
    totalPts += pt.points;
  }
  
  return totalPts > 0 ? weightedScore / totalPts : 0;
}
