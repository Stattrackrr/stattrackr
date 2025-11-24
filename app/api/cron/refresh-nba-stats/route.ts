// app/api/cron/refresh-nba-stats/route.ts
/**
 * Daily NBA Stats Refresh Cron Job
 * Runs daily to refresh stale NBA API cache entries
 * 
 * Schedule: Daily at 3 AM ET (8 AM UTC) - after NBA games are finalized
 * Configured in vercel.json
 */

import { NextRequest, NextResponse } from 'next/server';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { cache, CACHE_TTL } from '@/lib/cache';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes for cron job

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

// NBA Team ID mapping
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

const NBA_TEAMS = Object.keys(NBA_TEAM_IDS);

async function fetchNBAStats(url: string, timeout = 20000): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`NBA API ${response.status}: ${response.statusText}`);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * Check if cache entry is stale (older than 24 hours)
 */
function isStale(updatedAt: string | undefined): boolean {
  if (!updatedAt) return true;
  const age = Date.now() - new Date(updatedAt).getTime();
  return age > (24 * 60 * 60 * 1000); // 24 hours
}

/**
 * Refresh tracking stats for a team
 */
type TrackingCategory = 'passing' | 'rebounding';

async function refreshTeamTrackingStats(
  team: string,
  season: number,
  category: TrackingCategory,
  opponentTeam: string | null = null,
  options?: {
    timeoutMs?: number;
    maxAttempts?: number;
  }
): Promise<{ success: boolean; changed: boolean; error?: string }> {
  try {
    const seasonStr = `${season}-${String(season + 1).slice(-2)}`;
    const cacheKey = opponentTeam 
      ? `tracking_stats_${team.toUpperCase()}_${season}_${category}_vs_${opponentTeam.toUpperCase()}`
      : `tracking_stats_${team.toUpperCase()}_${season}_${category}`;

    // Check if stale
    const cached = await getNBACache<any>(cacheKey);
    const cacheMetadata = cached?.__cache_metadata;
    
    if (cached && !isStale(cacheMetadata?.updated_at)) {
      return { success: true, changed: false }; // Not stale, skip
    }

    // Fetch new data
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
    const maxAttempts = Math.max(
      1,
      (options?.maxAttempts ??
        (parseInt(process.env.TRACKING_RETRY_ATTEMPTS ?? '5', 10) || 5))
    );
    const timeoutMs = Math.max(
      10000,
      (options?.timeoutMs ??
        (parseInt(process.env.TRACKING_TIMEOUT_MS ?? '60000', 10) || 60000))
    );
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const data = await fetchNBAStats(url, timeoutMs);

        if (!data?.resultSets?.[0]) {
          return { success: false, changed: false, error: 'No resultSets' };
        }

        const resultSet = data.resultSets[0];
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];

        const playerIdIdx = headers.indexOf('PLAYER_ID');
        const playerNameIdx = headers.indexOf('PLAYER_NAME');
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');

        if (playerIdIdx === -1 || playerNameIdx === -1) {
          return { success: false, changed: false, error: 'Missing columns' };
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

        const hasChanged = !cached || JSON.stringify(cached) !== JSON.stringify(newPayload);

        await setNBACache(cacheKey, 'team_tracking', newPayload, CACHE_TTL.TRACKING_STATS);
        cache.set(cacheKey, newPayload, CACHE_TTL.TRACKING_STATS);

        return { success: true, changed: hasChanged };
      } catch (error: any) {
        lastError = error.message;
        console.warn(`[Team Tracking Stats] ${team} ${category} attempt ${attempt}/${maxAttempts} failed: ${lastError}`);
        if (attempt < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
        }
      }
    }

    return { success: false, changed: false, error: lastError ?? 'Unknown error' };
  } catch (error: any) {
    return { success: false, changed: false, error: error.message };
  }
}

const SHOULD_TRIGGER_LEAGUE_BULK =
  process.env.ENABLE_LEAGUE_BULK === 'true' || process.env.NODE_ENV !== 'production';

export async function GET(request: NextRequest) {
  // Verify cron secret (optional but recommended)
  // Try multiple header name variations (HTTP headers are case-insensitive)
  const authHeader = request.headers.get('authorization') 
    || request.headers.get('Authorization')
    || request.headers.get('AUTHORIZATION');
  
  // Also check query parameter as fallback (easier for testing with PowerShell)
  const requestUrl = new URL(request.url);
  const secretFromQuery = requestUrl.searchParams.get('secret');
  
  // Debug: Log all headers and URL details
  const allHeaders: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    allHeaders[key] = value;
  });
  console.log('[NBA Stats Refresh] Request URL:', request.url);
  console.log('[NBA Stats Refresh] URL search params:', requestUrl.search);
  console.log('[NBA Stats Refresh] All headers:', Object.keys(allHeaders));
  console.log('[NBA Stats Refresh] Authorization header (get):', authHeader || 'NOT FOUND');
  console.log('[NBA Stats Refresh] Secret from query:', secretFromQuery ? `PROVIDED (length: ${secretFromQuery.length})` : 'NOT PROVIDED');
  
  // Check if this is a Vercel Cron call (they send x-vercel-cron header)
  const isVercelCron = request.headers.get('x-vercel-cron') === '1';
  
  // Check if this is an internal Vercel request (from same deployment)
  // Internal requests have x-vercel-* headers and come from vercel domains
  const host = request.headers.get('host') || '';
  const isInternalVercel = host.includes('vercel.app') || 
                           host.includes('vercel.app') ||
                           request.headers.get('x-vercel-id') !== null ||
                           request.headers.get('x-vercel-deployment-url') !== null;
  
  console.log('[NBA Stats Refresh] Is Vercel Cron call:', isVercelCron);
  console.log('[NBA Stats Refresh] Is internal Vercel request:', isInternalVercel);
  console.log('[NBA Stats Refresh] Host:', host);
  
  const cronSecret = process.env.CRON_SECRET;
  
  // Allow bypass in development or if secret is not set
  const isDevelopment = process.env.NODE_ENV === 'development';
  const allowBypass = isDevelopment || !cronSecret;
  
  // Vercel Cron calls and internal Vercel requests are authenticated by Vercel itself
  // Only require auth for manual/external calls
  if (cronSecret && !allowBypass && !isVercelCron && !isInternalVercel) {
    // Check both header and query parameter
    const normalizedHeader = authHeader?.trim().toLowerCase();
    const expectedHeader = `bearer ${cronSecret}`.toLowerCase();
    const headerMatch = normalizedHeader === expectedHeader;
    const queryMatch = secretFromQuery === cronSecret;
    
    // Log for debugging (will show in Vercel logs)
    console.log('[NBA Stats Refresh] Auth check:', {
      hasHeader: !!authHeader,
      headerMatch,
      queryMatch,
      secretLength: cronSecret.length
    });
    
    if (!headerMatch && !queryMatch) {
      return NextResponse.json({ 
        error: 'Unauthorized',
        hint: 'CRON_SECRET required. Use ?secret=YOUR_SECRET in URL or Authorization: Bearer YOUR_SECRET header.',
        receivedHeader: authHeader ? 'yes' : 'no',
        receivedQuery: secretFromQuery ? 'yes' : 'no'
      }, { status: 401 });
    }
  }

  const startTime = Date.now();
  const { currentNbaSeason } = await import('@/lib/nbaUtils');
  const currentSeason = currentNbaSeason(); // Dynamically determine current NBA season
  const results = {
    total: 0,
    refreshed: 0,
    changed: 0,
    skipped: 0,
    errors: 0,
    details: [] as Array<{ team: string; category: string; status: string; error?: string }>
  };
  let bulkPlayTypeStatus: 'fresh' | 'needs_refresh' | 'skipped_disabled_in_production' = SHOULD_TRIGGER_LEAGUE_BULK ? 'fresh' : 'skipped_disabled_in_production';
  const teamsParam = requestUrl.searchParams.get('teams');
  const teamLimitParam = requestUrl.searchParams.get('teamLimit');
const trackingBatchParam = requestUrl.searchParams.get('trackingBatch');
  const trackingCategoriesParam = requestUrl.searchParams.get('trackingCategories');

  let teamsToProcess = teamsParam
    ? teamsParam
        .split(',')
        .map((t) => t.trim().toUpperCase())
        .filter((t) => NBA_TEAM_IDS[t])
    : [...NBA_TEAMS];

  if (teamLimitParam) {
    const limit = parseInt(teamLimitParam, 10);
    if (!Number.isNaN(limit) && limit > 0) {
      teamsToProcess = teamsToProcess.slice(0, limit);
    }
  }

  const trackingBatchSize = Math.max(
    1,
    parseInt(
      trackingBatchParam ??
        (process.env.TRACKING_BATCH_SIZE ??
        '1'),
      10
    ) || 1
  );
  const trackingTimeoutParam = requestUrl.searchParams.get('trackingTimeout');
  const trackingRetriesParam = requestUrl.searchParams.get('trackingRetries');
  const trackingTimeoutMs = Math.max(
    10000,
    parseInt(
      (trackingTimeoutParam ??
        (process.env.TRACKING_TIMEOUT_MS ??
        '60000')),
      10
    ) || 60000
  );
  const trackingMaxAttempts = Math.max(
      1,
      parseInt(
      (trackingRetriesParam ??
        (process.env.TRACKING_RETRY_ATTEMPTS ??
        '5')),
      10
    ) || 5
    );

  const trackingCategories: TrackingCategory[] = trackingCategoriesParam
    ? trackingCategoriesParam
        .split(',')
        .map((c) => c.trim().toLowerCase())
        .filter((c): c is TrackingCategory => c === 'passing' || c === 'rebounding')
    : ['passing', 'rebounding'];

  console.log('[NBA Stats Refresh] Teams to process:', teamsToProcess.length, teamsToProcess.join(','));
  console.log('[NBA Stats Refresh] Tracking batch size:', trackingBatchSize);
  console.log('[NBA Stats Refresh] Tracking categories:', trackingCategories.join(','));

  try {
    console.log('[NBA Stats Refresh] Starting daily refresh...');

    // Refresh all teams' tracking stats (passing and rebounding) in parallel batches
    // Process in batches of 10 to avoid overwhelming the API
    const BATCH_SIZE = trackingBatchSize;
    const refreshPromises: Promise<void>[] = [];
    
    for (const team of teamsToProcess) {
      for (const category of trackingCategories) {
        results.total++;
        
        // Add to batch
        refreshPromises.push(
          refreshTeamTrackingStats(team, currentSeason, category, null, {
            timeoutMs: trackingTimeoutMs,
            maxAttempts: trackingMaxAttempts
          }).then((result) => {
            if (result.success) {
              if (result.changed) {
                results.changed++;
                results.refreshed++;
                results.details.push({ team, category, status: 'updated' });
              } else {
                results.skipped++;
                results.details.push({ team, category, status: 'skipped (not stale or no changes)' });
              }
            } else {
              results.errors++;
              results.details.push({ team, category, status: 'error', error: result.error });
            }
          }).catch((err) => {
            results.errors++;
            results.details.push({ team, category, status: 'error', error: err.message });
          })
        );
        
        // Process batches to avoid too many concurrent requests
        if (refreshPromises.length >= BATCH_SIZE) {
          await Promise.all(refreshPromises);
          refreshPromises.length = 0; // Clear array
          // Small delay between batches
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }
    }
    
    // Process remaining promises
    if (refreshPromises.length > 0) {
      await Promise.all(refreshPromises);
    }

    // Also refresh bulk play type cache if stale
    const seasonStr = `${currentSeason}-${String(currentSeason + 1).slice(-2)}`;

    if (SHOULD_TRIGGER_LEAGUE_BULK) {
      console.log('[NBA Stats Refresh] Checking bulk play type cache...');
      const bulkPlayTypeCacheKey = `player_playtypes_bulk_${seasonStr}`;
      const bulkPlayTypeCache = await getNBACache<any>(bulkPlayTypeCacheKey);
      const bulkCacheMetadata = bulkPlayTypeCache?.__cache_metadata;
      const isBulkStale = !bulkPlayTypeCache || isStale(bulkCacheMetadata?.updated_at);
      
      bulkPlayTypeStatus = isBulkStale ? 'needs_refresh' : 'fresh';
      if (isBulkStale) {
        console.log('[NBA Stats Refresh] Bulk play type cache is stale or missing, refreshing...');
        results.details.push({ 
          team: 'BULK_PLAY_TYPES', 
          category: 'all_play_types', 
          status: 'needs_refresh_on_next_request' 
        });
      } else {
        console.log('[NBA Stats Refresh] Bulk play type cache is fresh');
      }

      console.log('[NBA Stats Refresh] Triggering defensive rankings cache refresh...');
      const host = request.headers.get('host') || 'localhost:3000';
      const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
      const cacheUrl = `${protocol}://${host}/api/cache/nba-league-data?season=${currentSeason}`;
      
      fetch(cacheUrl).then(async (response) => {
        if (response.ok) {
          const data = await response.json();
          console.log('[NBA Stats Refresh] ✅ Defensive rankings cache refreshed:', data.summary);
        } else {
          console.warn('[NBA Stats Refresh] ⚠️ Defensive rankings cache refresh failed:', response.status);
        }
      }).catch((err) => {
        console.warn('[NBA Stats Refresh] ⚠️ Defensive rankings cache refresh error:', err.message);
      });
      
      results.details.push({ 
        team: 'DEFENSIVE_RANKINGS', 
        category: 'play_type_rankings', 
        status: 'triggered_in_background' 
      });
    } else {
      console.log('[NBA Stats Refresh] Skipping league bulk cache (disabled in production). Set ENABLE_LEAGUE_BULK=true to re-enable.');
      bulkPlayTypeStatus = 'skipped_disabled_in_production';
      results.details.push({ 
        team: 'BULK_PLAY_TYPES', 
        category: 'all_play_types', 
        status: 'skipped_disabled_in_production' 
      });
      results.details.push({ 
        team: 'DEFENSIVE_RANKINGS', 
        category: 'play_type_rankings', 
        status: 'skipped_disabled_in_production' 
      });
    }

    // Refresh individual player caches (shot charts and play type analysis) - trigger in background
    // Query Supabase for existing player cache entries and refresh stale ones
    console.log('[NBA Stats Refresh] Triggering individual player cache refresh (background)...');
    results.details.push({ 
      team: 'PLAYER_CACHES', 
      category: 'shot_charts_and_play_types', 
      status: 'triggered_in_background' 
    });
    
    // Run player cache refresh in background (non-blocking)
    (async () => {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
        
        if (supabaseUrl && supabaseServiceKey) {
          const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
            auth: { autoRefreshToken: false, persistSession: false }
          });
          
          // Get all shot chart cache entries for current season
          const { data: shotChartCaches, error: shotChartError } = await supabaseAdmin
            .from('nba_api_cache')
            .select('cache_key, updated_at')
            .like('cache_key', `shot_enhanced_%_${currentSeason}`)
            .limit(100); // Limit to 100 most recent to avoid timeout
          
          if (!shotChartError && shotChartCaches && shotChartCaches.length > 0) {
            console.log(`[NBA Stats Refresh] Found ${shotChartCaches.length} shot chart cache entries to refresh`);
            
            let refreshedShotCharts = 0;
            for (const cacheEntry of shotChartCaches) {
              // Extract player ID from cache key: shot_enhanced_{playerId}_{opponent}_{season}
              const match = cacheEntry.cache_key.match(/^shot_enhanced_(\d+)_/);
              if (match && match[1]) {
                const playerId = match[1];
                const isStaleEntry = isStale(cacheEntry.updated_at);
                
                if (isStaleEntry) {
                  // Trigger refresh in background (non-blocking)
                  const host = request.headers.get('host') || 'localhost:3000';
                  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                  const refreshUrl = `${protocol}://${host}/api/shot-chart-enhanced?playerId=${playerId}&season=${currentSeason}&bypassCache=true`;
                  
                  fetch(refreshUrl).catch(() => {}); // Fire and forget
                  refreshedShotCharts++;
                }
              }
            }
            
            console.log(`[NBA Stats Refresh] Triggered refresh for ${refreshedShotCharts} shot chart caches`);
          }
          
          // Get all play type analysis cache entries for current season
          const { data: playTypeCaches, error: playTypeError } = await supabaseAdmin
            .from('nba_api_cache')
            .select('cache_key, updated_at')
            .like('cache_key', `playtype_analysis_%_${currentSeason}`)
            .limit(100); // Limit to 100 most recent
          
          if (!playTypeError && playTypeCaches && playTypeCaches.length > 0) {
            console.log(`[NBA Stats Refresh] Found ${playTypeCaches.length} play type analysis cache entries to refresh`);
            
            let refreshedPlayTypes = 0;
            for (const cacheEntry of playTypeCaches) {
              // Extract player ID from cache key: playtype_analysis_{playerId}_{season}
              const match = cacheEntry.cache_key.match(/^playtype_analysis_(\d+)_/);
              if (match && match[1]) {
                const playerId = match[1];
                const isStaleEntry = isStale(cacheEntry.updated_at);
                
                if (isStaleEntry) {
                  // Trigger refresh in background (non-blocking)
                  const host = request.headers.get('host') || 'localhost:3000';
                  const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
                  const refreshUrl = `${protocol}://${host}/api/play-type-analysis?playerId=${playerId}&season=${currentSeason}&bypassCache=true`;
                  
                  fetch(refreshUrl).catch(() => {}); // Fire and forget
                  refreshedPlayTypes++;
                }
              }
            }
            
            console.log(`[NBA Stats Refresh] Triggered refresh for ${refreshedPlayTypes} play type caches`);
          }
        }
      } catch (err: any) {
        console.error('[NBA Stats Refresh] Error refreshing individual player caches:', err);
      }
    })(); // Immediately invoke async function - runs in background

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[NBA Stats Refresh] Complete: ${results.refreshed} refreshed, ${results.changed} changed, ${results.skipped} skipped, ${results.errors} errors (${duration}s)`);

    return NextResponse.json({
      success: true,
      message: 'NBA stats refresh complete',
      results: {
        ...results,
        duration: `${duration}s`,
        bulkPlayTypeCache: bulkPlayTypeStatus
      },
      timestamp: new Date().toISOString()
    });

  } catch (error: any) {
    console.error('[NBA Stats Refresh] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message,
      results,
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
}

