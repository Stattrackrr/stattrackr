import { NextRequest, NextResponse } from 'next/server';
import { getPlayerTeamForSeason } from '@/lib/aflPlayerTeamResolver';
import { rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';
import { getAflOddsCache, getNextAflGameFromGames, refreshAflOddsData } from '@/lib/refreshAflOdds';

/**
 * The odds feed is the canonical source for unplayed fixtures because it includes
 * the game IDs used by the props feed. FootyInfo remains the sole AFL stats source.
 */
export async function GET(request: NextRequest) {
  const teamParam = request.nextUrl.searchParams.get('team')?.trim();
  const playerName = request.nextUrl.searchParams.get('player_name')?.trim();
  const season = Number(request.nextUrl.searchParams.get('season') || new Date().getFullYear());
  const team = teamParam
    ? rosterTeamToInjuryTeam(teamParam) || teamParam
    : playerName
      ? await getPlayerTeamForSeason(season, playerName)
      : null;

  if (!team) {
    return NextResponse.json({ error: 'team or player_name query param required' }, { status: 400 });
  }

  let games = (await getAflOddsCache())?.games || [];
  let next = getNextAflGameFromGames(games, team);
  if (!next) {
    const refreshed = await refreshAflOddsData({ skipWrite: true });
    games = refreshed.games || [];
    next = getNextAflGameFromGames(games, team);
  }

  if (!next) {
    return NextResponse.json({
      season,
      team,
      next_opponent: null,
      next_round: null,
      next_game_tipoff: null,
      next_game_id: null,
      next_game_weather: null,
      match_url: null,
      source: 'odds_api',
    });
  }

  return NextResponse.json({
    season,
    team,
    next_opponent: next.opponent,
    next_round: null,
    next_game_tipoff: next.commenceTime,
    next_game_id: next.gameId ?? null,
    next_game_weather: null,
    match_url: null,
    source: 'odds_api',
  });
}
