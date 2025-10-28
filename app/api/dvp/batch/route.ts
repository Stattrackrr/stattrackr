import { NextRequest, NextResponse } from 'next/server';

/**
 * Batched DVP API endpoint
 * Fetches multiple metrics for a team in a single request
 * 
 * Query params:
 * - team: Team abbreviation (e.g., "LAL")
 * - metrics: Comma-separated list of metrics (e.g., "pts,reb,ast")
 * - games: Number of games to analyze (default: 82)
 * 
 * Example: /api/dvp/batch?team=LAL&metrics=pts,reb,ast&games=82
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const metricsParam = searchParams.get('metrics');
    const games = searchParams.get('games') || '82';

    if (!team) {
      return NextResponse.json(
        { error: 'Missing required parameter: team' },
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

    // Fetch all metrics in parallel
    const results = await Promise.all(
      metrics.map(async (metric) => {
        try {
          // Construct URL for individual DVP endpoint
          const dvpUrl = new URL('/api/dvp', request.url);
          dvpUrl.searchParams.set('team', team);
          dvpUrl.searchParams.set('metric', metric);
          dvpUrl.searchParams.set('games', games);

          // Use absolute URL for internal API calls
          const fullUrl = new URL(dvpUrl.pathname + dvpUrl.search, request.nextUrl.origin);
          
          const response = await fetch(fullUrl.toString(), {
            headers: request.headers,
          });

          if (!response.ok) {
            console.error(`Failed to fetch ${metric} for ${team}: ${response.status}`);
            return {
              metric,
              error: `HTTP ${response.status}`,
              perGame: null,
              sample_games: 0,
            };
          }

          const data = await response.json();
          return {
            metric,
            perGame: data.perGame || null,
            sample_games: data.sample_games || 0,
          };
        } catch (error: any) {
          console.error(`Error fetching ${metric} for ${team}:`, error);
          return {
            metric,
            error: error?.message || 'Unknown error',
            perGame: null,
            sample_games: 0,
          };
        }
      })
    );

    // Transform results into a more convenient format
    const response: {
      team: string;
      games: string;
      metrics: Record<string, any>;
      sample_games: number;
    } = {
      team,
      games,
      metrics: {},
      sample_games: 0,
    };

    for (const result of results) {
      response.metrics[result.metric] = result.perGame;
      if (result.sample_games) {
        response.sample_games = Math.max(response.sample_games, result.sample_games);
      }
    }

    return NextResponse.json(response);
  } catch (error: any) {
    console.error('Error in batch DVP endpoint:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
