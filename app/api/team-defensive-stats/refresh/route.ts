// app/api/team-defensive-stats/refresh/route.ts
import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max execution

const ALL_NBA_TEAMS = [
  'ATL', 'BOS', 'BKN', 'CHA', 'CHI', 'CLE', 'DAL', 'DEN', 'DET', 'GSW',
  'HOU', 'IND', 'LAC', 'LAL', 'MEM', 'MIA', 'MIL', 'MIN', 'NOP', 'NYK',
  'OKC', 'ORL', 'PHI', 'PHX', 'POR', 'SAC', 'SAS', 'TOR', 'UTA', 'WAS'
];

const CACHE_KEY = 'bballref_defensive_stats_all';
const CACHE_TYPE = 'team_defensive_stats';

/**
 * Refresh all teams' defensive stats from Basketball Reference
 * This endpoint fetches and caches all 30 teams' defensive stats in one go
 */
export async function GET(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    console.log('[Team Defensive Stats Refresh] Starting bulk refresh for all teams');
    
    // Fetch all teams' defensive stats by calling the bballref endpoint with ?all=1
    // Use the request URL to determine the base URL
    const requestUrl = new URL(request.url);
    const baseUrl = `${requestUrl.protocol}//${requestUrl.host}`;
    
    const refreshUrl = `${baseUrl}/api/team-defensive-stats/bballref?all=1`;
    
    console.log(`[Team Defensive Stats Refresh] Fetching from: ${refreshUrl}`);
    
    const response = await fetch(refreshUrl, {
      cache: 'no-store',
      headers: {
        'User-Agent': 'StatTrackr-Cache-Refresh/1.0',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch defensive stats: ${response.status} ${response.statusText}`);
    }
    
    const data = await response.json();
    
    if (!data.success || !data.teamStats) {
      throw new Error('Invalid response from defensive stats API');
    }
    
    const teamsProcessed = Object.keys(data.teamStats).length;
    
    // Cache in both in-memory and Supabase
    const cachePayload = {
      success: true,
      source: 'basketball-reference',
      teamStats: data.teamStats,
      rankings: data.rankings || {},
      cachedAt: new Date().toISOString(),
    };
    
    // Cache in-memory (24 hours)
    cache.set(CACHE_KEY, cachePayload, 24 * 60);
    
    // Cache in Supabase (24 hours) for persistent storage across instances
    await setNBACache(CACHE_KEY, CACHE_TYPE, cachePayload, 24 * 60);
    
    const elapsed = Date.now() - startTime;
    const result = {
      success: true,
      teamsProcessed,
      totalTeams: ALL_NBA_TEAMS.length,
      elapsed: `${elapsed}ms`,
      cachedAt: new Date().toISOString(),
      ttl: '24 hours',
    };
    
    console.log(`[Team Defensive Stats Refresh] ✅ Complete:`, result);
    
    return NextResponse.json(result, { status: 200 });
    
  } catch (error: any) {
    const elapsed = Date.now() - startTime;
    console.error('[Team Defensive Stats Refresh] ❌ Error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error.message || 'Failed to refresh team defensive stats',
        elapsed: `${elapsed}ms`
      },
      { status: 500 }
    );
  }
}

