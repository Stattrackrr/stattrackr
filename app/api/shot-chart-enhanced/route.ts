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
  // Check cache first
  const cacheKey = `team_defense_stats_${teamAbbr}_${season}`;
  const cached = cache.get<any>(cacheKey);
  if (cached) {
    console.log(`[Shot Chart Enhanced] ✅ Using cached defensive stats for ${teamAbbr}`);
    return cached;
  }

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
    console.log(`[Shot Chart Enhanced] Fetching defensive stats for ${teamAbbr}...`);
    
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

      // Cache the result for 24 hours (1440 minutes)
      cache.set(cacheKey, stats, 1440);
      console.log(`[Shot Chart Enhanced] 💾 Cached defensive stats for ${teamAbbr}`);
      
      return stats;
    }

    return null;
  } catch (error: any) {
    console.warn(`[Shot Chart Enhanced] Error fetching defensive stats for ${teamAbbr}:`, error.message);
    return null;
  }
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
      console.log(`[Shot Chart Enhanced] Fetching NBA API (attempt ${attempt + 1}/${maxAttempts}): ${url.substring(0, 100)}...`);
      
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
        console.error(`[Shot Chart Enhanced] NBA API error ${response.status} (attempt ${attempt + 1}/${maxAttempts}):`, text.slice(0, 500));
        
        // Don't retry on 4xx errors (client errors) except 429 (rate limit)
        if (response.status === 429 || (response.status >= 500 && attempt < actualRetries)) {
          const delay = 1000 * (attempt + 1);
          console.log(`[Shot Chart Enhanced] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log(`[Shot Chart Enhanced] ✅ Successfully fetched NBA API data`);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${actualTimeout}ms`);
        if (attempt < actualRetries) {
          console.log(`[Shot Chart Enhanced] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNRESET')) {
        lastError = error;
        if (attempt < actualRetries) {
          console.log(`[Shot Chart Enhanced] Network error on attempt ${attempt + 1}: ${error.message}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
      
      // Log the error for debugging
      console.error(`[Shot Chart Enhanced] Fetch error (attempt ${attempt + 1}):`, {
        name: error.name,
        message: error.message,
        isProduction,
      });
      
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
    
    // Try to convert any ID format using the smart detection
    console.log(`[Shot Chart Enhanced] Received player ID: ${playerId} (length: ${playerId.length})`);
    
    // Convert to NBA Stats ID first (handles BDL IDs and other formats)
    const converted = getNbaStatsId(playerId);
    nbaPlayerId = converted || playerId;
    
    // Validate NBA Stats ID format (should be 6-10 digits after conversion)
    // NBA Stats IDs are typically 6-7 digits, but some newer players have longer IDs
    if (nbaPlayerId.length > 10) {
      console.error(`[Shot Chart Enhanced] ❌ Invalid player ID: ${playerId} -> ${nbaPlayerId} (too long after conversion, max 10 digits)`);
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
    
    if (converted && converted !== playerId) {
      // Conversion happened
      console.log(`[Shot Chart Enhanced] ✅ Converted ${playerId} → ${nbaPlayerId}`);
    } else if (converted === playerId || nbaPlayerId === playerId) {
      // Already NBA Stats ID
      console.log(`[Shot Chart Enhanced] ✅ Player ID ${playerId} is already NBA Stats format`);
    } else {
      // Conversion failed
      console.error(`[Shot Chart Enhanced] ❌ Could not convert player ID ${playerId} - not in mapping file`);
      // Return empty data instead of error - player just might not have shot data yet
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

    console.log(`[Shot Chart Enhanced] Request for player ${nbaPlayerId} (original: ${originalPlayerId}), opponent: ${opponentTeam || 'none'}, season: ${season}, bypassCache: ${bypassCache}`);

    // Define seasonStr early so it's available throughout the function
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;

    // Check cache (unless bypassed) - use NBA ID for cache key
    cacheKey = `shot_enhanced_${nbaPlayerId}_${opponentTeam || 'none'}_${season}`;
    
    // Log Supabase status for debugging
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log(`[Shot Chart Enhanced] Supabase config check: URL=${supabaseUrl ? 'SET' : 'MISSING'}, KEY=${supabaseKey ? 'SET' : 'MISSING'}`);
    
    // Try Supabase cache first (persistent, shared across instances)
    let cached = !bypassCache ? await getNBACache<any>(cacheKey) : null;
    console.log(`[Shot Chart Enhanced] Cache check result: ${cached ? 'FOUND in Supabase' : 'NOT FOUND in Supabase'}`);
    
    // Fallback to in-memory cache
    if (!cached && !bypassCache) {
      cached = cache.get<any>(cacheKey);
    }
    
    // Also check for cache without opponent team (in case opponent-specific cache doesn't exist)
    if (!cached && !bypassCache && opponentTeam && opponentTeam !== 'N/A') {
      const cacheKeyNoOpponent = `shot_enhanced_${nbaPlayerId}_none_${season}`;
      cached = await getNBACache<any>(cacheKeyNoOpponent);
      if (!cached) {
        cached = cache.get<any>(cacheKeyNoOpponent);
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
        console.log(`[Shot Chart Enhanced] ⚠️ Cached data has 0 shot attempts, treating as invalid cache. Fetching fresh data...`);
        cached = null; // Treat as cache miss
      } else {
        console.log(`[Shot Chart Enhanced] ✅ Cache hit for player ${nbaPlayerId} (original: ${originalPlayerId}), zones:`, {
          restrictedArea: cached.shotZones?.restrictedArea?.fga || 0,
          paint: cached.shotZones?.paint?.fga || 0,
          midRange: cached.shotZones?.midRange?.fga || 0,
          leftCorner3: cached.shotZones?.leftCorner3?.fga || 0,
          rightCorner3: cached.shotZones?.rightCorner3?.fga || 0,
          aboveBreak3: cached.shotZones?.aboveBreak3?.fga || 0,
        });
      }
    }
    
    if (cached) {
      // If opponent team is provided, fetch defensive rankings even on cache hit
      // (rankings are opponent-specific, so they may not be in the cached response)
      if (opponentTeam && opponentTeam !== 'N/A') {
        let defenseRankings = null;
        try {
          const rankingsCacheKey = `team_defense_rankings_${season}`;
          // Try Supabase cache first (persistent, shared across instances)
          let cachedRankings = await getNBACache<any>(rankingsCacheKey);
          
          // Fallback to in-memory cache
          if (!cachedRankings) {
            cachedRankings = cache.get<any>(rankingsCacheKey);
          }
          
          // Handle both formats: direct rankings object or wrapped in rankings property
          const rankings = cachedRankings?.rankings || cachedRankings;
          
          if (rankings && Object.keys(rankings).length > 0) {
            console.log(`[Shot Chart Enhanced] ✅ Using cached defense rankings (${Object.keys(rankings).length} teams)`);
            defenseRankings = rankings;
          } else {
            // Check for single team stats cache (without rank, but still useful)
            const singleTeamCacheKey = `team_defense_stats_${opponentTeam}_${season}`;
            // Try Supabase cache first
            let singleTeamStats = await getNBACache<any>(singleTeamCacheKey);
            
            // Fallback to in-memory cache
            if (!singleTeamStats) {
              singleTeamStats = cache.get<any>(singleTeamCacheKey);
            }
            
            if (singleTeamStats) {
              console.log(`[Shot Chart Enhanced] ✅ Using cached single team stats for ${opponentTeam} (no rank available)`);
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
            } else {
              // No cached rankings or stats - try to fetch single team stats synchronously (faster than all teams)
              console.log(`[Shot Chart Enhanced] ⚠️ No cached rankings found. Fetching single team defensive stats for ${opponentTeam}...`);
              try {
                const singleTeamStats = await fetchSingleTeamDefenseStats(opponentTeam, NBA_TEAM_MAP[opponentTeam], seasonStr, season);
                if (singleTeamStats) {
                  console.log(`[Shot Chart Enhanced] ✅ Fetched single team stats for ${opponentTeam}`);
                  // Convert to rankings format (without rank, but with stats)
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
                } else {
                  // If single team fetch fails, trigger background fetch for ALL teams (non-blocking)
                  console.warn(`[Shot Chart Enhanced] ⚠️ Single team fetch failed. Triggering background fetch for all 30 teams...`);
                  const host = request.headers.get('host') || 'localhost:3000';
                  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                  const rankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}`;
                  fetch(rankingsUrl).catch(err => {
                    console.warn(`[Shot Chart Enhanced] Background all-teams rankings fetch failed:`, err.message);
                  });
                }
              } catch (err) {
                console.error(`[Shot Chart Enhanced] ⚠️ Error fetching single team stats:`, err);
                // Trigger background fetch as fallback
                const host = request.headers.get('host') || 'localhost:3000';
                const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                const rankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}`;
                fetch(rankingsUrl).catch(fetchErr => {
                  console.warn(`[Shot Chart Enhanced] Background all-teams rankings fetch failed:`, fetchErr.message);
                });
              }
            }
          }
          
          // Add opponent rankings to cached response
          if (defenseRankings && defenseRankings[opponentTeam]) {
            cached.opponentRankings = defenseRankings[opponentTeam];
            cached.opponentTeam = opponentTeam; // Ensure opponentTeam is set
            console.log(`[Shot Chart Enhanced] ✅ Added rankings for ${opponentTeam} to cached response`);
          } else {
            console.warn(`[Shot Chart Enhanced] ⚠️ No defensive rankings available for ${opponentTeam}`);
          }
        } catch (err) {
          console.error(`[Shot Chart Enhanced] ⚠️ Error fetching defense rankings (non-fatal):`, err);
        }
      }
      
      return NextResponse.json(cached, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    // No cache found - try to fetch from NBA API
    // In production, we'll try with aggressive timeouts, and if it fails, trigger background cache population
    console.log(`[Shot Chart Enhanced] No cache found, fetching from NBA API for player ${nbaPlayerId} (original: ${originalPlayerId}), season ${season}`);

    console.log(`[Shot Chart Enhanced] Fetching for player ${nbaPlayerId} (original: ${originalPlayerId}), season ${season} (bypassCache=true)`);

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
    console.log(`[Shot Chart Enhanced] Calling NBA API: ${playerUrl}`);
    
    // Use shorter timeout in production (8s) to fail fast, longer in dev (20s)
    const timeout = process.env.NODE_ENV === 'production' ? 8000 : 20000;
    let playerData;
    
    try {
      playerData = await fetchNBAStats(playerUrl, timeout);
      console.log(`[Shot Chart Enhanced] Player data received:`, playerData?.resultSets?.length, 'result sets');
    } catch (error: any) {
      console.error(`[Shot Chart Enhanced] NBA API fetch error:`, error.message);
      
      // If fetch fails, check if we have any cached data (even expired) to return
      // Query Supabase directly to get expired cache
      try {
        const { getNBACache } = await import('@/lib/nbaCache');
        const { createClient } = await import('@supabase/supabase-js');
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        console.log(`[Shot Chart Enhanced] Checking stale cache - Supabase URL: ${supabaseUrl ? 'SET' : 'MISSING'}, Key: ${supabaseServiceKey ? 'SET' : 'MISSING'}`);
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });
          
          console.log(`[Shot Chart Enhanced] Querying Supabase for stale cache key: ${cacheKey}`);
          
          // Get cache even if expired (use .maybeSingle() to handle 0 rows gracefully)
          const { data: staleData, error: staleError } = await supabaseAdmin
            .from('nba_api_cache')
            .select('data')
            .eq('cache_key', cacheKey)
            .maybeSingle(); // Use maybeSingle() instead of single() to handle 0 rows
          
          if (staleError) {
            console.warn(`[Shot Chart Enhanced] Supabase query error for stale cache:`, staleError.message || staleError);
          } else if (staleData?.data && staleData.data.shotZones) {
            console.log(`[Shot Chart Enhanced] ⚠️ Returning stale cached data due to API failure`);
            return NextResponse.json({
              ...staleData.data,
              error: 'Using cached data - fresh data unavailable',
              stale: true
            }, { status: 200 });
          } else {
            console.log(`[Shot Chart Enhanced] No stale cache found in Supabase for key: ${cacheKey}`);
          }
        } else {
          console.error(`[Shot Chart Enhanced] ❌ Cannot check stale cache - Supabase credentials missing!`);
        }
      } catch (staleError: any) {
        console.error(`[Shot Chart Enhanced] ❌ Error checking stale cache:`, staleError.message || staleError);
      }
      
      // If fetch fails in production, try to trigger background cache population
      if (process.env.NODE_ENV === 'production' && !bypassCache) {
        console.log(`[Shot Chart Enhanced] ⚠️ NBA API fetch failed in production. Attempting background cache population...`);
        
        // Try to trigger background cache population (non-blocking)
        // Use a separate endpoint or queue system if available
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = 'https';
        const cacheUrl = `${protocol}://${host}/api/shot-chart-enhanced?playerId=${nbaPlayerId}&season=${season}&bypassCache=true`;
        
        // Don't await - let it run in background (may also fail, but worth trying)
        fetch(cacheUrl, { 
          method: 'GET',
          headers: { 'Cache-Control': 'no-cache' }
        }).catch(err => {
          console.warn(`[Shot Chart Enhanced] Background cache population failed:`, err.message);
        });
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
        error: process.env.NODE_ENV === 'production' 
          ? 'NBA API unreachable from production. Data will be available once the daily cache refresh runs.'
          : error.message,
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
    if (!shotData || !shotData.rowSet) {
      console.log(`[Shot Chart Enhanced] No shot data available`);
    } else {
      const headers = shotData.headers || [];
      const rows = shotData.rowSet || [];
      
      console.log(`[Shot Chart Enhanced] Processing ${rows.length} individual shots`);
      console.log(`[Shot Chart Enhanced] Headers:`, headers.slice(0, 10).join(', '), '...');

      const shotZoneIdx = headers.indexOf('SHOT_ZONE_BASIC');
      const shotZoneAreaIdx = headers.indexOf('SHOT_ZONE_AREA');
      const shotMadeIdx = headers.indexOf('SHOT_MADE_FLAG');
      const shotTypeIdx = headers.indexOf('SHOT_TYPE');

      if (shotZoneIdx === -1) {
        console.log(`[Shot Chart Enhanced] ⚠️ No SHOT_ZONE_BASIC column found`);
      }

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
      
      console.log(`[Shot Chart Enhanced] Processed ${rows.length} shots into zones`);
      console.log(`[Shot Chart Enhanced] Unique zones found:`, Array.from(uniqueZones));
      console.log(`[Shot Chart Enhanced] Unique areas found:`, Array.from(uniqueAreas));
    }

    // Calculate percentages (keep pts as totals, not per game)
    Object.keys(shotZones).forEach((key) => {
      const zone = shotZones[key as keyof typeof shotZones];
      if (zone.fga > 0) {
        zone.fgPct = (zone.fgm / zone.fga) * 100;
      }
    });

    console.log(`[Shot Chart Enhanced] Final shot zones (with percentages):`, JSON.stringify(shotZones, null, 2));

    // Validate that we have actual shot data before proceeding
    const totalAttempts = shotZones.restrictedArea.fga +
                         shotZones.paint.fga +
                         shotZones.midRange.fga +
                         shotZones.leftCorner3.fga +
                         shotZones.rightCorner3.fga +
                         shotZones.aboveBreak3.fga;
    
    if (totalAttempts === 0) {
      console.warn(`[Shot Chart Enhanced] ⚠️ No shot attempts found for player ${nbaPlayerId}. This might be a rookie or player with no games this season.`);
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

    // Fetch league-wide defense rankings (all 30 teams)
    // This is optional - if it fails, we'll just not show rankings
    let defenseRankings = null;
      try {
        const rankingsCacheKey = `team_defense_rankings_${season}`;
        // Try Supabase cache first (persistent, shared across instances)
        let cachedRankings = await getNBACache<any>(rankingsCacheKey);
        
        // Fallback to in-memory cache
        if (!cachedRankings) {
          cachedRankings = cache.get<any>(rankingsCacheKey);
        }
        
        // Handle both formats: direct rankings object or wrapped in rankings property
        const rankings = cachedRankings?.rankings || cachedRankings;
        
        if (rankings && Object.keys(rankings).length > 0) {
          console.log(`[Shot Chart Enhanced] ✅ Using cached defense rankings (${Object.keys(rankings).length} teams)`);
          defenseRankings = rankings;
        } else if (opponentTeam && opponentTeam !== 'N/A') {
          // Check for single team stats cache (without rank, but still useful)
          const singleTeamCacheKey = `team_defense_stats_${opponentTeam}_${season}`;
          // Try Supabase cache first
          let singleTeamStats = await getNBACache<any>(singleTeamCacheKey);
          
          // Fallback to in-memory cache
          if (!singleTeamStats) {
            singleTeamStats = cache.get<any>(singleTeamCacheKey);
          }
        
        if (singleTeamStats) {
          console.log(`[Shot Chart Enhanced] ✅ Using cached single team stats for ${opponentTeam} (no rank available)`);
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
        } else {
          // No cached rankings or stats - trigger background fetch for ALL teams (non-blocking)
          // This will populate the all-teams rankings cache with actual ranks (1-30)
          console.warn(`[Shot Chart Enhanced] ⚠️ No cached rankings found. Triggering background fetch for all 30 teams to calculate ranks...`);
          
          // Trigger all-teams rankings endpoint in background (non-blocking)
          // This will calculate ranks by comparing all teams
          // Works in both dev and production - uses Supabase cache if available
          const host = request.headers.get('host') || 'localhost:3000';
          const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
          const rankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}`;
          
          // Don't await - let it run in background (this can take 30-60 seconds)
          // In production, this will use Supabase cache if available, avoiding timeouts
          fetch(rankingsUrl).catch(err => {
            console.warn(`[Shot Chart Enhanced] Background all-teams rankings fetch failed:`, err.message);
          });
        }
      }
    } catch (err) {
      console.error(`[Shot Chart Enhanced] ⚠️ Error fetching defense rankings (non-fatal):`, err);
      // Continue without rankings - they're optional
    }

    // Note: Opponent defense data is now handled via rankings (see defenseRankings above)
    // The old per-team defense fetching has been deprecated in favor of league-wide rankings
    const opponentDefense = null; // Deprecated, keeping for backwards compatibility

    // Add opponent defense rankings if available
    let opponentRankings = null;
    if (opponentTeam && opponentTeam !== 'N/A' && defenseRankings && defenseRankings[opponentTeam]) {
      opponentRankings = defenseRankings[opponentTeam];
      console.log(`[Shot Chart Enhanced] ✅ Added rankings for ${opponentTeam}:`, opponentRankings);
    }

    const response = {
      playerId: nbaPlayerId,
      originalPlayerId: originalPlayerId !== nbaPlayerId ? originalPlayerId : undefined,
      season: seasonStr,
      shotZones,
      opponentTeam,
      opponentDefense,
      opponentRankings, // Rankings for opponent team (rank 1 = best defense)
      cachedAt: new Date().toISOString()
    };

    // Cache the result in both Supabase (persistent) and in-memory
    await setNBACache(cacheKey, 'shot_chart', response, CACHE_TTL.TRACKING_STATS);
    cache.set(cacheKey, response, CACHE_TTL.TRACKING_STATS);
    
    console.log(`[Shot Chart Enhanced] 💾 Cached response for player ${nbaPlayerId} (original: ${originalPlayerId}), zones:`, {
      restrictedArea: response.shotZones.restrictedArea.fga,
      paint: response.shotZones.paint.fga,
      midRange: response.shotZones.midRange.fga,
      leftCorner3: response.shotZones.leftCorner3.fga,
      rightCorner3: response.shotZones.rightCorner3.fga,
      aboveBreak3: response.shotZones.aboveBreak3.fga,
    });

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Shot Chart Enhanced] Error:', error);
    
    // On timeout, try to return cached data if available
    if ((error.message?.includes('timeout') || error.name === 'AbortError') && cacheKey) {
      const cached = cache.get<any>(cacheKey);
      if (cached) {
        console.log(`[Shot Chart Enhanced] ⚠️ Timeout occurred, returning cached data for player ${nbaPlayerId}`);
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
    
    if (error.message?.includes('timeout') || error.name === 'AbortError') {
      errorMessage = 'Request timed out - NBA API is slow to respond. Please try again.';
      errorType = 'TimeoutError';
    } else if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
      errorMessage = 'Network error - Unable to reach NBA API. Please check your connection.';
      errorType = 'NetworkError';
    } else if (error.message?.includes('NBA API 4')) {
      errorMessage = 'NBA API returned an error. The player data may not be available.';
      errorType = 'APIError';
    } else if (error.message?.includes('NBA API 5')) {
      errorMessage = 'NBA API server error. Please try again in a few moments.';
      errorType = 'ServerError';
    } else if (error.message) {
      errorMessage = error.message;
    }
    
    const isProduction = process.env.NODE_ENV === 'production';
    const errorDetails = isProduction 
      ? {
          error: errorMessage,
          type: errorType,
          // Include original message for debugging but sanitized
          originalError: error.message?.substring(0, 100) || 'Unknown error',
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

