export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
import { getNBACache, setNBACache } from "@/lib/nbaCache";
import type { OddsCache } from '@/app/api/odds/refresh/route';

export const runtime = "nodejs";
export const maxDuration = 60; // 1 minute max

const ODDS_CACHE_KEY = 'all_nba_odds_v2_bdl';
const PROD_URL = process.env.PROD_URL || 'https://www.stattrackr.co';
const CACHE_EMPTY_TRACKING_KEY_PREFIX = 'player-props-cache-empty-since';

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
 * Get the game date from odds cache (prioritizes today's games)
 */
function getGameDateFromOddsCache(oddsCache: OddsCache): string {
  const getUSEasternDateString = (date: Date): string => {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date).replace(/(\d+)\/(\d+)\/(\d+)/, (_, month, day, year) => {
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    });
  };
  
  const todayUSET = getUSEasternDateString(new Date());
  
  if (!oddsCache.games || oddsCache.games.length === 0) {
    return todayUSET;
  }
  
  const gameDates = new Set<string>();
  for (const game of oddsCache.games) {
    if (!game.commenceTime) continue;
    const commenceStr = String(game.commenceTime).trim();
    let gameDateUSET: string;
    if (/^\d{4}-\d{2}-\d{2}$/.test(commenceStr)) {
      gameDateUSET = commenceStr;
    } else {
      const date = new Date(commenceStr);
      gameDateUSET = getUSEasternDateString(date);
    }
    gameDates.add(gameDateUSET);
  }
  
  const todayUSETStr = getUSEasternDateString(new Date());
  const [year, month, day] = todayUSETStr.split('-').map(Number);
  const tomorrowDate = new Date(year, month - 1, day + 1);
  const tomorrowUSET = getUSEasternDateString(tomorrowDate);

  if (gameDates.has(todayUSETStr)) {
    return todayUSETStr;
  }
  if (gameDates.has(tomorrowUSET)) {
    return tomorrowUSET;
  }
  return tomorrowUSET;
}

/**
 * Get player props cache key
 */
function getPlayerPropsCacheKey(gameDate: string): string {
  return `nba-player-props-${gameDate}`;
}

/**
 * Trigger GitHub Actions workflow to process player props
 */
async function triggerPlayerPropsProcessing(): Promise<boolean> {
  try {
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubToken) {
      console.error(`[Check Player Props Cache] ❌ GITHUB_TOKEN not set - cannot trigger workflow`);
      return false;
    }

    const owner = 'Stattrackrr';
    const repo = 'stattrackr';
    const workflowId = 'process-player-props.yml';
    
    const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflowId}/dispatches`;
    
    console.log(`[Check Player Props Cache] 🔄 Triggering GitHub Actions workflow...`);
    
    const response = await fetch(githubApiUrl, {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ref: 'master',
        inputs: {
          trigger: 'cron-cache-empty-check'
        }
      }),
    });

    if (response.ok || response.status === 204) {
      console.log(`[Check Player Props Cache] ✅ GitHub Actions workflow triggered successfully`);
      return true;
    } else {
      const errorText = await response.text();
      console.error(`[Check Player Props Cache] ❌ Failed to trigger workflow: ${response.status} ${response.statusText} - ${errorText}`);
      return false;
    }
  } catch (error: any) {
    console.error(`[Check Player Props Cache] ❌ Error triggering processing:`, error.message);
    return false;
  }
}

export async function GET(req: NextRequest) {
  const timestamp = new Date().toISOString();
  
  console.log(`[Check Player Props Cache] 🕐 Started at ${timestamp}`);

  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    console.log(`[Check Player Props Cache] ❌ Unauthorized`);
    return authResult.response;
  }

  try {
    // Get odds cache to determine game date
    const oddsCache = await getNBACache<OddsCache>(ODDS_CACHE_KEY, {
      restTimeoutMs: 10000,
      jsTimeoutMs: 10000,
      quiet: true,
    });

    if (!oddsCache) {
      console.log(`[Check Player Props Cache] ⚠️ No odds cache available - skipping check`);
      return NextResponse.json({
        success: true,
        message: 'No odds cache available - skipping check',
        timestamp
      });
    }

    // Get the game date (today or tomorrow)
    const gameDate = getGameDateFromOddsCache(oddsCache);
    const cacheKey = getPlayerPropsCacheKey(gameDate);
    const trackingKey = `${CACHE_EMPTY_TRACKING_KEY_PREFIX}-${gameDate}`;

    console.log(`[Check Player Props Cache] 📅 Checking cache for game date: ${gameDate}`);
    console.log(`[Check Player Props Cache] 🔑 Cache key: ${cacheKey}`);

    // Check if player props cache exists and is valid
    const cachedProps = await getNBACache<any[]>(cacheKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });

    const isCacheValid = cachedProps && Array.isArray(cachedProps) && cachedProps.length > 0;

    if (isCacheValid) {
      // Cache is valid - clear any empty tracking timestamp
      console.log(`[Check Player Props Cache] ✅ Cache is valid (${cachedProps.length} props)`);
      
      // Clear the empty tracking timestamp if it exists
      try {
        const { deleteNBACache } = await import('@/lib/nbaCache');
        await deleteNBACache(trackingKey);
        console.log(`[Check Player Props Cache] 🧹 Cleared empty tracking timestamp`);
      } catch (e) {
        // Ignore deletion errors
      }

      return NextResponse.json({
        success: true,
        cacheValid: true,
        propsCount: cachedProps.length,
        gameDate,
        message: 'Cache is valid',
        timestamp
      });
    }

    // Cache is empty or invalid - check tracking timestamp
    console.log(`[Check Player Props Cache] ⚠️ Cache is empty or invalid`);
    
    const emptySinceTimestamp = await getNBACache<string>(trackingKey, {
      restTimeoutMs: 5000,
      jsTimeoutMs: 5000,
      quiet: true,
    });

    const now = new Date();
    const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

    if (!emptySinceTimestamp) {
      // First time detecting empty cache - set tracking timestamp
      console.log(`[Check Player Props Cache] 📝 Setting empty tracking timestamp`);
      await setNBACache(trackingKey, 'cache-tracking', now.toISOString(), 24 * 60, false); // 24 hours TTL
      
      return NextResponse.json({
        success: true,
        cacheValid: false,
        emptySince: now.toISOString(),
        gameDate,
        message: 'Cache is empty - tracking started. Will trigger processing if still empty after 5 minutes.',
        timestamp
      });
    }

    // Cache has been empty - check if it's been more than 5 minutes
    const emptySince = new Date(emptySinceTimestamp);
    const minutesEmpty = (now.getTime() - emptySince.getTime()) / (60 * 1000);

    console.log(`[Check Player Props Cache] ⏰ Cache has been empty for ${minutesEmpty.toFixed(1)} minutes`);

    if (emptySince <= fiveMinutesAgo) {
      // Cache has been empty for more than 5 minutes - trigger processing
      console.log(`[Check Player Props Cache] 🚨 Cache has been empty for more than 5 minutes - triggering processing`);
      
      // Check if we've already triggered recently (within last 10 minutes) to avoid duplicate triggers
      const lastTriggeredKey = `${trackingKey}-last-triggered`;
      const lastTriggered = await getNBACache<string>(lastTriggeredKey, {
        restTimeoutMs: 5000,
        jsTimeoutMs: 5000,
        quiet: true,
      });
      
      if (lastTriggered) {
        const lastTriggeredDate = new Date(lastTriggered);
        const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1000);
        if (lastTriggeredDate > tenMinutesAgo) {
          const minutesSinceLastTrigger = (now.getTime() - lastTriggeredDate.getTime()) / (60 * 1000);
          console.log(`[Check Player Props Cache] ⏸️ Already triggered ${minutesSinceLastTrigger.toFixed(1)} minutes ago - skipping to avoid duplicates`);
          return NextResponse.json({
            success: true,
            cacheValid: false,
            emptySince: emptySinceTimestamp,
            minutesEmpty: minutesEmpty.toFixed(1),
            triggered: false,
            alreadyTriggered: true,
            lastTriggered: lastTriggered,
            gameDate,
            message: 'Processing already triggered recently - waiting for completion',
            timestamp
          });
        }
      }
      
      const triggered = await triggerPlayerPropsProcessing();
      
      if (triggered) {
        // Record that we triggered (but don't clear the empty tracking - only clear when cache becomes valid)
        await setNBACache(lastTriggeredKey, 'cache-tracking', now.toISOString(), 24 * 60, false); // 24 hours TTL
        console.log(`[Check Player Props Cache] ✅ Processing triggered - tracking timestamp will be cleared when cache becomes valid`);

        return NextResponse.json({
          success: true,
          cacheValid: false,
          emptySince: emptySinceTimestamp,
          minutesEmpty: minutesEmpty.toFixed(1),
          triggered: true,
          gameDate,
          message: 'Processing triggered - cache has been empty for more than 5 minutes',
          timestamp
        });
      } else {
        return NextResponse.json({
          success: false,
          cacheValid: false,
          emptySince: emptySinceTimestamp,
          minutesEmpty: minutesEmpty.toFixed(1),
          triggered: false,
          gameDate,
          error: 'Failed to trigger processing',
          timestamp
        }, { status: 500 });
      }
    } else {
      // Cache is empty but hasn't been empty for 5 minutes yet
      const minutesUntilTrigger = 5 - minutesEmpty;
      return NextResponse.json({
        success: true,
        cacheValid: false,
        emptySince: emptySinceTimestamp,
        minutesEmpty: minutesEmpty.toFixed(1),
        minutesUntilTrigger: minutesUntilTrigger.toFixed(1),
        gameDate,
        message: `Cache is empty but will trigger processing in ${minutesUntilTrigger.toFixed(1)} minutes if still empty`,
        timestamp
      });
    }
  } catch (e: any) {
    console.error(`[Check Player Props Cache] ❌ Error:`, e.message);
    return NextResponse.json(
      { 
        success: false, 
        error: e?.message || 'Check player props cache failed',
        timestamp 
      },
      { status: 500 }
    );
  }
}

