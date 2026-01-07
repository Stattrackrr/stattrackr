import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is required');
}

/**
 * Get live stats for a player in a specific game
 * Query params: playerId, gameId
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const playerId = searchParams.get('playerId');
    const gameId = searchParams.get('gameId');
    const gameDate = searchParams.get('gameDate');

    // Input validation
    if (!playerId || (!gameId && !gameDate)) {
      return NextResponse.json(
        { error: 'playerId and gameId or gameDate required' },
        { status: 400 }
      );
    }

    // Validate playerId format (should be numeric, max 10 digits)
    if (!/^\d{1,10}$/.test(playerId)) {
      return NextResponse.json(
        { error: 'Invalid playerId format. Must be numeric (1-10 digits)' },
        { status: 400 }
      );
    }

    // Validate gameId format if provided (should be numeric, max 10 digits)
    if (gameId && !/^\d{1,10}$/.test(gameId)) {
      return NextResponse.json(
        { error: 'Invalid gameId format. Must be numeric (1-10 digits)' },
        { status: 400 }
      );
    }

    // Validate gameDate format if provided (YYYY-MM-DD)
    if (gameDate && !/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) {
      return NextResponse.json(
        { error: 'Invalid gameDate format. Use YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // If we have gameDate but not gameId, find the game first
    let targetGameId = gameId;
    if (!targetGameId && gameDate) {
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
        {
          headers: {
            'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
          },
        }
      );

      if (gamesResponse.ok) {
        const gamesData = await gamesResponse.json();
        const games = gamesData.data || [];
        
        // Find game where player is playing by checking stats for each game
        for (const game of games) {
          const statsResponse = await fetch(
            `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${playerId}`,
            {
              headers: {
                'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
              },
            }
          );

          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            if (statsData.data && statsData.data.length > 0) {
              targetGameId = game.id;
              break;
            }
          }
        }
      }
    }

    if (!targetGameId) {
      return NextResponse.json(
        { error: 'Could not find game' },
        { status: 404 }
      );
    }

    // Fetch stats for this specific game and player
    const statsResponse = await fetch(
      `https://api.balldontlie.io/v1/stats?game_ids[]=${targetGameId}&player_ids[]=${playerId}`,
      {
        headers: {
          'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
        },
      }
    );

    if (!statsResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch stats' },
        { status: statsResponse.status }
      );
    }

    const statsData = await statsResponse.json();
    
    if (!statsData.data || statsData.data.length === 0) {
      return NextResponse.json(
        { error: 'No stats found' },
        { status: 404 }
      );
    }

    const stat = statsData.data[0];
    
    // Return formatted stats
    return NextResponse.json({
      pts: stat.pts || 0,
      reb: stat.reb || 0,
      ast: stat.ast || 0,
      stl: stat.stl || 0,
      blk: stat.blk || 0,
      fg3m: stat.fg3m || 0,
      game: stat.game,
    });
  } catch (error: any) {
    console.error('Error fetching live stats:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch live stats' },
      { status: 500 }
    );
  }
}

