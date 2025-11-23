// app/api/play-type-analysis/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { cache, CACHE_TTL } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { getNbaStatsId, convertNbaToBdlId } from '@/lib/playerIdMapping';

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
  
  // Use 20s max timeout in production (leaving 40s buffer for Vercel overhead and retries)
  // NBA API is slow, so we need to fail fast and rely on cache
  const actualTimeout = isProduction ? Math.min(Math.max(timeout, 20000), 20000) : timeout;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
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
        console.error(`[Play Type Analysis] NBA API error ${response.status} (attempt ${attempt + 1}/${retries + 1}):`, text.slice(0, 200));
        
        // Don't retry on 4xx errors (client errors) except 429 (rate limit)
        if (response.status === 429 || (response.status >= 500 && attempt < retries)) {
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
        if (attempt < retries) {
          console.log(`[Play Type Analysis] Timeout on attempt ${attempt + 1}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        throw lastError;
      }
      
      // Network errors - retry
      if (error.message?.includes('fetch failed') || error.message?.includes('ECONNREFUSED') || error.message?.includes('ENOTFOUND')) {
        lastError = error;
        if (attempt < retries) {
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
    const season = parseInt(searchParams.get('season') || '2025');
    
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
    const cacheKey = `playtype_analysis_${playerId}_${opponentTeam || 'all'}_${season}`;
    
    // Check cache unless bypassed
    // We'll use cached data for play types with values > 0, and retry 0.0 values
    let cachedData: any = null;
    if (!bypassCache) {
      // Try Supabase cache first (persistent, shared across instances)
      cachedData = await getNBACache<any>(cacheKey);
      
      // Fallback to in-memory cache
      if (!cachedData) {
        cachedData = cache.get<any>(cacheKey);
      }
      if (cachedData) {
        // Check if we have any play types with 0.0 that need retrying
        const zeroValuePlayTypes = cachedData.playTypes?.filter((pt: any) => pt.points === 0) || [];
        // Check if FreeThrows is missing (old cache won't have it)
        const hasFreeThrows = cachedData.playTypes?.some((pt: any) => pt.playType === 'FreeThrows') || false;
        
        if (zeroValuePlayTypes.length === 0 && hasFreeThrows) {
          // All play types have values and FreeThrows exists, return cached data
          console.log(`[Play Type Analysis] ✅ Cache hit for player ${playerId} (all play types have values, including FreeThrows)`);
          return NextResponse.json(cachedData, {
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
      }
    } else {
      console.log(`[Play Type Analysis] ⚠️ Cache bypassed for player ${playerId}`);
      // Clear the cache entry if bypassing
      cache.delete(cacheKey);
    }

    console.log(`[Play Type Analysis] Fetching data for player ${playerId}, opponent ${opponentTeam || 'all'}, season ${season}`);

    // Step 0: Get player info to know their team (for filtering)
    const nbaPlayerId = getNbaStatsId(playerId) || playerId;
    let playerTeamAbbr: string | null = null;
    let playerName: string | null = null;

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
          playerName = `${firstName} ${lastName}`.trim();
          
          console.log(`[Play Type Analysis] Player info: ${playerName}, Team: ${playerTeamAbbr}`);
        }
      }
    } catch (err) {
      console.warn(`[Play Type Analysis] Could not fetch player info:`, err);
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
      cachedData.playTypes.forEach((pt: any) => {
        cachedPlayTypesMap.set(pt.playType, pt);
        // Fetch if value is 0.0 (need retry)
        if (pt.points === 0) {
          playTypesToFetch.push(pt.playType);
        }
      });
    }
    
    // Also fetch play types that aren't in cache at all
    PLAY_TYPES.forEach(({ key }) => {
      if (!cachedPlayTypesMap.has(key)) {
        playTypesToFetch.push(key);
      }
    });
    
    // If no play types need fetching and we have cache, use cached data
    if (playTypesToFetch.length === 0 && cachedData) {
      // All play types are cached with values > 0, use cached data
      console.log(`[Play Type Analysis] ✅ All play types cached with values > 0`);
      return NextResponse.json(cachedData, {
        status: 200,
        headers: { 'X-Cache-Status': 'HIT' }
      });
    }
    
    // If no cache and in production (where NBA API is unreachable), return empty data
    // In development, continue to try fetching from NBA API
    if (!bypassCache && !cachedData && playTypesToFetch.length === PLAY_TYPES.length && process.env.NODE_ENV === 'production') {
      console.log(`[Play Type Analysis] ⚠️ No cache available in production. NBA API is unreachable from Vercel. Returning empty data.`);
      // Return minimal response with empty play types
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
        error: 'NBA API unreachable - data will be available once cache is populated',
        cachedAt: new Date().toISOString()
      };
      return NextResponse.json(emptyResponse, { status: 200 });
    }

    // In development, continue to fetch from NBA API even if cache is empty
    if (!cachedData && !bypassCache && playTypesToFetch.length === PLAY_TYPES.length) {
      console.log(`[Play Type Analysis] No cache found, fetching from NBA API for player ${playerId}, season ${season}`);
    }
    
    console.log(`[Play Type Analysis] Fetching ${playTypesToFetch.length} play types (${cachedData ? 'retrying 0.0 values' : 'all'})`);
      
    // Check for bulk cached player play type data first
    const bulkPlayerDataCacheKey = `player_playtypes_bulk_${seasonStr}`;
    const bulkPlayerData = !bypassCache ? cache.get<Record<string, { headers: string[]; rows: any[] }>>(bulkPlayerDataCacheKey) : null;
    
    const allResults: Array<{ status: 'fulfilled' | 'rejected', value?: any, reason?: any }> = [];
    
    // Only use bulk cache if it exists and has substantial data, and we're not bypassing cache
    // Check if bulk cache has at least some play types with data
    const hasValidBulkCache = bulkPlayerData && Object.keys(bulkPlayerData).length > 0 && 
      Object.values(bulkPlayerData).some((pt: any) => pt && pt.rows && Array.isArray(pt.rows) && pt.rows.length > 0);
    
    console.log(`[Play Type Analysis] Bulk cache check: exists=${!!bulkPlayerData}, keys=${bulkPlayerData ? Object.keys(bulkPlayerData).length : 0}, hasValidData=${hasValidBulkCache}, bypassCache=${bypassCache}`);
    
    if (hasValidBulkCache && !bypassCache) {
      console.log(`[Play Type Analysis] ✅ Using bulk cached player play type data (${Object.keys(bulkPlayerData).length} play types cached)`);
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
      console.log(`[Play Type Analysis] ⚠️ No bulk cached data found (or empty/invalid), fetching all from API...`);
      // Fetch play types in parallel batches to speed up (3 at a time to avoid rate limiting)
      const BATCH_SIZE = 3;
      const batches: string[][] = [];
      for (let i = 0; i < playTypesToFetch.length; i += BATCH_SIZE) {
        batches.push(playTypesToFetch.slice(i, i + BATCH_SIZE));
      }
      
      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        console.log(`[Play Type Analysis] Fetching batch ${batchIdx + 1}/${batches.length} (${batch.length} play types)...`);
        
        // Fetch batch in parallel
        const batchPromises = batch.map(async (key) => {
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
            
            const playerData = await fetchNBAStats(playerUrl, 8000); // 8s per call to stay under 60s total with retries
            const playerResultSet = playerData?.resultSets?.[0];
            
            if (!playerResultSet) {
              return { status: 'fulfilled' as const, value: { key, success: false, rows: [], headers: [] } };
            } else {
              const playerRows = playerResultSet.rowSet || [];
              const headers = playerResultSet.headers || [];
              console.log(`[Play Type Analysis] ${key}: ${playerRows.length} rows`);
              
              return { status: 'fulfilled' as const, value: { key, success: true, rows: playerRows, headers } };
            }
          } catch (err) {
            console.warn(`[Play Type Analysis] Error fetching ${key}:`, err);
            return { status: 'fulfilled' as const, value: { key, success: false, rows: [], headers: [], error: err } };
          }
        });
        
        const batchResults = await Promise.all(batchPromises);
        allResults.push(...batchResults);
        
        // Small delay between batches (not between individual calls)
        if (batchIdx < batches.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 500)); // 0.5 second delay between batches
        }
      }
    }
      
      const results = allResults;
      
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
              
              // If we have player name, also filter by name to ensure we have the right player
              // This helps catch cases where player ID might match multiple players (shouldn't happen, but safety check)
              if (matchedRows.length > 0 && playerName && playerNameIdx >= 0) {
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
            } else {
              // If we don't have player ID, we can't reliably match - log warning
              console.warn(`[Play Type Analysis] ${key}: No player ID available, cannot filter rows`);
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
      // Check cache for defensive rankings (league-wide, same for all players)
      const defensiveRankingsCacheKey = `playtype_defensive_rankings_${seasonStr}`;
      const cachedRankings = cache.get<Record<string, Array<{ team: string; ppp: number }>>>(defensiveRankingsCacheKey);
      
      if (cachedRankings) {
        console.log(`[Play Type Analysis] ✅ Using cached defensive rankings for season ${seasonStr}`);
        Object.assign(playTypeRankings, cachedRankings);
      } else {
        console.warn(`[Play Type Analysis] ⚠️ No cached defensive rankings found for season ${seasonStr}. Background job may not have run yet. Opponent ranks will be N/A.`);
        // Don't fetch on-demand - rely on background job cache
        // This prevents timeouts when multiple users access the API
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
      if (opponentTeam && opponentTeam !== 'N/A' && playTypeRankings[key]) {
        const normalizedOpponent = opponentTeam.toUpperCase();
        const ranking = playTypeRankings[key].findIndex(r => r.team.toUpperCase() === normalizedOpponent);
        oppRank = ranking >= 0 ? ranking + 1 : null;
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

    return NextResponse.json(response, {
      status: 200,
      headers: { 'X-Cache-Status': 'MISS' }
    });

  } catch (error: any) {
    console.error('[Play Type Analysis] Error:', error);
    
    // On timeout, try to return cached data if available
    const { searchParams: errorSearchParams } = new URL(request.url);
    const errorPlayerId = errorSearchParams.get('playerId');
    const errorSeason = parseInt(errorSearchParams.get('season') || '2025');
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

