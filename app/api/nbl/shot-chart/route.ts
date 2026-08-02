import { NextRequest, NextResponse } from 'next/server';
import {
  buildPlayerShotChart,
  buildTeamDefenseShotChart,
} from '@/lib/nbl/nblShotChartData';
import { NBL_SHOT_CHART_SEASON_YEAR } from '@/lib/nblTeamCanonical';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseYears(request: NextRequest): number[] {
  const raw = String(request.nextUrl.searchParams.get('years') || '').trim();
  if (raw) {
    const parsed = raw
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((y) => Number.isFinite(y) && y >= 2020 && y <= 2100);
    if (parsed.length) return [...new Set(parsed)];
  }
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      ''
  );
  if (Number.isFinite(year) && year >= 2020) return [year];
  return [NBL_SHOT_CHART_SEASON_YEAR];
}

/**
 * GET /api/nbl/shot-chart
 *  mode=player (default): playerName + optional team → offensive zone chart
 *  mode=defense: team → opponent shots allowed by zone (+ ranks from cache)
 */
export async function GET(request: NextRequest) {
  const mode = String(request.nextUrl.searchParams.get('mode') || 'player').toLowerCase();
  const years = parseYears(request);
  const maxGames = Math.min(
    80,
    Math.max(1, Number(request.nextUrl.searchParams.get('maxGames') || 80) || 80)
  );
  const forceRefresh = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('refresh') || '').toLowerCase()
  );

  try {
    if (mode === 'defense') {
      const team = String(request.nextUrl.searchParams.get('team') || '').trim();
      if (!team) {
        return NextResponse.json({ error: 'team is required for defense mode' }, { status: 400 });
      }
      const data = await buildTeamDefenseShotChart({
        team,
        years,
        maxGames,
        forceRefresh,
        withLeagueRanks: !['0', 'false'].includes(
          String(request.nextUrl.searchParams.get('ranks') || '1').toLowerCase()
        ),
      });
      return NextResponse.json({ success: true, seasonYear: NBL_SHOT_CHART_SEASON_YEAR, ...data });
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
    const data = await buildPlayerShotChart({
      playerName,
      team,
      years,
      maxGames,
      forceRefresh,
    });
    return NextResponse.json({ success: true, seasonYear: NBL_SHOT_CHART_SEASON_YEAR, ...data });
  } catch (error) {
    console.error('[nbl/shot-chart]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to build shot chart' },
      { status: 500 }
    );
  }
}
