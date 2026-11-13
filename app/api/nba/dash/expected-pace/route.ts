import { NextRequest, NextResponse } from 'next/server';
import {
  NBA_GAME_MODEL,
  nbaFinalsFromDataset,
  nbaTeamRatings,
  projectNbaGame,
} from '@/lib/aiPicks/model/nbaGames';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { getNbaSeasonDataset } from '@/lib/nba/dash/season';
import {
  NBA_CURRENT_SEASON_YEAR,
  resolveNbaClub,
} from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

/**
 * GET /api/nba/dash/expected-pace?home=&away=&year=
 * Same matchup pace the AI props model uses (`projectNbaGame(...).pace`).
 */
export async function GET(request: NextRequest) {
  const homeParam = String(request.nextUrl.searchParams.get('home') || '').trim();
  const awayParam = String(request.nextUrl.searchParams.get('away') || '').trim();
  const yearParam = Number(request.nextUrl.searchParams.get('year') || NBA_CURRENT_SEASON_YEAR);
  const season = Number.isFinite(yearParam) ? yearParam : NBA_CURRENT_SEASON_YEAR;

  const home = resolveNbaClub(homeParam);
  const away = resolveNbaClub(awayParam);
  if (!home || !away) {
    return NextResponse.json(
      { error: 'home and away team params are required' },
      { status: 400 }
    );
  }

  try {
    const pace = await nbaDashCached(
      'expected-pace',
      [home.code, away.code, season],
      NBA_DASH_CACHE.league,
      async () => {
        const [cur, prev] = await Promise.all([
          getNbaSeasonDataset(season),
          getNbaSeasonDataset(season - 1),
        ]);
        const finals = [...nbaFinalsFromDataset(prev), ...nbaFinalsFromDataset(cur)];
        const rated = nbaTeamRatings(finals, season);
        const proj = projectNbaGame(home.code, away.code, rated, NBA_GAME_MODEL);
        return {
          pace: proj.pace,
          home: home.code,
          away: away.code,
          homePace: proj.home?.pace ?? null,
          awayPace: proj.away?.pace ?? null,
          leaguePace: proj.league.pace,
          season,
          source: 'ai:projectNbaGame',
        };
      }
    );

    return NextResponse.json(pace, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=1800' },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
