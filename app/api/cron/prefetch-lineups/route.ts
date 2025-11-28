export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from "next/server";
import { authorizeCronRequest } from "@/lib/cronAuth";
import { checkRateLimit, strictRateLimiter } from "@/lib/rateLimit";
import { getNBACache, setNBACache } from "@/lib/nbaCache";
import { scrapeBasketballMonstersLineupForDate } from "@/lib/basketballmonsters";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes

/**
 * Pre-fetch BasketballMonsters lineups for all teams playing today/tomorrow
 * Runs every 30 minutes until lineups are confirmed, then locks them in
 * 
 * This ensures lineups are cached BEFORE games finish, so post-game ingest
 * can use verified positions from BasketballMonsters
 */

interface LineupCacheEntry {
  lineup: Array<{ name: string; position: string; isVerified: boolean; isProjected: boolean }>;
  date: string;
  team: string;
  isLocked: boolean; // true when lineup is fully verified
  lastUpdated: string; // ISO timestamp
  verifiedCount: number; // number of verified players (0-5)
}

async function fetchGamesForTodayAndTomorrow(): Promise<Array<{ home: string; away: string; date: string }>> {
  try {
    const apiKey = process.env.BALLDONTLIE_API_KEY;
    if (!apiKey) {
      throw new Error('BALLDONTLIE_API_KEY environment variable is required');
    }

    // Use Eastern Time to match BasketballMonsters (they use Eastern Time)
    const now = new Date();
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = new Date(easternTime);
    const tomorrow = new Date(easternTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    const url = `https://api.balldontlie.io/v1/games?start_date=${todayStr}&end_date=${tomorrowStr}`;
    const res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      console.error(`[prefetch-lineups] BDL API error: ${res.status}`);
      return [];
    }
    
    const data = await res.json();
    const games = Array.isArray(data?.data) ? data.data : [];

    return games.map((game: any) => ({
      home: game.home_team?.abbreviation?.toUpperCase() || '',
      away: game.visitor_team?.abbreviation?.toUpperCase() || '',
      date: game.date ? game.date.split('T')[0] : todayStr, // Extract date part
    })).filter((g: any) => g.home && g.away);
  } catch (e: any) {
    console.error('[prefetch-lineups] Error fetching games:', e.message);
    return [];
  }
}

async function fetchAndCacheLineup(
  teamAbbr: string,
  date: string
): Promise<{ success: boolean; isLocked: boolean; verifiedCount: number; message: string }> {
  try {
    const cacheKey = `basketballmonsters:lineup:${teamAbbr.toUpperCase()}:${date}`;
    
    // Check if we already have a locked (verified) lineup
    const existing = await getNBACache<LineupCacheEntry>(`lineup:meta:${teamAbbr.toUpperCase()}:${date}`);
    if (existing?.isLocked) {
      console.log(`[prefetch-lineups] ✅ ${teamAbbr} on ${date}: Already locked (${existing.verifiedCount}/5 verified)`);
      return {
        success: true,
        isLocked: true,
        verifiedCount: existing.verifiedCount,
        message: `Already locked (${existing.verifiedCount}/5 verified)`
      };
    }

    // Fetch fresh lineup from BasketballMonsters (bypass cache to get latest)
    // Note: scrapeBasketballMonstersLineupForDate signature: (date, teamAbbr, bypassCache, expectedOpponent, teamRoster)
    console.log(`[prefetch-lineups] 🔍 Fetching lineup for ${teamAbbr} on ${date}...`);
    const lineup = await scrapeBasketballMonstersLineupForDate(
      date,
      teamAbbr,
      true, // bypass cache to get fresh data from BasketballMonsters
      null, // expectedOpponent
      undefined // teamRoster
    );

    if (!lineup || !Array.isArray(lineup) || lineup.length !== 5) {
      console.log(`[prefetch-lineups] ⚠️ ${teamAbbr} on ${date}: No lineup found or incomplete lineup`);
      return {
        success: false,
        isLocked: false,
        verifiedCount: 0,
        message: 'No lineup found or incomplete lineup'
      };
    }

    // Count verified players
    const verifiedCount = lineup.filter(p => p.isVerified && !p.isProjected).length;
    const allVerified = verifiedCount === 5;
    
    // Store the lineup in cache (this is what ingest will use)
    await setNBACache(cacheKey, 'basketballmonsters_lineup', lineup, 7 * 24 * 60); // Cache for 7 days (in minutes)

    // Store metadata about lock status
    const metadata: LineupCacheEntry = {
      lineup,
      date,
      team: teamAbbr.toUpperCase(),
      isLocked: allVerified,
      lastUpdated: new Date().toISOString(),
      verifiedCount
    };
    await setNBACache(`lineup:meta:${teamAbbr.toUpperCase()}:${date}`, 'lineup_metadata', metadata, 7 * 24 * 60); // Cache for 7 days (in minutes)

    const statusMsg = allVerified 
      ? `✅ Locked in (${verifiedCount}/5 verified)` 
      : `📋 Projected (${verifiedCount}/5 verified) - will continue polling`;
    console.log(`[prefetch-lineups] ${statusMsg} - ${teamAbbr} on ${date}`);

    return {
      success: true,
      isLocked: allVerified,
      verifiedCount,
      message: statusMsg
    };
  } catch (e: any) {
    console.error(`[prefetch-lineups] Error fetching lineup for ${teamAbbr} on ${date}:`, e.message);
    return {
      success: false,
      isLocked: false,
      verifiedCount: 0,
      message: `Error: ${e.message}`
    };
  }
}

export async function GET(req: NextRequest) {
  const authResult = authorizeCronRequest(req);
  if (!authResult.authorized) {
    return authResult.response;
  }

  const rateResult = checkRateLimit(req, strictRateLimiter);
  if (!rateResult.allowed && rateResult.response) {
    return rateResult.response;
  }

  try {
    console.log('[prefetch-lineups] Cron job triggered');

    // Get all games for today and tomorrow
    const games = await fetchGamesForTodayAndTomorrow();
    
    // Use Eastern Time to match BasketballMonsters (they use Eastern Time)
    const now = new Date();
    const easternTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
    const today = new Date(easternTime);
    const tomorrow = new Date(easternTime);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    
    // Count games by date for logging
    const todayGames = games.filter(g => g.date === todayStr).length;
    const tomorrowGames = games.filter(g => g.date === tomorrowStr).length;
    
    console.log(`[prefetch-lineups] Found ${games.length} games: ${todayGames} today (${todayStr}), ${tomorrowGames} tomorrow (${tomorrowStr})`);
    
    if (games.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No games scheduled for today/tomorrow',
        gamesProcessed: 0,
        locked: 0,
        projected: 0
      });
    }

    // Collect all unique teams and dates
    const teamDatePairs = new Set<string>();
    games.forEach(game => {
      if (game.home) teamDatePairs.add(`${game.home}:${game.date}`);
      if (game.away) teamDatePairs.add(`${game.away}:${game.date}`);
    });

    const results: Array<{
      team: string;
      date: string;
      success: boolean;
      isLocked: boolean;
      verifiedCount: number;
      message: string;
    }> = [];

    let lockedCount = 0;
    let projectedCount = 0;

    // Process each team-date pair
    for (const pair of teamDatePairs) {
      const [team, date] = pair.split(':');
      const result = await fetchAndCacheLineup(team, date);
      
      results.push({
        team,
        date,
        ...result
      });

      if (result.isLocked) {
        lockedCount++;
      } else if (result.success) {
        projectedCount++;
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const totalProcessed = results.length;
    const successful = results.filter(r => r.success).length;

    console.log(`[prefetch-lineups] Processed ${totalProcessed} team-date pairs: ${lockedCount} locked, ${projectedCount} projected`);

    return NextResponse.json({
      success: true,
      message: `Processed ${totalProcessed} team-date pairs`,
      gamesProcessed: totalProcessed,
      successful,
      locked: lockedCount,
      projected: projectedCount,
      results: results.slice(0, 20) // Limit response size
    });
  } catch (e: any) {
    console.error('[prefetch-lineups] Error:', e.message);
    return NextResponse.json(
      { success: false, error: e?.message || 'Pre-fetch lineups failed' },
      { status: 500 }
    );
  }
}

