export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
import { getNBACache } from "@/lib/nbaCache";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PROD_URL = process.env.PROD_URL || 'https://www.stattrackr.co';

/**
 * Get today's date in US Eastern Time
 */
function getUSEasternDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  });
}

/**
 * Fetch the latest game tipoff time from NBA Stats API for a given date
 */
async function fetchLatestGameTimeFromNBA(dateStr: string): Promise<Date | null> {
  console.log(`[Process Tomorrow Props] 🔍 fetchLatestGameTimeFromNBA called with date: ${dateStr}`);
  
  try {
    // Convert YYYY-MM-DD to MM/DD/YYYY for NBA Stats API
    const [year, month, day] = dateStr.split('-').map(Number);
    const mdy = `${month}/${day}/${year}`;
    console.log(`[Process Tomorrow Props] 📅 Converted date format: ${dateStr} -> ${mdy}`);
    
    const NBA_BASE = "https://stats.nba.com/stats";
    const NBA_HEADERS: Record<string, string> = {
      Accept: "application/json, text/plain, */*",
      "Accept-Language": "en-US,en;q=0.9",
      Origin: "https://www.nba.com",
      Referer: "https://www.nba.com/stats/",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
      "x-nba-stats-origin": "stats",
      "x-nba-stats-token": "true",
    };
    
    const url = `${NBA_BASE}/scoreboardv2?GameDate=${encodeURIComponent(mdy)}&DayOffset=0`;
    console.log(`[Process Tomorrow Props] 🌐 Fetching NBA schedule from: ${url}`);
    
    const res = await fetch(url, { headers: NBA_HEADERS, cache: "no-store" });
    
    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      console.warn(`[Process Tomorrow Props] ⚠️ Failed to fetch NBA schedule for ${dateStr}: ${res.status} ${res.statusText}`, errorText.substring(0, 200));
      return null;
    }
    
    const data = await res.json();
    console.log(`[Process Tomorrow Props] 📦 NBA Stats API response structure:`, {
      hasResultSets: !!data?.resultSets,
      resultSetsCount: data?.resultSets?.length || 0,
      resultSetNames: data?.resultSets?.map((r: any) => r?.name || 'unnamed') || []
    });
    
    const resultSets = data?.resultSets || [];
    const gamesSet = resultSets.find((r: any) => (r?.name || '').toLowerCase().includes('game')) || resultSets[0];
    
    if (!gamesSet) {
      console.warn(`[Process Tomorrow Props] ⚠️ No games result set found in NBA Stats API response`);
      return null;
    }
    
    if (!gamesSet?.headers || !gamesSet?.rowSet || gamesSet.rowSet.length === 0) {
      console.warn(`[Process Tomorrow Props] ⚠️ Games result set is empty:`, {
        hasHeaders: !!gamesSet?.headers,
        headersCount: gamesSet?.headers?.length || 0,
        hasRowSet: !!gamesSet?.rowSet,
        rowSetCount: gamesSet?.rowSet?.length || 0
      });
      return null;
    }
    
    console.log(`[Process Tomorrow Props] ✅ Found ${gamesSet.rowSet.length} games in NBA Stats API response`);
    
    const headers = gamesSet.headers.map((h: string) => String(h || '').toLowerCase());
    
    // Try multiple possible field names for game time
    const possibleTimeFields = [
      'gamedatetimeest',
      'datetimeest',
      'gamedatetime',
      'datetime',
      'starttimeest',
      'starttime'
    ];
    
    let gameDateTimeEstIdx = -1;
    for (const field of possibleTimeFields) {
      const idx = headers.findIndex((h: string) => h.includes(field));
      if (idx >= 0) {
        gameDateTimeEstIdx = idx;
        console.log(`[Process Tomorrow Props] ✅ Found game time field: ${headers[idx]} at index ${idx}`);
        break;
      }
    }
    
    if (gameDateTimeEstIdx < 0) {
      console.warn(`[Process Tomorrow Props] ⚠️ No game time field found. Available headers:`, headers.slice(0, 10));
      return null;
    }
    
    let latestTipoff: Date | null = null;
    
    console.log(`[Process Tomorrow Props] 📊 Processing ${gamesSet.rowSet.length} games from NBA Stats API...`);
    
    for (const row of gamesSet.rowSet) {
      const gameDateTimeEst = row[gameDateTimeEstIdx];
      if (!gameDateTimeEst) {
        console.log(`[Process Tomorrow Props] ⚠️ Game has no time data:`, row.slice(0, 5));
        continue;
      }
      
      // Parse the datetime string (could be various formats)
      let tipoffDate: Date;
      if (typeof gameDateTimeEst === 'string') {
        // Try parsing as ISO string or other formats
        tipoffDate = new Date(gameDateTimeEst);
      } else if (typeof gameDateTimeEst === 'number') {
        // Could be a timestamp
        tipoffDate = new Date(gameDateTimeEst);
      } else {
        continue;
      }
      
      if (!isNaN(tipoffDate.getTime())) {
        console.log(`[Process Tomorrow Props] 📅 Game time: ${gameDateTimeEst} -> ${tipoffDate.toISOString()} (${tipoffDate.toLocaleString('en-US', { timeZone: 'America/New_York' })})`);
        if (!latestTipoff || tipoffDate > latestTipoff) {
          latestTipoff = tipoffDate;
        }
      } else {
        console.warn(`[Process Tomorrow Props] ⚠️ Failed to parse game time: ${gameDateTimeEst}`);
      }
    }
    
    if (latestTipoff) {
      const sydneyTime = latestTipoff.toLocaleString('en-US', { timeZone: 'Australia/Sydney' });
      console.log(`[Process Tomorrow Props] ✅ Latest game tipoff: ${latestTipoff.toISOString()} (ET: ${latestTipoff.toLocaleString('en-US', { timeZone: 'America/New_York' })}, Sydney: ${sydneyTime})`);
    } else {
      console.warn(`[Process Tomorrow Props] ⚠️ No valid game times found in NBA Stats API response`);
    }
    
    return latestTipoff;
  } catch (error: any) {
    console.error(`[Process Tomorrow Props] ❌ Error fetching NBA schedule for ${dateStr}:`, {
      message: error?.message,
      stack: error?.stack,
      name: error?.name
    });
    return null;
  }
}

/**
 * Find the latest game tipoff time for today's games
 */
async function findLastGameTipoff(oddsCache: any): Promise<Date | null> {
  if (!oddsCache?.games || !Array.isArray(oddsCache.games)) {
    return null;
  }

  const todayUSET = getUSEasternDateString(new Date());
  const todayGames = oddsCache.games.filter((game: any) => {
    if (!game.commenceTime) return false;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET: string;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - this is the game date
      gameDateUSET = commenceStr;
    } else {
      // Has time component - parse and convert to US ET
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    
    return gameDateUSET === todayUSET;
  });

  if (todayGames.length === 0) {
    return null;
  }

  // Fetch latest game time from NBA Stats API (more accurate than assuming 7pm)
  const nbaLatestTipoff = await fetchLatestGameTimeFromNBA(todayUSET);
  
  let latestTipoff: Date | null = null;

  for (const game of todayGames) {
    if (!game.commenceTime) continue;
    
    const commenceStr = String(game.commenceTime).trim();
    let tipoffDate: Date | null = null;
    
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      // Date-only string - use NBA Stats API time if available
      if (nbaLatestTipoff) {
        tipoffDate = nbaLatestTipoff;
      } else {
        // Fallback: Since NBA Stats API doesn't have games yet, use a conservative time
        // Assume latest game is at 2:00 AM UTC (1pm Sydney time, which is common for late games)
        // This is safer than 11:59 PM ET (4:59 AM UTC) which is too late
        const [year, month, day] = commenceStr.split('-').map(Number);
        // Use 2:00 AM UTC as fallback (1pm Sydney = UTC+11)
        const utcDateStr = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}T02:00:00.000Z`;
        tipoffDate = new Date(utcDateStr);
        const sydneyTime = tipoffDate.toLocaleString('en-US', { timeZone: 'Australia/Sydney' });
        console.log(`[Process Tomorrow Props] ⚠️ No NBA time found, using fallback: ${tipoffDate.toISOString()} (Sydney: ${sydneyTime})`);
      }
    } else {
      // Has time component - parse it (should already be in correct timezone)
      tipoffDate = new Date(commenceStr);
    }

    if (tipoffDate && (!latestTipoff || tipoffDate > latestTipoff)) {
      latestTipoff = tipoffDate;
    }
  }

  return latestTipoff;
}

/**
 * Trigger processing for tomorrow's props via GitHub Actions API
 */
async function triggerTomorrowPropsProcessing(): Promise<boolean> {
  try {
    // Trigger GitHub Actions workflow via API
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.error(`[Process Tomorrow Props] ❌ GITHUB_TOKEN not set - cannot trigger workflow`);
      // Fallback: call Vercel endpoint (will have timeout issues but better than nothing)
      const processUrl = `${PROD_URL}/api/nba/player-props/process?refresh=1`;
      console.log(`[Process Tomorrow Props] 🔄 Fallback: Triggering Vercel endpoint at: ${processUrl}`);
      const response = await fetch(processUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    }

    const owner = 'Stattrackrr'; // Update with your GitHub username/org
    const repo = 'stattrackr';
    const workflowId = 'process-player-props.yml';
    
    const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
    
    console.log(`[Process Tomorrow Props] 🔄 Triggering GitHub Actions workflow...`);
    
    const response = await fetch(githubApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'master', // or 'main' depending on your default branch
        inputs: {
          trigger: 'cron-tomorrow-props'
        }
      }),
    });

    if (response.ok || response.status === 204) {
      console.log(`[Process Tomorrow Props] ✅ GitHub Actions workflow triggered successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[Process Tomorrow Props] ❌ Failed to trigger workflow: ${response.status} ${response.statusText} - ${errorText}`);
      return false;
    }
  } catch (error: any) {
    console.error(`[Process Tomorrow Props] ❌ Error triggering processing:`, error.message);
    return false;
  }
}

/**
 * Check if tomorrow's props are ready (processing complete)
 */
async function checkTomorrowPropsReady(): Promise<boolean> {
  try {
    const todayUSET = getUSEasternDateString(new Date());
    const [year, month, day] = todayUSET.split('-').map(Number);
    const tomorrowDate = new Date(year, month - 1, day + 1);
    const tomorrowUSET = getUSEasternDateString(tomorrowDate);
    
    const cacheKey = `nba-player-props-${tomorrowUSET}`;
    const cachedProps = await getNBACache<any[]>(cacheKey, { quiet: true });
    
    if (cachedProps && Array.isArray(cachedProps) && cachedProps.length > 0) {
      console.log(`[Process Tomorrow Props] ✅ Tomorrow's props are ready (${cachedProps.length} props)`);
      return true;
    }
    
    return false;
  } catch (error: any) {
    console.error(`[Process Tomorrow Props] ❌ Error checking props:`, error.message);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const timestamp = new Date().toISOString();
  
  console.log(`[Process Tomorrow Props] 🕐 Started at ${timestamp}`);

  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    console.log(`[Process Tomorrow Props] ❌ Unauthorized`);
    return authResult.response;
  }

  try {
    // Get odds cache to find today's games
    const oddsCache = await getNBACache<any>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
    });

    if (!oddsCache) {
      return NextResponse.json({
        success: false,
        error: 'No odds cache available',
        message: 'Cannot determine last game tipoff without odds cache',
      }, { status: 500 });
    }

    // Find the latest game tipoff time for today
    const lastTipoff = await findLastGameTipoff(oddsCache);
    
    // Debug: Log all today's games and their commenceTime values
    const todayUSETStr = getUSEasternDateString(new Date());
    const todayGames = oddsCache.games?.filter((game: any) => {
      if (!game.commenceTime) return false;
      const commenceStr = String(game.commenceTime).trim();
      let gameDateUSET: string;
      if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
        gameDateUSET = commenceStr;
      } else {
        const date = new Date(commenceStr);
        gameDateUSET = getUSEasternDateString(date);
      }
      return gameDateUSET === todayUSETStr;
    }) || [];
    
    console.log(`[Process Tomorrow Props] 📊 Found ${todayGames.length} games for today (${todayUSETStr})`);
    for (const game of todayGames.slice(0, 5)) {
      console.log(`[Process Tomorrow Props] 📋 ${game.homeTeam} vs ${game.awayTeam}: commenceTime="${game.commenceTime}" (type: ${typeof game.commenceTime})`);
    }
    
    if (!lastTipoff) {
      return NextResponse.json({
        success: false,
        error: 'No games found for today',
        message: 'Cannot determine when to process tomorrow\'s props',
        debug: {
          todayUSET: todayUSETStr,
          totalGames: oddsCache.games?.length || 0,
          todayGamesCount: todayGames.length,
          sampleGames: todayGames.slice(0, 3).map((g: any) => ({
            game: `${g.homeTeam} vs ${g.awayTeam}`,
            commenceTime: g.commenceTime,
            commenceTimeType: typeof g.commenceTime
          }))
        }
      }, { status: 400 });
    }

    const now = new Date();
    const tipoffTime = lastTipoff.getTime();
    const currentTime = now.getTime();
    const tenMinutesAfterTipoff = tipoffTime + (10 * 60 * 1000); // 10 minutes in milliseconds

    console.log(`[Process Tomorrow Props] 📅 Last game tipoff: ${lastTipoff.toISOString()}`);
    console.log(`[Process Tomorrow Props] ⏰ Current time: ${now.toISOString()}`);
    console.log(`[Process Tomorrow Props] ⏰ 10 minutes after tipoff: ${new Date(tenMinutesAfterTipoff).toISOString()}`);

    // Check if we should trigger processing (10 minutes after last tipoff)
    if (currentTime >= tenMinutesAfterTipoff) {
      // Check if processing has already been triggered today
      const todayUSET = getUSEasternDateString(new Date());
      const lastProcessedKey = `tomorrow-props-last-processed-${todayUSET}`;
      const lastProcessed = await getNBACache<string>(lastProcessedKey, { quiet: true });

      if (lastProcessed) {
        // Already processed today - check if ready
        const isReady = await checkTomorrowPropsReady();
        return NextResponse.json({
          success: true,
          alreadyProcessed: true,
          propsReady: isReady,
          lastTipoff: lastTipoff.toISOString(),
          processedAt: lastProcessed,
          message: isReady 
            ? 'Tomorrow\'s props are ready and displayed'
            : 'Processing was triggered, waiting for completion...',
        });
      }

      // Trigger processing
      console.log(`[Process Tomorrow Props] 🚀 Triggering processing for tomorrow's props...`);
      const triggered = await triggerTomorrowPropsProcessing();

      if (triggered) {
        // Mark as processed
        await getNBACache(lastProcessedKey, { quiet: true }); // This will be set by the processing endpoint
        
        return NextResponse.json({
          success: true,
          triggered: true,
          lastTipoff: lastTipoff.toISOString(),
          triggeredAt: now.toISOString(),
          message: 'Processing triggered for tomorrow\'s props. Will be ready shortly.',
        });
      } else {
        return NextResponse.json({
          success: false,
          error: 'Failed to trigger processing',
          lastTipoff: lastTipoff.toISOString(),
        }, { status: 500 });
      }
    } else {
      // Not time yet - return when it will trigger
      const timeUntilTrigger = tenMinutesAfterTipoff - currentTime;
      const minutesUntil = Math.ceil(timeUntilTrigger / (60 * 1000));
      
      return NextResponse.json({
        success: true,
        waiting: true,
        lastTipoff: lastTipoff.toISOString(),
        willTriggerAt: new Date(tenMinutesAfterTipoff).toISOString(),
        minutesUntil,
        message: `Will trigger processing in ${minutesUntil} minutes`,
      });
    }
  } catch (e: any) {
    console.error(`[Process Tomorrow Props] ❌ Error:`, e.message);
    return NextResponse.json(
      { 
        success: false, 
        error: e?.message || 'Process tomorrow props failed',
        timestamp 
      },
      { status: 500 }
    );
  }
}

