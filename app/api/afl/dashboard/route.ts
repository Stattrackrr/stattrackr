/**
 * GET /api/afl/dashboard?player=...&team=...&opponent=...&season=...
 *
 * Returns a single payload with next-game, odds, player-props, and game-logs
 * by reading from the same caches used by the individual endpoints (cron-populated).
 * Use this from the AFL dashboard so one request replaces 5+ round-trips.
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  getAflOddsCache,
  getAflEventIdForMatchup,
  getNextAflGameFromGames,
  type AflBookRow,
} from '@/lib/refreshAflOdds';
import { getAflPlayerPropsAllFromCache } from '@/lib/aflPlayerPropsCache';
import {
  buildAflPlayerLogsCacheKey,
  getAflPlayerLogsCache,
  isAflPlayerLogsCacheEnabled,
} from '@/lib/cache/aflPlayerLogsCache';
import {
  rosterTeamToInjuryTeam,
  footywireNicknameToOfficial,
  opponentToOfficialTeamName,
  getFootyWireTeamNameForPlayerUrl,
  AFL_TEAM_TO_FOOTYWIRE,
} from '@/lib/aflTeamMapping';
import { toCanonicalAflPlayerName } from '@/lib/aflPlayerNameUtils';

const AFL_ODDS_EXCLUDED_BOOKMAKERS = ['tabtouch', 'playup', 'betrivers', 'bet rivers'];

function filterExcludedBookmakers<T extends { name?: string }>(rows: T[]): T[] {
  return rows.filter((r) => {
    const n = (r.name ?? '').trim().toLowerCase();
    return !AFL_ODDS_EXCLUDED_BOOKMAKERS.some((x) => n === x || n.includes(x));
  });
}

function normalize(s: string | null | undefined): string {
  return String(s ?? '').trim().toLowerCase();
}

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
  return aliases.some((t) => t && (h.includes(t) || a.includes(t) || t.includes(h) || t.includes(a)));
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

/** Same normalization as player-game-logs route for cache key. */
function normalizeIrishNameForLookup(name: string): string {
  if (!name || typeof name !== 'string') return name;
  return name.trim().replace(/\b([OD]) ([A-Z])/g, "$1'$2");
}

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const player = searchParams.get('player')?.trim();
  const teamParam = searchParams.get('team')?.trim();
  const opponentParam = searchParams.get('opponent')?.trim();
  const seasonParam = searchParams.get('season');
  const season = seasonParam ? parseInt(seasonParam, 10) : new Date().getFullYear();
  if (!Number.isFinite(season)) {
    return NextResponse.json({ error: 'Invalid season' }, { status: 400 });
  }
  if (!player || !teamParam) {
    return NextResponse.json(
      { error: 'player and team query params required' },
      { status: 400 }
    );
  }

  const origin = request.nextUrl.origin;
  let nextOpponent: string | null = opponentParam && opponentParam !== '—' ? opponentParam : null;
  let nextTipoff: string | null = null;
  let gameDate: string | null = null;

  const oddsCache = await getAflOddsCache();
  const games = oddsCache?.games ?? [];

  // Resolve next game: prefer opponent from URL; else from odds cache; else call next-game API
  if (!nextOpponent && games.length > 0) {
    const teamFull = rosterTeamToInjuryTeam(teamParam) || footywireNicknameToOfficial(teamParam) || teamParam;
    const fromOdds = getNextAflGameFromGames(games, teamFull);
    if (fromOdds) {
      nextOpponent = fromOdds.opponent;
      nextTipoff = fromOdds.commenceTime ?? null;
      gameDate = nextTipoff ? nextTipoff.slice(0, 10) : null;
    }
  }
  if (!nextOpponent) {
    try {
      const lastRound = searchParams.get('last_round')?.trim() ?? '';
      const nextGameParams = new URLSearchParams({ team: teamParam, season: String(season) });
      if (lastRound) nextGameParams.set('last_round', lastRound);
      const nextRes = await fetch(`${origin}/api/afl/next-game?${nextGameParams}`);
      const nextData = (await nextRes.json()) as { next_opponent?: string; next_game_tipoff?: string };
      if (nextData?.next_opponent && nextData.next_opponent !== '—') {
        nextOpponent = opponentToOfficialTeamName(nextData.next_opponent) || nextData.next_opponent;
        nextTipoff = typeof nextData.next_game_tipoff === 'string' ? nextData.next_game_tipoff : null;
        gameDate = nextTipoff ? nextTipoff.slice(0, 10) : null;
      }
    } catch {
      // leave nextOpponent null
    }
  } else if (games.length > 0) {
    const teamFull = rosterTeamToInjuryTeam(teamParam) || footywireNicknameToOfficial(teamParam) || teamParam;
    const match = games.find(
      (g) => gameMatchesTeam(g.homeTeam, g.awayTeam, teamFull) && gameMatchesOpponent(g.homeTeam, g.awayTeam, nextOpponent!)
    );
    if (match?.commenceTime) {
      nextTipoff = match.commenceTime;
      gameDate = nextTipoff.slice(0, 10);
    }
  }

  const opponentForProps = nextOpponent && nextOpponent !== '—' ? nextOpponent : null;
  const teamForProps = rosterTeamToInjuryTeam(teamParam) || teamParam;

  // Odds: filter from cache for team + opponent
  let oddsData: { data: AflBookRow[]; homeTeam?: string; awayTeam?: string; lastUpdated?: string; nextUpdate?: string } = {
    data: [],
    lastUpdated: oddsCache?.lastUpdated ?? '',
    nextUpdate: oddsCache?.nextUpdate ?? '',
  };
  if (games.length > 0 && opponentForProps) {
    const teamFull = rosterTeamToInjuryTeam(teamParam) || teamParam;
    const game = games.find(
      (g) => gameMatchesTeam(g.homeTeam, g.awayTeam, teamFull) && gameMatchesOpponent(g.homeTeam, g.awayTeam, opponentForProps)
    );
    if (game) {
      const bookmakers = filterExcludedBookmakers(game.bookmakers ?? []);
      oddsData = {
        data: bookmakers,
        homeTeam: game.homeTeam,
        awayTeam: game.awayTeam,
        lastUpdated: oddsCache?.lastUpdated ?? '',
        nextUpdate: oddsCache?.nextUpdate ?? '',
      };
    }
  }

  // Player props: need eventId from odds cache
  let playerPropsAll: Record<string, { bookmaker: string; line?: number; overPrice?: number; underPrice?: number; yesPrice?: number; noPrice?: number }[]> | null = null;
  if (opponentForProps && games.length > 0) {
    const teamFull = rosterTeamToInjuryTeam(teamParam) || teamParam;
    const eventId = getAflEventIdForMatchup(games, teamFull, opponentForProps, gameDate ?? undefined);
    if (eventId) {
      playerPropsAll = await getAflPlayerPropsAllFromCache(eventId, player);
    }
  }

  // Game logs: read from same cache as player-game-logs (cache-only)
  let gameLogs: { games: Record<string, unknown>[]; gamesWithQuarters?: Record<string, unknown>[]; height?: string; guernsey?: number } | null = null;
  if (isAflPlayerLogsCacheEnabled()) {
    const effectivePlayerName = normalizeIrishNameForLookup(toCanonicalAflPlayerName(player));
    const teamFull = rosterTeamToInjuryTeam(teamParam) || footywireNicknameToOfficial(teamParam) || teamParam;
    const teamForRequest = teamFull ? getFootyWireTeamNameForPlayerUrl(teamFull) : null;
    const keyBase = buildAflPlayerLogsCacheKey({
      season,
      playerName: effectivePlayerName,
      teamForRequest,
      includeQuarters: false,
    });
    const keyQuarters = buildAflPlayerLogsCacheKey({
      season,
      playerName: effectivePlayerName,
      teamForRequest,
      includeQuarters: true,
    });
    const [cachedBase, cachedQuarters] = await Promise.all([
      getAflPlayerLogsCache(keyBase),
      getAflPlayerLogsCache(keyQuarters),
    ]);
    const baseGames = cachedBase?.games;
    if (cachedBase && Array.isArray(baseGames) && baseGames.length > 0) {
      gameLogs = {
        games: baseGames as Record<string, unknown>[],
        gamesWithQuarters: (cachedQuarters?.games ?? baseGames) as Record<string, unknown>[],
        height: cachedBase.height,
        guernsey: cachedBase.guernsey,
      };
    }
  }

  return NextResponse.json({
    nextGame: {
      next_opponent: nextOpponent,
      next_game_tipoff: nextTipoff,
      game_date: gameDate,
    },
    odds: {
      success: true,
      data: oddsData.data,
      homeTeam: oddsData.homeTeam,
      awayTeam: oddsData.awayTeam,
      lastUpdated: oddsData.lastUpdated,
      nextUpdate: oddsData.nextUpdate,
    },
    playerProps: playerPropsAll ?? {},
    gameLogs: gameLogs ?? null,
  });
}
