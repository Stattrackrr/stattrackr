import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, strictRateLimiter } from '@/lib/rateLimit';
import { sharedCache } from '@/lib/sharedCache';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is required');
}

// SECURITY: Validate API key format (should not be empty or just whitespace)
if (!BALLDONTLIE_API_KEY.trim()) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is invalid');
}

const LIVE_STATS_TTL_SECONDS = 20;

function buildLiveStatsCacheKey(playerId: string, gameId: string) {
  return `live-stats:${playerId}:${gameId}`;
}

function getAuthHeaders() {
  return {
    'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
  };
}

async function fetchJson(url: string) {
  const response = await fetch(url, {
    headers: getAuthHeaders(),
    cache: 'no-store',
  });

  if (!response.ok) {
    const error: any = new Error(`BallDontLie request failed with ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

async function resolveGameIdForPlayerOnDate(playerId: string, gameDate: string): Promise<string | null> {
  const gamesData = await fetchJson(`https://api.balldontlie.io/v1/games?dates[]=${gameDate}&per_page=100`);
  const games = Array.isArray(gamesData?.data) ? gamesData.data : [];
  if (games.length === 0) return null;

  const statsData = await fetchJson(
    `https://api.balldontlie.io/v1/stats?dates[]=${gameDate}&player_ids[]=${playerId}&per_page=100`
  );
  const stats = Array.isArray(statsData?.data) ? statsData.data : [];
  const matchingStat = stats.find((entry: any) => {
    const statGameId = entry?.game?.id;
    return statGameId != null && games.some((game: any) => String(game.id) === String(statGameId));
  });

  return matchingStat?.game?.id ? String(matchingStat.game.id) : null;
}

/**
 * Get live stats for a player in a specific game
 * Query params: playerId, gameId
 */
export async function GET(request: NextRequest) {
  try {
    const rateLimitResult = await checkRateLimitAsync(request, {
      keyPrefix: 'live-stats',
      maxRequests: process.env.NODE_ENV === 'development' ? 120 : 30,
      windowMs: 60 * 1000,
      fallbackLimiter: strictRateLimiter,
    });
    if (!rateLimitResult.allowed && rateLimitResult.response) {
      return rateLimitResult.response;
    }

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

    // If we have gameDate but not gameId, find the game first with at most
    // two upstream requests instead of one per game on the slate.
    let targetGameId = gameId;
    if (!targetGameId && gameDate) {
      targetGameId = await resolveGameIdForPlayerOnDate(playerId, gameDate);
    }

    if (!targetGameId) {
      return NextResponse.json(
        { error: 'Could not find game' },
        { status: 404 }
      );
    }

    const cacheKey = buildLiveStatsCacheKey(playerId, String(targetGameId));
    const cached = await sharedCache.getJSON<any>(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Fetch stats for this specific game and player
    const statsData = await fetchJson(
      `https://api.balldontlie.io/v1/stats?game_ids[]=${targetGameId}&player_ids[]=${playerId}`
    );
    
    if (!statsData.data || statsData.data.length === 0) {
      return NextResponse.json(
        { error: 'No stats found' },
        { status: 404 }
      );
    }

    const stat = statsData.data[0];
    
    const payload = {
      pts: stat.pts || 0,
      reb: stat.reb || 0,
      ast: stat.ast || 0,
      stl: stat.stl || 0,
      blk: stat.blk || 0,
      fg3m: stat.fg3m || 0,
      game: stat.game,
    };

    await sharedCache.setJSON(cacheKey, payload, LIVE_STATS_TTL_SECONDS);

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('Error fetching live stats:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch live stats' },
      { status: error?.status || 500 }
    );
  }
}

