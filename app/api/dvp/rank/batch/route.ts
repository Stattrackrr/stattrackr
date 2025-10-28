import { NextRequest, NextResponse } from 'next/server';

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

    // Fetch all metric rankings in parallel
    const results = await Promise.all(
      metrics.map(async (metric) => {
        try {
          // Construct URL for individual rank endpoint
          const rankUrl = new URL('/api/dvp/rank', request.url);
          rankUrl.searchParams.set('metric', metric);
          rankUrl.searchParams.set('pos', pos);
          rankUrl.searchParams.set('games', games);

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
