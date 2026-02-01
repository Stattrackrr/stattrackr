/**
 * BettingPros Data Fetcher
 * Fetches DVP (Defense vs Position) rankings from BettingPros
 */

import type { DVPRanking } from '../types';

/**
 * Fetch DVP ranking for a specific team/position/stat
 * Uses the BettingPros lib directly
 */
export async function fetchDVPRanking(
  team: string,
  position: string,
  statType: string
): Promise<DVPRanking | null> {
  try {
    // Import the BettingPros fetcher
    const { fetchBettingProsData, OUR_TO_BP_ABBR, OUR_TO_BP_METRIC } = await import('@/lib/bettingpros-dvp');
    const { normalizeAbbr } = await import('@/lib/nbaAbbr');
    
    const bpData = await fetchBettingProsData();
    
    const teamAbbr = normalizeAbbr(team);
    const bpTeamAbbr = OUR_TO_BP_ABBR[teamAbbr] || teamAbbr;
    
    const teamStats = bpData.teamStats?.[bpTeamAbbr];
    if (!teamStats) {
      console.warn(`[BettingPros Fetcher] No team stats for ${team}`);
      return null;
    }
    
    const pos = position.toUpperCase();
    const positionData = teamStats[pos] || teamStats['ALL'];
    if (!positionData) {
      return null;
    }
    
    const bpMetric = OUR_TO_BP_METRIC[statType] || statType;
    const value = positionData[bpMetric];
    
    return {
      team,
      position: pos,
      statType,
      rank: 15, // placeholder - will calculate actual rank
      valueAllowed: value !== undefined ? Number(value) : 0,
    };
  } catch (error) {
    console.error('[BettingPros Fetcher] Error fetching DVP:', error);
    return null;
  }
}

/**
 * Fetch DVP rankings for all teams for a specific position/stat
 */
export async function fetchAllDVPRankings(
  position: string,
  statType: string
): Promise<DVPRanking[]> {
  try {
    // Import the BettingPros fetcher
    const { fetchBettingProsData, OUR_TO_BP_METRIC } = await import('@/lib/bettingpros-dvp');
    const { normalizeAbbr } = await import('@/lib/nbaAbbr');
    
    const bpData = await fetchBettingProsData();
    
    if (!bpData.teamStats) {
      console.warn('[BettingPros Fetcher] No team stats in BettingPros data');
      return [];
    }
    
    const pos = position.toUpperCase();
    const bpMetric = OUR_TO_BP_METRIC[statType] || statType;
    
    // Convert to array
    const teams: { team: string; value: number }[] = [];
    
    for (const [bpAbbr, teamStats] of Object.entries(bpData.teamStats || {})) {
      const ourAbbr = normalizeAbbr(bpAbbr);
      
      if (teamStats && typeof teamStats === 'object') {
        const positionData = (teamStats as any)[pos] || (teamStats as any)['ALL'];
        if (positionData) {
          const value = positionData[bpMetric];
          if (value !== undefined) {
            teams.push({
              team: ourAbbr,
              value: Number(value),
            });
          }
        }
      }
    }
    
    // Sort by value (for points: higher = worse defense, lower rank)
    // For defensive stats (stl, blk): lower = worse defense
    const isDefensiveStat = ['stl', 'blk'].includes(statType);
    teams.sort((a, b) => isDefensiveStat ? a.value - b.value : b.value - a.value);
    
    // Assign ranks (1 = best defense, 30 = worst)
    return teams.map((team, index) => ({
      team: team.team,
      position: pos,
      statType,
      rank: index + 1,
      valueAllowed: team.value,
    }));
  } catch (error) {
    console.error('[BettingPros Fetcher] Error fetching all DVP rankings:', error);
    return [];
  }
}

/**
 * Get DVP multiplier based on rank
 * Rank 1 (best defense) = 0.85 multiplier (15% reduction)
 * Rank 30 (worst defense) = 1.15 multiplier (15% increase)
 */
export function getDVPMultiplier(rank: number): number {
  if (rank < 1 || rank > 30) return 1.0;
  
  // Linear interpolation from 0.85 (rank 1) to 1.15 (rank 30)
  const minMultiplier = 0.85;
  const maxMultiplier = 1.15;
  const range = maxMultiplier - minMultiplier;
  
  return minMultiplier + (range * (rank - 1) / 29);
}

/**
 * Get DVP adjustment for a player vs opponent
 */
export async function getDVPAdjustment(
  opponent: string,
  position: string,
  statType: string
): Promise<{ rank: number; multiplier: number; confidence: number }> {
  try {
    // Fetch all rankings to get accurate rank
    const rankings = await fetchAllDVPRankings(position, statType);
    
    if (rankings.length === 0) {
      return { rank: 15, multiplier: 1.0, confidence: 0 };
    }
    
    // Find opponent's rank
    const opponentRanking = rankings.find(r => r.team === opponent);
    
    if (!opponentRanking) {
      return { rank: 15, multiplier: 1.0, confidence: 0 };
    }
    
    const multiplier = getDVPMultiplier(opponentRanking.rank);
    
    // Confidence based on sample size (BettingPros usually has good data)
    const confidence = 0.85;
    
    return {
      rank: opponentRanking.rank,
      multiplier,
      confidence,
    };
  } catch (error) {
    console.error('[BettingPros Fetcher] Error getting DVP adjustment:', error);
    return { rank: 15, multiplier: 1.0, confidence: 0 };
  }
}

/**
 * Cache DVP rankings in memory for performance
 */
const dvpCache = new Map<string, { data: DVPRanking[]; timestamp: number }>();
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

export async function getCachedDVPRankings(
  position: string,
  statType: string
): Promise<DVPRanking[]> {
  const cacheKey = `${position}-${statType}`;
  const cached = dvpCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const rankings = await fetchAllDVPRankings(position, statType);
  dvpCache.set(cacheKey, { data: rankings, timestamp: Date.now() });
  
  return rankings;
}
