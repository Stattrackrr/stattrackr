export const dynamic = 'force-dynamic';

// app/api/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { BdlPlayerStats, BdlPaginatedResponse } from "@/lib/types/apiResponses";
import { TEAM_ID_TO_ABBR } from "@/lib/nbaConstants";
import { checkRateLimit } from "@/lib/rateLimit";
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/v1";
// Optional: set in your .env.local
// BALLDONTLIE_API_KEY=<your key for paid tier or v2 proxy if you have one>
const API_KEY = process.env.BALLDONTLIE_API_KEY;

/**
 * Builds a BallDon'tLie URL for stats
 * We use array-style params so it works across BDL versions that accept it.
 */
function buildStatsUrl(playerId: string, season: number, page = 1, perPage = 40, postseason = false) {
  const url = new URL(`${BDL_BASE}/stats`);
  url.searchParams.set("page", String(page));
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.append("player_ids[]", String(playerId));
  url.searchParams.append("seasons[]", String(season));
  // Include postseason filter when requested
  url.searchParams.set("postseason", postseason ? "true" : "false");
  return url;
}

async function bdlFetch(url: URL) {
  // Some deployments require a Bearer token, some don’t (public tier).
  const headers: Record<string, string> = {};
  if (API_KEY) headers["Authorization"] = `Bearer ${API_KEY}`;

  const res = await fetch(url, { headers });
  // If BDL returns a rate-limit message or 4xx, surface it gracefully
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`BallDon'tLie ${res.status}: ${txt || res.statusText}`);
  }
  return res.json();
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get("player_id");
    const seasonParam = searchParams.get("season");
    const perPageParam = Number(searchParams.get("per_page") || 40);
    const maxPages = Number(searchParams.get("max_pages") || 3); // cap requests
    const postseason = (searchParams.get("postseason") || "false").toLowerCase() === "true";
    const forceRefresh = searchParams.get("refresh") === "1" || searchParams.get("refresh") === "true";

    if (!playerId) {
      return NextResponse.json(
        { error: "Missing required query param: player_id" },
        { status: 400 }
      );
    }

    // Default to a safe recent season if not provided
    const season = Number(seasonParam || 2023);

    // Check cache first (before rate limiting) - use same cache key format as /api/bdl/stats
    const cacheKey = getCacheKey.playerStats(playerId, season);
    const cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
    // Only use cache if it has actual data (not empty arrays) AND not forcing refresh
    if (!forceRefresh && cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
      // Debug: log cached data structure to verify game/team are included
      if (cachedData.data.length > 0) {
        console.log('[Stats API] Cached stat structure:', {
          playerId,
          season,
          totalStats: cachedData.data.length,
          hasGame: !!cachedData.data[0]?.game,
          hasGameDate: !!cachedData.data[0]?.game?.date,
          hasTeam: !!cachedData.data[0]?.team,
          hasTeamAbbr: !!cachedData.data[0]?.team?.abbreviation,
          sampleStatKeys: Object.keys(cachedData.data[0] || {}),
        });
      }
      // Return cached data even if rate limited
      return NextResponse.json(cachedData, { status: 200 });
    }
    
    // If cache exists but is empty, log it and continue to fetch fresh data
    if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length === 0) {
      console.log(`[Stats API] Cache hit but empty array for player ${playerId}, season ${season}. Fetching fresh data...`);
    }

    // Only check rate limit if we need to fetch fresh data
    const rateLimitResult = checkRateLimit(req);
    if (!rateLimitResult.allowed) {
      // If rate limited but we have some cached data (even if empty), return it
      if (cachedData) {
        return NextResponse.json(cachedData, { status: 200 });
      }
      // No cache and rate limited - return error
      return rateLimitResult.response!;
    }

    const all: BdlPlayerStats[] = [];
    let page = 1;

    while (page <= maxPages) {
      const url = buildStatsUrl(playerId, season, page, perPageParam, postseason);
      const json = await bdlFetch(url) as BdlPaginatedResponse<BdlPlayerStats>;

      // Expect shape: { data: [], meta: { next_page, total_pages, current_page } }
      // Enrich each stat with home/visitor team objects (some BDL responses only include *_team_id)
      const batch = (Array.isArray(json?.data) ? json.data : []).map((stat) => {
        if (!stat?.game) return stat;
        const game = stat.game as any;
        const homeTeamId = game.home_team?.id ?? game.home_team_id;
        const visitorTeamId = game.visitor_team?.id ?? game.visitor_team_id;
        const homeAbbr = game.home_team?.abbreviation ?? (homeTeamId ? TEAM_ID_TO_ABBR[homeTeamId] : undefined);
        const visitorAbbr = game.visitor_team?.abbreviation ?? (visitorTeamId ? TEAM_ID_TO_ABBR[visitorTeamId] : undefined);

        return {
          ...stat,
          game: {
            ...game,
            home_team: game.home_team ?? (homeAbbr ? { id: homeTeamId ?? null, abbreviation: homeAbbr } : undefined),
            visitor_team: game.visitor_team ?? (visitorAbbr ? { id: visitorTeamId ?? null, abbreviation: visitorAbbr } : undefined),
          },
        };
      });
      
      // Debug: log sample stat structure to verify game/team are included
      if (batch.length > 0 && all.length === 0) {
        console.log('[Stats API] Sample stat from BDL:', {
          hasGame: !!batch[0]?.game,
          hasGameDate: !!batch[0]?.game?.date,
          hasTeam: !!batch[0]?.team,
          hasTeamAbbr: !!batch[0]?.team?.abbreviation,
          statKeys: Object.keys(batch[0] || {}),
        });
      }
      
      all.push(...batch);

      const nextPage =
        (json?.meta as any)?.next_page ?? ((json?.meta?.current_page ?? 0) < (json?.meta?.total_pages ?? 0) ? page + 1 : null);

      if (!nextPage) break;
      page = nextPage;
    }

    // Cache the successful response (only if we have data)
    const responseData = { data: all };
    // Only cache if we have actual data (don't cache empty arrays)
    if (all.length > 0) {
      cache.set(cacheKey, responseData, CACHE_TTL.PLAYER_STATS);
    } else {
      console.log(`[Stats API] Not caching empty array for player ${playerId}, season ${season}`);
    }

    return NextResponse.json(responseData, { status: 200 });
  } catch (err: any) {
    console.error('Stats API error:', err);
    
    // Try to return cached data even on error
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get("player_id");
    const seasonParam = searchParams.get("season");
    const season = Number(seasonParam || 2023);
    if (playerId) {
      const cacheKey = getCacheKey.playerStats(playerId, season);
      const cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
      if (cachedData) {
        return NextResponse.json(cachedData, { status: 200 });
      }
    }
    
    return NextResponse.json(
      { error: err?.message || "Internal error fetching stats", data: [] },
      { status: 500 }
    );
  }
}
