export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, apiRateLimiter } from '@/lib/rateLimit';
import cache, { CACHE_TTL } from '@/lib/cache';
import { getNBACache, setNBACache } from '@/lib/nbaCache';

/**
 * Batched DVP Rank API endpoint
 * Fetches rankings for multiple metrics in a single request
 * 
 * Query params:
 * - pos: Position (e.g., "PG", "SG", "SF", "PF", "C")
 * - metrics: Comma-separated list of metrics (e.g., "pts,reb,ast")
 * - games: Number of games to analyze (default: 82)
 * 
 * Example: /api/dvp/rank/batch?pos=PG&metrics=pts,reb,ast&games=82
 */
export async function GET(request: NextRequest) {
  // Rate limiting
  const rateResult = checkRateLimit(request, apiRateLimiter);
  if (!rateResult.allowed && rateResult.response) {
    return rateResult.response;
  }

  try {
    const { searchParams } = new URL(request.url);
    const pos = searchParams.get('pos');
    const metricsParam = searchParams.get('metrics');
    const games = searchParams.get('games') || '82';

    if (!pos) {
      return NextResponse.json(
        { error: 'Missing required parameter: pos' },
        { status: 400 }
      );
    }

    if (!metricsParam) {
      return NextResponse.json(
        { error: 'Missing required parameter: metrics' },
        { status: 400 }
      );
    }

    const metrics = metricsParam.split(',').map(m => m.trim());
    const forceRefresh = searchParams.get('refresh') === '1';

    // Cache key for batch results
    const cacheKey = `dvp_rank_batch:${pos}:${metrics.join(',')}:${games}`;
    
    // Check cache first (in-memory, then Supabase)
    if (!forceRefresh) {
      // Try in-memory cache first
      let hit = cache.get<any>(cacheKey);
      if (hit) {
        return NextResponse.json(hit, {
          headers: {
            'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
          }
        });
      }
      
      // Try Supabase cache
      try {
        const supabaseHit = await getNBACache<any>(cacheKey, { quiet: true });
        if (supabaseHit) {
          // Validate that cached data has metrics with non-empty ranks
          const hasValidMetrics = supabaseHit.metrics && 
            Object.keys(supabaseHit.metrics).length > 0 &&
            Object.values(supabaseHit.metrics).some((ranks: any) => 
              ranks && typeof ranks === 'object' && Object.keys(ranks).length > 0
            );
          
          if (hasValidMetrics) {
            console.log(`[DVP Rank Batch] ✅ Supabase cache HIT for ${cacheKey}`, {
              metricKeys: Object.keys(supabaseHit.metrics),
              sampleMetric: supabaseHit.metrics.pts ? {
                teamCount: Object.keys(supabaseHit.metrics.pts).length,
                sampleTeams: Object.keys(supabaseHit.metrics.pts).slice(0, 5)
              } : null
            });
            cache.set(cacheKey, supabaseHit, CACHE_TTL.ADVANCED_STATS);
            return NextResponse.json(supabaseHit, {
              headers: {
                'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
              }
            });
          } else {
            console.warn(`[DVP Rank Batch] ⚠️ Cached data has empty metrics, forcing refresh for ${cacheKey}`, {
              hasMetrics: !!supabaseHit.metrics,
              metricKeys: supabaseHit.metrics ? Object.keys(supabaseHit.metrics) : [],
              sampleMetric: supabaseHit.metrics?.pts ? {
                teamCount: Object.keys(supabaseHit.metrics.pts).length
              } : null
            });
            // Continue to fetch fresh data instead of returning empty cache
          }
        }
      } catch (error) {
        console.warn('[DVP Rank Batch] Supabase cache check failed, continuing with fetch:', error);
      }
    }

    // Fetch all metric rankings in parallel
    // Instead of making HTTP calls, directly import and call the rank endpoint logic
    // This avoids issues with internal API calls on local development
    const results = await Promise.all(
      metrics.map(async (metric) => {
        try {
          // Create a mock request object for the rank endpoint
          const rankRequestUrl = new URL('/api/dvp/rank', request.url);
          rankRequestUrl.searchParams.set('metric', metric);
          rankRequestUrl.searchParams.set('pos', pos);
          rankRequestUrl.searchParams.set('games', games);
          if (forceRefresh) {
            rankRequestUrl.searchParams.set('refresh', '1');
          }

          // For internal API calls, use the request's origin
          // On local, this will be http://localhost:3000, on production it will be the actual domain
          const baseUrl = request.nextUrl.origin || 'http://localhost:3000';
          const fetchUrl = `${baseUrl}${rankRequestUrl.pathname}${rankRequestUrl.search}`;
          
          // Make the internal API call
          const response = await fetch(fetchUrl, {
            // Don't forward all headers - just the essential ones
            headers: {
              'user-agent': request.headers.get('user-agent') || 'StatTrackr-Internal',
            },
            // Use no-store to bypass Next.js cache for internal calls
            cache: 'no-store',
          });

          if (!response.ok) {
            console.error(`Failed to fetch rank for ${metric} (${pos}): ${response.status}`);
            return {
              metric,
              error: `HTTP ${response.status}`,
              ranks: {},
            };
          }

          const data = await response.json();
          
          // Ensure we have ranks in the response
          if (!data || typeof data !== 'object') {
            console.error(`[DVP Rank Batch] Invalid response for ${metric} (${pos}):`, data);
            return {
              metric,
              error: 'Invalid response structure',
              ranks: {},
            };
          }
          
          // The individual rank endpoint returns { success: true, ranks: {...} }
          const ranks = data.ranks || {};
          
          // Debug logging - always log to see what we're getting
          console.log(`[DVP Rank Batch] Response for ${metric} (${pos}):`, {
            success: data.success,
            hasRanks: !!ranks,
            rankCount: Object.keys(ranks).length,
            sampleKeys: Object.keys(ranks).slice(0, 10),
            sampleRanks: Object.fromEntries(Object.entries(ranks).slice(0, 5)),
            // Log all team keys to see normalization
            allTeamKeys: Object.keys(ranks).sort(),
            // Verify ranks are numbers
            sampleRankValues: Object.fromEntries(
              Object.entries(ranks).slice(0, 5).map(([team, rank]) => [team, { rank, type: typeof rank }])
            ),
            fullResponse: data // Log full response to debug
          });
          
          if (!ranks || Object.keys(ranks).length === 0) {
            console.error(`[DVP Rank Batch] ⚠️ No ranks returned for ${metric} (${pos}):`, {
              success: data.success,
              hasRanks: !!ranks,
              rankCount: Object.keys(ranks).length,
              error: data.error,
              fullData: data
            });
          }
          
          return {
            metric,
            ranks: ranks,
          };
        } catch (error: any) {
          console.error(`Error fetching rank for ${metric} (${pos}):`, error);
          return {
            metric,
            error: error?.message || 'Unknown error',
            ranks: {},
          };
        }
      })
    );

    // Transform results into a more convenient format
    const response: {
      pos: string;
      games: string;
      metrics: Record<string, Record<string, number>>;
    } = {
      pos,
      games,
      metrics: {},
    };

    for (const result of results) {
      if (result.error) {
        console.warn(`[DVP Rank Batch] Skipping ${result.metric} due to error: ${result.error}`);
        continue;
      }
      if (!result.ranks || Object.keys(result.ranks).length === 0) {
        console.warn(`[DVP Rank Batch] Skipping ${result.metric} - empty ranks`);
        continue;
      }
      response.metrics[result.metric] = result.ranks;
    }
    
    // Debug: log final response structure
    console.log(`[DVP Rank Batch] Final response structure:`, {
      pos: response.pos,
      games: response.games,
      metricKeys: Object.keys(response.metrics),
      totalMetrics: Object.keys(response.metrics).length,
      sampleMetric: response.metrics.pts ? {
        teamCount: Object.keys(response.metrics.pts).length,
        sampleTeams: Object.keys(response.metrics.pts).slice(0, 5)
      } : null
    });

    // Cache the response
    cache.set(cacheKey, response, CACHE_TTL.ADVANCED_STATS);
    setNBACache(cacheKey, 'dvp_rank_batch', response, CACHE_TTL.ADVANCED_STATS, true).catch(err => {
      console.warn('[DVP Rank Batch] Failed to store in Supabase cache:', err);
    });

    // Final debug log before returning
    console.log(`[DVP Rank Batch] ✅ Returning final response for ${pos}:`, {
      pos: response.pos,
      games: response.games,
      metricsCount: Object.keys(response.metrics).length,
      metricKeys: Object.keys(response.metrics),
      sampleMetricData: response.metrics.pts ? {
        teamCount: Object.keys(response.metrics.pts).length,
        sampleTeams: Object.keys(response.metrics.pts).slice(0, 5),
        sampleRanks: Object.fromEntries(Object.entries(response.metrics.pts).slice(0, 5))
      } : 'pts not found'
    });

    return NextResponse.json(response, {
      headers: {
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=3600',
      }
    });
  } catch (error: any) {
    console.error('Error in batch rank endpoint:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
