import { NextRequest, NextResponse } from 'next/server';
import {
  emptyPlayerShotChart,
  loadPlayerShotChartForApi,
  loadTeamDefenseShotChartForApi,
} from '@/lib/nbl/nblShotChartData';
import { emptyZoneStats } from '@/lib/nbl/nblShotZones';
import {
  NBL_SHOT_CHART_CACHE_YEARS,
  NBL_SHOT_CHART_SEASON_YEAR,
} from '@/lib/nblTeamCanonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USER_SHOT_CHART_UNAVAILABLE = 'No shot chart available for this player.';
const USER_DEFENSE_UNAVAILABLE = 'No opponent shot chart available.';

/**
 * GET /api/nbl/shot-chart — cache only (no live SportRadar).
 *  mode=player (default): playerName + optional team
 *  mode=defense: team → opponent shots allowed by zone (+ ranks)
 */
export async function GET(request: NextRequest) {
  const mode = String(request.nextUrl.searchParams.get('mode') || 'player').toLowerCase();

  try {
    if (mode === 'defense') {
      const team = String(request.nextUrl.searchParams.get('team') || '').trim();
      if (!team) {
        return NextResponse.json({ error: 'team is required for defense mode' }, { status: 400 });
      }
      const data = loadTeamDefenseShotChartForApi(team);
      if (!data || data.shotCount <= 0) {
        return NextResponse.json({
          success: true,
          empty: true,
          mode: 'defense',
          team,
          shotCount: 0,
          gamesUsed: 0,
          zones: emptyZoneStats(),
          ranks: [],
          seasonYear: NBL_SHOT_CHART_SEASON_YEAR,
          cacheYears: [...NBL_SHOT_CHART_CACHE_YEARS],
          message: USER_DEFENSE_UNAVAILABLE,
        });
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
    if (!data || data.shotCount <= 0) {
      return NextResponse.json({
        success: true,
        empty: true,
        ...(data || emptyPlayerShotChart(playerName, [...NBL_SHOT_CHART_CACHE_YEARS])),
        playerName,
        shotCount: 0,
        seasonYear: NBL_SHOT_CHART_SEASON_YEAR,
        cacheYears: [...NBL_SHOT_CHART_CACHE_YEARS],
        message: USER_SHOT_CHART_UNAVAILABLE,
      });
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
      { error: "Couldn't load shot chart. Try again." },
      { status: 500 }
    );
  }
}
