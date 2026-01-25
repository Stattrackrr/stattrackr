// app/api/shot-chart-enhanced/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { getNbaStatsId } from '@/lib/playerIdMapping';
import { currentNbaSeason } from '@/lib/nbaUtils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Vercel Pro plan allows up to 60s

const NBA_STATS_BASE = 'https://stats.nba.com/stats';

const NBA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nba.com/stats/',
  'Origin': 'https://www.nba.com',
  'Cache-Control': 'no-cache',
  'Pragma': 'no-cache',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not=A?Brand";v="99"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"Windows"',
};

const NBA_TEAM_MAP: { [key: string]: string } = {
  'ATL': '1610612737', 'BOS': '1610612738', 'BKN': '1610612751', 'CHA': '1610612766',
  'CHI': '1610612741', 'CLE': '1610612739', 'DAL': '1610612742', 'DEN': '1610612743',
  'DET': '1610612765', 'GSW': '1610612744', 'HOU': '1610612745', 'IND': '1610612754',
  'LAC': '1610612746', 'LAL': '1610612747', 'MEM': '1610612763', 'MIA': '1610612748',
  'MIL': '1610612749', 'MIN': '1610612750', 'NOP': '1610612740', 'NYK': '1610612752',
  'OKC': '1610612760', 'ORL': '1610612753', 'PHI': '1610612755', 'PHX': '1610612756',
  'POR': '1610612757', 'SAC': '1610612758', 'SAS': '1610612759', 'TOR': '1610612761',
  'UTA': '1610612762', 'WAS': '1610612764'
};

/**
 * Fetch defensive stats for a single team (not all 30 teams)
 * This is much faster than fetching all teams just to get one team's stats
 * Results are cached to avoid repeated API calls
 */
async function fetchSingleTeamDefenseStats(teamAbbr: string, teamId: string, seasonStr: string, season: number) {
  const isProduction = process.env.NODE_ENV === 'production';
  const cacheKey = `team_defense_stats_${teamAbbr}_${season}`;
  
  // Check cache first (in-memory)
  let cached = cache.get<any>(cacheKey);
  if (cached) {
    return cached;
  }
  
  // Check Supabase cache (persistent, shared across instances)
  try {
    const { getNBACache } = await import('@/lib/nbaCache');
    cached = await getNBACache<any>(cacheKey);
    if (cached) {
      // Also store in in-memory cache for faster access
      // Use TRACKING_STATS TTL (365 days) so cache persists until replaced by cron job
      cache.set(cacheKey, cached, CACHE_TTL.TRACKING_STATS);
      return cached;
    }
    
    // Check for stale cache (even expired) - important for development/production where NBA API is unreachable
    const { createClient } = await import('@supabase/supabase-js');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (supabaseUrl && supabaseServiceKey) {
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
        auth: { autoRefreshToken: false, persistSession: false }
      });
      
      const { data: staleData } = await supabaseAdmin
        .from('nba_api_cache')
        .select('data, expires_at')
        .eq('cache_key', cacheKey)
        .maybeSingle();
      
      if (staleData?.data) {
        // Store in in-memory cache with TRACKING_STATS TTL
        cache.set(cacheKey, staleData.data, CACHE_TTL.TRACKING_STATS);
        return staleData.data;
      }
    }
  } catch (cacheError: any) {
    // Ignore cache errors
  }

  // In production/development, don't try NBA API - everything should be cached
  if (isProduction) {
    return null;
  }

  // Only try NBA API in local development
  try {
    const defenseParams = new URLSearchParams({
      LeagueID: '00',
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TeamID: '0',
      PlayerID: '0',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: teamId,
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      ContextMeasure: 'FGA',
      RookieYear: '',
      Position: '',
    });

    const defenseUrl = `${NBA_STATS_BASE}/shotchartdetail?${defenseParams.toString()}`;
    
    const defenseData = await fetchNBAStats(defenseUrl, 5000, 0); // 5s timeout, no retries (fail fast)

    if (defenseData?.resultSets?.[0]) {
      const resultSet = defenseData.resultSets[0];
      const headers = resultSet.headers || [];
      const rows = resultSet.rowSet || [];

      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
      const shotZoneBasicIdx = headers.indexOf('SHOT_ZONE_BASIC');

      const zoneStats: {
        [key: string]: { made: number; attempted: number };
      } = {
        restrictedArea: { made: 0, attempted: 0 },
        paint: { made: 0, attempted: 0 },
        midRange: { made: 0, attempted: 0 },
        leftCorner3: { made: 0, attempted: 0 },
        rightCorner3: { made: 0, attempted: 0 },
        aboveBreak3: { made: 0, attempted: 0 },
      };

      for (const row of rows) {
        const made = row[shotMadeIdx] === 1;
        const zone = row[shotZoneBasicIdx];

        if (zone === 'Restricted Area') {
          zoneStats.restrictedArea.attempted++;
          if (made) zoneStats.restrictedArea.made++;
        } else if (zone === 'In The Paint (Non-RA)') {
          zoneStats.paint.attempted++;
          if (made) zoneStats.paint.made++;
        } else if (zone === 'Mid-Range') {
          zoneStats.midRange.attempted++;
          if (made) zoneStats.midRange.made++;
        } else if (zone === 'Left Corner 3') {
          zoneStats.leftCorner3.attempted++;
          if (made) zoneStats.leftCorner3.made++;
        } else if (zone === 'Right Corner 3') {
          zoneStats.rightCorner3.attempted++;
          if (made) zoneStats.rightCorner3.made++;
        } else if (zone === 'Above the Break 3') {
          zoneStats.aboveBreak3.attempted++;
          if (made) zoneStats.aboveBreak3.made++;
        }
      }

      const stats = {
        restrictedArea: {
          fgPct: zoneStats.restrictedArea.attempted > 0 ? (zoneStats.restrictedArea.made / zoneStats.restrictedArea.attempted) * 100 : 0,
          fga: zoneStats.restrictedArea.attempted,
          fgm: zoneStats.restrictedArea.made
        },
        paint: {
          fgPct: zoneStats.paint.attempted > 0 ? (zoneStats.paint.made / zoneStats.paint.attempted) * 100 : 0,
          fga: zoneStats.paint.attempted,
          fgm: zoneStats.paint.made
        },
        midRange: {
          fgPct: zoneStats.midRange.attempted > 0 ? (zoneStats.midRange.made / zoneStats.midRange.attempted) * 100 : 0,
          fga: zoneStats.midRange.attempted,
          fgm: zoneStats.midRange.made
        },
        leftCorner3: {
          fgPct: zoneStats.leftCorner3.attempted > 0 ? (zoneStats.leftCorner3.made / zoneStats.leftCorner3.attempted) * 100 : 0,
          fga: zoneStats.leftCorner3.attempted,
          fgm: zoneStats.leftCorner3.made
        },
        rightCorner3: {
          fgPct: zoneStats.rightCorner3.attempted > 0 ? (zoneStats.rightCorner3.made / zoneStats.rightCorner3.attempted) * 100 : 0,
          fga: zoneStats.rightCorner3.attempted,
          fgm: zoneStats.rightCorner3.made
        },
        aboveBreak3: {
          fgPct: zoneStats.aboveBreak3.attempted > 0 ? (zoneStats.aboveBreak3.made / zoneStats.aboveBreak3.attempted) * 100 : 0,
          fga: zoneStats.aboveBreak3.attempted,
          fgm: zoneStats.aboveBreak3.made
        }
      };

      // Cache with TRACKING_STATS TTL (365 days) so cache persists until replaced by cron job
      cache.set(cacheKey, stats, CACHE_TTL.TRACKING_STATS);
      
      // Also save to Supabase for persistence across instances
      try {
        const { setNBACache } = await import('@/lib/nbaCache');
        await setNBACache(cacheKey, 'team_defense', stats, CACHE_TTL.TRACKING_STATS);
      } catch (cacheError: any) {
        // Ignore cache save errors
      }
      
      return stats;
    }

    return null;
  } catch (error: any) {
    
    // If NBA API fails, try to get stale cache from Supabase as last resort
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      
      if (supabaseUrl && supabaseServiceKey) {
        const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
          auth: { autoRefreshToken: false, persistSession: false }
        });
        
        const { data: staleData } = await supabaseAdmin
          .from('nba_api_cache')
          .select('data, expires_at')
          .eq('cache_key', cacheKey)
          .maybeSingle();
        
        if (staleData?.data) {
          // Store in in-memory cache for faster access with TRACKING_STATS TTL
          cache.set(cacheKey, staleData.data, CACHE_TTL.TRACKING_STATS);
          return staleData.data;
        }
      }
    } catch (staleError: any) {
      // Ignore stale cache errors
    }
    
    return null;
  }
}

function computeLeagueAverageRankings(rankings: Record<string, any>) {
  if (!rankings || Object.keys(rankings).length === 0) {
    return null;
  }
  const zones = ['restrictedArea', 'paint', 'midRange', 'leftCorner3', 'rightCorner3', 'aboveBreak3'];
  const averages: Record<string, { rank: number; fgPct: number; fga: number; fgm: number; totalTeams: number }> = {};

  zones.forEach((zone) => {
    let total = 0;
    let count = 0;
    Object.values(rankings).forEach((team: any) => {
      const zoneData = team?.[zone];
      if (zoneData && typeof zoneData.fgPct === 'number') {
        total += zoneData.fgPct;
        count++;
      }
    });
    if (count > 0) {
      averages[zone] = {
        rank: 0,
        fgPct: total / count,
        fga: 0,
        fgm: 0,
        totalTeams: count,
      };
    }
  });

  return Object.keys(averages).length > 0 ? averages : null;
}

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Aggressive timeouts: 5s in dev, 8s in production (fail fast, rely on cache)
  // No retries in production, 1 retry max in dev
  const actualTimeout = Math.max(4000, Math.min(timeout, 30000)); // allow longer requests (up to 30s)
  const actualRetries = Math.max(0, Math.min(retries, 2)); // honor requested retries (max 2)
  
  const maxAttempts = actualRetries + 1;

  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store',
        // Add redirect handling for production
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        const errorMsg = `NBA API ${response.status}: ${response.statusText}`;
        
        // Don't retry on 4xx errors (client errors) except 429 (rate limit)
        if (response.status === 429 || (response.status >= 500 && attempt < actualRetries)) {
          const delay = 1000 * (attempt + 1);
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      const data = await response.json();
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${actualTimeout}ms`);
        if (attempt < actualRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNRESET')) {
        lastError = error;
        if (attempt < actualRetries) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
      
      throw error;
    }
  }
  
  throw lastError || new Error('Failed after retries');
}

export async function GET(request: NextRequest) {
  // Define variables at function scope for error handling
  let cacheKey: string | null = null;
  let nbaPlayerId: string | null = null;
  
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const opponentTeam = searchParams.get('opponentTeam');
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const bypassCache = searchParams.get('bypassCache') === 'true';

    if (!playerId) {
      return NextResponse.json(
        { error: 'Player ID is required' },
        { status: 400 }
      );
    }

    // Auto-convert BallDontLie ID to NBA Stats ID if needed
    const originalPlayerId = playerId;
    
    // Convert to NBA Stats ID first (handles BDL IDs and other formats)
    const converted = getNbaStatsId(playerId);
    nbaPlayerId = converted || playerId;
    
    // Validate NBA Stats ID format (should be 6-10 digits after conversion)
    // NBA Stats IDs are typically 6-7 digits, but some newer players have longer IDs
    if (nbaPlayerId.length > 10) {
      return NextResponse.json({
        playerId: playerId,
        season: `${season}-${String(season + 1).slice(-2)}`,
        shotZones: {
          restrictedArea: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          paint: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          midRange: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          leftCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          rightCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          aboveBreak3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
        },
        opponentTeam,
        opponentDefense: null,
        error: 'Invalid player ID format',
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }
    
    if (!converted || (converted === playerId && nbaPlayerId === playerId && nbaPlayerId.length <= 10)) {
      // Already NBA Stats ID or valid format
    } else {
      // Conversion failed - return empty data instead of error - player just might not have shot data yet
      return NextResponse.json({
        playerId: playerId,
        season: `${season}-${String(season + 1).slice(-2)}`,
        shotZones: {
          restrictedArea: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          paint: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          midRange: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          leftCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          rightCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          aboveBreak3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
        },
        opponentTeam,
        opponentDefense: null,
        error: 'Player not found in ID mapping',
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }

    // Define seasonStr early so it's available throughout the function
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;

    // Check cache (unless bypassed) - use NBA ID for cache key
    cacheKey = `shot_enhanced_${nbaPlayerId}_${opponentTeam || 'none'}_${season}`;
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    // OPTIMIZATION: Check both caches in parallel for faster response
    // Check in-memory cache (fastest) and Supabase cache simultaneously
    let cached: any = null;
    if (!bypassCache) {
      // Check in-memory cache first (instant)
      cached = cache.get<any>(cacheKey);
      
      // If not in memory, check Supabase in parallel with opponent-less cache
      if (!cached) {
        const cacheKeyNoOpponent = opponentTeam && opponentTeam !== 'N/A' 
          ? `shot_enhanced_${nbaPlayerId}_none_${season}` 
          : null;
        
        // Fetch both caches in parallel
        const [supabaseCache, noOpponentCache] = await Promise.all([
          getNBACache<any>(cacheKey),
          cacheKeyNoOpponent ? getNBACache<any>(cacheKeyNoOpponent) : Promise.resolve(null)
        ]);
        
        // Prefer opponent-specific cache, fallback to no-opponent cache
        cached = supabaseCache || noOpponentCache;
        
        if (cached) {
          // Store in in-memory cache for faster future access
          cache.set(cached === supabaseCache ? cacheKey : cacheKeyNoOpponent!, cached, CACHE_TTL.PLAYER_STATS);
        } else if (cacheKeyNoOpponent) {
          // Also check in-memory for no-opponent cache
          cached = cache.get<any>(cacheKeyNoOpponent);
        }
      }
    }
    
    if (cached) {
      // Validate cached data - if all zones have 0 attempts, treat as invalid cache
      const totalAttempts = (cached.shotZones?.restrictedArea?.fga || 0) +
                           (cached.shotZones?.paint?.fga || 0) +
                           (cached.shotZones?.midRange?.fga || 0) +
                           (cached.shotZones?.leftCorner3?.fga || 0) +
                           (cached.shotZones?.rightCorner3?.fga || 0) +
                           (cached.shotZones?.aboveBreak3?.fga || 0);
      
      if (totalAttempts === 0) {
        cached = null; // Treat as cache miss
      }
    }
    
    if (cached) {
      // Validate cached data before returning
      const totalAttempts = (cached.shotZones?.restrictedArea?.fga || 0) +
                           (cached.shotZones?.paint?.fga || 0) +
                           (cached.shotZones?.midRange?.fga || 0) +
                           (cached.shotZones?.leftCorner3?.fga || 0) +
                           (cached.shotZones?.rightCorner3?.fga || 0) +
                           (cached.shotZones?.aboveBreak3?.fga || 0);
      
      // OPTIMIZATION: Return cached data immediately, fetch defense rankings in background (non-blocking)
      // This reduces latency from ~15s to <100ms for cached shot chart data
      const responseData = { ...cached };
      
      // If rankings are already in cache, include them
      if (opponentTeam && opponentTeam !== 'N/A' && cached.opponentRankings) {
        responseData.opponentRankings = cached.opponentRankings;
        responseData.opponentRankingsSource = cached.opponentRankingsSource;
        responseData.opponentTeam = opponentTeam;
      } else if (opponentTeam && opponentTeam !== 'N/A' && !cached.opponentRankings) {
        // Rankings not in cache - fetch in background (non-blocking) for future requests
        // Don't block the response - return shot chart data immediately
        Promise.resolve().then(async () => {
          try {
            const rankingsCacheKey = `team_defense_rankings_${season}`;
            // Use shorter timeout (3s) - if it takes longer, skip it
            let cachedRankings = await Promise.race([
              getNBACache<any>(rankingsCacheKey, {
                restTimeoutMs: 3000,
                jsTimeoutMs: 3000,
              }),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
            ]);
            
            if (!cachedRankings) {
              cachedRankings = cache.get<any>(rankingsCacheKey);
            } else {
              cache.set(rankingsCacheKey, cachedRankings, CACHE_TTL.TRACKING_STATS);
            }
            
            const rankings = cachedRankings?.rankings || cachedRankings;
            
            if (rankings && Object.keys(rankings).length > 0 && rankings[opponentTeam]) {
              // Rankings found - could update cache here for future requests
              return;
            }
            
            // Try single team stats cache (faster fallback)
            const singleTeamCacheKey = `team_defense_stats_${opponentTeam}_${season}`;
            let singleTeamStats = await Promise.race([
              getNBACache<any>(singleTeamCacheKey),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
            ]);
            
            if (!singleTeamStats) {
              singleTeamStats = cache.get<any>(singleTeamCacheKey);
            }
            
            // Found stats - could update cache here for future requests
          } catch (err) {
            // Ignore background fetch errors
          }
        }).catch(() => {});
      }
      
      return NextResponse.json(responseData, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    // No cache found - check if we should try NBA API
    // In production/development, everything should be cached - don't try NBA API
    // UNLESS X-Allow-NBA-API header is set (indicates caller can reach NBA API, e.g., from GitHub Actions)
    const allowNbaApi = request.headers.get('x-allow-nba-api') === 'true';
    if (isProduction && !allowNbaApi) {
      // Return empty data - cache should be populated by external service
      return NextResponse.json({
        playerId: nbaPlayerId,
        season: seasonStr,
        shotZones: {
          restrictedArea: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          paint: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          midRange: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          leftCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          rightCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          aboveBreak3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
        },
        opponentTeam,
        opponentDefense: null,
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }

    // Only try NBA API in local development
    // Fetch player shot chart detail (has actual zone data)
    const playerParams = new URLSearchParams({
      LeagueID: '00',
      PlayerID: nbaPlayerId,
      Season: seasonStr,
      SeasonType: 'Regular Season',
      TeamID: '0',
      Outcome: '',
      Location: '',
      Month: '0',
      SeasonSegment: '',
      DateFrom: '',
      DateTo: '',
      OpponentTeamID: '0',
      VsConference: '',
      VsDivision: '',
      GameSegment: '',
      Period: '0',
      LastNGames: '0',
      ContextMeasure: 'FGA',
      RookieYear: '',
      Position: '',
    });

    const playerUrl = `${NBA_STATS_BASE}/shotchartdetail?${playerParams.toString()}`;
    
    // Use shorter timeout in production (8s) to fail fast, longer in dev (20s)
    const timeout = process.env.NODE_ENV === 'production' ? 8000 : 20000;
    let playerData;
    
    try {
      playerData = await fetchNBAStats(playerUrl, timeout);
    } catch (error: any) {
      // If fetch fails, check if we have any cached data (even expired) to return
      // Query Supabase directly to get expired cache
      try {
        const { getNBACache } = await import('@/lib/nbaCache');
        const { createClient } = await import('@supabase/supabase-js');
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });
          
          // Get cache even if expired (use .maybeSingle() to handle 0 rows gracefully)
          let { data: staleData, error: staleError } = await supabaseAdmin
            .from('nba_api_cache')
            .select('data, expires_at')
            .eq('cache_key', cacheKey)
            .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows
          
          // If no cache with opponent, check without opponent (like we do for fresh cache)
          if (!staleData?.data && opponentTeam && opponentTeam !== 'N/A') {
            const cacheKeyNoOpponent = `shot_enhanced_${nbaPlayerId}_none_${season}`;
            const result = await supabaseAdmin
              .from('nba_api_cache')
              .select('data, expires_at')
              .eq('cache_key', cacheKeyNoOpponent)
              .maybeSingle();
            staleData = result.data;
            staleError = result.error;
          }
          
          if (!staleError && staleData?.data && staleData.data.shotZones) {
            // Validate that we have actual shot data
            const totalAttempts = (staleData.data.shotZones?.restrictedArea?.fga || 0) +
                               (staleData.data.shotZones?.paint?.fga || 0) +
                               (staleData.data.shotZones?.midRange?.fga || 0) +
                               (staleData.data.shotZones?.leftCorner3?.fga || 0) +
                               (staleData.data.shotZones?.rightCorner3?.fga || 0) +
                               (staleData.data.shotZones?.aboveBreak3?.fga || 0);
            
            if (totalAttempts > 0) {
              const isExpired = staleData.expires_at && new Date(staleData.expires_at) < new Date();
              
              // Add opponent rankings if needed (same logic as cache hit)
              if (opponentTeam && opponentTeam !== 'N/A') {
                try {
                  const rankingsCacheKey = `team_defense_rankings_${season}`;
                  let cachedRankings = await getNBACache<any>(rankingsCacheKey);
                  if (!cachedRankings) {
                    cachedRankings = cache.get<any>(rankingsCacheKey);
                  }
                  const rankings = cachedRankings?.rankings || cachedRankings;
                  
                  if (rankings && rankings[opponentTeam]) {
                    staleData.data.opponentRankings = rankings[opponentTeam];
                    staleData.data.opponentRankingsSource = 'team';
                  } else {
                    const leagueAverageRankings = computeLeagueAverageRankings(rankings || {});
                    if (leagueAverageRankings) {
                      staleData.data.opponentRankings = leagueAverageRankings;
                      staleData.data.opponentRankingsSource = 'league_average';
                    }
                  }
                } catch (err) {
                  // Ignore defense rankings errors
                }
              }
              
              return NextResponse.json({
                ...staleData.data,
                opponentTeam,
                cachedAt: staleData.expires_at || new Date().toISOString(),
                stale: isExpired
              }, { 
                status: 200,
                headers: { 'X-Cache-Status': isExpired ? 'STALE' : 'HIT' }
              });
            }
          }
        }
      } catch (staleError: any) {
        // Ignore stale cache errors
      }
      
      // If fetch fails in production, try to trigger background cache population
      if (process.env.NODE_ENV === 'production' && !bypassCache) {
        // Try to trigger background cache population (non-blocking)
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = 'https';
        const cacheUrl = `${protocol}://${host}/api/shot-chart-enhanced?playerId=${nbaPlayerId}&season=${season}&bypassCache=true`;
        
        // Don't await - let it run in background (may also fail, but worth trying)
        fetch(cacheUrl, { 
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' }
        }).catch(() => {});
      }
      
      // Return empty data - component will show 0% but at least won't crash
      // The daily cron job should populate cache eventually
      return NextResponse.json({
        playerId: nbaPlayerId,
        originalPlayerId: originalPlayerId !== nbaPlayerId ? originalPlayerId : undefined,
        season: `${season}-${String(season + 1).slice(-2)}`,
        shotZones: {
          restrictedArea: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          paint: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          midRange: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          leftCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          rightCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
          aboveBreak3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
        },
        opponentTeam,
        opponentDefense: null,
        opponentRankings: null,
        // Don't include error message - return empty data silently like play-type-analysis does
        // The component will handle empty data gracefully
        loading: false,
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }

    if (!playerData?.resultSets) {
      throw new Error('No player shot data available');
    }

    // Extract zone data from result sets
    const shotZones = {
      restrictedArea: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
      paint: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
      midRange: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
      leftCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
      rightCorner3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
      aboveBreak3: { fgm: 0, fga: 0, fgPct: 0, pts: 0 },
    };

    // Process shot chart data (individual shots, not aggregated)
    // The shotchartdetail endpoint returns individual shots in the first result set
    const shotData = playerData.resultSets?.[0];
    if (shotData && shotData.rowSet) {
      const headers = shotData.headers || [];
      const rows = shotData.rowSet || [];

      const shotZoneIdx = headers.indexOf('SHOT_ZONE_BASIC');
      const shotZoneAreaIdx = headers.indexOf('SHOT_ZONE_AREA');
      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
      const shotTypeIdx = headers.indexOf('SHOT_TYPE');

      // Log unique zones/areas to debug
      const uniqueZones = new Set();
      const uniqueAreas = new Set();
      
      // Aggregate individual shots into zones
      for (const row of rows) {
        const zone = row[shotZoneIdx];
        const area = row[shotZoneAreaIdx];
        const made = row[shotMadeIdx] === 1;
        const shotType = row[shotTypeIdx];
        
        uniqueZones.add(zone);
        uniqueAreas.add(area);
        
        const is3Pointer = shotType?.includes('3PT');
        const points = is3Pointer ? 3 : 2;

        // Map to our zones
        if (zone === 'Restricted Area') {
          shotZones.restrictedArea.fga += 1;
          if (made) {
            shotZones.restrictedArea.fgm += 1;
            shotZones.restrictedArea.pts += points;
          }
        } else if (zone === 'In The Paint (Non-RA)') {
          shotZones.paint.fga += 1;
          if (made) {
            shotZones.paint.fgm += 1;
            shotZones.paint.pts += points;
          }
        } else if (zone === 'Mid-Range') {
          shotZones.midRange.fga += 1;
          if (made) {
            shotZones.midRange.fgm += 1;
            shotZones.midRange.pts += points;
          }
        } else if (zone === 'Left Corner 3') {
          shotZones.leftCorner3.fga += 1;
          if (made) {
            shotZones.leftCorner3.fgm += 1;
            shotZones.leftCorner3.pts += 3;
          }
        } else if (zone === 'Right Corner 3') {
          shotZones.rightCorner3.fga += 1;
          if (made) {
            shotZones.rightCorner3.fgm += 1;
            shotZones.rightCorner3.pts += 3;
          }
        } else if (zone === 'Above the Break 3') {
          shotZones.aboveBreak3.fga += 1;
          if (made) {
            shotZones.aboveBreak3.fgm += 1;
            shotZones.aboveBreak3.pts += 3;
          }
        }
      }
      
    }

    // Calculate percentages (keep pts as totals, not per game)
    Object.keys(shotZones).forEach((key) => {
      const zone = shotZones[key as keyof typeof shotZones];
      if (zone.fga > 0) {
        zone.fgPct = (zone.fgm / zone.fga) * 100;
      }
    });

    // Validate that we have actual shot data before proceeding
    const totalAttempts = shotZones.restrictedArea.fga +
                         shotZones.paint.fga +
                         shotZones.midRange.fga +
                         shotZones.leftCorner3.fga +
                         shotZones.rightCorner3.fga +
                         shotZones.aboveBreak3.fga;
    
    if (totalAttempts === 0) {
      // Don't cache empty data - return it but don't cache
      return NextResponse.json({
        playerId: nbaPlayerId,
        originalPlayerId: originalPlayerId !== nbaPlayerId ? originalPlayerId : undefined,
        season: seasonStr,
        shotZones,
        opponentTeam,
        opponentDefense: null,
        opponentRankings: null,
        error: 'No shot data available for this player this season',
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }

    // Fetch league-wide defense rankings (all 30 teams) - OPTIMIZED: Use shorter timeout
    // This is optional - if it fails, we'll just not show rankings
    let defenseRankings = null;
    let leagueAverageRankings = null;
    
    // OPTIMIZATION: Only fetch rankings if opponent is specified, and use shorter timeout
    if (opponentTeam && opponentTeam !== 'N/A') {
      try {
        const rankingsCacheKey = `team_defense_rankings_${season}`;
        // Use shorter timeout (3s) for faster response
        let cachedRankings = await Promise.race([
          getNBACache<any>(rankingsCacheKey, {
            restTimeoutMs: 3000,
            jsTimeoutMs: 3000,
          }),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000))
        ]);
        
        // Fallback to in-memory cache
        if (!cachedRankings) {
          cachedRankings = cache.get<any>(rankingsCacheKey);
        }
        
        // Handle both formats: direct rankings object or wrapped in rankings property
        const rankings = cachedRankings?.rankings || cachedRankings;
        
        if (rankings && Object.keys(rankings).length > 0) {
          defenseRankings = rankings;
          leagueAverageRankings = computeLeagueAverageRankings(rankings);
        } else {
          // Check for single team stats cache (without rank, but still useful)
          const singleTeamCacheKey = `team_defense_stats_${opponentTeam}_${season}`;
          // Use shorter timeout (2s)
          let singleTeamStats = await Promise.race([
            getNBACache<any>(singleTeamCacheKey),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), 2000))
          ]);
          
          // Fallback to in-memory cache
          if (!singleTeamStats) {
            singleTeamStats = cache.get<any>(singleTeamCacheKey);
          }
        
          if (singleTeamStats) {
            // Convert single team stats to rankings format (without rank)
            defenseRankings = {
              [opponentTeam]: {
                restrictedArea: {
                  ...singleTeamStats.restrictedArea,
                  rank: 0 // No rank available without all teams comparison
                },
                paint: {
                  ...singleTeamStats.paint,
                  rank: 0
                },
                midRange: {
                  ...singleTeamStats.midRange,
                  rank: 0
                },
                leftCorner3: {
                  ...singleTeamStats.leftCorner3,
                  rank: 0
                },
                rightCorner3: {
                  ...singleTeamStats.rightCorner3,
                  rank: 0
                },
                aboveBreak3: {
                  ...singleTeamStats.aboveBreak3,
                  rank: 0
                }
              }
            };
            leagueAverageRankings = computeLeagueAverageRankings(defenseRankings);
          } else {
            // No cached rankings or stats - trigger background fetch for ALL teams (non-blocking)
            // This will populate the all-teams rankings cache with actual ranks (1-30)
            const host = request.headers.get('host') || 'localhost:3000';
            const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
            const rankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}`;
            
            // Don't await - let it run in background (this can take 30-60 seconds)
            // In production, this will use Supabase cache if available, avoiding timeouts
            fetch(rankingsUrl).catch(() => {});
          }
        }
      } catch (err) {
        // Ignore defense rankings errors
      }
    }

    // Note: Opponent defense data is now handled via rankings (see defenseRankings above)
    // The old per-team defense fetching has been deprecated in favor of league-wide rankings
    const opponentDefense = null; // Deprecated, keeping for backwards compatibility

    // Add opponent defense rankings if available
    let opponentRankings = null;
    let opponentRankingsSource: 'team' | 'league_average' | null = null;
    if (opponentTeam && opponentTeam !== 'N/A' && defenseRankings && defenseRankings[opponentTeam]) {
      opponentRankings = defenseRankings[opponentTeam];
      opponentRankingsSource = 'team';
    } else if (leagueAverageRankings) {
      opponentRankings = leagueAverageRankings;
      opponentRankingsSource = 'league_average';
    }

    const response = {
      playerId: nbaPlayerId,
      originalPlayerId: originalPlayerId !== nbaPlayerId ? originalPlayerId : undefined,
      season: seasonStr,
      shotZones,
      opponentTeam,
      opponentDefense,
      opponentRankings, // Rankings for opponent team (rank 1 = best defense)
      opponentRankingsSource,
      cachedAt: new Date().toISOString()
    };

    // Cache the result in both Supabase (persistent) and in-memory
    // TTL is 365 days - cache is refreshed by cron job, not by expiration
    await setNBACache(cacheKey, 'shot_chart', response, CACHE_TTL.TRACKING_STATS);
    cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    // On timeout, try to return cached data if available
    if ((error.message?.includes('timeout') || error.name === 'AbortError') && cacheKey) {
      const cached = cache.get<any>(cacheKey);
      if (cached) {
        return NextResponse.json(cached, {
          status: 200,
          headers: { 
            'X-Cache-Status': 'HIT-FALLBACK',
            'X-Error': 'Timeout - using cached data'
          }
        });
      }
    }
    
    // Determine error type and provide helpful message
    let errorMessage = 'Failed to fetch enhanced shot data';
    let errorType = error.name || 'UnknownError';
    
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (error.message?.includes('timeout') || error.name === 'AbortError') {
      errorType = 'TimeoutError';
      errorMessage = isProduction ? 'Request timed out. Please try again.' : 'Request timed out - API is slow to respond. Please try again.';
    } else if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
      errorType = 'NetworkError';
      errorMessage = isProduction ? 'Network error. Please check your connection.' : 'Network error - Unable to reach data source. Please check your connection.';
    } else if (error.message?.includes('NBA API 4')) {
      errorType = 'APIError';
      errorMessage = isProduction ? 'Data unavailable. Please try again later.' : 'API returned an error. The player data may not be available.';
    } else if (error.message?.includes('NBA API 5')) {
      errorType = 'ServerError';
      errorMessage = isProduction ? 'Server error. Please try again in a few moments.' : 'Server error. Please try again in a few moments.';
    } else if (error.message && !isProduction) {
      errorMessage = error.message;
    } else {
      errorMessage = isProduction ? 'An error occurred. Please try again later.' : error.message || 'Failed to fetch enhanced shot data';
    }
    
    const errorDetails = isProduction 
      ? {
          error: errorMessage,
          type: errorType,
        }
      : {
          error: errorMessage,
          message: error.message,
          stack: error.stack,
          type: errorType,
        };
    
    return NextResponse.json(
      errorDetails,
      { status: 500 }
    );
  }
}

