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

// Request deduplication: track in-flight requests to prevent duplicate API calls
const inFlightRequests = new Map<string, Promise<BdlPlayerStats[]>>();

/**
 * Builds a BallDon'tLie URL for stats
 * BDL uses page-based pagination
 */
function buildStatsUrl(playerId: string, season: number, page: number = 1, perPage = 40, postseason?: boolean) {
  const url = new URL(`${BDL_BASE}/stats`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.append("player_ids[]", String(playerId));
  url.searchParams.append("seasons[]", String(season));
  // Only include postseason filter if explicitly requested (undefined = fetch both)
  // Note: BDL docs say "posteason" (typo) but we use "postseason" which works
  if (postseason !== undefined) {
    url.searchParams.set("postseason", postseason ? "true" : "false");
  }
  // Use page for pagination
  if (page > 1) {
    url.searchParams.set("page", String(page));
  }
  return url;
}

async function bdlFetch(url: URL, timeoutMs: number = 30000) {
  // BDL docs say "Authorization: YOUR_API_KEY" but Bearer format also works
  // We use Bearer format for consistency with other APIs
  const headers: Record<string, string> = {};
  if (API_KEY) {
    // Support both formats: if key already has "Bearer ", use as-is, otherwise add it
    headers["Authorization"] = API_KEY.startsWith('Bearer ') ? API_KEY : `Bearer ${API_KEY}`;
  }

  // Add timeout to prevent hanging requests (30s per page is reasonable)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => {
      reject(new Error(`BDL API timeout after ${timeoutMs/1000}s: ${url.toString()}`));
    }, timeoutMs);
  });

  const fetchPromise = fetch(url, { headers });
  
  try {
    const res = await Promise.race([fetchPromise, timeoutPromise]);
    // If BDL returns a rate-limit message or 4xx, surface it gracefully
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      const error: any = new Error(`BallDon'tLie ${res.status}: ${txt || res.statusText}`);
      error.status = res.status;
      error.response = res;
      throw error;
    }
    return res.json();
  } catch (error: any) {
    // If it's a timeout, make it clear
    if (error.message?.includes('timeout')) {
      const timeoutError: any = new Error(`BDL API request timed out after ${timeoutMs/1000}s: ${url.toString()}`);
      timeoutError.isTimeout = true;
      throw timeoutError;
    }
    throw error;
  }
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

    // Check cache first (before rate limiting) - include postseason in cache key
    // This ensures regular season and postseason stats are cached separately
    const cacheKey = `${getCacheKey.playerStats(playerId, season)}_${postseason ? 'po' : 'reg'}`;
    const cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
    
    // Dashboard stats chart always bypasses cache (refresh=1) - other features can use cache
    if (forceRefresh) {
      console.log(`[Stats API] 🔄 Bypassing cache (refresh=1) for player ${playerId}, season ${season}, postseason ${postseason}`);
    } else if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
      // Only use cache if it has actual data (not empty arrays) AND not forcing refresh
      // Debug: log cached data structure to verify game/team are included
      if (cachedData.data.length > 0) {
        console.log('[Stats API] ✅ Using cached data:', {
          playerId,
          season,
          postseason,
          totalStats: cachedData.data.length,
          hasGame: !!cachedData.data[0]?.game,
          hasGameDate: !!cachedData.data[0]?.game?.date,
          hasTeam: !!cachedData.data[0]?.team,
          hasTeamAbbr: !!cachedData.data[0]?.team?.abbreviation,
          sampleStatKeys: Object.keys(cachedData.data[0] || {}),
        });
      }
      // Return cached data immediately - no rate limit check needed for cached responses
      return NextResponse.json(cachedData, { status: 200 });
    }
    
    // If cache exists but is empty, log it and continue to fetch fresh data
    if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length === 0) {
      console.log(`[Stats API] Cache hit but empty array for player ${playerId}, season ${season}, postseason ${postseason}. Fetching fresh data...`);
    }

    // Check if a request for this player/season/postseason is already in flight
    const requestKey = `${playerId}-${season}-${postseason ? 'po' : 'reg'}`;
    if (inFlightRequests.has(requestKey)) {
      console.log(`[Stats API] Request already in flight for ${requestKey}, waiting...`);
      try {
        const existingData = await inFlightRequests.get(requestKey)!;
        return NextResponse.json({ data: existingData }, { status: 200 });
      } catch (error) {
        // If the in-flight request failed, continue to make a new request
        console.warn(`[Stats API] In-flight request failed for ${requestKey}, making new request`);
      }
    }

    // Only check rate limit if we need to fetch fresh data (after cache check)
    // This ensures cached requests don't count against rate limit
    // Skip rate limiting in development to allow faster testing
    const isDev = process.env.NODE_ENV === 'development';
    if (!isDev) {
      const rateLimitResult = checkRateLimit(req);
      if (!rateLimitResult.allowed) {
        // If rate limited but we have some cached data (even if empty), return it
        if (cachedData) {
          console.log(`[Stats API] Rate limited but returning cached data for player ${playerId}, season ${season}, postseason ${postseason}`);
          return NextResponse.json(cachedData, { status: 200 });
        }
        // No cache and rate limited - return 429 with retry-after header
        console.warn(`[Stats API] Rate limited with no cache for player ${playerId}, season ${season}, postseason ${postseason}`);
        return rateLimitResult.response!;
      }
    }

    // Create a promise for this request and store it
    const fetchPromise = (async (): Promise<BdlPlayerStats[]> => {
      const all: BdlPlayerStats[] = [];
      let page = 1;

      while (page <= maxPages) {
        const url = buildStatsUrl(playerId, season, page, perPageParam, postseason);
        let json: BdlPaginatedResponse<BdlPlayerStats>;
        
        try {
          // 30s timeout per page (reasonable for BDL API)
          json = await bdlFetch(url, 30000) as BdlPaginatedResponse<BdlPlayerStats>;
        } catch (error: any) {
          // If timeout on first page, try to return cached data
          if (error.isTimeout && page === 1) {
            console.warn(`[Stats API] Timeout on first page for player ${playerId}, season ${season}, postseason ${postseason} - checking cache...`);
            const cacheKey = `${getCacheKey.playerStats(playerId, season)}_${postseason ? 'po' : 'reg'}`;
            const cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
            if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
              console.log(`[Stats API] Returning cached data after timeout: ${cachedData.data.length} stats`);
              return cachedData.data;
            }
          }
          
          // If timeout on later pages, return what we have so far
          if (error.isTimeout && all.length > 0) {
            console.warn(`[Stats API] Timeout on page ${page}, returning ${all.length} stats collected so far`);
            return all;
          }
          
          // Otherwise, re-throw the error
          throw error;
        } 

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
          const sampleStat = batch[0];
          console.log('[Stats API] Sample stat from BDL:', {
            playerId,
            season,
            postseason,
            hasGame: !!sampleStat?.game,
            hasGameDate: !!sampleStat?.game?.date,
            hasTeam: !!sampleStat?.team,
            hasTeamAbbr: !!sampleStat?.team?.abbreviation,
            statKeys: Object.keys(sampleStat || {}),
            // Log actual stat values to verify all fields are present
            statValues: {
              pts: sampleStat?.pts,
              reb: sampleStat?.reb,
              ast: sampleStat?.ast,
              stl: sampleStat?.stl,
              blk: sampleStat?.blk,
              fg3m: sampleStat?.fg3m,
              fgm: sampleStat?.fgm,
              fga: sampleStat?.fga,
              ftm: sampleStat?.ftm,
              fta: sampleStat?.fta,
              turnover: sampleStat?.turnover,
              pf: sampleStat?.pf,
              oreb: sampleStat?.oreb,
              dreb: sampleStat?.dreb,
            },
          });
        }
        
        // Log batch summary to see if we're getting all stat types
        if (batch.length > 0) {
          const statCounts = {
            hasPts: batch.filter(s => s.pts !== undefined && s.pts !== null).length,
            hasReb: batch.filter(s => s.reb !== undefined && s.reb !== null).length,
            hasAst: batch.filter(s => s.ast !== undefined && s.ast !== null).length,
            hasStl: batch.filter(s => s.stl !== undefined && s.stl !== null).length,
            hasBlk: batch.filter(s => s.blk !== undefined && s.blk !== null).length,
            hasFg3m: batch.filter(s => s.fg3m !== undefined && s.fg3m !== null).length,
          };
          console.log(`[Stats API] Page ${page} stat coverage (${batch.length} stats):`, statCounts);
        }

        all.push(...batch);

        const nextPage =
          (json?.meta as any)?.next_page ?? ((json?.meta?.current_page ?? 0) < (json?.meta?.total_pages ?? 0) ? page + 1 : null);

        if (!nextPage) break;
        page = nextPage;
      }

      // Cache the successful response (only if we have data)
      // Use the same cache key format that includes postseason
      const responseData = { data: all };
      // Only cache if we have actual data (don't cache empty arrays)
      if (all.length > 0) {
        cache.set(cacheKey, responseData, CACHE_TTL.PLAYER_STATS);
      } else {
        console.log(`[Stats API] Not caching empty array for player ${playerId}, season ${season}, postseason ${postseason}`);
      }

      return all;
    })();

    // Store the promise for deduplication
    inFlightRequests.set(requestKey, fetchPromise);

    try {
      // Add overall timeout (60s total for all pages - should be enough for 3 pages at 30s each)
      // But we want to fail faster if it's really stuck
      const overallTimeout = 60000; // 60s total
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`Stats API overall timeout after ${overallTimeout/1000}s for player ${playerId}`));
        }, overallTimeout);
      });
      
      const all = await Promise.race([fetchPromise, timeoutPromise]);
      return NextResponse.json({ data: all }, { status: 200 });
    } catch (error: any) {
      // On timeout, try to return cached data
      if (error.message?.includes('timeout')) {
        console.warn(`[Stats API] Overall timeout for player ${playerId}, season ${season}, postseason ${postseason} - checking cache...`);
        const cacheKey = `${getCacheKey.playerStats(playerId, season)}_${postseason ? 'po' : 'reg'}`;
        const cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
        if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
          console.log(`[Stats API] Returning cached data after overall timeout: ${cachedData.data.length} stats`);
          return NextResponse.json(cachedData, { status: 200 });
        }
      }
      throw error;
    } finally {
      // Remove from in-flight requests when done
      inFlightRequests.delete(requestKey);
    }
  } catch (err: any) {
    console.error('Stats API error:', err);
    
    // Try to return cached data even on error
    const { searchParams } = new URL(req.url);
    const playerId = searchParams.get("player_id");
    const seasonParam = searchParams.get("season");
    const season = Number(seasonParam || 2023);
    const postseason = (searchParams.get("postseason") || "false").toLowerCase() === "true";
    if (playerId) {
      const cacheKey = `${getCacheKey.playerStats(playerId, season)}_${postseason ? 'po' : 'reg'}`;
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
