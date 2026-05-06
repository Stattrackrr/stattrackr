import { NextRequest, NextResponse } from 'next/server';
import { getAflOddsCache } from '@/lib/refreshAflOdds';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';

const AFL_ODDS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

function filterExcludedBookmakers<T extends { name?: string }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const n = (r.name ?? '').trim().toLowerCase();
    return !AFL_ODDS_EXCLUDED_BOOKMAKERS.some((x) => n === x || n.includes(x));
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function dateKey(s: string | null | undefined): string {
  const str = String(s ?? '');
  const i = str.indexOf('T');
  return i >= 0 ? str.slice(0, i) : str.slice(0, 10);
}

/** Compare using official names only so we never match wrong (e.g. Melbourne vs North Melbourne). */
function gameMatchesTeam(home: string, away: string, team: string): boolean {
  const h = toOfficialAflTeamDisplayName(home).trim().toLowerCase();
  const a = toOfficialAflTeamDisplayName(away).trim().toLowerCase();
  const t = toOfficialAflTeamDisplayName(team).trim().toLowerCase();
  if (!t) return false;
  return h === t || a === t;
}

function gameMatchesOpponent(home: string, away: string, opponent: string): boolean {
  const h = toOfficialAflTeamDisplayName(home).trim().toLowerCase();
  const a = toOfficialAflTeamDisplayName(away).trim().toLowerCase();
  const o = (opponent ?? '').trim() ? toOfficialAflTeamDisplayName(opponent).trim().toLowerCase() : '';
  if (!o) return true;
  return h === o || a === o;
}

/** No date filter: show odds for any game in cache matching team+opponent (unlimited). */
function dateMatches(_requestedDateKey: string, _commenceTime: string): boolean {
  return true;
}

/** Fallback: both team and opponent match by official name. */
function gameHasBothTeams(
  home: string,
  away: string,
  team: string,
  opponent: string
): boolean {
  const h = toOfficialAflTeamDisplayName(home).trim().toLowerCase();
  const a = toOfficialAflTeamDisplayName(away).trim().toLowerCase();
  const t = toOfficialAflTeamDisplayName(team).trim().toLowerCase();
  const o = (opponent ?? '').trim() ? toOfficialAflTeamDisplayName(opponent).trim().toLowerCase() : '';
  if (!t) return false;
  const teamIn = h === t || a === t;
  if (!o) return teamIn;
  return teamIn && (h === o || a === o);
}

function findMatchingGame(
  games: Array<{ homeTeam: string; awayTeam: string; bookmakers?: unknown[]; commenceTime?: string }>,
  team: string | null,
  opponent: string | null,
  requestedDateKey: string
) {
  if (!games.length || !team) return null;
  let candidates = games.filter((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));
  if (opponent) {
    candidates = candidates.filter((g) => gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent));
  }
  if (requestedDateKey) {
    candidates = candidates.filter((g) => dateMatches(requestedDateKey, g.commenceTime ?? ''));
  }
  let game =
    candidates[0] ??
    games.find((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team) && (!opponent || gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent))) ??
    games.find((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));
  if (!game && team && opponent) {
    const fallback = games.find((g) => gameHasBothTeams(g.homeTeam, g.awayTeam, team, opponent));
    if (fallback) game = fallback;
  }
  if (!game) return null;
  const allMatching =
    candidates.length > 0
      ? candidates
      : games.filter((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team) && (!opponent || gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent)));
  const withBooks = allMatching.find((g) => filterExcludedBookmakers((g.bookmakers ?? []) as { name?: string }[]).length > 0);
  return withBooks ?? game;
}

/**
 * GET /api/afl/odds?team=...&opponent=...&game_date=...
 * Returns cached game odds (H2H, Spread, Total) for the matching AFL game.
 * User-facing loads are cache-only, mirroring the AFL player props route.
 */
export async function GET(request: NextRequest) {
  try {
    const cache = await getAflOddsCache();
    let games = cache?.games ?? [];
    let lastUpdated = cache?.lastUpdated ?? '';
    let nextUpdate = cache?.nextUpdate ?? '';

    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const opponent = searchParams.get('opponent');
    const gameIdParam = searchParams.get('game_id') ?? searchParams.get('gameId');
    const gameDate = searchParams.get('game_date');
    const requestedDateKey = dateKey(gameDate);

    // When game_id is provided (e.g. from next-game API), resolve strictly from cache.
    if (gameIdParam && gameIdParam.trim()) {
      const id = gameIdParam.trim();
      const byId = games.find((g) => g.gameId === id) ?? null;
      if (byId) {
        const filtered = filterExcludedBookmakers((byId.bookmakers ?? []) as { name?: string }[]);
        const bookmakers = filtered.length > 0 ? filtered : (byId.bookmakers ?? []);
        return NextResponse.json({
          success: true,
          data: bookmakers,
          homeTeam: byId.homeTeam,
          awayTeam: byId.awayTeam,
          lastUpdated,
          nextUpdate,
        });
      }
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No cached AFL game for that game_id. Run /api/afl/odds/refresh to repopulate the cache.',
      });
    }

    if (!team) {
      if (!games.length) {
        return NextResponse.json({
          success: true,
          data: [],
          lastUpdated,
          nextUpdate,
          message: 'No AFL games in cache. Cache is refreshed by the AFL odds refresh job or /api/afl/odds/refresh.',
        });
      }
      const gamesWithDate = games.map((g) => ({
        ...g,
        gameDate: (g.commenceTime ?? '').slice(0, 10),
      }));
      return NextResponse.json({
        success: true,
        data: gamesWithDate,
        lastUpdated,
        nextUpdate,
      });
    }

    // Normalize so "GWS", "Bulldogs" etc match cached games (GWS Giants, Western Bulldogs).
    const teamNorm = team ? toOfficialAflTeamDisplayName(team) || team : null;
    const opponentNorm = opponent ? toOfficialAflTeamDisplayName(opponent) || opponent : null;

    const game = findMatchingGame(games, teamNorm ?? team, opponentNorm ?? opponent, requestedDateKey);

    if (!games.length && !game) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No AFL games in cache. Run /api/afl/odds/refresh to repopulate the AFL game props cache.',
      });
    }

    if (!game) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No matching AFL game in cache',
      });
    }

    const filtered = filterExcludedBookmakers((game.bookmakers ?? []) as { name?: string }[]);
    const bookmakers = filtered.length > 0 ? filtered : (game.bookmakers ?? []);
    return NextResponse.json({
      success: true,
      data: bookmakers,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      lastUpdated,
      nextUpdate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
