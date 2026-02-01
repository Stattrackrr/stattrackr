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
 * Refresh all teams' defensive stats
 * This endpoint is deprecated - the bballref endpoint has been removed
 */
export async function GET(request: NextRequest) {
  return NextResponse.json(
    {
      success: false,
      error: 'This endpoint is deprecated. The Basketball Reference scraping endpoint has been removed.',
      message: 'Please use alternative data sources for team defensive stats.'
    },
    { status: 410 } // 410 Gone
  );
}

