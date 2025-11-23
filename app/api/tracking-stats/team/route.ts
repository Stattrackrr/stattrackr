// app/api/tracking-stats/team/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
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

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  const isProduction = process.env.NODE_ENV === 'production';
  
  // Aggressive timeouts: 5s in dev, 8s in production (fail fast, rely on cache)
  // No retries in production, 1 retry max in dev
  const actualTimeout = isProduction 
    ? Math.min(timeout, 8000) // 8s max in production - fail fast
    : Math.min(timeout, 5000); // 5s max in dev - fail fast
  const actualRetries = isProduction ? 0 : Math.min(retries, 1); // 0 retries in production, 1 max in dev
  
  for (let attempt = 0; attempt <= actualRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      console.log(`[Team Tracking Stats] Fetching NBA API (attempt ${attempt + 1}/${retries + 1}): ${url.substring(0, 100)}...`);
      
      const response = await fetch(url, {
        headers: NBA_HEADERS,
        signal: controller.signal,
        cache: 'no-store',
        redirect: 'follow'
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const text = await response.text();
        const errorMsg = `NBA API ${response.status}: ${response.statusText}`;
        console.error(`[Team Tracking Stats] NBA API error ${response.status} (attempt ${attempt + 1}/${actualRetries + 1}):`, text.slice(0, 500));
        
        // Retry on 5xx errors or 429 (rate limit)
        if ((response.status >= 500 || response.status === 429) && attempt < actualRetries) {
          const delay = 1000 * (attempt + 1);
          console.log(`[Team Tracking Stats] Retrying after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      const data = await response.json();
      console.log(`[Team Tracking Stats] ✅ Successfully fetched NBA API data`);
      return data;
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error(`Request timeout after ${actualTimeout}ms`);
        if (attempt < actualRetries) {
          console.log(`[Team Tracking Stats] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNRESET')) {
        lastError = error;
        if (attempt < actualRetries) {
          console.log(`[Team Tracking Stats] Network error on attempt ${attempt + 1}: ${error.message}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
      }
      
      // Log the error for debugging
      console.error(`[Team Tracking Stats] Fetch error (attempt ${attempt + 1}):`, {
        name: error.name,
        message: error.message,
        isProduction,
      });
      
      throw error;
    }
  }
  
  throw lastError || new Error('Failed after retries');
}

// NBA Team ID mapping (abbreviation to ID)
const NBA_TEAM_IDS: Record<string, string> = {
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
 * Deep equality check for comparing old vs new data
 */
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  
  for (const key of keysA) {
    if (key === '__cache_metadata') continue; // Skip metadata
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  
  return true;
}

/**
 * Refresh tracking stats in background
 * Fetches new data, compares with old, updates if different
 */
async function refreshTrackingStatsInBackground(
  team: string,
  season: number,
  category: string,
  opponentTeam: string | null,
  cacheKey: string
): Promise<void> {
  try {
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
    const opponentTeamId = opponentTeam && NBA_TEAM_IDS[opponentTeam] 
      ? NBA_TEAM_IDS[opponentTeam] 
      : "0";
    
    const params = new URLSearchParams({
      College: "",
      Conference: "",
      Country: "",
      DateFrom: "",
      DateTo: "",
      Division: "",
      DraftPick: "",
      DraftYear: "",
      GameScope: "",
      Height: "",
      LastNGames: "0",
      LeagueID: "00",
      Location: "",
      Month: "0",
      OpponentTeamID: opponentTeamId,
      Outcome: "",
      PORound: "0",
      PerMode: "PerGame",
      PlayerExperience: "",
      PlayerOrTeam: "Player",
      PlayerPosition: "",
      PtMeasureType: ptMeasureType,
      Season: seasonStr,
      SeasonSegment: "",
      SeasonType: "Regular Season",
      StarterBench: "",
      TeamID: "0",
      VsConference: "",
      VsDivision: "",
      Weight: "",
    });

    const url = `${NBA_STATS_BASE}/leaguedashptstats?${params.toString()}`;
    const data = await fetchNBAStats(url);

    if (!data?.resultSets?.[0]) {
      console.warn(`[Team Tracking Stats] Background refresh: No resultSets for ${team} ${category}`);
      return;
    }

    const resultSet = data.resultSets[0];
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];

    const playerIdIdx = headers.indexOf('PLAYER_ID');
    const playerNameIdx = headers.indexOf('PLAYER_NAME');
    const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');

    if (playerIdIdx === -1 || playerNameIdx === -1) {
      console.warn(`[Team Tracking Stats] Background refresh: Missing columns for ${team} ${category}`);
      return;
    }

    const teamPlayers = rows
      .filter((row: any[]) => row[teamAbbrIdx] === team)
      .map((row: any[]) => {
        const stats: any = {};
        headers.forEach((header: string, idx: number) => {
          stats[header] = row[idx];
        });

        const player: any = {
          playerId: String(stats.PLAYER_ID),
          playerName: stats.PLAYER_NAME,
          gp: stats.GP || 0,
        };

        if (category === 'passing') {
          player.potentialAst = stats.POTENTIAL_AST;
          player.ast = stats.AST_ADJ || stats.AST;
          player.astPtsCreated = stats.AST_POINTS_CREATED || stats.AST_PTS_CREATED;
          player.passesMade = stats.PASSES_MADE;
          player.astToPct = stats.AST_TO_PASS_PCT_ADJ || stats.AST_TO_PASS_PCT;
        } else {
          player.rebChances = stats.REB_CHANCES;
          player.reb = stats.REB;
          player.rebChancePct = stats.REB_CHANCE_PCT;
          player.rebContest = stats.REB_CONTEST;
          player.rebUncontest = stats.REB_UNCONTEST;
          player.avgRebDist = stats.AVG_REB_DIST;
          player.drebChances = stats.DREB_CHANCES;
          player.drebChancePct = stats.DREB_CHANCE_PCT;
          player.avgDrebDist = stats.AVG_DREB_DIST;
        }

        return player;
      });

    const newPayload = { 
      team,
      season: seasonStr,
      category,
      players: teamPlayers,
      opponentTeam: opponentTeam || undefined,
      cachedAt: new Date().toISOString()
    };

    // Get old data for comparison
    const oldCached = await getNBACache<any>(cacheKey);
    const hasChanged = !oldCached || !deepEqual(oldCached, newPayload);
    
    if (hasChanged) {
      console.log(`[Team Tracking Stats] ✅ Background refresh: New data detected for ${team} ${category}, updating cache...`);
      await setNBACache(cacheKey, 'team_tracking', newPayload, CACHE_TTL.TRACKING_STATS);
      cache.set(cacheKey, newPayload, CACHE_TTL.TRACKING_STATS);
    } else {
      console.log(`[Team Tracking Stats] ℹ️ Background refresh: No changes for ${team} ${category}, updating TTL only`);
      await setNBACache(cacheKey, 'team_tracking', newPayload, CACHE_TTL.TRACKING_STATS);
      cache.set(cacheKey, newPayload, CACHE_TTL.TRACKING_STATS);
    }
  } catch (error: any) {
    console.error(`[Team Tracking Stats] Background refresh failed for ${team} ${category}:`, error);
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    const category = searchParams.get('category') || 'passing';
    const opponentTeam = searchParams.get('opponentTeam');
    const forceRefresh = searchParams.get('refresh') === '1';

    if (!team) {
      return NextResponse.json(
        { error: 'Team abbreviation is required' },
        { status: 400 }
      );
    }

    // Build cache key (include opponent if filtering)
    const cacheKey = opponentTeam 
      ? `tracking_stats_${team.toUpperCase()}_${season}_${category}_vs_${opponentTeam.toUpperCase()}`
      : getCacheKey.trackingStats(team, season, category);
    
    // Try to serve from cache first (for both all games and opponent-specific)
    if (!forceRefresh) {
      // Try Supabase cache first (persistent, shared across instances)
      let cached = await getNBACache<any>(cacheKey);
      let cacheSource = 'supabase';
      
      // Fallback to in-memory cache
      if (!cached) {
        cached = cache.get<any>(cacheKey);
        cacheSource = 'memory';
      }
      
      if (cached) {
        const filterSuffix = opponentTeam ? ` vs ${opponentTeam}` : '';
        
        // Check if data is stale (older than 24 hours for daily updates)
        const cacheMetadata = (cached as any).__cache_metadata;
        const isStale = cacheMetadata?.updated_at 
          ? (Date.now() - new Date(cacheMetadata.updated_at).getTime()) > (24 * 60 * 60 * 1000)
          : false;
        
        // If stale, trigger background refresh but return old data immediately
        if (isStale && process.env.NODE_ENV !== 'production') {
          console.log(`[Team Tracking Stats] ⚠️ Cache is stale (older than 24h) for ${team} ${category}${filterSuffix}, refreshing in background...`);
          
          // Trigger background refresh (don't await)
          refreshTrackingStatsInBackground(team, season, category, opponentTeam, cacheKey).catch(err => {
            console.error(`[Team Tracking Stats] Background refresh failed:`, err);
          });
        }
        
        // Remove metadata before returning
        if ((cached as any).__cache_metadata) {
          delete (cached as any).__cache_metadata;
        }
        
        console.log(`[Team Tracking Stats] ✅ Cache hit (${cacheSource}${isStale ? ', stale' : ''}) for ${team} ${category}${filterSuffix} (season ${season})`);
        return NextResponse.json(cached, {
          status: 200,
          headers: {
            'X-Cache-Status': isStale ? 'STALE' : 'HIT',
            'X-Cache-Source': cacheSource,
            'X-Refresh-In-Progress': isStale ? 'true' : 'false',
            'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800' // 24h cache, 48h stale
          }
        });
      }
      
      const filterSuffix = opponentTeam ? ` vs ${opponentTeam}` : '';
      console.log(`[Team Tracking Stats] ⚠️ Cache miss for ${team} ${category}${filterSuffix} - falling back to API`);
      
      // If no cache, try to fetch from NBA API (even in production with short timeout)
      // If that fails, check for stale cache
      if (!forceRefresh && process.env.NODE_ENV === 'production') {
        // Try to fetch with short timeout first
        console.log(`[Team Tracking Stats] ⚠️ No cache available in production. Attempting API fetch with short timeout...`);
        // Continue to fetch below - don't return early
      }

      // In development, continue to fetch from NBA API even if cache is empty
      if (!forceRefresh) {
        const filterSuffix = opponentTeam ? ` vs ${opponentTeam}` : '';
        console.log(`[Team Tracking Stats] No cache found, fetching from NBA API for ${team} ${category}${filterSuffix}, season ${season}`);
      }
    }

    const filterSuffix = opponentTeam ? ` vs ${opponentTeam}` : '';
    console.log(`[Team Tracking Stats] Fetching ${category} stats for ${team}${filterSuffix}, season ${season}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    
    // Determine which endpoint to use based on category
    const ptMeasureType = category === 'passing' ? 'Passing' : 'Rebounding';
    
    // Get opponent team ID if filtering by opponent
    const opponentTeamId = opponentTeam && NBA_TEAM_IDS[opponentTeam] 
      ? NBA_TEAM_IDS[opponentTeam] 
      : "0";
    
    // Fetch league-wide stats
    const params = new URLSearchParams({
      College: "",
      Conference: "",
      Country: "",
      DateFrom: "",
      DateTo: "",
      Division: "",
      DraftPick: "",
      DraftYear: "",
      GameScope: "",
      Height: "",
      LastNGames: "0",
      LeagueID: "00",
      Location: "",
      Month: "0",
      OpponentTeamID: opponentTeamId,
      Outcome: "",
      PORound: "0",
      PerMode: "PerGame",
      PlayerExperience: "",
      PlayerOrTeam: "Player",
      PlayerPosition: "",
      PtMeasureType: ptMeasureType,
      Season: seasonStr,
      SeasonSegment: "",
      SeasonType: "Regular Season",
      StarterBench: "",
      TeamID: "0",
      VsConference: "",
      VsDivision: "",
      Weight: "",
    });

    const url = `${NBA_STATS_BASE}/leaguedashptstats?${params.toString()}`;
    console.log(`[Team Tracking Stats] Fetching: ${url}`);

    let data;
    try {
      data = await fetchNBAStats(url);
    } catch (error: any) {
      console.error(`[Team Tracking Stats] NBA API fetch error:`, error.message);
      
      // If fetch fails, check if we have any cached data (even expired) to return
      try {
        const { createClient } = await import('@supabase/supabase-js');
        
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });
          
          // Get cache even if expired (for this specific cache key)
          const { data: staleData } = await supabaseAdmin
            .from('nba_api_cache')
            .select('data')
            .eq('cache_key', cacheKey)
            .single();
          
          if (staleData?.data && staleData.data.players && Array.isArray(staleData.data.players)) {
            console.log(`[Team Tracking Stats] ⚠️ Returning stale cached data due to API failure`);
            return NextResponse.json({
              ...staleData.data,
              error: 'Using cached data - fresh data unavailable',
              stale: true
            }, { status: 200 });
          }
          
          // Also check for cache without opponent team as fallback
          if (opponentTeam) {
            const cacheKeyNoOpponent = `tracking_stats_${team.toUpperCase()}_${season}_${category}`;
            const { data: staleDataNoOpp } = await supabaseAdmin
              .from('nba_api_cache')
              .select('data')
              .eq('cache_key', cacheKeyNoOpponent)
              .single();
            
            if (staleDataNoOpp?.data && staleDataNoOpp.data.players && Array.isArray(staleDataNoOpp.data.players)) {
              console.log(`[Team Tracking Stats] ⚠️ Returning stale cached data (without opponent) due to API failure`);
              return NextResponse.json({
                ...staleDataNoOpp.data,
                error: 'Using cached data (all games) - opponent-specific data unavailable',
                stale: true
              }, { status: 200 });
            }
          }
        }
      } catch (staleError) {
        console.warn(`[Team Tracking Stats] Could not retrieve stale cache:`, staleError);
      }
      
      // If no stale cache, return empty data
      const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
      return NextResponse.json({
        team,
        season: seasonStr,
        category,
        players: [],
        error: opponentTeam 
          ? `No stats available for ${team} vs ${opponentTeam} this season. The teams may not have played yet, or the data hasn't been cached.`
          : 'NBA API unreachable - data will be available once cache is populated',
        cachedAt: new Date().toISOString()
      }, { status: 200 });
    }

    if (!data?.resultSets?.[0]) {
      console.warn("[Team Tracking Stats] No resultSets in response");
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    const resultSet = data.resultSets[0];
    const headers = resultSet.headers || [];
    const rows = resultSet.rowSet || [];

    // Find column indices
    const playerIdIdx = headers.indexOf('PLAYER_ID');
    const playerNameIdx = headers.indexOf('PLAYER_NAME');
    const teamIdIdx = headers.indexOf('TEAM_ID');
    const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');
    const gpIdx = headers.indexOf('GP');

    if (playerIdIdx === -1 || playerNameIdx === -1) {
      console.warn("[Team Tracking Stats] Missing required columns");
      return NextResponse.json({ players: [] }, { status: 200 });
    }

    // Filter for the specific team and map to our format
    const teamPlayers = rows
      .filter((row: any[]) => {
        const teamAbbr = row[teamAbbrIdx];
        return teamAbbr === team;
      })
      .map((row: any[]) => {
        const stats: any = {};
        headers.forEach((header: string, idx: number) => {
          stats[header] = row[idx];
        });

        const player: any = {
          playerId: String(stats.PLAYER_ID),
          playerName: stats.PLAYER_NAME,
          gp: stats.GP || 0,
        };

        if (category === 'passing') {
          player.potentialAst = stats.POTENTIAL_AST;
          player.ast = stats.AST_ADJ || stats.AST;
          player.astPtsCreated = stats.AST_POINTS_CREATED || stats.AST_PTS_CREATED;
          player.passesMade = stats.PASSES_MADE;
          player.astToPct = stats.AST_TO_PASS_PCT_ADJ || stats.AST_TO_PASS_PCT;
        } else {
          player.rebChances = stats.REB_CHANCES;
          player.reb = stats.REB;
          player.rebChancePct = stats.REB_CHANCE_PCT;
          player.rebContest = stats.REB_CONTEST;
          player.rebUncontest = stats.REB_UNCONTEST;
          player.avgRebDist = stats.AVG_REB_DIST;
          player.drebChances = stats.DREB_CHANCES;
          player.drebChancePct = stats.DREB_CHANCE_PCT;
          player.avgDrebDist = stats.AVG_DREB_DIST;
        }

        return player;
      });

    console.log(`[Team Tracking Stats] Found ${teamPlayers.length} players for ${team}`);

    const responsePayload = { 
      team,
      season: seasonStr,
      category,
      players: teamPlayers,
      opponentTeam: opponentTeam || undefined, // Include opponent in response if filtering
      cachedAt: new Date().toISOString()
    };

    // Check if we have old data to compare
    const oldCached = await getNBACache<any>(cacheKey);
    const hasChanged = oldCached && !deepEqual(oldCached, responsePayload);
    
    if (hasChanged) {
      console.log(`[Team Tracking Stats] ✅ New data detected for ${team} ${category}${filterSuffix}, updating cache...`);
    } else if (oldCached) {
      console.log(`[Team Tracking Stats] ℹ️ No changes detected for ${team} ${category}${filterSuffix}, updating TTL only`);
    }

    // Cache the result (both all games and opponent-specific)
    // Store in both Supabase (persistent, shared across all users) and in-memory
    // The upsert will replace old entry, effectively deleting it
    await setNBACache(cacheKey, 'team_tracking', responsePayload, CACHE_TTL.TRACKING_STATS);
    cache.set(cacheKey, responsePayload, CACHE_TTL.TRACKING_STATS);
    console.log(`[Team Tracking Stats] 💾 Cached ${team} ${category}${filterSuffix} in Supabase + memory for ${CACHE_TTL.TRACKING_STATS} minutes (available instantly for all users)`);

    return NextResponse.json(
      responsePayload,
      { 
        status: 200,
        headers: {
          'X-Cache-Status': 'MISS',
          'Cache-Control': 'public, s-maxage=86400, stale-while-revalidate=172800'
        }
      }
    );

  } catch (error: any) {
    console.error('[Team Tracking Stats] Error:', error);
    
    // Determine error type and provide helpful message
    let errorMessage = 'Failed to fetch team tracking stats';
    let errorType = error.name || 'UnknownError';
    
    if (error.message?.includes('timeout') || error.name === 'AbortError') {
      errorMessage = 'Request timed out - NBA API is slow to respond. Please try again.';
      errorType = 'TimeoutError';
    } else if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
      errorMessage = 'Network error - Unable to reach NBA API. Please check your connection.';
      errorType = 'NetworkError';
    } else if (error.message?.includes('NBA API 4')) {
      errorMessage = 'NBA API returned an error. The team data may not be available.';
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

