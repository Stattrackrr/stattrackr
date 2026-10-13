import { NextRequest, NextResponse } from 'next/server';
import { loadNblPlayerGameLogs } from '@/lib/nbl/playerGameLogsServer';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CURRENT_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';

/**
 * GET /api/nbl/player-game-logs — disk cache only.
 * Rosetta fetch happens in `scripts/fetch-nbl-player-game-logs.ts`, not per request.
 */

function parseYears(request: NextRequest): number[] {
  const yearsParam = String(request.nextUrl.searchParams.get('years') || '').trim();
  if (yearsParam) {
    const parsed = yearsParam
      .split(',')
      .map((p) => Number(p.trim()))
      .filter((y) => Number.isFinite(y) && y >= 2020 && y <= 2100);
    if (parsed.length) return [...new Set(parsed)];
  }
  const history = ['1', 'true'].includes(
    String(request.nextUrl.searchParams.get('history') || '').toLowerCase()
  );
  if (history) return [...NBL_CHART_HISTORY_YEARS];
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  return [Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR];
}

export async function GET(request: NextRequest) {
  const playerId = String(request.nextUrl.searchParams.get('playerId') || '').trim();
  const name = String(request.nextUrl.searchParams.get('name') || '').trim();
  const years = parseYears(request);

  const logs = loadNblPlayerGameLogs({ playerId, name, years });
  if (!logs) {
    return NextResponse.json(
      { error: 'Provide playerId or exact name query param' },
      { status: 400 }
    );
  }

  return NextResponse.json({
    playerId: logs.playerId,
    name: logs.name,
    team: logs.team,
    years,
    year: years[0] ?? NBL_CURRENT_SEASON_YEAR,
    seasonLabel: years.map(nblSeasonLabel).join('+'),
    generatedAt: new Date().toISOString(),
    source: 'cache',
    gameCount: logs.games.length,
    games: logs.games,
  });
}
