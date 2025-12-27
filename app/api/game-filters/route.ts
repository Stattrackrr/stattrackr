import { NextRequest, NextResponse } from 'next/server';
import { getNBACache } from '@/lib/nbaCache';

/**
 * Get cached game filters for a player
 * Cache key format: player_game_filters_{bdlPlayerId}_{seasonYear}
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('player_id'); // BDL player ID
    const season = searchParams.get('season');

    if (!playerId || !season) {
      return NextResponse.json(
        { error: 'player_id and season are required' },
        { status: 400 }
      );
    }

    const cacheKey = `player_game_filters_${playerId}_${season}`;
    const cachedData = await getNBACache<any[]>(cacheKey, { quiet: true });

    if (!cachedData) {
      return NextResponse.json(
        { error: 'No cached filter data found. Run cache-game-filters.js script first.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: cachedData }, { status: 200 });
  } catch (error: any) {
    console.error('[Game Filters API] Error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}




