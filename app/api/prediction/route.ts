import { NextRequest, NextResponse } from 'next/server';

// Normal distribution CDF (Cumulative Distribution Function) approximation
// Returns the probability that a value from a standard normal distribution is <= z
function normalCDF(z: number): number {
  // Abramowitz and Stegun approximation (accurate to ~0.0002)
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp(-z * z / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function parseMinutes(minStr: string): number {
  if (!minStr || minStr === 'N/A') return 0;
  
  // Handle format like "29" (just a number)
  if (!minStr.includes(':')) {
    const mins = parseFloat(minStr);
    return Number.isFinite(mins) && mins >= 0 ? mins : 0;
  }
  
  // Handle format like "29:30" (MM:SS)
  const parts = minStr.split(':');
  if (parts.length !== 2) return 0;
  const mins = parseInt(parts[0], 10) || 0;
  const secs = parseInt(parts[1], 10) || 0;
  return mins + secs / 60;
}

function getStatValue(stats: any, statType: string): number {
  const statMap: Record<string, string> = {
    'pts': 'pts',
    'PTS': 'pts',
    'reb': 'reb',
    'REB': 'reb',
    'ast': 'ast',
    'AST': 'ast',
    'stl': 'stl',
    'STL': 'stl',
    'blk': 'blk',
    'BLK': 'blk',
    'fg3m': 'fg3m',
    'THREES': 'fg3m',
    'to': 'turnover',
    'TO': 'turnover',
  };
  const key = statMap[statType] || statType.toLowerCase();
  const rawValue = stats[key];
  
  // Handle null/undefined explicitly
  if (rawValue === null || rawValue === undefined) {
    return 0;
  }
  
  // Parse the value
  const parsed = parseFloat(String(rawValue));
  return Number.isFinite(parsed) ? parsed : 0;
}

// Team abbreviation alias map for matching quirks (same as depth-chart)
const TEAM_ABBR_ALIASES: Record<string, string[]> = {
  ATL: ['ATL'],
  BOS: ['BOS'],
  BKN: ['BKN', 'BRK'],
  CHA: ['CHA', 'CHH'],
  CHI: ['CHI'],
  CLE: ['CLE'],
  DAL: ['DAL'],
  DEN: ['DEN'],
  DET: ['DET'],
  GSW: ['GS', 'GSW'],
  HOU: ['HOU'],
  IND: ['IND'],
  LAC: ['LAC'],
  LAL: ['LAL'],
  MEM: ['MEM'],
  MIA: ['MIA'],
  MIL: ['MIL'],
  MIN: ['MIN'],
  NOP: ['NO', 'NOP', 'NOR', 'NOH'],
  NYK: ['NY', 'NYK'],
  OKC: ['OKC', 'SEA'],
  ORL: ['ORL'],
  PHI: ['PHI'],
  PHX: ['PHX', 'PHO'],
  POR: ['POR'],
  SAC: ['SAC'],
  SAS: ['SA', 'SAS', 'SAN'],
  TOR: ['TOR'],
  UTA: ['UTA', 'UTAH', 'UTH'],
  WAS: ['WAS', 'WSH'],
};

function normalizeAbbr(abbr: string): string {
  if (!abbr) return '';
  const upper = abbr.toUpperCase().trim();
  
  // Check if this abbreviation matches any canonical team or its aliases
  for (const [canonical, aliases] of Object.entries(TEAM_ABBR_ALIASES)) {
    if (canonical === upper || aliases.includes(upper)) {
      return canonical;
    }
  }
  
  // If no match found, return uppercased version
  return upper;
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const statType = searchParams.get('statType');
    const line = searchParams.get('line');
    const opponent = searchParams.get('opponent');
    const playerTeam = searchParams.get('playerTeam');
    const position = searchParams.get('position');
    const marketLine = searchParams.get('marketLine'); // Primary market line for blending
    const marketOverProb = searchParams.get('marketOverProb'); // Market implied probability for blending
    const marketUnderProb = searchParams.get('marketUnderProb');
    const forceRefresh = searchParams.get('refresh') === '1' || searchParams.get('refresh') === 'true';

    console.log('[prediction API] Request received:', { playerId, statType, line, opponent, playerTeam, forceRefresh });

    if (!playerId || !statType || !line) {
      console.error('[prediction API] Missing required parameters');
      return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
    }

    const lineValue = parseFloat(line);
    if (isNaN(lineValue)) {
      console.error('[prediction API] Invalid line value (NaN):', line);
      return NextResponse.json({ error: 'Invalid line value', line }, { status: 400 });
    }
    
    // Allow line value of 0 for some stats (like steals/blocks where 0.5 is common)
    // Only reject if it's truly invalid
    if (lineValue < 0) {
      console.error('[prediction API] Invalid line value (negative):', line);
      return NextResponse.json({ error: 'Invalid line value (negative)', line }, { status: 400 });
    }

    // Fetch player stats for current season and last season (both regular and postseason)
    const currentSeason = new Date().getFullYear();
    const seasonStartMonth = 9; // NBA season starts in October (month 9)
    const currentMonth = new Date().getMonth() + 1;
    const nbaSeason = currentMonth >= seasonStartMonth ? currentSeason : currentSeason - 1;
    const lastSeason = nbaSeason - 1;
    
    console.log('[prediction API] Fetching stats for player:', playerId, 'current season:', nbaSeason, 'last season:', lastSeason);
    
    // Use internal stats API which handles pagination properly
    // Always force refresh to get fresh data from BDL
    const fetchStats = async (season: number, postseason: boolean, delayMs: number = 0) => {
      if (delayMs > 0) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      const origin = request.nextUrl.origin;
      // Use cache unless forceRefresh is explicitly requested
      const refreshParam = forceRefresh ? '&refresh=1' : '';
      const url = `${origin}/api/stats?player_id=${playerId}&season=${season}&per_page=100&max_pages=3&postseason=${postseason}${refreshParam}`;
      const res = await fetch(url, { cache: forceRefresh ? 'no-store' : 'default' });
      if (!res.ok) {
        // If rate limited, try to return cached data if available
        if (res.status === 429) {
          console.warn(`[prediction API] Rate limited for season ${season}, postseason ${postseason}, attempting to parse cached data...`);
          try {
            const data = await res.json();
            if (Array.isArray(data?.data) && data.data.length > 0) {
              console.log(`[prediction API] Got cached data despite 429: ${data.data.length} stats`);
              return data.data;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
        console.warn(`[prediction API] Failed to fetch stats for season ${season}, postseason ${postseason}:`, res.status);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data?.data) ? data.data : [];
    };
    
    // Fetch all stats sequentially to avoid rate limits: current season (reg + post), last season (reg + post)
    // Sequential calls with small delays reduce the chance of hitting rate limits
    const currentReg = await fetchStats(nbaSeason, false, 0);
    const currentPost = await fetchStats(nbaSeason, true, 200); // 200ms delay between calls
    const lastReg = await fetchStats(lastSeason, false, 200);
    const lastPost = await fetchStats(lastSeason, true, 200);
    
    // Combine all stats
    const allStats = [...currentReg, ...currentPost, ...lastReg, ...lastPost];
    
    console.log('[prediction API] Got stats data:', {
      currentReg: currentReg.length,
      currentPost: currentPost.length,
      lastReg: lastReg.length,
      lastPost: lastPost.length,
      total: allStats.length,
      nbaSeason,
      lastSeason
    });
    
    if (allStats.length === 0) {
      console.warn('[prediction API] No stats data returned for player:', playerId);
      console.warn('[prediction API] All API calls returned empty:', {
        currentRegEmpty: currentReg.length === 0,
        currentPostEmpty: currentPost.length === 0,
        lastRegEmpty: lastReg.length === 0,
        lastPostEmpty: lastPost.length === 0,
      });
      return NextResponse.json({ 
        overProb: null, 
        underProb: null, 
        error: 'No stats data available',
        debug: {
          playerId,
          nbaSeason,
          lastSeason,
          fetchedSeasons: { currentReg: currentReg.length, currentPost: currentPost.length, lastReg: lastReg.length, lastPost: lastPost.length }
        }
      });
    }
    
    // Create statsData object with data array for compatibility
    const statsData = { data: allStats };

    // Filter to only current season stats for season average calculation
    // Current season: games from Oct (month 10) of nbaSeason-1 to Sep (month 9) of nbaSeason
    const currentSeasonStats = allStats.filter((stat: any) => {
      const gameDate = stat?.game?.date;
      if (!gameDate) return false;
      const date = new Date(gameDate);
      const gameYear = date.getFullYear();
      const gameMonth = date.getMonth() + 1;
      
      // NBA season spans two calendar years: Oct (month 10) to Sep (month 9)
      // For season 2025: Oct 2024 - Sep 2025
      if (gameMonth >= seasonStartMonth) {
        // Oct-Dec: should be in previous calendar year (nbaSeason - 1)
        return gameYear === nbaSeason - 1;
      } else {
        // Jan-Sep: should be in current calendar year (nbaSeason)
        return gameYear === nbaSeason;
      }
    });
    
    console.log('[prediction API] Season filtering:', {
      nbaSeason,
      totalStats: allStats.length,
      currentSeasonStatsCount: currentSeasonStats.length,
      sampleDates: allStats.slice(0, 5).map((s: any) => ({
        date: s?.game?.date,
        year: s?.game?.date ? new Date(s.game.date).getFullYear() : null,
        month: s?.game?.date ? new Date(s.game.date).getMonth() + 1 : null,
      })),
    });
    
    // Extract all stat values from current season games where player played
    // Debug: log first few stats to see structure
    if (currentSeasonStats.length > 0) {
      const sampleStat = currentSeasonStats[0];
      console.log('[prediction API] Sample stat structure:', {
        hasMin: !!sampleStat.min,
        min: sampleStat.min,
        statKeys: Object.keys(sampleStat).filter(k => !['player', 'game', 'team'].includes(k)),
        statValue: getStatValue(sampleStat, statType),
        statType,
        directAccess: sampleStat[statType.toLowerCase()],
        directAccessStl: sampleStat.stl,
      });
    }
    
    const allStatValues = currentSeasonStats
      .filter((stats: any) => {
        const minutes = parseMinutes(stats.min || '0:00');
        return minutes > 0;
      })
      .map((stats: any) => {
        const val = getStatValue(stats, statType);
        // Include 0 values - they're valid (player might have 0 steals in a game)
        return val;
      })
      .filter((val: number) => Number.isFinite(val) && val >= 0); // Allow 0, only filter out negative or NaN

    console.log('[prediction API] Stat extraction results:', {
      totalGames: allStats.length,
      currentSeasonGames: currentSeasonStats.length,
      gamesWithMinutes: currentSeasonStats.filter((s: any) => parseMinutes(s.min || '0:00') > 0).length,
      allStatValuesLength: allStatValues.length,
      sampleValues: allStatValues.slice(0, 5),
    });

    // If no current season stats, use all stats as fallback
    let finalStatValues = allStatValues;
    if (allStatValues.length === 0 && allStats.length > 0) {
      console.warn('[prediction API] No current season stats, using all available stats as fallback');
      finalStatValues = allStats
        .filter((stats: any) => {
          const minutes = parseMinutes(stats.min || '0:00');
          return minutes > 0;
        })
        .map((stats: any) => {
          const val = getStatValue(stats, statType);
          return val;
        })
        .filter((val: number) => Number.isFinite(val) && val >= 0);
    }
    
    if (finalStatValues.length === 0) {
      console.warn('[prediction API] No valid stat values after filtering for stat:', statType);
      console.warn('[prediction API] Debug info:', {
        totalStats: allStats.length,
        currentSeasonStatsCount: currentSeasonStats.length,
        gamesWithMinutes: currentSeasonStats.filter((s: any) => parseMinutes(s.min || '0:00') > 0).length,
        statType,
        nbaSeason,
        lastSeason,
        sampleStats: allStats.slice(0, 3).map((s: any) => ({
          min: s.min,
          statValue: getStatValue(s, statType),
          directStl: s.stl,
          directPts: s.pts,
          gameDate: s.game?.date,
          hasGame: !!s.game,
          hasTeam: !!s.team,
          allKeys: Object.keys(s).filter(k => !['player', 'game', 'team'].includes(k))
        })),
      });
      return NextResponse.json({ 
        overProb: null, 
        underProb: null, 
        error: 'No valid stat values',
        debug: {
          totalStats: allStats.length,
          currentSeasonStats: currentSeasonStats.length,
          statType,
          nbaSeason
        }
      });
    }

    console.log('[prediction API] Valid stat values:', finalStatValues.length, 'games with stat:', statType, finalStatValues.length !== allStatValues.length ? '(using fallback)' : '');

    // Sort all stats by date (newest first) - use all stats for H2H, current season for last 5
    const sortedAllStats = [...allStats].sort((a, b) => {
      const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return dateB - dateA; // Newest first
    });
    
    // For last 5 games, only use current season stats
    const sortedCurrentSeasonStats = [...currentSeasonStats].sort((a, b) => {
      const dateA = a?.game?.date ? new Date(a.game.date).getTime() : 0;
      const dateB = b?.game?.date ? new Date(b.game.date).getTime() : 0;
      return dateB - dateA; // Newest first
    });

    // 1. Last 5 games average (35% weight) - only from current season
    const last5Stats = sortedCurrentSeasonStats
      .filter((stats: any) => {
        const minutes = parseMinutes(stats.min || '0:00');
        return minutes > 0;
      })
      .slice(0, 5)
      .map((stats: any) => getStatValue(stats, statType))
      .filter((val: number) => Number.isFinite(val));
    const last5Avg = last5Stats.length > 0
      ? last5Stats.reduce((sum: number, val: number) => sum + val, 0) / last5Stats.length
      : null;

    // 2. H2H average vs current opponent (30% weight)
    const normalizedOpponent = opponent && opponent !== 'N/A' && opponent !== 'ALL' && opponent !== ''
      ? normalizeAbbr(opponent)
      : null;
    
    let h2hAvg: number | null = null;
    let h2hStatsLength = 0;
    if (normalizedOpponent && playerTeam) {
      const normalizedPlayerTeam = normalizeAbbr(playerTeam);
      // Use all stats (current + last season) for H2H calculation
      const h2hStats = sortedAllStats
        .filter((stats: any) => {
          const minutes = parseMinutes(stats.min || '0:00');
          if (minutes === 0) return false;
          
          const playerTeamFromStats = stats?.team?.abbreviation || '';
          const playerTeamNorm = normalizeAbbr(playerTeamFromStats);
          const homeTeamId = stats?.game?.home_team?.id ?? (stats?.game as any)?.home_team_id;
          const visitorTeamId = stats?.game?.visitor_team?.id ?? (stats?.game as any)?.visitor_team_id;
          
          // Use team ID mapping if available
          const TEAM_ID_TO_ABBR: Record<number, string> = {
            1: 'ATL', 2: 'BOS', 3: 'BKN', 4: 'CHA', 5: 'CHI', 6: 'CLE', 7: 'DAL', 8: 'DEN',
            9: 'DET', 10: 'GSW', 11: 'HOU', 12: 'IND', 13: 'LAC', 14: 'LAL', 15: 'MEM',
            16: 'MIA', 17: 'MIL', 18: 'MIN', 19: 'NO', 20: 'NY', 21: 'OKC', 22: 'ORL',
            23: 'PHI', 24: 'PHX', 25: 'POR', 26: 'SAC', 27: 'SA', 28: 'TOR', 29: 'UTA', 30: 'WAS'
          };
          
          const homeTeamAbbr = stats?.game?.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
          const visitorTeamAbbr = stats?.game?.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);
          
          let gameOpponent = '';
          if (homeTeamAbbr && visitorTeamAbbr) {
            const homeNorm = normalizeAbbr(homeTeamAbbr);
            const visitorNorm = normalizeAbbr(visitorTeamAbbr);
            if (homeNorm === playerTeamNorm) {
              gameOpponent = visitorNorm;
            } else if (visitorNorm === playerTeamNorm) {
              gameOpponent = homeNorm;
            }
          }
          
          return normalizeAbbr(gameOpponent) === normalizedOpponent;
        })
        .map((stats: any) => getStatValue(stats, statType))
        .filter((val: number) => Number.isFinite(val));
      
      h2hStatsLength = h2hStats.length;
      h2hAvg = h2hStats.length > 0
        ? h2hStats.reduce((sum: number, val: number) => sum + val, 0) / h2hStats.length
        : null;
    }

    // 3. Season average (35% weight) - use finalStatValues (current season or fallback)
    const seasonAvg = finalStatValues.length > 0
      ? finalStatValues.reduce((sum: number, val: number) => sum + val, 0) / finalStatValues.length
      : 0;

    // 4. DvP adjustment
    let dvpAdjustment = 0;
    if (normalizedOpponent && position) {
      try {
        const statToMetric: Record<string, string> = {
          'pts': 'pts',
          'reb': 'reb',
          'ast': 'ast',
          'fg3m': 'fg3m',
          'stl': 'stl',
          'blk': 'blk',
          'to': 'to',
          'fg_pct': 'fg_pct',
          'ft_pct': 'ft_pct',
        };
        const metric = statToMetric[statType.toLowerCase()] || statType.toLowerCase();
        
        // Fetch DvP rank data using internal API
        // For server-side API routes, we can use the full URL or make a direct internal call
        // Skip DvP for now to avoid hanging - can be added back later if needed
        const dvpRankResponse = null; // Temporarily disabled to prevent hanging
        
        // DvP rank logic temporarily disabled
        // if (dvpRankResponse?.metrics?.[metric]) {
        //   const ranks = dvpRankResponse.metrics[metric];
        //   const teamRank = ranks[normalizedOpponent] || ranks[normalizedOpponent.toUpperCase()] || null;
        //   
        //   if (teamRank !== null && teamRank >= 1 && teamRank <= 30) {
        //     if (teamRank <= 10) {
        //       dvpAdjustment = -0.5 - ((10 - teamRank) / 10) * 0.5;
        //     } else if (teamRank <= 20) {
        //       dvpAdjustment = -1 + ((teamRank - 11) / 9) * 2;
        //     } else {
        //       dvpAdjustment = 1.5 + ((teamRank - 21) / 9) * 1;
        //     }
        //   }
        // }
      } catch (dvpError) {
        console.warn('Failed to fetch DvP rank data:', dvpError);
      }
    }

    // 5. Advanced stats adjustment (simplified - would need player advanced stats API)
    let advancedStatsAdjustment = 0;
    // Note: Full advanced stats would require additional API call
    // For now, we'll skip this to keep the endpoint simpler

    // 6. Team pace adjustment (simplified - would need team pace data)
    // For now, we'll skip this

    // Combine all factors with weights
    // Ensure seasonAvg is valid
    if (!Number.isFinite(seasonAvg) || seasonAvg < 0) {
      console.error('[prediction API] Invalid seasonAvg:', seasonAvg);
      return NextResponse.json({ overProb: null, underProb: null, error: 'Invalid season average' });
    }
    
    let predictedValue = seasonAvg;
    let totalWeight = 0.35; // Season avg weight
    let weightedSum = seasonAvg * 0.35;

    if (last5Avg !== null && Number.isFinite(last5Avg) && last5Stats.length >= 3) {
      weightedSum += last5Avg * 0.35;
      totalWeight += 0.35;
    }

    if (h2hAvg !== null && Number.isFinite(h2hAvg) && h2hStatsLength >= 2) {
      weightedSum += h2hAvg * 0.30;
      totalWeight += 0.30;
    }

    predictedValue = totalWeight > 0 ? weightedSum / totalWeight : seasonAvg;
    
    // Validate predictedValue
    if (!Number.isFinite(predictedValue) || predictedValue < 0) {
      console.error('[prediction API] Invalid predictedValue after weighting:', predictedValue);
      predictedValue = seasonAvg; // Fallback to season average
    }

    // Apply adjustments
    predictedValue += dvpAdjustment;
    predictedValue += advancedStatsAdjustment;

    // Blend with market line if provided (70% prediction, 30% market)
    let finalPredictedValue = predictedValue;
    if (marketLine && marketOverProb && marketUnderProb) {
      const marketLineValue = parseFloat(marketLine);
      if (!isNaN(marketLineValue) && marketLineValue > 0) {
        finalPredictedValue = predictedValue * 0.7 + marketLineValue * 0.3;
      }
    }
    
    // Ensure finalPredictedValue is valid
    if (!Number.isFinite(finalPredictedValue) || finalPredictedValue < 0) {
      console.warn('[prediction API] Invalid finalPredictedValue:', finalPredictedValue, 'using predictedValue instead');
      finalPredictedValue = predictedValue;
    }
    
    // Final validation - if still invalid, use season average
    if (!Number.isFinite(finalPredictedValue) || finalPredictedValue < 0) {
      console.warn('[prediction API] finalPredictedValue still invalid, using seasonAvg:', seasonAvg);
      finalPredictedValue = seasonAvg;
    }

    // Calculate standard deviation - use finalStatValues
    const variance = finalStatValues.length > 0
      ? finalStatValues.reduce((sum: number, val: number) => {
          const diff = val - seasonAvg;
          return sum + (diff * diff);
        }, 0) / finalStatValues.length
      : 0;
    const stdDev = Math.sqrt(variance);
    let adjustedStdDev = Math.max(stdDev, 2);
    
    // Ensure adjustedStdDev is valid
    if (!Number.isFinite(adjustedStdDev) || adjustedStdDev <= 0) {
      console.warn('[prediction API] Invalid adjustedStdDev:', adjustedStdDev, 'using default 2');
      adjustedStdDev = 2;
    }

    console.log('[prediction API] Calculation values:', {
      seasonAvg,
      last5Avg,
      h2hAvg,
      predictedValue,
      finalPredictedValue,
      lineValue,
      adjustedStdDev,
      isFinite: Number.isFinite(finalPredictedValue),
      stdDevValid: adjustedStdDev > 0
    });

    // Final check - ensure all values are valid before calculating probabilities
    if (!Number.isFinite(finalPredictedValue) || finalPredictedValue < 0) {
      console.error('[prediction API] finalPredictedValue is still invalid after all checks:', finalPredictedValue);
      return NextResponse.json({ 
        overProb: null, 
        underProb: null,
        error: 'Invalid predicted value',
        debug: { finalPredictedValue, predictedValue, seasonAvg, last5Avg, h2hAvg }
      });
    }
    
    if (!Number.isFinite(adjustedStdDev) || adjustedStdDev <= 0) {
      console.error('[prediction API] adjustedStdDev is invalid:', adjustedStdDev);
      return NextResponse.json({ 
        overProb: null, 
        underProb: null,
        error: 'Invalid standard deviation',
        debug: { adjustedStdDev, stdDev, variance }
      });
    }
    
    if (!Number.isFinite(lineValue) || lineValue < 0) {
      console.error('[prediction API] lineValue is invalid:', lineValue);
      return NextResponse.json({ 
        overProb: null, 
        underProb: null,
        error: 'Invalid line value',
        debug: { lineValue, line }
      });
    }

    // All values are valid, calculate probabilities
    const zScore = (lineValue - finalPredictedValue) / adjustedStdDev;
    const underProb = normalCDF(zScore) * 100;
    const overProb = (1 - normalCDF(zScore)) * 100;

    const clampedOverProb = Math.max(0, Math.min(100, overProb));
    const clampedUnderProb = Math.max(0, Math.min(100, underProb));

    console.log('[prediction API] Returning probabilities:', { overProb: clampedOverProb, underProb: clampedUnderProb });
    
    return NextResponse.json({
      overProb: clampedOverProb,
      underProb: clampedUnderProb,
    });
  } catch (error) {
    console.error('[prediction API] Error calculating StatTrackr prediction:', error);
    return NextResponse.json({ error: 'Internal server error', details: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
