import { NextRequest, NextResponse } from 'next/server';
import { getAflOddsCache, refreshAflOddsData } from '@/lib/refreshAflOdds';

const AFL_ODDS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

function filterExcludedBookmakers<T extends { name?: string }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const n = (r.name ?? '').trim().toLowerCase();
    return !AFL_ODDS_EXCLUDED_BOOKMAKERS.some((x) => n === x || n.includes(x));
  });
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function normalize(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

function dateKey(s: string | null | undefined): string {
  const str = String(s ?? '');
  const i = str.indexOf('T');
  return i >= 0 ? str.slice(0, i) : str.slice(0, 10);
}

function gameMatchesTeam(home: string, away: string, team: string): boolean {
  const t = normalize(team);
  const h = normalize(home);
  const a = normalize(away);
  if (!t) return false;
  return h.includes(t) || a.includes(t) || t.includes(h) || t.includes(a);
}

function gameMatchesOpponent(home: string, away: string, opponent: string): boolean {
  const o = normalize(opponent);
  const h = normalize(home);
  const a = normalize(away);
  if (!o) return true;
  return h.includes(o) || a.includes(o) || o.includes(h) || o.includes(a);
}

/**
 * GET /api/afl/odds?team=...&opponent=...&game_date=...
 * Returns game odds (H2H, Spread, Total) for the matching AFL game.
 * Uses The Odds API (ODDS_API_KEY); data is cached after /api/afl/odds/refresh.
 */
export async function GET(request: NextRequest) {
  try {
    let cache = getAflOddsCache();
    if (!cache) {
      const result = await refreshAflOddsData();
      if (!result.success) {
        return NextResponse.json(
          {
            success: false,
            error: result.error ?? 'Failed to load AFL odds',
            data: [],
          },
          { status: 503 }
        );
      }
      cache = getAflOddsCache();
    }
    if (!cache || !cache.games?.length) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated: undefined,
        nextUpdate: undefined,
        message: 'No AFL games in cache',
      });
    }

    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const opponent = searchParams.get('opponent');
    const gameDate = searchParams.get('game_date');
    const requestedDateKey = dateKey(gameDate);

    if (!team) {
      // Return all games (e.g. for parlay game search) with gameDate for UI
      const gamesWithDate = cache.games.map((g) => ({
        ...g,
        gameDate: g.commenceTime.slice(0, 10),
      }));
      return NextResponse.json({
        success: true,
        data: gamesWithDate,
        lastUpdated: cache.lastUpdated,
        nextUpdate: cache.nextUpdate,
      });
    }

    let candidates = cache.games.filter((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));
    if (opponent) {
      candidates = candidates.filter((g) => gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent));
    }
    if (requestedDateKey) {
      candidates = candidates.filter((g) => dateKey(g.commenceTime) === requestedDateKey);
    }
    const game = candidates[0] ?? cache.games.find((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));

    if (!game) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated: cache.lastUpdated,
        nextUpdate: cache.nextUpdate,
        message: 'No matching AFL game',
      });
    }

    const bookmakers = filterExcludedBookmakers(game.bookmakers ?? []);
    return NextResponse.json({
      success: true,
      data: bookmakers,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      lastUpdated: cache.lastUpdated,
      nextUpdate: cache.nextUpdate,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message, data: [] }, { status: 500 });
  }
}
