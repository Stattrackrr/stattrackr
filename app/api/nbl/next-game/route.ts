import { NextRequest, NextResponse } from 'next/server';
import { getNblNextGameForTeam } from '@/lib/nbl/nextGame';
import { NBL_CURRENT_SEASON_YEAR, nblSeasonLabel } from '@/lib/nblTeamCanonical';

export async function GET(request: NextRequest) {
  const team = String(request.nextUrl.searchParams.get('team') || '').trim();
  const year = Number(
    request.nextUrl.searchParams.get('year') ||
      request.nextUrl.searchParams.get('season') ||
      NBL_CURRENT_SEASON_YEAR
  );
  if (!team) {
    return NextResponse.json({ error: 'team query param is required' }, { status: 400 });
  }

  const next = getNblNextGameForTeam(
    team,
    Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR
  );
  if (!next) {
    return NextResponse.json({
      team,
      year: Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR,
      seasonLabel: nblSeasonLabel(Number.isFinite(year) ? year : NBL_CURRENT_SEASON_YEAR),
      next_opponent: null,
      next_game_tipoff: null,
      next_game_id: null,
      opponent_logo: null,
      venue: null,
      is_home: null,
      home_team: null,
      away_team: null,
      source: null,
    });
  }

  return NextResponse.json({
    team: next.team,
    year: next.year,
    seasonLabel: nblSeasonLabel(next.year),
    next_opponent: next.opponent,
    next_game_tipoff: next.tipoff,
    next_game_id: next.matchId,
    opponent_logo: next.opponentLogo,
    venue: next.venue,
    is_home: next.isHome,
    home_team: next.homeTeam,
    away_team: next.awayTeam,
    source: next.source,
  });
}
