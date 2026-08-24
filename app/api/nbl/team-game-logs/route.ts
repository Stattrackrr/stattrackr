import { NextRequest, NextResponse } from 'next/server';
import { buildNblTeamGameLogs } from '@/lib/nbl/teamGameLogs';
import {
  NBL_CHART_HISTORY_YEARS,
  NBL_CURRENT_SEASON_YEAR,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

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
  const teamParam = String(request.nextUrl.searchParams.get('team') || '').trim();
  const team = resolveNblClubName(teamParam) || teamParam;
  if (!team) {
    return NextResponse.json({ error: 'Missing team parameter' }, { status: 400 });
  }

  const years = parseYears(request);
  const games = buildNblTeamGameLogs(team, years);
  return NextResponse.json({
    team,
    years,
    gameCount: games.length,
    games,
  });
}
