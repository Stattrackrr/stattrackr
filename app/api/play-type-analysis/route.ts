// app/api/play-type-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { getNbaStatsId, convertNbaToBdlId } from '@/lib/playerIdMapping';
import { requestDeduplicator } from '@/lib/requestDeduplication';
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

// Play type mapping - matches NBA API values
const PLAY_TYPES = [
  { key: 'PRBallHandler', displayName: 'PNR Ball Handler' },
  { key: 'Transition', displayName: 'Transition' },
  { key: 'Spotup', displayName: 'Spot Up' },
  { key: 'OffScreen', displayName: 'Off Screen' },
  { key: 'Isolation', displayName: 'Isolation' },
  { key: 'Postup', displayName: 'Post Up' },
  { key: 'Cut', displayName: 'Cut' },
  { key: 'Handoff', displayName: 'Handoff' },
  { key: 'Misc', displayName: 'Misc' },
  { key: 'PRRollman', displayName: 'PNR Roll Man' },
  { key: 'OffRebound', displayName: 'Putbacks' },
];

async function fetchNBAStats(url: string, timeout = 20000, retries = 2) {
  let lastError: Error | null = null;
  const isProduction = process.env.NODE_ENV === 'production';
  
  const actualTimeout = Math.max(4000, Math.min(timeout, 30000));
  const actualRetries = Math.max(0, Math.min(retries, 2));
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
        const text = await response.text().catch(() => '');
        const errorMsg = `NBA API ${response.status}`;
        console.error(`[Play Type Analysis] NBA API error ${response.status} (attempt ${attempt + 1}/${maxAttempts}):`, text.slice(0, 200));
        
        // Don't retry on 4xx errors (client errors) except 429 (rate limit)
        if (response.status === 429 || (response.status >= 500 && attempt < actualRetries)) {
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1))); // Exponential backoff
          lastError = new Error(errorMsg);
          continue;
        }
        
        throw new Error(errorMsg);
      }

      return await response.json();
    } catch (error: any) {
      clearTimeout(timeoutId);
      
      if (error.name === 'AbortError') {
        lastError = new Error('Request timeout');
        if (attempt < actualRetries) {
          console.log(`[Play Type Analysis] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
        lastError = error;
        if (attempt < actualRetries) {
          console.log(`[Play Type Analysis] Network error on attempt ${attempt + 1}, retrying...`);
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
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    let opponentTeam = searchParams.get('opponentTeam');
    const season = parseInt(searchParams.get('season') || currentNbaSeason().toString());
    
    // Normalize opponent team abbreviation (ensure uppercase)
    if (opponentTeam && opponentTeam !== 'N/A') {
      opponentTeam = opponentTeam.toUpperCase();
    }

    if (!playerId) {
      return NextResponse.json(
        { error: 'Player ID is required' },
        { status: 400 }
      );
    }

    let seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const bypassCache = searchParams.get('bypassCache') === 'true';
    // Cache key WITHOUT opponent - player play types are the same for all opponents
    // Opponent only affects defensive rankings, which we add separately
    const cacheKey = `playtype_analysis_${playerId}_${season}`;
    
    // Check cache unless bypassed
    // We'll use cached data for play types with values > 0, and retry 0.0 values
    let cachedData: any = null;
    let zeroValuePlayTypes: any[] = [];
    let hasFreeThrows = false;
    
    if (!bypassCache) {
      // Try Supabase cache first (persistent, shared across instances)
      // Use longer timeout for large cache entries
      cachedData = await getNBACache<any>(cacheKey, {
        restTimeoutMs: 20000,
        jsTimeoutMs: 20000,
      });
      
      // Fallback to in-memory cache
      if (!cachedData) {
        cachedData = cache.get<any>(cacheKey);
      }
      if (cachedData) {
        console.log(`[Play Type Analysis] ✅ Found cached data for player ${playerId}, playTypes count: ${cachedData.playTypes?.length || 0}`);
        // Check if we have any play types with 0.0 that need retrying
        zeroValuePlayTypes = cachedData.playTypes?.filter((pt: any) => pt.points === 0) || [];
        // Check if FreeThrows is missing (old cache won't have it)
        hasFreeThrows = cachedData.playTypes?.some((pt: any) => pt.playType === 'FreeThrows' || pt.playType === 'Free Throws') || false;
        
        if (zeroValuePlayTypes.length === 0 && hasFreeThrows) {
          // All play types have values and FreeThrows exists
          // Return cached data immediately, add defensive rankings if available (fast path)
          console.log(`[Play Type Analysis] ✅ Cache hit for player ${playerId} (all play types have values, including FreeThrows)`);
          
          // If opponent team is specified, check for defensive rankings (in-memory first, then Supabase)
          if (opponentTeam && opponentTeam !== 'N/A') {
            const defensiveRankingsCacheKey = `playtype_defensive_rankings_${seasonStr}`;
            
            // Check in-memory cache first (fastest)
            let rankings = cache.get<Record<string, Array<{ team: string; ppp: number }>>>(defensiveRankingsCacheKey);
            
            // If not in-memory, check Supabase (with shorter timeout for fast response)
            if (!rankings) {
              console.log(`[Play Type Analysis] Rankings not in-memory, checking Supabase...`);
              rankings = await getNBACache<Record<string, Array<{ team: string; ppp: number }>>>(defensiveRankingsCacheKey, {
                restTimeoutMs: 8000, // Shorter timeout for fast response
                jsTimeoutMs: 8000,
              });
              
              // If found in Supabase, also cache in-memory for next time
              if (rankings) {
                cache.set(defensiveRankingsCacheKey, rankings, CACHE_TTL.TRACKING_STATS);
                console.log(`[Play Type Analysis] ✅ Loaded rankings from Supabase and cached in-memory`);
              }
            }
            
            if (rankings) {
              // Add opponent ranks to cached response
              const normalizedOpponent = opponentTeam.toUpperCase();
              const updatedPlayTypes = cachedData.playTypes.map((pt: any) => {
                const playTypeKey = pt.playType === 'Free Throws' ? 'FreeThrows' : pt.playType;
                if (rankings![playTypeKey]) {
                  const ranking = rankings![playTypeKey].findIndex((r: any) => r.team.toUpperCase() === normalizedOpponent);
                  return {
                    ...pt,
                    oppRank: ranking >= 0 ? ranking + 1 : null
                  };
                }
                return pt;
              });
              
              console.log(`[Play Type Analysis] ✅ Added defensive rankings for ${opponentTeam}`);
              
              return NextResponse.json({
                ...cachedData,
                playTypes: updatedPlayTypes,
                opponentTeam: opponentTeam || null,
              }, {
                status: 200,
                headers: { 'X-Cache-Status': 'HIT' }
              });
            } else {
              console.log(`[Play Type Analysis] ⚠️ No defensive rankings found for ${opponentTeam}`);
            }
          }
          
          // Return cached data immediately (rankings will be added later if available)
          return NextResponse.json({
            ...cachedData,
            opponentTeam: opponentTeam || null,
          }, {
            status: 200,
            headers: { 'X-Cache-Status': 'HIT' }
          });
        } else {
          if (zeroValuePlayTypes.length > 0) {
            console.log(`[Play Type Analysis] ⚠️ Cache hit but ${zeroValuePlayTypes.length} play types have 0.0 - will retry those`);
          }
          if (!hasFreeThrows) {
            console.log(`[Play Type Analysis] ⚠️ Cache hit but FreeThrows missing (old cache) - will fetch FreeThrows`);
          }
        }
      } else {
        console.log(`[Play Type Analysis] ⚠️ No cached data found for player ${playerId} (cacheKey: ${cacheKey})`);
      }
    } else {
      console.log(`[Play Type Analysis] ⚠️ Cache bypassed for player ${playerId}`);
      // Clear the cache entry if bypassing
      cache.delete(cacheKey);
    }

    // Use request deduplication to prevent concurrent duplicate fetches
    // If multiple requests come in for the same player/season, they'll share the same fetch
    const dedupeKey = `playtype_fetch_${cacheKey}`;
    
    const fetchData = async () => {
      console.log(`[Play Type Analysis] Fetching data for player ${playerId}, opponent ${opponentTeam || 'all'}, season ${season}`);

      // Step 0: Get player info to know their team (for filtering)
      const nbaPlayerId = getNbaStatsId(playerId) || playerId;
      let playerTeamAbbr: string | null = null;
      let playerName: string | null = null;

      // Try to get player name from mapping first (fallback if API fails)
      const { getPlayerNameFromMapping } = await import('@/lib/playerIdMapping');
      const mappedName = getPlayerNameFromMapping(playerId) || getPlayerNameFromMapping(nbaPlayerId);
      if (mappedName) {
        playerName = mappedName;
        console.log(`[Play Type Analysis] Got player name from mapping: ${playerName}`);
      }

      try {
        const playerInfoParams = new URLSearchParams({
        LeagueID: '00',
        PlayerID: String(nbaPlayerId),
      });
      const playerInfoUrl = `${NBA_STATS_BASE}/commonplayerinfo?${playerInfoParams.toString()}`;
      const playerInfoData = await fetchNBAStats(playerInfoUrl, 3000); // Reduced timeout - not critical
      
      const playerInfoResultSet = playerInfoData?.resultSets?.[0];
      if (playerInfoResultSet) {
        const infoHeaders = playerInfoResultSet.headers || [];
        const infoRows = playerInfoResultSet.rowSet || [];
        
        if (infoRows.length > 0) {
          const row = infoRows[0];
          const teamAbbrIdx = infoHeaders.indexOf('TEAM_ABBREVIATION');
          const firstNameIdx = infoHeaders.indexOf('FIRST_NAME');
          const lastNameIdx = infoHeaders.indexOf('LAST_NAME');
          
          playerTeamAbbr = teamAbbrIdx >= 0 ? row[teamAbbrIdx] : null;
          const firstName = firstNameIdx >= 0 ? row[firstNameIdx] : '';
          const lastName = lastNameIdx >= 0 ? row[lastNameIdx] : '';
          const apiName = `${firstName} ${lastName}`.trim();
          
          // Use API name if available, otherwise keep mapped name
          if (apiName) {
            playerName = apiName;
          }
          
          console.log(`[Play Type Analysis] Player info: ${playerName}, Team: ${playerTeamAbbr}`);
        }
      }
      } catch (err) {
        console.warn(`[Play Type Analysis] Could not fetch player info:`, err);
        // If we have a mapped name, use it as fallback
        if (!playerName && mappedName) {
          playerName = mappedName;
          console.log(`[Play Type Analysis] Using mapped name as fallback: ${playerName}`);
        }
      }

      // Step 1: Fetch player play type stats
      // The NBA website fetches each play type individually with PlayType parameter specified
      // We need to fetch each play type separately and then filter by player
      const playerPlayTypes: Record<string, any> = {};
      
      // Initialize all play types with 0 values so they all show up in results
      PLAY_TYPES.forEach(({ key }) => {
        playerPlayTypes[key] = {
          points: 0,
          possessions: 0,
          ppp: 0,
          ftPossPct: 0,
        };
      });
      
      let totalPoints = 0;
      let playerRowsFound = 0;
      let playerHeaders: string[] = [];
      let foundData = false;
      
      // Use only the specified season (no fallback)
      console.log(`[Play Type Analysis] Fetching play types for season ${seasonStr}...`);
      
      // Determine which play types need to be fetched
      // If cached, only fetch play types with 0.0 values or missing from cache
      const playTypesToFetch: string[] = [];
      const cachedPlayTypesMap = new Map<string, any>();
      
      if (cachedData?.playTypes) {
        console.log(`[Play Type Analysis] Processing ${cachedData.playTypes.length} cached play types`);
        cachedData.playTypes.forEach((pt: any) => {
          // Handle both 'FreeThrows' and 'Free Throws' keys
          const playTypeKey = pt.playType === 'Free Throws' ? 'FreeThrows' : pt.playType;
          cachedPlayTypesMap.set(playTypeKey, pt);
          // Fetch if value is 0.0 (need retry)
          if (pt.points === 0) {
            playTypesToFetch.push(playTypeKey);
            console.log(`[Play Type Analysis] Will retry ${playTypeKey} (cached value: 0.0)`);
          } else {
            console.log(`[Play Type Analysis] Using cached ${playTypeKey} (${pt.points} pts)`);
          }
        });
      }
      
      // Also fetch play types that aren't in cache at all
      PLAY_TYPES.forEach(({ key }) => {
        if (!cachedPlayTypesMap.has(key)) {
          playTypesToFetch.push(key);
          console.log(`[Play Type Analysis] Will fetch ${key} (not in cache)`);
        }
      });
      
      console.log(`[Play Type Analysis] Total play types to fetch: ${playTypesToFetch.length} (cached: ${cachedPlayTypesMap.size})`);
      
      // If no play types need fetching and we have cache, use cached data
      if (playTypesToFetch.length === 0 && cachedData) {
        // All play types are cached with values > 0, use cached data
        console.log(`[Play Type Analysis] ✅ All play types cached with values > 0`);
        return { response: cachedData, cacheStatus: 'HIT' };
      }
      
      // In production, try to fetch but with aggressive timeouts
      // If it fails, trigger background cache population
      if (!bypassCache && process.env.NODE_ENV === 'production' && playTypesToFetch.length > 0) {
        console.log(`[Play Type Analysis] ⚠️ Production mode: Will attempt NBA API calls with short timeouts. Missing ${playTypesToFetch.length} play types.`);
        // Continue to fetch below - don't return early
      }

      // In development, continue to fetch from NBA API even if cache is empty
      if (!cachedData && !bypassCache && playTypesToFetch.length === PLAY_TYPES.length) {
        console.log(`[Play Type Analysis] No cache found, fetching from NBA API for player ${playerId}, season ${season}`);
      }
      
      console.log(`[Play Type Analysis] Fetching ${playTypesToFetch.length} play types (${cachedData ? 'retrying 0.0 values' : 'all'})`);
      
    // Check for bulk cached player play type data first
    // Try Supabase cache first (persistent, shared across instances)
    const bulkPlayerDataCacheKey = `player_playtypes_bulk_${seasonStr}`;
    let bulkPlayerData = !bypassCache
      ? await getNBACache<Record<string, { headers: string[]; rows: any[] }>>(bulkPlayerDataCacheKey, {
          restTimeoutMs: 20000,
          jsTimeoutMs: 20000,
        })
      : null;
    
    // Fallback to in-memory cache
    if (!bulkPlayerData) {
      bulkPlayerData = !bypassCache ? cache.get<Record<string, { headers: string[]; rows: any[] }>>(bulkPlayerDataCacheKey) : null;
    }
    
    const allResults: Array<{ status: 'fulfilled' | 'rejected', value?: any, reason?: any }> = [];
    
    // Only use bulk cache if it exists and has substantial data, and we're not bypassing cache
    // Check if bulk cache has at least some play types with data
    const hasValidBulkCache = bulkPlayerData && Object.keys(bulkPlayerData || {}).length > 0 && 
      Object.values(bulkPlayerData).some((pt: any) => pt && pt.rows && Array.isArray(pt.rows) && pt.rows.length > 0);
    
    console.log(`[Play Type Analysis] Bulk cache check: exists=${!!bulkPlayerData}, keys=${bulkPlayerData ? Object.keys(bulkPlayerData).length : 0}, hasValidData=${hasValidBulkCache}, bypassCache=${bypassCache}`);
    
    if (hasValidBulkCache && !bypassCache) {
      console.log(`[Play Type Analysis] ✅ Using bulk cached player play type data (${bulkPlayerData ? Object.keys(bulkPlayerData).length : 0} play types cached)`);
      // Use cached bulk data - filter by play types we need
      playTypesToFetch.forEach((key) => {
        const cachedPlayTypeData = bulkPlayerData![key];
        if (cachedPlayTypeData && cachedPlayTypeData.rows && cachedPlayTypeData.rows.length > 0) {
          console.log(`[Play Type Analysis] Using cached ${key} data: ${cachedPlayTypeData.rows.length} players`);
          allResults.push({ 
            status: 'fulfilled', 
            value: { 
              key, 
              success: true, 
              rows: cachedPlayTypeData.rows || [], 
              headers: cachedPlayTypeData.headers || [] 
            } 
          });
        } else {
          console.log(`[Play Type Analysis] ⚠️ No cached data for ${key} in bulk cache, will fetch from API`);
          // Mark this play type to fetch from API
          allResults.push({ status: 'fulfilled', value: { key, success: false, rows: [], headers: [], needsApiFetch: true } });
        }
      });
    } else {
      // In production, skip API calls entirely if no cache
      if (process.env.NODE_ENV === 'production' && !bypassCache) {
        console.log(`[Play Type Analysis] ⚠️ Production mode: No bulk cache available. Skipping NBA API calls.`);
        // Return empty results for missing play types
        playTypesToFetch.forEach((key) => {
          allResults.push({ status: 'fulfilled', value: { key, success: false, rows: [], headers: [] } });
        });
      } else {
        console.log(`[Play Type Analysis] ⚠️ No bulk cached data found (or empty/invalid), fetching all from API...`);
        
        // Check if we should try fetching or just trigger background cache population
        const shouldTryFetch = !bypassCache && process.env.NODE_ENV === 'production' 
          ? playTypesToFetch.length <= 3 // Only try if 3 or fewer play types (to avoid timeout)
          : true; // Always try in dev
        
        if (!shouldTryFetch) {
          console.log(`[Play Type Analysis] ⚠️ Too many play types to fetch in production (${playTypesToFetch.length}). Triggering background cache population...`);
          
          // Trigger background cache population (non-blocking)
          const host = request.headers.get('host') || 'localhost:3000';
          const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
          const cacheUrl = `${protocol}://${host}/api/play-type-analysis?playerId=${playerId}&season=${season}&bypassCache=true`;
          
          // Don't await - let it run in background
          fetch(cacheUrl).catch(err => {
            console.warn(`[Play Type Analysis] Background cache population failed:`, err.message);
          });
          
          // Return empty response with loading message
          const emptyResponse = {
            playerId: parseInt(playerId),
            season: seasonStr,
            opponentTeam: opponentTeam || null,
            playTypes: PLAY_TYPES.map(({ key, displayName }) => ({
              playType: key,
              displayName,
              points: 0,
              possessions: 0,
              ppp: 0,
              percentage: 0,
              opponentRank: null,
            })),
            totalPoints: 0,
            error: 'Data is loading in the background. Please refresh in a few moments.',
            loading: true,
            cachedAt: new Date().toISOString()
          };
          return { response: emptyResponse, cacheStatus: 'MISS' };
        }
        
        // Fetch play types SEQUENTIALLY (one at a time) to avoid overwhelming the API
        // This is slower but more reliable - we'll cache partial results as we go
        for (let i = 0; i < playTypesToFetch.length; i++) {
        const key = playTypesToFetch[i];
        console.log(`[Play Type Analysis] Fetching ${key} (${i + 1}/${playTypesToFetch.length})...`);
        
        try {
          const playerParams = new URLSearchParams({
            LeagueID: '00',
            PerMode: 'PerGame',
            PlayerOrTeam: 'P',
            SeasonType: 'Regular Season',
            SeasonYear: seasonStr,
            PlayType: key,
            TypeGrouping: 'offensive',
          });

          const playerUrl = `${NBA_STATS_BASE}/synergyplaytypes?${playerParams.toString()}`;
          
          // Use shorter timeout in production (8s) to fail fast, longer in dev (15s)
          const timeout = process.env.NODE_ENV === 'production' ? 8000 : 15000;
          const playerData = await fetchNBAStats(playerUrl, timeout);
          const playerResultSet = playerData?.resultSets?.[0];
          
          if (!playerResultSet) {
            allResults.push({ status: 'fulfilled' as const, value: { key, success: false, rows: [], headers: [] } });
          } else {
            const playerRows = playerResultSet.rowSet || [];
            const headers = playerResultSet.headers || [];
            console.log(`[Play Type Analysis] ✅ ${key}: ${playerRows.length} rows`);
            
            allResults.push({ status: 'fulfilled' as const, value: { key, success: true, rows: playerRows, headers } });
          }
        } catch (err: any) {
          console.warn(`[Play Type Analysis] ❌ Error fetching ${key}:`, err.message);
          
          // If we're in production and this is one of the first few play types, trigger background cache
          if (process.env.NODE_ENV === 'production' && i === 0 && !bypassCache) {
            console.log(`[Play Type Analysis] ⚠️ First play type fetch failed in production. Triggering background cache population...`);
            
            const host = request.headers.get('host') || 'localhost:3000';
            const protocol = 'https';
            const cacheUrl = `${protocol}://${host}/api/play-type-analysis?playerId=${playerId}&season=${season}&bypassCache=true`;
            
            // Don't await - let it run in background
            fetch(cacheUrl).catch(fetchErr => {
              console.warn(`[Play Type Analysis] Background cache population failed:`, fetchErr.message);
            });
          }
          
          allResults.push({ status: 'fulfilled' as const, value: { key, success: false, rows: [], headers: [], error: err } });
        }
        
        // Small delay between requests to avoid overwhelming the API
        // Reduced to 500ms in dev (was 2s) - NBA API is slow but we can reduce delays
        if (i < playTypesToFetch.length - 1) {
          const delay = process.env.NODE_ENV === 'production' ? 2000 : 500; // 500ms in dev, 2s in prod
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
      }
    }
      
      const results = allResults;
      
      // Populate bulk cache if we fetched from API (for future requests)
      if (!hasValidBulkCache && results.length > 0) {
        const bulkCacheData: Record<string, { headers: string[]; rows: any[] }> = {};
        results.forEach((result) => {
          if (result.status === 'fulfilled' && result.value?.success && result.value?.rows?.length > 0) {
            const { key, rows, headers } = result.value;
            bulkCacheData[key] = { headers, rows };
          }
        });
        
        if (Object.keys(bulkCacheData).length > 0) {
          console.log(`[Play Type Analysis] 💾 Populating bulk cache with ${Object.keys(bulkCacheData).length} play types`);
          // Store in both Supabase (persistent, shared) and in-memory
          await setNBACache(bulkPlayerDataCacheKey, 'play_type_bulk', bulkCacheData, CACHE_TTL.TRACKING_STATS);
          cache.set(bulkPlayerDataCacheKey, bulkCacheData, CACHE_TTL.TRACKING_STATS);
        }
      }
      
      // Process results
      let seasonHeaders: string[] = [];
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const { key, success, rows, headers } = result.value;
          
          if (success && rows.length > 0) {
            foundData = true;
            
            // Set headers once
            if (seasonHeaders.length === 0 && headers.length > 0) {
              seasonHeaders = headers;
              playerHeaders = headers;
            }
            
            // Find column indices
            const playerIdIdx = seasonHeaders.indexOf('PLAYER_ID');
            const teamAbbrIdx = seasonHeaders.indexOf('TEAM_ABBREVIATION');
            const playerNameIdx = seasonHeaders.indexOf('PLAYER_NAME');
            const playTypeIdx = seasonHeaders.indexOf('PLAY_TYPE');
            const ptsIdx = seasonHeaders.indexOf('PTS');
            const possIdx = seasonHeaders.indexOf('POSS');
            const pppIdx = seasonHeaders.indexOf('PPP');
            const ftPossPctIdx = seasonHeaders.indexOf('FT_POSS_PCT');
            
            // Filter rows by player - MUST match by player ID, never fall back to just team
            let matchedRows: any[] = [];
            
            // First, try to filter by PLAYER_ID if available (REQUIRED)
            if (playerIdIdx >= 0 && nbaPlayerId) {
              const playerIdNum = parseInt(String(nbaPlayerId));
              matchedRows = rows.filter((row: any[]) => {
                const rowPlayerId = row[playerIdIdx];
                return rowPlayerId === playerIdNum || String(rowPlayerId) === String(nbaPlayerId);
              });
              
              // If ID match failed but we have player name, try matching by name as fallback
              // This handles cases where getNbaStatsId failed and we still have BDL ID
              if (matchedRows.length === 0 && playerName && playerNameIdx >= 0) {
                console.log(`[Play Type Analysis] ${key}: ID match failed (looking for ${nbaPlayerId}), trying name match: ${playerName}`);
                const nameParts = playerName.toLowerCase().split(' ').filter(p => p.length > 1);
                matchedRows = rows.filter((row: any[]) => {
                  const rowName = String(row[playerNameIdx] || '').toLowerCase();
                  return nameParts.every(part => rowName.includes(part));
                });
                
                if (matchedRows.length > 0) {
                  // If we found by name, also check team if available
                  if (playerTeamAbbr && teamAbbrIdx >= 0) {
                    const teamFiltered = matchedRows.filter((row: any[]) => {
                      const rowTeam = String(row[teamAbbrIdx] || '').toUpperCase();
                      return rowTeam === playerTeamAbbr.toUpperCase();
                    });
                    if (teamFiltered.length > 0) {
                      matchedRows = teamFiltered;
                      console.log(`[Play Type Analysis] ${key}: Found by name+team: ${matchedRows.length} matches`);
                    } else {
                      console.log(`[Play Type Analysis] ${key}: Found by name only: ${matchedRows.length} matches`);
                    }
                  } else {
                    console.log(`[Play Type Analysis] ${key}: Found by name only: ${matchedRows.length} matches`);
                  }
                }
              } else if (matchedRows.length > 0 && playerName && playerNameIdx >= 0) {
                // If we have player name, also filter by name to ensure we have the right player
                // This helps catch cases where player ID might match multiple players (shouldn't happen, but safety check)
                const nameParts = playerName.toLowerCase().split(' ').filter(p => p.length > 1);
                const nameFiltered = matchedRows.filter((row: any[]) => {
                  const rowName = String(row[playerNameIdx] || '').toLowerCase();
                  return nameParts.every(part => rowName.includes(part));
                });
                
                if (nameFiltered.length > 0) {
                  matchedRows = nameFiltered;
                  console.log(`[Play Type Analysis] ${key}: Filtered by name from ${matchedRows.length + nameFiltered.length - matchedRows.length} to ${matchedRows.length} matches`);
                }
              }
            } else if (playerName && playerNameIdx >= 0) {
              // Fallback: if we don't have player ID, try matching by name
              console.warn(`[Play Type Analysis] ${key}: No player ID available, trying name match: ${playerName}`);
              const nameParts = playerName.toLowerCase().split(' ').filter(p => p.length > 1);
              matchedRows = rows.filter((row: any[]) => {
                const rowName = String(row[playerNameIdx] || '').toLowerCase();
                return nameParts.every(part => rowName.includes(part));
              });
              
              if (matchedRows.length > 0 && playerTeamAbbr && teamAbbrIdx >= 0) {
                const teamFiltered = matchedRows.filter((row: any[]) => {
                  const rowTeam = String(row[teamAbbrIdx] || '').toUpperCase();
                  return rowTeam === playerTeamAbbr.toUpperCase();
                });
                if (teamFiltered.length > 0) {
                  matchedRows = teamFiltered;
                }
              }
            } else {
              // If we don't have player ID or name, we can't reliably match - log warning
              console.warn(`[Play Type Analysis] ${key}: No player ID or name available, cannot filter rows`);
            }
            
            // Log matching results
            if (matchedRows.length === 0) {
              console.log(`[Play Type Analysis] ❌ No data found for ${key} - Looking for: Player ID=${nbaPlayerId}, Name=${playerName}, Team=${playerTeamAbbr}`);
              console.log(`[Play Type Analysis]   Total rows from API: ${rows.length}`);
              // Log first few rows to see what players are in the data
              if (rows.length > 0 && playerNameIdx >= 0) {
                const sampleRows = rows.slice(0, 3);
                sampleRows.forEach((row: any[], idx: number) => {
                  const rowPlayerId = playerIdIdx >= 0 ? row[playerIdIdx] : 'N/A';
                  const rowName = row[playerNameIdx] || 'N/A';
                  const rowTeam = teamAbbrIdx >= 0 ? row[teamAbbrIdx] : 'N/A';
                  console.log(`[Play Type Analysis]   Sample row ${idx + 1}: ID=${rowPlayerId}, Name=${rowName}, Team=${rowTeam}`);
                });
              }
            } else {
              // Log what we found
              matchedRows.forEach((row: any[], idx: number) => {
                const rowPlayerId = playerIdIdx >= 0 ? row[playerIdIdx] : 'N/A';
                const rowName = playerNameIdx >= 0 ? row[playerNameIdx] : 'N/A';
                const rowTeam = teamAbbrIdx >= 0 ? row[teamAbbrIdx] : 'N/A';
                const rowPoints = ptsIdx >= 0 ? row[ptsIdx] : 0;
                console.log(`[Play Type Analysis] ✅ ${key} - Match ${idx + 1}: ID=${rowPlayerId}, Name=${rowName}, Team=${rowTeam}, Points=${rowPoints}`);
              });
            }
            
            // Process matched rows for this play type
            // IMPORTANT: Only use the FIRST match to avoid summing multiple team entries
            // If a player was traded, they may have entries for multiple teams, but we only want one
            if (matchedRows.length > 0) {
              const row = matchedRows[0]; // Use only the first match
              const points = row[ptsIdx] || 0;
              const possessions = row[possIdx] || 0;
              const ppp = row[pppIdx] || 0;
              const ftPossPct = row[ftPossPctIdx] || 0;
              
              // Log if we found multiple matches (player might have been traded)
              if (matchedRows.length > 1) {
                console.log(`[Play Type Analysis] ⚠️ Found ${matchedRows.length} matches for ${key}, using first match only`);
                // Log all matches to see what we're skipping
                matchedRows.forEach((r: any[], idx: number) => {
                  const team = r[teamAbbrIdx] || 'N/A';
                  const pts = r[ptsIdx] || 0;
                  console.log(`[Play Type Analysis]   Match ${idx + 1}: Team=${team}, Points=${pts}`);
                });
              }
              
              // Set data (don't add, just set - we only want one entry)
              // This will override any cached value, which is correct - fresh API data takes precedence
              playerPlayTypes[key].points = points;
              playerPlayTypes[key].possessions = possessions;
              playerPlayTypes[key].ppp = ppp;
              playerPlayTypes[key].ftPossPct = ftPossPct;
              
              if (points > 0) {
                totalPoints += points;
                playerRowsFound++;
                console.log(`[Play Type Analysis] ${key}: ${points} points (total now: ${totalPoints.toFixed(1)})`);
              } else {
                console.log(`[Play Type Analysis] ${key}: 0 points (player has no stats for this play type)`);
              }
            } else {
              // No match found - explicitly set to 0 (override any cached value)
              // This ensures that if the NBA website shows no stats, we also show 0
              playerPlayTypes[key].points = 0;
              playerPlayTypes[key].possessions = 0;
              playerPlayTypes[key].ppp = 0;
              playerPlayTypes[key].ftPossPct = 0;
              console.log(`[Play Type Analysis] ${key}: Set to 0 (no match found in API)`);
            }
          }
        } else {
          const key = playTypesToFetch[index] || 'unknown';
          console.warn(`[Play Type Analysis] Promise rejected for ${key}:`, result.reason);
        }
      });
      
      if (foundData && playerRowsFound > 0) {
        console.log(`[Play Type Analysis] ✅ Found data for season ${seasonStr} (${totalPoints.toFixed(1)} total points, ${playerRowsFound} rows)`);
      }
    
    if (!foundData || playerRowsFound === 0) {
      console.warn(`[Play Type Analysis] ⚠️ No player play type data found`);
    }

    // Step 2: Fetch team defensive stats for rankings (optional - don't fail if this times out)
    // Fetch each play type's defensive data individually (similar to player data)
    const playTypeRankings: Record<string, Array<{ team: string; ppp: number }>> = {};
    
    if (opponentTeam && opponentTeam !== 'N/A') {
      console.log(`[Play Type Analysis] 🔍 Checking for defensive rankings (opponent: ${opponentTeam}, season: ${seasonStr})...`);
      
      // Check cache for defensive rankings (league-wide, same for all players)
      const defensiveRankingsCacheKey = `playtype_defensive_rankings_${seasonStr}`;
      console.log(`[Play Type Analysis] Cache key: ${defensiveRankingsCacheKey}`);
      
      // Try Supabase cache first (persistent, shared across instances)
      let cachedRankings = await getNBACache<Record<string, Array<{ team: string; ppp: number }>>>(defensiveRankingsCacheKey, {
        restTimeoutMs: 20000,
        jsTimeoutMs: 20000,
      });
      console.log(`[Play Type Analysis] Supabase cache result: ${cachedRankings ? `found (${Object.keys(cachedRankings || {}).length} play types)` : 'not found'}`);
      
      // Fallback to in-memory cache
      if (!cachedRankings) {
        cachedRankings = cache.get<Record<string, Array<{ team: string; ppp: number }>>>(defensiveRankingsCacheKey);
        console.log(`[Play Type Analysis] In-memory cache result: ${cachedRankings ? `found (${Object.keys(cachedRankings || {}).length} play types)` : 'not found'}`);
      }
      
      if (cachedRankings) {
        const playTypeCount = Object.keys(cachedRankings).length;
        const expectedPlayTypes = PLAY_TYPES.length; // Should be 11
        const missingPlayTypes = PLAY_TYPES.filter(({ key }) => !cachedRankings[key]).map(({ key }) => key);
        
        console.log(`[Play Type Analysis] ✅ Using cached defensive rankings for season ${seasonStr} (${playTypeCount}/${expectedPlayTypes} play types)`);
        console.log(`[Play Type Analysis] Cached play types:`, Object.keys(cachedRankings));
        console.log(`[Play Type Analysis] Opponent team: ${opponentTeam}`);
        
        // Log sample teams from first play type to verify structure
        const firstPlayType = Object.keys(cachedRankings)[0];
        if (firstPlayType && cachedRankings[firstPlayType]?.length > 0) {
          const sampleTeams = cachedRankings[firstPlayType].slice(0, 3).map((r: any) => r.team).join(', ');
          console.log(`[Play Type Analysis] Sample teams from ${firstPlayType}: ${sampleTeams}`);
        }
        
        // If cache is incomplete, trigger background retry for missing play types
        if (playTypeCount < expectedPlayTypes && missingPlayTypes.length > 0) {
          console.warn(`[Play Type Analysis] ⚠️ Cache is incomplete! Missing ${missingPlayTypes.length} play types: ${missingPlayTypes.join(', ')}`);
          console.warn(`[Play Type Analysis] 🔄 Triggering background retry for missing play types...`);
          
          // Trigger cache endpoint in background to retry missing play types
          if (process.env.NODE_ENV === 'development') {
            const host = request.headers.get('host') || 'localhost:3000';
            const protocol = 'http';
            const cacheUrl = `${protocol}://${host}/api/cache/nba-league-data?season=${season}&retry=true`;
            
            // Don't await - let it run in background
            fetch(cacheUrl).catch(err => {
              console.warn(`[Play Type Analysis] Background cache retry failed:`, err.message);
            });
          }
        }
        
        Object.assign(playTypeRankings, cachedRankings);
        console.log(`[Play Type Analysis] Loaded ${Object.keys(playTypeRankings).length} play type rankings into memory`);
      } else {
        // No cached rankings - trigger background fetch (non-blocking)
        // This will populate the cache for future requests
        console.warn(`[Play Type Analysis] ⚠️ No cached defensive rankings found. Triggering background fetch for all play types...`);
        
        // Trigger cache endpoint in background (non-blocking)
        // This fetches defensive rankings for all 11 play types (takes ~2-3 minutes)
        if (process.env.NODE_ENV === 'development') {
          const host = request.headers.get('host') || 'localhost:3000';
          const protocol = 'http';
          const cacheUrl = `${protocol}://${host}/api/cache/nba-league-data?season=${season}`;
          
          // Don't await - let it run in background (this takes 2-3 minutes)
          fetch(cacheUrl).catch(err => {
            console.warn(`[Play Type Analysis] Background cache endpoint fetch failed:`, err.message);
          });
        }
        
        // Opponent ranks will be N/A for this request, but will be available after cache is populated
        console.warn(`[Play Type Analysis] ⚠️ No defensive rankings available. Opponent ranks will be N/A. Cache will be populated in background.`);
      }
    } else {
      console.log(`[Play Type Analysis] No opponent team specified - skipping defensive rankings`);
    }

    console.log(`[Play Type Analysis] Using NBA Stats ID: ${nbaPlayerId} (original: ${playerId})`);
    console.log(`[Play Type Analysis] Processed ${playerRowsFound} player play type rows`);
    console.log(`[Play Type Analysis] Player play types found:`, Object.keys(playerPlayTypes));
    console.log(`[Play Type Analysis] Total points so far:`, totalPoints);
    
    // Merge cached play types (with values > 0) with fresh data
    // First, add cached play types that weren't refetched
    let cachedPointsAdded = 0;
    
    // If we have a full cache hit (all play types + FreeThrows), use cached data directly
    if (cachedData && zeroValuePlayTypes.length === 0 && hasFreeThrows) {
      console.log(`[Play Type Analysis] Using full cached data, populating playerPlayTypes from cache...`);
      PLAY_TYPES.forEach(({ key, displayName }) => {
        const cachedPt = cachedData.playTypes?.find((pt: any) => {
          const ptKey = pt.playType === 'Free Throws' ? 'FreeThrows' : pt.playType;
          return ptKey === key;
        });
        if (cachedPt && cachedPt.points > 0) {
          const playerStats = { points: cachedPt.points, possessions: cachedPt.possessions || 0, ppp: cachedPt.ppp || 0 };
          playerPlayTypes[key] = playerStats;
          totalPoints += cachedPt.points;
          cachedPointsAdded += cachedPt.points;
          console.log(`[Play Type Analysis] Using cached ${displayName}: ${cachedPt.points} points`);
        }
      });
    } else {
      // Partial cache hit - merge cached and fresh data
      PLAY_TYPES.forEach(({ key, displayName }) => {
        const cachedPt = cachedPlayTypesMap.get(key);
        if (cachedPt && cachedPt.points > 0 && !playTypesToFetch.includes(key)) {
          // Use cached value if it has a value > 0 and wasn't refetched
          const playerStats = { points: cachedPt.points, possessions: 0, ppp: 0 };
          playerPlayTypes[key] = playerStats;
          totalPoints += cachedPt.points;
          cachedPointsAdded += cachedPt.points;
          console.log(`[Play Type Analysis] Using cached ${displayName}: ${cachedPt.points} points`);
        }
      });
    }
    
    // Fetch free throw data from BDL API (or use cached value)
    let freeThrowPoints = 0;
    
    // Check if FreeThrows is cached
    const cachedFreeThrows = cachedPlayTypesMap.get('FreeThrows');
    if (cachedFreeThrows && cachedFreeThrows.points > 0) {
      freeThrowPoints = cachedFreeThrows.points;
      console.log(`[Play Type Analysis] Using cached Free Throws: ${freeThrowPoints} points`);
    } else if (nbaPlayerId) {
      try {
        const bdlPlayerId = convertNbaToBdlId(nbaPlayerId);
        if (bdlPlayerId) {
          console.log(`[Play Type Analysis] Fetching free throw data from BDL API for player ${bdlPlayerId} (NBA ID: ${nbaPlayerId})...`);
          
          // Convert season string (e.g., "2025-26") to BDL season format (e.g., 2025)
          const bdlSeason = parseInt(seasonStr.split('-')[0]);
          
          // Build BDL API URL
          const bdlUrl = new URL('https://api.balldontlie.io/v1/stats');
          bdlUrl.searchParams.set('player_ids[]', bdlPlayerId);
          bdlUrl.searchParams.set('seasons[]', String(bdlSeason));
          bdlUrl.searchParams.set('per_page', '100'); // Get up to 100 games per page
          
          const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
          const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
          
          let totalFtm = 0;
          let gameCount = 0;
          let currentPage = 1;
          let hasMorePages = true;
          
          // Paginate through all games
          while (hasMorePages && currentPage <= 10) { // Limit to 10 pages (1000 games max, should be enough)
            bdlUrl.searchParams.set('page', String(currentPage));
            
            const response = await fetch(bdlUrl.toString(), {
              headers: {
                'Authorization': authHeader,
              },
            });
            
            if (!response.ok) {
              throw new Error(`BDL API error: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            const stats = data.data || [];
            
            if (stats.length === 0) {
              hasMorePages = false;
            } else {
              stats.forEach((stat: any) => {
                const ftm = stat.ftm || 0;
                totalFtm += ftm;
                gameCount++;
              });
              
              // Check if there are more pages
              const meta = data.meta || {};
              const totalPages = meta.total_pages || 1;
              hasMorePages = currentPage < totalPages;
              currentPage++;
            }
          }
          
          // Calculate per-game average
          if (gameCount > 0) {
            freeThrowPoints = totalFtm / gameCount;
            console.log(`[Play Type Analysis] ✅ Free throws from BDL: ${totalFtm} total FTM in ${gameCount} games = ${freeThrowPoints.toFixed(2)} per game`);
          } else {
            console.log(`[Play Type Analysis] ⚠️ No games found in BDL API for player ${bdlPlayerId}`);
          }
        } else {
          console.log(`[Play Type Analysis] ⚠️ Could not convert NBA ID ${nbaPlayerId} to BDL ID`);
        }
      } catch (err: any) {
        console.warn(`[Play Type Analysis] Could not fetch free throw data from BDL API:`, err.message);
      }
    }
    
    // Add free throw points to total
    totalPoints += freeThrowPoints;
    
    // Recalculate total points for percentage calculation
    console.log(`[Play Type Analysis] Total points breakdown: Fresh=${(totalPoints - cachedPointsAdded - freeThrowPoints).toFixed(1)}, Cached=${cachedPointsAdded.toFixed(1)}, FreeThrows=${freeThrowPoints.toFixed(1)}, Total=${totalPoints.toFixed(1)}`);
    const recalculatedTotalPoints = totalPoints;
    
    // Build response with play types
    const playTypeAnalysis = PLAY_TYPES.map(({ key, displayName }) => {
      const playerStats = playerPlayTypes[key] || { points: 0, possessions: 0, ppp: 0 };
      const points = playerStats.points || 0;
      const pointsPct = recalculatedTotalPoints > 0 ? (points / recalculatedTotalPoints) * 100 : 0;

      // Get opponent rank if opponent team is specified
      let oppRank: number | null = null;
      if (opponentTeam && opponentTeam !== 'N/A') {
        if (playTypeRankings[key]) {
          const normalizedOpponent = opponentTeam.toUpperCase();
          const ranking = playTypeRankings[key].findIndex(r => r.team.toUpperCase() === normalizedOpponent);
          oppRank = ranking >= 0 ? ranking + 1 : null;
          if (oppRank) {
            console.log(`[Play Type Analysis] ✅ ${key}: ${opponentTeam} rank = ${oppRank} (out of ${playTypeRankings[key].length} teams)`);
          } else {
            // Log available teams for debugging
            const availableTeams = playTypeRankings[key].slice(0, 5).map(r => r.team).join(', ');
            console.log(`[Play Type Analysis] ⚠️ ${key}: ${opponentTeam} not found in rankings (${playTypeRankings[key].length} teams available, sample: ${availableTeams})`);
            console.log(`[Play Type Analysis] ⚠️ Looking for: "${normalizedOpponent}", available teams:`, playTypeRankings[key].map(r => r.team.toUpperCase()));
          }
        } else {
          // Check if rankings exist at all
          const hasAnyRankings = Object.keys(playTypeRankings).length > 0;
          const availablePlayTypes = Object.keys(playTypeRankings);
          console.log(`[Play Type Analysis] ⚠️ ${key}: No rankings available for this play type. Has rankings: ${hasAnyRankings}, Available play types: ${availablePlayTypes.join(', ')}`);
        }
      }

      const result = {
        playType: key,
        displayName,
        points: parseFloat(points.toFixed(1)),
        pointsPct: parseFloat(pointsPct.toFixed(0)),
        oppRank,
      };
      
      // Log Cut and Handoff specifically
      if (key === 'Cut' || key === 'Handoff') {
        console.log(`[Play Type Analysis] ${displayName}: ${points} points, ${pointsPct}%`);
      }
      
      return result;
    });

    // Add Free Throws entry (from BDL API)
    const freeThrowPointsRounded = parseFloat(freeThrowPoints.toFixed(1));
    const freeThrowPct = recalculatedTotalPoints > 0 ? parseFloat(((freeThrowPoints / recalculatedTotalPoints) * 100).toFixed(0)) : 0;
    
    // Free throws don't have opponent rank (not a play type in NBA synergy system)
    playTypeAnalysis.push({
      playType: 'FreeThrows',
      displayName: 'Free Throws',
      points: freeThrowPointsRounded,
      pointsPct: freeThrowPct,
      oppRank: null, // Free throws don't have defensive rankings
    });
    
    console.log(`[Play Type Analysis] Added Free Throws: ${freeThrowPointsRounded} points (${freeThrowPct}%)`);

    // Sort by points (descending)
    playTypeAnalysis.sort((a, b) => b.points - a.points);
    
    // Log all play types in response to verify Cut and Handoff are included
    console.log(`[Play Type Analysis] Response includes ${playTypeAnalysis.length} play types:`, 
      playTypeAnalysis.map(pt => `${pt.displayName} (${pt.points} pts)`).join(', '));
    
    // Calculate sum of all play types for verification
    const sumOfPlayTypes = playTypeAnalysis.reduce((sum, pt) => sum + pt.points, 0);
    console.log(`[Play Type Analysis] Sum of all play types: ${sumOfPlayTypes.toFixed(1)} points`);
    console.log(`[Play Type Analysis] Note: Sum may not equal actual PPG. NBA Synergy requires min 10 min/game and 10 possessions per play type to qualify.`);

    const response = {
      playerId,
      opponentTeam: opponentTeam || null,
      season: seasonStr,
      totalPoints: parseFloat(recalculatedTotalPoints.toFixed(1)),
      playTypes: playTypeAnalysis,
      cachedAt: new Date().toISOString(),
      // Note about data filtering
      _meta: {
        sumOfPlayTypes: parseFloat(sumOfPlayTypes.toFixed(1)),
        note: "Sum of play types may not equal actual PPG. NBA Synergy data requires minimum 10 min/game and 10 possessions per play type to qualify. Some play types may not appear if they don't meet these thresholds."
      }
    };

    // Only cache play types with values > 0 (filter out 0.0 values)
    // This allows us to retry 0.0 values on next request
    const playTypesToCache = playTypeAnalysis.filter(pt => pt.points > 0);
    const cachedResponse = {
      ...response,
      playTypes: playTypesToCache,
    };
    
    // Merge with existing cached play types that weren't refetched
    if (cachedData?.playTypes) {
      cachedData.playTypes.forEach((cachedPt: any) => {
        // Add cached play types that have values > 0 and weren't in the fresh fetch
        if (cachedPt.points > 0 && !playTypesToFetch.includes(cachedPt.playType)) {
          const alreadyInCache = cachedResponse.playTypes.find(pt => pt.playType === cachedPt.playType);
          if (!alreadyInCache) {
            cachedResponse.playTypes.push(cachedPt);
          }
        }
      });
    }
    
    // Sort cached play types by points
    cachedResponse.playTypes.sort((a, b) => b.points - a.points);
    
    // Recalculate total points for cached response
    const cachedTotalPoints = cachedResponse.playTypes.reduce((sum, pt) => sum + pt.points, 0);
    cachedResponse.totalPoints = parseFloat(cachedTotalPoints.toFixed(1));

    // Cache only play types with values > 0 (24 hour TTL)
    // Store in both Supabase (persistent) and in-memory
    await setNBACache(cacheKey, 'play_type', cachedResponse, CACHE_TTL.TRACKING_STATS);
    cache.set(cacheKey, cachedResponse, CACHE_TTL.TRACKING_STATS);
      const zeroCount = playTypeAnalysis.length - playTypesToCache.length;
      console.log(`[Play Type Analysis] 💾 Cached ${playTypesToCache.length} play types with values > 0 (${zeroCount} with 0.0 will be retried next time)`);

      return { response, cacheStatus: 'MISS' };
    };
    
    // Execute with deduplication - concurrent requests will share the same fetch
    const result = await requestDeduplicator.dedupe(dedupeKey, fetchData);
    
    // Handle early returns (cache hits, empty responses)
    if (result.cacheStatus === 'HIT') {
      return NextResponse.json(result.response, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }
    
    return NextResponse.json(result.response, {
      status: 200,
      headers: { 'X-Cache-Status': result.cacheStatus || 'MISS' }
    });

  } catch (error: any) {
    console.error('[Play Type Analysis] Error:', error);
    
    // On timeout, try to return cached data if available
    const { searchParams: errorSearchParams } = new URL(request.url);
    const errorPlayerId = errorSearchParams.get('playerId');
    const errorSeason = parseInt(errorSearchParams.get('season') || currentNbaSeason().toString());
    const errorOpponentTeam = errorSearchParams.get('opponentTeam') || 'all';
    const errorCacheKey = `playtype_analysis_${errorPlayerId}_${errorOpponentTeam}_${errorSeason}`;
    
    if ((error.message?.includes('timeout') || error.name === 'AbortError') && errorCacheKey) {
      const cached = cache.get<any>(errorCacheKey);
      if (cached) {
        console.log(`[Play Type Analysis] ⚠️ Timeout occurred, returning cached data for player ${errorPlayerId}`);
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
    let errorMessage = 'Failed to fetch play type analysis';
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

