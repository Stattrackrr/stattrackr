import { NextRequest, NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { loadNbaNextGame } from '@/lib/nba/dash/server';
import { NBA_CURRENT_SEASON_YEAR, nbaSeasonLabel } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/** GET /api/nba/dash/next-game?team= — next scheduled game from nba_games. */
export async function GET(request: NextRequest) {
  const team = String(request.nextUrl.searchParams.get('team') || '').trim();
  if (!team) return NextResponse.json({ error: 'team query param is required' }, { status: 400 });
  try {
    const next = await nbaDashCached('next-game', [team.toLowerCase()], NBA_DASH_CACHE.nextGame, () =>
      loadNbaNextGame(team)
    );
    const year = next?.year ?? NBA_CURRENT_SEASON_YEAR;
    return NextResponse.json(
      {
        team: next?.team ?? team,
        year,
        seasonLabel: nbaSeasonLabel(year),
        next_opponent: next?.opponent ?? null,
        next_game_tipoff: next?.tipoff ?? null,
        next_game_id: next?.matchId ?? null,
        opponent_logo: next?.opponentLogo ?? null,
        venue: null,
        is_home: next?.isHome ?? null,
        home_team: next?.homeTeam ?? null,
        away_team: next?.awayTeam ?? null,
        source: next?.source ?? null,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=900' } }
    );
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
