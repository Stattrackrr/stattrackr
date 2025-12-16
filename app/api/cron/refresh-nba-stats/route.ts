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
    console.log(`[fetchNBAStats] Fetching: ${url.substring(0, 150)}...`);
    const response = await fetch(url, {
      headers: NBA_HEADERS,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow'
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      const errorMsg = `NBA API ${response.status}: ${response.statusText}${errorText ? ` - ${errorText.slice(0, 200)}` : ''}`;
      console.error(`[fetchNBAStats] API error: ${errorMsg}`);
      throw new Error(errorMsg);
    }

    return await response.json();
  } catch (error: any) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Request timeout after ${timeout}ms`);
      console.error(`[fetchNBAStats] Timeout: ${timeoutError.message}`);
      throw timeoutError;
    }
    
    // Capture more details about fetch failures
    const errorDetails: any = {
      message: error.message || String(error),
      name: error.name,
      code: error.code,
      cause: error.cause,
      stack: error.stack?.split('\n').slice(0, 3).join('\n')
    };
    
    // Check for common network error patterns
    let diagnosticMsg = error.message || String(error);
    if (error.message?.includes('ECONNREFUSED') || error.code === 'ECONNREFUSED') {
      diagnosticMsg = `Connection refused - NBA API may be down or unreachable`;
    } else if (error.message?.includes('ENOTFOUND') || error.code === 'ENOTFOUND') {
      diagnosticMsg = `DNS resolution failed - Cannot resolve stats.nba.com`;
    } else if (error.message?.includes('ETIMEDOUT') || error.code === 'ETIMEDOUT') {
      diagnosticMsg = `Connection timeout - NBA API took too long to respond`;
    } else if (error.message?.includes('ECONNRESET') || error.code === 'ECONNRESET') {
      diagnosticMsg = `Connection reset - NBA API closed the connection`;
    } else if (error.message?.includes('fetch failed')) {
      diagnosticMsg = `Network fetch failed - ${error.code || 'unknown error code'}. Check if stats.nba.com is reachable.`;
    }
    
    console.error(`[fetchNBAStats] Error details:`, {
      ...errorDetails,
      diagnostic: diagnosticMsg,
      url: url.substring(0, 100)
    });
    
    throw new Error(diagnosticMsg);
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
        (parseInt(process.env.TRACKING_RETRY_ATTEMPTS ?? '3', 10) || 3))
    );
    const timeoutMs = Math.max(
      10000,
      (options?.timeoutMs ??
        (parseInt(process.env.TRACKING_TIMEOUT_MS ?? '60000', 10) || 60000))
    );
    let lastError: string | null = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        console.log(`[Team Tracking Stats] ${team} ${category} attempt ${attempt}/${maxAttempts} (timeout: ${timeoutMs}ms)...`);
        const data = await fetchNBAStats(url, timeoutMs);

        if (!data?.resultSets?.[0]) {
          const errorMsg = 'No resultSets in response';
          console.error(`[Team Tracking Stats] ${team} ${category}: ${errorMsg}`);
          // Don't retry on invalid response - this is a data issue, not network
          return { success: false, changed: false, error: errorMsg };
        }

        const resultSet = data.resultSets[0];
        const headers = resultSet.headers || [];
        const rows = resultSet.rowSet || [];

        const playerIdIdx = headers.indexOf('PLAYER_ID');
        const playerNameIdx = headers.indexOf('PLAYER_NAME');
        const teamAbbrIdx = headers.indexOf('TEAM_ABBREVIATION');

        if (playerIdIdx === -1 || playerNameIdx === -1) {
          const errorMsg = `Missing required columns (PLAYER_ID: ${playerIdIdx}, PLAYER_NAME: ${playerNameIdx})`;
          console.error(`[Team Tracking Stats] ${team} ${category}: ${errorMsg}`);
          return { success: false, changed: false, error: errorMsg };
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

        // Only update cache if data has changed (preserve old cache if no changes)
        if (hasChanged) {
          console.log(`[Team Tracking Stats] 📊 Data changed for ${team} ${category}, updating cache...`);
          await setNBACache(cacheKey, 'team_tracking', newPayload, CACHE_TTL.TRACKING_STATS);
          cache.set(cacheKey, newPayload, CACHE_TTL.TRACKING_STATS);
        } else {
          console.log(`[Team Tracking Stats] ℹ️ No changes for ${team} ${category}, keeping existing cache (no expiration update)`);
        }

        console.log(`[Team Tracking Stats] ✅ ${team} ${category} refreshed successfully on attempt ${attempt}/${maxAttempts}`);
        return { success: true, changed: hasChanged };
      } catch (error: any) {
        lastError = error.message || String(error);
        const isTransientError = lastError
          ? (lastError.includes('ECONNRESET') ||
             lastError.includes('ETIMEDOUT') ||
             lastError.includes('fetch failed') ||
             lastError.includes('timeout'))
          : false;
        
        console.warn(`[Team Tracking Stats] ${team} ${category} attempt ${attempt}/${maxAttempts} failed: ${lastError || 'Unknown error'}`);
        
        if (attempt < maxAttempts && isTransientError) {
          // Exponential backoff: 2s, 4s, 8s, 16s, etc. (max 30s)
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          const errorPreview = lastError ? lastError.substring(0, 50) : 'Unknown error';
          console.log(`[Team Tracking Stats] Retrying ${team} ${category} after ${delay}ms (transient error: ${errorPreview})...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else if (attempt < maxAttempts) {
          // Non-transient error, shorter delay
          const delay = 1000 * attempt;
          console.log(`[Team Tracking Stats] Retrying ${team} ${category} after ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          // Last attempt failed, don't retry
          break;
        }
      }
    }

    const finalError = lastError ?? 'Unknown error - all attempts exhausted';
    console.error(`[Team Tracking Stats] ❌ ${team} ${category} failed after ${maxAttempts} attempts: ${finalError}`);
    return { success: false, changed: false, error: finalError };
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
  let bulkPlayTypeStatus: 'fresh' | 'needs_refresh' | 'skipped_disabled_in_production' | 'refreshed' | 'error' | 'triggered_in_background' = 'triggered_in_background';
  let oddsStatus: 'refreshed' | 'error' | 'triggered_in_background' = 'triggered_in_background';
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

    // Refresh team defensive stats (vs data) - fetch all teams at once
    try {
      console.log('[NBA Stats Refresh] Refreshing team defensive stats...');
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.VERCEL_URL 
        ? `https://${process.env.VERCEL_URL}` 
        : 'http://localhost:3000';
      const defensiveStatsUrl = `${baseUrl}/api/team-defensive-stats/refresh`;
      const defensiveStatsResponse = await fetch(defensiveStatsUrl, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'StatTrackr-Cron/1.0',
        },
      });
      if (defensiveStatsResponse.ok) {
        const defensiveStatsResult = await defensiveStatsResponse.json();
        console.log('[NBA Stats Refresh] ✅ Team defensive stats refreshed:', defensiveStatsResult);
        results.details.push({ type: 'team_defensive_stats', status: 'refreshed', teamsProcessed: defensiveStatsResult.teamsProcessed });
      } else {
        console.warn('[NBA Stats Refresh] ⚠️ Failed to refresh team defensive stats:', defensiveStatsResponse.status);
        results.details.push({ type: 'team_defensive_stats', status: 'error', error: `HTTP ${defensiveStatsResponse.status}` });
      }
    } catch (error: any) {
      console.error('[NBA Stats Refresh] ❌ Error refreshing team defensive stats:', error);
      results.details.push({ type: 'team_defensive_stats', status: 'error', error: error.message });
    }

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
              // Log uncached teams in development/staging only
              if (process.env.NODE_ENV !== 'production') {
                console.warn(`[Cache Miss Log] ❌ Team ${team} (${category}) failed to cache: ${result.error || 'Unknown error'}`);
              }
            }
          }).catch((err) => {
            results.errors++;
            results.details.push({ team, category, status: 'error', error: err.message });
            // Log uncached teams in development/staging only
            if (process.env.NODE_ENV !== 'production') {
              console.warn(`[Cache Miss Log] ❌ Team ${team} (${category}) failed to cache: ${err.message || 'Unknown error'}`);
            }
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

    // Always refresh bulk play type cache (bulk only strategy)
    const seasonStr = `${currentSeason}-${String(currentSeason + 1).slice(-2)}`;

    console.log('[NBA Stats Refresh] Triggering bulk cache refresh (player play types + defensive rankings)...');
    const host = request.headers.get('host') || 'localhost:3000';
    const protocol = process.env.NODE_ENV === 'production' ? 'https' : 'http';
    const cacheUrl = `${protocol}://${host}/api/cache/nba-league-data?season=${currentSeason}`;
    
    // Trigger in background (non-blocking)
    fetch(cacheUrl).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        console.log('[NBA Stats Refresh] ✅ Bulk cache refreshed:', data.summary);
        bulkPlayTypeStatus = 'refreshed';
      } else {
        console.warn('[NBA Stats Refresh] ⚠️ Bulk cache refresh failed:', response.status);
        bulkPlayTypeStatus = 'error';
      }
    }).catch((err) => {
      console.warn('[NBA Stats Refresh] ⚠️ Bulk cache refresh error:', err.message);
      bulkPlayTypeStatus = 'error';
    });
    
    // Also trigger team defense rankings (zone rankings) refresh
    console.log('[NBA Stats Refresh] Triggering team defense rankings (zone rankings) refresh...');
    const zoneRankingsUrl = `${protocol}://${host}/api/team-defense-rankings?season=${currentSeason}`;
    fetch(zoneRankingsUrl).then(async (response) => {
      if (response.ok) {
        console.log('[NBA Stats Refresh] ✅ Team defense rankings refreshed');
      } else {
        console.warn('[NBA Stats Refresh] ⚠️ Team defense rankings refresh failed:', response.status);
      }
    }).catch((err) => {
      console.warn('[NBA Stats Refresh] ⚠️ Team defense rankings refresh error:', err.message);
    });
    
    // Trigger odds refresh (saves to Supabase for all instances)
    console.log('[NBA Stats Refresh] Triggering odds refresh...');
    const oddsRefreshUrl = `${protocol}://${host}/api/odds/refresh`;
    fetch(oddsRefreshUrl).then(async (response) => {
      if (response.ok) {
        const data = await response.json();
        console.log('[NBA Stats Refresh] ✅ Odds refreshed:', data.gamesCount ? `${data.gamesCount} games` : 'success');
        oddsStatus = 'refreshed';
      } else {
        console.warn('[NBA Stats Refresh] ⚠️ Odds refresh failed:', response.status);
        oddsStatus = 'error';
      }
    }).catch((err) => {
      console.warn('[NBA Stats Refresh] ⚠️ Odds refresh error:', err.message);
      oddsStatus = 'error';
    });
    
    results.details.push({ 
      team: 'BULK_PLAY_TYPES', 
      category: 'all_play_types', 
      status: 'triggered_in_background' 
    });
    results.details.push({ 
      team: 'DEFENSIVE_RANKINGS', 
      category: 'play_type_rankings', 
      status: 'triggered_in_background' 
    });
    results.details.push({ 
      team: 'ZONE_DEFENSE_RANKINGS', 
      category: 'zone_rankings', 
      status: 'triggered_in_background' 
    });
    results.details.push({ 
      team: 'ODDS', 
      category: 'all_nba_odds', 
      status: oddsStatus 
    });

    // Skip individual player cache refreshes - we only use bulk cache now
    console.log('[NBA Stats Refresh] Skipping individual player cache refresh (using bulk cache only)');
    results.details.push({ 
      team: 'PLAYER_CACHES', 
      category: 'shot_charts_and_play_types', 
      status: 'skipped_using_bulk_only' 
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log(`[NBA Stats Refresh] Complete: ${results.refreshed} refreshed, ${results.changed} changed, ${results.skipped} skipped, ${results.errors} errors (${duration}s)`);

    return NextResponse.json({
      success: true,
      message: 'NBA stats refresh complete',
      results: {
        ...results,
        duration: `${duration}s`,
        bulkPlayTypeCache: bulkPlayTypeStatus,
        oddsCache: oddsStatus
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

