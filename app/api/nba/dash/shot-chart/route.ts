import { NextRequest, NextResponse } from 'next/server';
import { NBA_DASH_CACHE, nbaDashCached } from '@/lib/nba/dash/responseCache';
import { emptyZoneStats, loadNbaDefenseShotChart, loadNbaPlayerShotChart } from '@/lib/nba/dash/shotChart';
import { NBA_SHOT_CHART_CACHE_YEARS, NBA_SHOT_CHART_SEASON_YEAR } from '@/lib/nba/dash/teams';

export const dynamic = 'force-dynamic';

const USER_SHOT_CHART_UNAVAILABLE = 'No shot chart available for this player.';
const USER_DEFENSE_UNAVAILABLE = 'No opponent shot chart available.';

function parseYears(raw: string | null): number[] {
  const years = String(raw || '')
    .split(',')
    .map((y) => Number(y.trim()))
    .filter((y) => Number.isFinite(y) && y >= NBA_SHOT_CHART_SEASON_YEAR);
  return years.length ? years : [...NBA_SHOT_CHART_CACHE_YEARS];
}

/**
 * GET /api/nba/dash/shot-chart
 *  mode=player (default): playerName + optional team
 *  mode=defense: team → opponent shots allowed by zone (+ ranks)
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const mode = String(sp.get('mode') || 'player').toLowerCase();
  const years = parseYears(sp.get('years'));
  const base = { success: true, seasonYear: NBA_SHOT_CHART_SEASON_YEAR, cacheYears: years };

  try {
    if (mode === 'defense') {
      const team = String(sp.get('team') || '').trim();
      if (!team) return NextResponse.json({ error: 'team is required for defense mode' }, { status: 400 });
      const data = await nbaDashCached('shot-chart-defense', [team.toLowerCase(), years], NBA_DASH_CACHE.league, () =>
        loadNbaDefenseShotChart(team, years)
      );
      if (!data || data.shotCount <= 0) {
        return NextResponse.json({
          ...base,
          empty: true,
          mode: 'defense',
          team,
          shotCount: 0,
          gamesUsed: 0,
          zones: emptyZoneStats(),
          ranks: [],
          message: USER_DEFENSE_UNAVAILABLE,
        });
      }
      return NextResponse.json({ ...base, ...data });
    }

    const playerName = String(sp.get('playerName') || sp.get('player') || '').trim();
    if (!playerName) return NextResponse.json({ error: 'playerName is required' }, { status: 400 });
    const team = String(sp.get('team') || '').trim() || null;
    const data = await nbaDashCached(
      'shot-chart-player',
      [playerName.toLowerCase(), team?.toLowerCase() ?? null, years],
      NBA_DASH_CACHE.league,
      () => loadNbaPlayerShotChart(playerName, team, years)
    );
    if (!data || data.shotCount <= 0) {
      return NextResponse.json({
        ...base,
        empty: true,
        mode: 'player',
        playerName,
        shotCount: 0,
        gamesUsed: data?.gamesUsed ?? 0,
        zones: data?.zones ?? emptyZoneStats(),
        assistCount: data?.assistCount ?? 0,
        assistGamesUsed: data?.assistGamesUsed ?? 0,
        assistZones: data?.assistZones ?? [],
        message: USER_SHOT_CHART_UNAVAILABLE,
      });
    }
    return NextResponse.json({ ...base, ...data });
  } catch (error) {
    console.error('[nba/dash/shot-chart]', error);
    return NextResponse.json({ error: "Couldn't load shot chart. Try again." }, { status: 500 });
  }
}
