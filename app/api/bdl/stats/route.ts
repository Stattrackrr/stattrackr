export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('player_id');
  const seasons = searchParams.getAll('seasons[]');
  const perPage = searchParams.get('per_page') || '100';
  
  if (!playerId) {
    return NextResponse.json({ error: 'player_id is required' }, { status: 400 });
  }

  const season = seasons[0] || 'current';
  const seasonNum = season === 'current' ? undefined : parseInt(season, 10);
  const cacheKey = getCacheKey.playerStats(playerId, seasonNum);
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return NextResponse.json(cachedData);
  }

  try {
    console.log(`🌐 Fresh API call for player stats: ${playerId} (season: ${season})`);
    
    // Build Ball Don't Lie API URL
    const bdlUrl = new URL('https://api.balldontlie.io/v1/stats');
    bdlUrl.searchParams.set('player_ids[]', playerId);
    if (season !== 'current') {
      bdlUrl.searchParams.set('seasons[]', season);
    }
    bdlUrl.searchParams.set('per_page', perPage);

    const apiKey = process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '';
    const authHeader = apiKey ? (apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`) : '';
    
    const response = await fetch(bdlUrl.toString(), {
      headers: {
        'Authorization': authHeader,
      },
    });

    if (!response.ok) {
      throw new Error(`Ball Don't Lie API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Cache the successful response
    cache.set(cacheKey, data, CACHE_TTL.PLAYER_STATS);
    
    console.log(`✅ Player stats cached for ${CACHE_TTL.PLAYER_STATS} minutes`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching player stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch player stats' },
      { status: 500 }
    );
  }
}
