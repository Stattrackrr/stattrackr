export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit, apiRateLimiter } from '@/lib/rateLimit';

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

    // Fetch all metric rankings in parallel
    const results = await Promise.all(
      metrics.map(async (metric) => {
        try {
          // Construct URL for individual rank endpoint
          const rankUrl = new URL('/api/dvp/rank', request.url);
          rankUrl.searchParams.set('metric', metric);
          rankUrl.searchParams.set('pos', pos);
          rankUrl.searchParams.set('games', games);
          if (forceRefresh) {
            rankUrl.searchParams.set('refresh', '1');
          }

          // Use absolute URL for internal API calls
          const fullUrl = new URL(rankUrl.pathname + rankUrl.search, request.nextUrl.origin);
          
          const response = await fetch(fullUrl.toString(), {
            headers: request.headers,
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
          
          // Debug logging
          if (!data.ranks || Object.keys(data.ranks || {}).length === 0) {
            console.error(`[DVP Rank Batch] No ranks returned for ${metric} (${pos}):`, {
              success: data.success,
              hasRanks: !!data.ranks,
              rankCount: data.ranks ? Object.keys(data.ranks).length : 0,
              sampleKeys: data.ranks ? Object.keys(data.ranks).slice(0, 5) : []
            });
          }
          
          return {
            metric,
            ranks: data.ranks || {},
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
      response.metrics[result.metric] = result.ranks;
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Error in batch rank endpoint:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
