import { NextRequest, NextResponse } from 'next/server';
import { getAflOddsCache } from '@/lib/refreshAflOdds';
import { AFL_TEAM_TO_FOOTYWIRE } from '@/lib/aflTeamMapping';

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

/** Team name variants (full, short, nickname) so dashboard request matches cache regardless of format. */
function teamAliases(team: string): string[] {
  const t = team.trim();
  if (!t) return [];
  const lower = t.toLowerCase();
  const out = new Set<string>([lower]);
  const nick = AFL_TEAM_TO_FOOTYWIRE[t] ?? AFL_TEAM_TO_FOOTYWIRE[t.split(/\s+/)[0]];
  if (nick) out.add(nick.trim().toLowerCase());
  const short = t.split(/\s+/)[0];
  if (short && short.length >= 2) out.add(short.toLowerCase());
  return [...out];
}

function gameMatchesTeam(home: string, away: string, team: string): boolean {
  const h = normalize(home);
  const a = normalize(away);
  const aliases = teamAliases(team);
  if (!aliases.length) return false;
  return aliases.some((t) => (t && (h.includes(t) || a.includes(t) || t.includes(h) || t.includes(a))));
}

function gameMatchesOpponent(home: string, away: string, opponent: string): boolean {
  const o = normalize(opponent);
  const h = normalize(home);
  const a = normalize(away);
  if (!o) return true;
  const aliases = teamAliases(opponent);
  if (!aliases.length) return h.includes(o) || a.includes(o) || o.includes(h) || o.includes(a);
  return aliases.some((alias) => alias && (h.includes(alias) || a.includes(alias) || alias.includes(h) || alias.includes(a)));
}

/** True if game's commence date is on requested date or ±1 day (timezone-safe). */
function dateMatches(requestedDateKey: string, commenceTime: string): boolean {
  const gameDate = dateKey(commenceTime);
  if (gameDate === requestedDateKey) return true;
  if (!requestedDateKey || requestedDateKey.length < 10) return true;
  try {
    const req = new Date(requestedDateKey + 'T12:00:00Z').getTime();
    const game = new Date(gameDate + 'T12:00:00Z').getTime();
    const oneDay = 24 * 60 * 60 * 1000;
    return Math.abs(req - game) <= oneDay;
  } catch {
    return false;
  }
}

/**
 * GET /api/afl/odds?team=...&opponent=...&game_date=...
 * Returns game odds (H2H, Spread, Total) for the matching AFL game.
 * Read-only: serves from cache only. Never calls The Odds API (refresh is cron/manual only).
 */
export async function GET(request: NextRequest) {
  try {
    const cache = await getAflOddsCache();
    const games = cache?.games ?? [];
    const lastUpdated = cache?.lastUpdated ?? '';
    const nextUpdate = cache?.nextUpdate ?? '';

    if (!games.length) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No AFL games in cache. Odds refresh runs every 90 min (cron or /api/afl/odds/refresh).',
      });
    }

    const { searchParams } = new URL(request.url);
    const team = searchParams.get('team');
    const opponent = searchParams.get('opponent');
    const gameDate = searchParams.get('game_date');
    const requestedDateKey = dateKey(gameDate);

    if (!team) {
      // Return all games (e.g. for parlay game search) with gameDate for UI
      const gamesWithDate = games.map((g) => ({
        ...g,
        gameDate: g.commenceTime.slice(0, 10),
      }));
      return NextResponse.json({
        success: true,
        data: gamesWithDate,
        lastUpdated,
        nextUpdate,
      });
    }

    let candidates = games.filter((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));
    if (opponent) {
      candidates = candidates.filter((g) => gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent));
    }
    if (requestedDateKey) {
      candidates = candidates.filter((g) => dateMatches(requestedDateKey, g.commenceTime));
    }
    const game =
      candidates[0] ??
      games.find((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team) && (!opponent || gameMatchesOpponent(g.homeTeam, g.awayTeam, opponent))) ??
      games.find((g) => gameMatchesTeam(g.homeTeam, g.awayTeam, team));

    if (!game) {
      return NextResponse.json({
        success: true,
        data: [],
        homeTeam: undefined,
        awayTeam: undefined,
        lastUpdated,
        nextUpdate,
        message: 'No matching AFL game',
      });
    }

    const bookmakers = filterExcludedBookmakers(game.bookmakers ?? []);
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
