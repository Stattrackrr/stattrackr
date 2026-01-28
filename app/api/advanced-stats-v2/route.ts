export const dynamic = 'force-dynamic';

// app/api/advanced-stats-v2/route.ts
import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import cache, { CACHE_TTL } from "@/lib/cache";

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/nba/v2";
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Builds a Ball Don't Lie V2 URL for advanced stats
 */
function buildAdvancedStatsV2Url(playerIds?: number[], season?: string, postseason = false, gameIds?: number[]) {
  const url = new URL(`${BDL_BASE}/stats/advanced`);
  
  // Add player IDs (if provided)
  if (playerIds && playerIds.length > 0) {
    playerIds.forEach(id => url.searchParams.append('player_ids[]', id.toString()));
  }
  
  // Add game IDs (if provided) - takes precedence over season filter
  if (gameIds && gameIds.length > 0) {
    gameIds.forEach(id => url.searchParams.append('game_ids[]', id.toString()));
  } else if (season) {
    // Only use season filter if gameIds not provided
    url.searchParams.append('seasons[]', season);
  }
  
  url.searchParams.set('postseason', postseason.toString());
  
  return url;
}

async function bdlFetch(url: URL) {
  const headers: Record<string, string> = {};
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers, cache: "no-store" });
  
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BallDontLie V2 ${res.status}: ${txt || res.statusText}`);
  }
  
  return res.json();
}

export async function GET(req: NextRequest) {
  // Check rate limit
  const rateLimitResult = checkRateLimit(req);
  if (!rateLimitResult.allowed) {
    return rateLimitResult.response!;
  }

  try {
    const { searchParams } = new URL(req.url);
    
    // Get player IDs (optional if game_ids provided)
    const playerIdsParam = searchParams.get("player_ids");
    const playerIds = playerIdsParam 
      ? playerIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : undefined;
    
    // Get game IDs (optional if player_ids provided)
    const gameIdsParam = searchParams.get("game_ids");
    const gameIds = gameIdsParam 
      ? gameIdsParam.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id))
      : undefined;
    
    // Require either player_ids or game_ids
    if ((!playerIds || playerIds.length === 0) && (!gameIds || gameIds.length === 0)) {
      return NextResponse.json(
        { error: "Missing required query param: player_ids or game_ids" },
        { status: 400 }
      );
    }
    
    const season = searchParams.get("season") || undefined;
    const postseason = searchParams.get("postseason") === "true";
    const forceRefresh = searchParams.get("refresh") === "1";
    
    // Build cache key based on parameters
    const cacheKeyParts = [];
    if (playerIds && playerIds.length > 0) {
      cacheKeyParts.push(`players_${playerIds.sort((a, b) => a - b).join(',')}`);
    }
    if (gameIds && gameIds.length > 0) {
      cacheKeyParts.push(`games_${gameIds.sort((a, b) => a - b).join(',')}`);
    }
    if (season) {
      cacheKeyParts.push(`season_${season}`);
    }
    if (postseason) {
      cacheKeyParts.push('postseason');
    }
    const cacheKey = `advanced_stats_v2:${cacheKeyParts.join(':')}`;
    
    // Check cache first (unless forcing refresh)
    if (!forceRefresh) {
      const cached = cache.get<any>(cacheKey);
      if (cached) {
        return NextResponse.json(cached, { status: 200 });
      }
    }
    
    const url = buildAdvancedStatsV2Url(playerIds, season, postseason, gameIds);
    const json = await bdlFetch(url);
    
    // Cache the response (advanced stats don't change after games are complete)
    cache.set(cacheKey, json, CACHE_TTL.ADVANCED_STATS);
    
    return NextResponse.json(json, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal error fetching advanced stats V2" },
      { status: 500 }
    );
  }
}
