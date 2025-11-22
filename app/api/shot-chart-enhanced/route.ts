// app/api/shot-chart-enhanced/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL, getCacheKey } from '@/lib/cache';
import { getNbaStatsId } from '@/lib/playerIdMapping';

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
  
  // Use longer timeout in production (Vercel Pro allows 60s, so use 50s max to leave buffer)
  const actualTimeout = isProduction ? Math.max(timeout, 50000) : timeout;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), actualTimeout);

    try {
      console.log(`[Shot Chart Enhanced] Fetching NBA API (attempt ${attempt + 1}/${retries + 1}): ${url.substring(0, 100)}...`);
      
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
        console.error(`[Shot Chart Enhanced] NBA API error ${response.status} (attempt ${attempt + 1}/${retries + 1}):`, text.slice(0, 500));
        
        // Don't retry on 4xx errors (client errors) except 429 (rate limit)
        if (response.status === 429 || (response.status >= 500 && attempt < retries)) {
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
        if (attempt < retries) {
          console.log(`[Shot Chart Enhanced] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND') || error.message?.includes('ECONNRESET')) {
        lastError = error;
        if (attempt < retries) {
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
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const opponentTeam = searchParams.get('opponentTeam');
    const season = parseInt(searchParams.get('season') || '2025');
    const bypassCache = searchParams.get('bypassCache') === 'true';

    if (!playerId) {
      return NextResponse.json(
        { error: 'Player ID is required' },
        { status: 400 }
      );
    }

    // Auto-convert BallDontLie ID to NBA Stats ID if needed
    let nbaPlayerId = playerId;
    const originalPlayerId = playerId;
    
    // Try to convert any ID format using the smart detection
    console.log(`[Shot Chart Enhanced] Received player ID: ${playerId} (length: ${playerId.length})`);
    
    // Validate player ID format (should be 6-9 digits for NBA Stats API)
    if (playerId.length > 9) {
      console.error(`[Shot Chart Enhanced] ❌ Invalid player ID: ${playerId} (too long, max 9 digits)`);
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
    
    const converted = getNbaStatsId(playerId);
    
    if (converted && converted !== playerId) {
      // Conversion happened
      nbaPlayerId = converted;
      console.log(`[Shot Chart Enhanced] ✅ Converted ${playerId} → ${nbaPlayerId}`);
    } else if (converted === playerId) {
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

    // Check cache (unless bypassed) - use NBA ID for cache key
    cacheKey = `shot_enhanced_${nbaPlayerId}_${opponentTeam || 'none'}_${season}`;
    const cached = !bypassCache ? cache.get<any>(cacheKey) : null;
    
    if (cached) {
      console.log(`[Shot Chart Enhanced] ✅ Cache hit for player ${nbaPlayerId} (original: ${originalPlayerId}), zones:`, {
        restrictedArea: cached.shotZones?.restrictedArea?.fga || 0,
        paint: cached.shotZones?.paint?.fga || 0,
        midRange: cached.shotZones?.midRange?.fga || 0,
        leftCorner3: cached.shotZones?.leftCorner3?.fga || 0,
        rightCorner3: cached.shotZones?.rightCorner3?.fga || 0,
        aboveBreak3: cached.shotZones?.aboveBreak3?.fga || 0,
      });
      return NextResponse.json(cached, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }

    console.log(`[Shot Chart Enhanced] Fetching for player ${nbaPlayerId} (original: ${originalPlayerId}), season ${season}`);

    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;

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
    
    // Use 40s timeout (leaving 20s buffer for Vercel overhead)
    const playerData = await fetchNBAStats(playerUrl, 40000);
    console.log(`[Shot Chart Enhanced] Player data received:`, playerData?.resultSets?.length, 'result sets');

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

    // Fetch league-wide defense rankings (all 30 teams)
    // This is optional - if it fails, we'll just not show rankings
    let defenseRankings = null;
    try {
      const rankingsCacheKey = `defense_rankings_${season}`;
      const cachedRankings = cache.get(rankingsCacheKey);
      
      if (cachedRankings) {
        console.log(`[Shot Chart Enhanced] ✅ Using cached defense rankings`);
        defenseRankings = cachedRankings;
      } else {
        console.log(`[Shot Chart Enhanced] Fetching defense rankings for all 30 teams...`);
        const host = request.headers.get('host') || 'localhost:3000';
        const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
        const rankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${season}`;
        
        // Add 10 second timeout for rankings fetch
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);
        
        try {
          const rankingsResponse = await fetch(rankingsUrl, { signal: controller.signal });
          clearTimeout(timeoutId);
          
          if (rankingsResponse.ok) {
            const rankingsData = await rankingsResponse.json();
            defenseRankings = rankingsData.rankings;
            cache.set(rankingsCacheKey, defenseRankings, 1440); // Cache for 24h
            console.log(`[Shot Chart Enhanced] ✅ Fetched rankings for ${Object.keys(defenseRankings || {}).length} teams`);
          } else {
            console.warn(`[Shot Chart Enhanced] ⚠️ Rankings API returned ${rankingsResponse.status}`);
          }
        } catch (fetchErr: any) {
          clearTimeout(timeoutId);
          if (fetchErr.name === 'AbortError') {
            console.warn(`[Shot Chart Enhanced] ⚠️ Rankings fetch timed out - continuing without rankings`);
          } else {
            throw fetchErr;
          }
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

    // Cache the result
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

