import { NextRequest, NextResponse } from 'next/server';
import {
  loadPlayerShotChartForApi,
  loadTeamDefenseShotChartForApi,
} from '@/lib/nbl/nblShotChartData';
import {
  NBL_SHOT_CHART_CACHE_YEARS,
  NBL_SHOT_CHART_SEASON_YEAR,
} from '@/lib/nblTeamCanonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/nbl/shot-chart — cache only (no live SportRadar).
 *  mode=player (default): playerName + optional team
 *  mode=defense: team → opponent shots allowed by zone (+ ranks)
 *
 * Warm caches via: npm run warm:nbl:shot-charts
 */
export async function GET(request: NextRequest) {
  const mode = String(request.nextUrl.searchParams.get('mode') || 'player').toLowerCase();
  const refresh = String(request.nextUrl.searchParams.get('refresh') || '').toLowerCase();
  if (refresh === '1' || refresh === 'true') {
    return NextResponse.json(
      {
        error:
          'Live SportRadar refresh is disabled on this endpoint. Run npm run warm:nbl:shot-charts (or the NBL Process Stats workflow).',
      },
      { status: 400 }
    );
  }

  try {
    if (mode === 'defense') {
      const team = String(request.nextUrl.searchParams.get('team') || '').trim();
      if (!team) {
        return NextResponse.json({ error: 'team is required for defense mode' }, { status: 400 });
      }
      const data = loadTeamDefenseShotChartForApi(team);
      if (!data) {
        return NextResponse.json(
          {
            error: `No cached defense shot chart for ${team}. Run warm:nbl:shot-charts.`,
            years: [...NBL_SHOT_CHART_CACHE_YEARS],
          },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        seasonYear: NBL_SHOT_CHART_SEASON_YEAR,
        cacheYears: [...NBL_SHOT_CHART_CACHE_YEARS],
        ...data,
      });
    }

    const playerName = String(
      request.nextUrl.searchParams.get('playerName') ||
        request.nextUrl.searchParams.get('player') ||
        ''
    ).trim();
    if (!playerName) {
      return NextResponse.json({ error: 'playerName is required' }, { status: 400 });
    }
    const team = String(request.nextUrl.searchParams.get('team') || '').trim() || null;
    const data = loadPlayerShotChartForApi(playerName, team);
    if (!data) {
      return NextResponse.json(
        {
          error: `No cached shot chart for ${playerName}. Run warm:nbl:shot-charts.`,
          years: [...NBL_SHOT_CHART_CACHE_YEARS],
        },
        { status: 404 }
      );
    }
    return NextResponse.json({
      success: true,
      seasonYear: NBL_SHOT_CHART_SEASON_YEAR,
      cacheYears: [...NBL_SHOT_CHART_CACHE_YEARS],
      ...data,
    });
  } catch (error) {
    console.error('[nbl/shot-chart]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load shot chart cache' },
      { status: 500 }
    );
  }
}
