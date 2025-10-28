import { NextRequest, NextResponse } from 'next/server';
import cache, { CACHE_TTL } from '@/lib/cache';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const playerId = searchParams.get('player_id');
  const season = searchParams.get('season') || '2024';
  
  if (!playerId) {
    return NextResponse.json({ error: 'player_id is required' }, { status: 400 });
  }

  const cacheKey = `shot_distance_${playerId}_${season}`;
  
  // Check cache first
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return NextResponse.json(cachedData);
  }

  try {
    console.log(`🌐 Fresh API call for shot distance stats: ${playerId} (season: ${season})`);
    
    // Build Ball Don't Lie API URL for shot distance stats
    const bdlUrl = new URL('https://api.balldontlie.io/v1/season_averages/shooting');
    bdlUrl.searchParams.set('player_ids[]', playerId);
    bdlUrl.searchParams.set('season', season);
    bdlUrl.searchParams.set('season_type', 'regular');
    bdlUrl.searchParams.set('type', '5ft_range');

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
    
    console.log(`✅ Shot distance stats cached for ${CACHE_TTL.PLAYER_STATS} minutes`);
    
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching shot distance stats:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shot distance stats' },
      { status: 500 }
    );
  }
}
