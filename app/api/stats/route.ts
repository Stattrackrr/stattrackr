export const dynamic = 'force-dynamic';

// app/api/stats/route.ts
import { NextRequest, NextResponse } from "next/server";
import { BdlPlayerStats, BdlPaginatedResponse } from "@/lib/types/apiResponses";
import { TEAM_ID_TO_ABBR } from "@/lib/nbaConstants";
import { checkRateLimit } from "@/lib/rateLimit";
import cache, { CACHE_TTL, getCacheKey } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';
import { fetchBettingProsData, OUR_TO_BP_METRIC, OUR_TO_BP_ABBR } from '@/lib/bettingpros-dvp';
import { normalizeAbbr } from '@/lib/nbaAbbr';

export const runtime = "nodejs";

const BDL_BASE = "https://api.balldontlie.io/v1";
// Optional: set in your .env.local
// BALLDONTLIE_API_KEY=<your key for paid tier or v2 proxy if you have one>
const API_KEY = process.env.BALLDONTLIE_API_KEY;

// Request deduplication: track in-flight requests to prevent duplicate API calls
const inFlightRequests = new Map<string, Promise<BdlPlayerStats[]>>();

type DvpRankMap = Record<string, number>; // normalized team abbr -> rank

const DVP_METRICS = ['pts', 'reb', 'ast', 'fg3m', 'fg_pct', 'stl', 'blk'] as const;

async function getDvpRanks(metric: string, pos: string): Promise<DvpRankMap> {
  try {
    const bpData = await fetchBettingProsData(false);
    if (!bpData?.teamStats) return {};
    const bpMetric = OUR_TO_BP_METRIC[metric] || metric;
    const ranks: DvpRankMap = {};
    const teams = Object.keys(bpData.teamStats);

    const values: Array<{ team: string; value: number | null }> = teams.map((t) => {
      try {
        const normalizedTeam = normalizeAbbr(t);
        const bpTeamAbbr = OUR_TO_BP_ABBR[normalizedTeam] || normalizedTeam;
        const teamStats = bpData.teamStats?.[bpTeamAbbr];
        if (!teamStats) return { team: normalizedTeam, value: null };
        const positionData = teamStats[pos] || teamStats['ALL'];
        if (!positionData) return { team: normalizedTeam, value: null };
        const v = positionData[bpMetric];
        const num = v !== undefined && v !== null ? Number(v) : null;
        return { team: normalizedTeam, value: Number.isFinite(num) ? num : null };
      } catch {
        return { team: t, value: null };
      }
    });

    const valid = values.filter((v) => v.value != null) as Array<{ team: string; value: number }>;
    valid.sort((a, b) => a.value - b.value); // lower value -> better rank
    valid.forEach((v, idx) => {
      ranks[normalizeAbbr(v.team)] = idx + 1;
    });
    values.filter((v) => v.value == null).forEach((v) => {
      ranks[normalizeAbbr(v.team)] = 0;
    });
    return ranks;
  } catch (e) {
    console.warn('[Stats API] DVP rank fetch failed:', (e as any)?.message || e);
    return {};
  }
}

function mapOpponentAbbr(stat: any): string | null {
  const game = stat?.game as any;
  const teamAbbr = stat?.team?.abbreviation || stat?.team?.abbr || stat?.team?.name || null;
  const homeAbbr = game?.home_team?.abbreviation;
  const visitorAbbr = game?.visitor_team?.abbreviation;
  if (!teamAbbr || !homeAbbr || !visitorAbbr) return null;
  const teamNorm = normalizeAbbr(teamAbbr);
  const homeNorm = normalizeAbbr(homeAbbr);
  const visitorNorm = normalizeAbbr(visitorAbbr);
  if (teamNorm === homeNorm) return visitorNorm;
  if (teamNorm === visitorNorm) return homeNorm;
  return null;
}

function metricToField(metric: string): string {
  switch (metric) {
    case 'pts': return 'dvpRankPts';
    case 'reb': return 'dvpRankReb';
    case 'ast': return 'dvpRankAst';
    case 'fg3m': return 'dvpRankFg3m';
    case 'fg_pct': return 'dvpRankFgPct';
    case 'stl': return 'dvpRankStl';
    case 'blk': return 'dvpRankBlk';
    default: return `dvpRank_${metric}`;
  }
}

/**
 * Builds a BallDon'tLie URL for stats
 * BDL uses page-based pagination
 */
function buildStatsUrl(playerId: string, season: number, page: number = 1, perPage = 40, postseason?: boolean, gameIds?: number[]) {
  const url = new URL(`${BDL_BASE}/stats`);
  url.searchParams.set("per_page", String(perPage));
  url.searchParams.append("player_ids[]", String(playerId));
  
  // If gameIds are provided, use those instead of season filter
  if (gameIds && gameIds.length > 0) {
    gameIds.forEach(id => url.searchParams.append("game_ids[]", String(id)));
  } else {
    url.searchParams.append("seasons[]", String(season));
  }
  
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
      // SECURITY: Don't expose full URL in error messages (could contain sensitive params)
      const urlPath = url.pathname + url.search.replace(/[?&]api[_-]?key=[^&]*/gi, '').replace(/[?&]token=[^&]*/gi, '');
      reject(new Error(`BDL API timeout after ${timeoutMs/1000}s: ${urlPath}`));
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
      // SECURITY: Don't expose full URL in error messages (could contain sensitive params)
      const urlPath = url.pathname + url.search.replace(/[?&]api[_-]?key=[^&]*/gi, '').replace(/[?&]token=[^&]*/gi, '');
      const timeoutError: any = new Error(`BDL API request timed out after ${timeoutMs/1000}s: ${urlPath}`);
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
    // OPTIMIZATION: Allow skipping DvP ranks for faster initial load (can be fetched in background)
    const skipDvp = searchParams.get("skip_dvp") === "1" || searchParams.get("skip_dvp") === "true";
    
    // Support game_ids parameter for querying specific games (useful for players who changed teams)
    const gameIdsParam = searchParams.get("game_ids");
    const gameIds = gameIdsParam ? gameIdsParam.split(',').map(id => parseInt(id.trim(), 10)).filter(id => !isNaN(id)) : undefined;

    if (!playerId) {
      return NextResponse.json(
        { error: "Missing required query param: player_id" },
        { status: 400 }
      );
    }

    // Default to a safe recent season if not provided
    const season = Number(seasonParam || 2023);

    // Check cache first (before rate limiting) - include postseason and gameIds in cache key
    // This ensures regular season and postseason stats are cached separately
    // If gameIds are provided, use a different cache key
    const cacheKey = gameIds && gameIds.length > 0
      ? `${getCacheKey.playerStats(playerId, season)}_games_${gameIds.sort((a, b) => a - b).join('_')}`
      : `${getCacheKey.playerStats(playerId, season)}_${postseason ? 'po' : 'reg'}`;
    
    // Try in-memory cache first (fastest)
    let cachedData = cache.get<{ data: BdlPlayerStats[] }>(cacheKey);
    let cacheSource = 'memory';
    
    // If not in memory, try Supabase cache (persistent across cold starts)
    if (!cachedData && !forceRefresh) {
      try {
        const supabaseCache = await getNBACache<{ data: BdlPlayerStats[] }>(cacheKey, { quiet: true });
        if (supabaseCache && Array.isArray(supabaseCache.data) && supabaseCache.data.length > 0) {
          cachedData = supabaseCache;
          cacheSource = 'supabase';
          // Store in in-memory cache for faster future access
          cache.set(cacheKey, cachedData, CACHE_TTL.PLAYER_STATS);
        }
      } catch (error) {
        // Supabase cache failed, continue with fetch
        console.warn('[Stats API] Supabase cache check failed, continuing with fetch:', error);
      }
    }
    
    // Dashboard stats chart always bypasses cache (refresh=1) - other features can use cache
    if (forceRefresh) {
      // Bypassing cache (refresh=1)
    } else if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length > 0) {
      // Only use cache if it has actual data (not empty arrays) AND not forcing refresh
      // Using cached data (verbose logging removed for performance)
      // Return cached data immediately with HTTP cache headers for CDN caching
      return NextResponse.json(cachedData, { 
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600', // 5min CDN cache, 1hr stale
        }
      });
    }
    
    // If cache exists but is empty, log it and continue to fetch fresh data
    if (cachedData && Array.isArray(cachedData.data) && cachedData.data.length === 0) {
      // Cache hit but empty array, fetching fresh data
    }

    // Check if a request for this player/season/postseason is already in flight
    const requestKey = `${playerId}-${season}-${postseason ? 'po' : 'reg'}`;
    if (inFlightRequests.has(requestKey)) {
      // Request already in flight, waiting
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
      let dvpRanksByMetric: Record<string, DvpRankMap> | null = null;
      let stampedPosition: string | null = null;

      while (page <= maxPages) {
        const url = buildStatsUrl(playerId, season, page, perPageParam, postseason, gameIds);
        
        if (gameIds && gameIds.length > 0 && page === 1) {
          console.log(`[Stats API] 🔍 Fetching stats by game_ids: ${gameIds.join(',')} for player ${playerId}, URL: ${url.toString()}`);
        }
        
        let json: BdlPaginatedResponse<BdlPlayerStats>;
        
        try {
          // 30s timeout per page (reasonable for BDL API)
          json = await bdlFetch(url, 30000) as BdlPaginatedResponse<BdlPlayerStats>;
          
          if (gameIds && gameIds.length > 0 && page === 1) {
            console.log(`[Stats API] 🔍 Response for game_ids ${gameIds.join(',')}:`, {
              totalStats: json.data?.length || 0,
              meta: json.meta,
              sampleStat: json.data?.[0] ? {
                id: json.data[0].id,
                gameId: json.data[0].game?.id,
                date: json.data[0].game?.date,
                team: json.data[0].team?.abbreviation,
                min: json.data[0].min,
                pts: json.data[0].pts,
                reb: json.data[0].reb,
                ast: json.data[0].ast,
                playerId: (json.data[0] as any)?.player?.id
              } : null,
              allStats: json.data?.map(s => ({
                id: s.id,
                gameId: s.game?.id,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts
              }))
            });
          }
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

          const position = (stat as any)?.player?.position || (stat as any)?.position || null;
          if (position && !stampedPosition) {
            stampedPosition = position;
          }

          return {
            ...stat,
            game: {
              ...game,
              home_team: game.home_team ?? (homeAbbr ? { id: homeTeamId ?? null, abbreviation: homeAbbr } : undefined),
              visitor_team: game.visitor_team ?? (visitorAbbr ? { id: visitorTeamId ?? null, abbreviation: visitorAbbr } : undefined),
            },
            dvpRankPts: null as number | null,
            dvpRankReb: null as number | null,
            dvpRankAst: null as number | null,
            dvpRankFg3m: null as number | null,
            dvpRankFgPct: null as number | null,
            dvpRankStl: null as number | null,
            dvpRankBlk: null as number | null,
          };
        });

        // If we now know the position and haven't fetched ranks yet, do it once (all metrics)
        // OPTIMIZATION: Fetch all DvP ranks in parallel instead of sequentially
        // OPTIMIZATION: Skip DvP on initial load for faster response (can be fetched in background)
        if (!dvpRanksByMetric && stampedPosition && !skipDvp) {
          // Fetch all metrics in parallel for faster response
          // TypeScript: stampedPosition is guaranteed to be non-null here due to the if condition
          const position = stampedPosition;
          const rankPromises = DVP_METRICS.map(m => 
            getDvpRanks(m, position).then(ranks => ({ metric: m, ranks }))
          );
          const rankResults = await Promise.all(rankPromises);
          const ranksMap: Record<string, DvpRankMap> = {};
          rankResults.forEach(({ metric, ranks }) => {
            ranksMap[metric] = ranks;
          });
          dvpRanksByMetric = ranksMap;
        }

        // Stamp dvp ranks for this batch if ranks are available
        if (dvpRanksByMetric) {
          for (const stat of batch as any[]) {
            const opp = mapOpponentAbbr(stat);
            if (!opp) continue;
            const normOpp = normalizeAbbr(opp);
            for (const m of DVP_METRICS) {
              const field = metricToField(m);
              if (stat[field] !== null && stat[field] !== undefined) continue;
              const ranks = dvpRanksByMetric[m];
              const rank = ranks ? ranks[normOpp] : null;
              stat[field] = rank ?? null;
            }
          }
        }

        // Debug: log sample stat structure to verify game/team are included      
        // Verbose logging removed for performance

        all.push(...batch);
        
        // Debug: Log last season stats on first page to diagnose team/minutes issues
        if (page === 1) {
          const currentSeason = new Date().getFullYear();
          const currentMonth = new Date().getMonth();
          const nbaSeason = currentMonth >= 9 ? currentSeason : currentSeason - 1;
          if (season === nbaSeason - 1) {
            const teams = new Set(batch.map(s => s?.team?.abbreviation).filter(Boolean));
            const withMinutes = batch.filter(s => {
              const min = s.min;
              if (!min || min === '0:00' || min === '00' || min === '0') return false;
              return true;
            });
            console.log(`[Stats API] Last season (${season}) page 1: total=${batch.length}, with minutes>0=${withMinutes.length}, teams=${Array.from(teams).join(',')}`);
            if (batch.length > 0 && withMinutes.length === 0) {
              const sample = batch.slice(0, 5).map(s => ({
                date: s.game?.date,
                team: s.team?.abbreviation,
                min: s.min,
                pts: s.pts,
                reb: s.reb,
                ast: s.ast,
                fgm: s.fgm,
                fga: s.fga,
                fg3m: s.fg3m,
                ftm: s.ftm,
                // Check game data for team info
                homeTeam: s.game?.home_team?.abbreviation,
                visitorTeam: s.game?.visitor_team?.abbreviation
              }));
              console.log(`[Stats API] ⚠️ All stats on page 1 have 0 minutes! Sample:`, sample);
              
              // Also log the FULL first stat object to see ALL fields
              if (batch.length > 0) {
                const firstStat = batch[0];
                console.log(`[Stats API] ⚠️ FULL FIRST STAT OBJECT (last season):`, {
                  id: firstStat.id,
                  min: firstStat.min,
                  pts: firstStat.pts,
                  reb: firstStat.reb,
                  ast: firstStat.ast,
                  fgm: firstStat.fgm,
                  fga: firstStat.fga,
                  fg3m: firstStat.fg3m,
                  ftm: firstStat.ftm,
                  fta: firstStat.fta,
                  stl: firstStat.stl,
                  blk: firstStat.blk,
                  turnover: firstStat.turnover,
                  pf: firstStat.pf,
                  team: firstStat.team,
                  game: firstStat.game,
                  // Check ALL numeric fields > 0
                  allNumericFields: Object.entries(firstStat).filter(([k, v]) => typeof v === 'number' && v > 0).map(([k, v]) => ({ [k]: v })),
                  // Check ALL fields with values (non-null, non-undefined, non-empty, non-zero)
                  allFieldsWithValues: Object.entries(firstStat).filter(([k, v]) => {
                    if (v === null || v === undefined || v === '') return false;
                    if (typeof v === 'number' && v === 0) return false;
                    if (typeof v === 'string' && v === '0' || v === '00' || v === '0:00') return false;
                    return true;
                  }).map(([k, v]) => ({ [k]: v })).slice(0, 30)
                });
              }
            }
          }
        }

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
        // Store in in-memory cache (fast, but lost on cold start)
        cache.set(cacheKey, responseData, CACHE_TTL.PLAYER_STATS);
        // Store in Supabase cache (persistent across cold starts)
        setNBACache(cacheKey, 'player_stats', responseData, CACHE_TTL.PLAYER_STATS, true).catch(err => {
          console.warn('[Stats API] Failed to store in Supabase cache:', err);
        });
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
      return NextResponse.json({ data: all }, { 
        status: 200,
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600', // 5min CDN cache, 1hr stale
        }
      });
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
