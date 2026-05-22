import { NextRequest, NextResponse } from 'next/server';
import { getSoccerPlayerStatsCache, normalizeSoccerTeamHref } from '@/lib/soccerCache';
import { parseSoccerSeasonYearParam } from '@/lib/soccerOpponentBreakdown';
import {
  parsePlayerStatsMatchLimit,
  parseRequestedPlayerStatCategories,
  type PlayerMatchStats,
} from '@/lib/soccerPlayerStatsScrape';
import { fetchSoccerwaySquadPlayers } from '@/lib/soccerwaySquadHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const READ_CONCURRENCY = 10;

type GameRow = {
  opponent: string;
  kickoffUnix: number | null;
  kickoffIso: string | null;
  competitionName: string | null;
  competitionCountry: string | null;
  venue: string;
  result: string;
  scoreline: string;
  summaryPath: string;
};

function kickoffToIso(unix: number | null): string | null {
  if (unix == null || !Number.isFinite(unix)) return null;
  try {
    return new Date(unix * 1000).toISOString();
  } catch {
    return null;
  }
}

function toGameRows(matches: PlayerMatchStats[]): GameRow[] {
  return [...matches]
    .map((m) => ({
      opponent: m.opponent,
      kickoffUnix: m.kickoffUnix,
      kickoffIso: kickoffToIso(m.kickoffUnix),
      competitionName: m.competitionName ?? null,
      competitionCountry: m.competitionCountry ?? null,
      venue: m.venue,
      result: m.result,
      scoreline: m.scoreline,
      summaryPath: m.summaryPath,
    }))
    .sort((a, b) => (b.kickoffUnix ?? 0) - (a.kickoffUnix ?? 0));
}

async function mapInChunks<T, R>(items: T[], chunkSize: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    out.push(...(await Promise.all(chunk.map(fn))));
  }
  return out;
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const seasonYear = parseSoccerSeasonYearParam(request.nextUrl.searchParams.get('season'));
  const limit = parsePlayerStatsMatchLimit(request.nextUrl.searchParams.get('limit'), { seasonYear });
  const categories = parseRequestedPlayerStatCategories(request.nextUrl.searchParams.get('categories'));

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  try {
    const squad = await fetchSoccerwaySquadPlayers(teamHref);
    if (!squad.length) {
      return NextResponse.json({ error: 'Squad list empty (Soccerway squad page).', players: [] }, { status: 404 });
    }

    const players = await mapInChunks(squad, READ_CONCURRENCY, async (p) => {
      const cached = await getSoccerPlayerStatsCache<PlayerMatchStats>(teamHref, p.playerKey, limit, categories, {
        quiet: true,
        restTimeoutMs: 1200,
        jsTimeoutMs: 1200,
      });
      const matches = Array.isArray(cached?.matches) ? cached!.matches : [];
      return {
        playerKey: p.playerKey,
        displayName: p.displayName,
        position: cached?.primaryPosition ?? p.position ?? null,
        cached: matches.length > 0,
        generatedAt: cached?.generatedAt ?? null,
        matchCount: matches.length,
        games: toGameRows(matches),
      };
    });

    const withData = players.filter((row) => row.matchCount > 0).length;

    return NextResponse.json({
      success: true,
      teamHref,
      limit,
      categories,
      summary: {
        squadListed: players.length,
        playersWithCachedGames: withData,
        playersWithNoCache: players.length - withData,
      },
      players,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to build roster report';
    return NextResponse.json({ success: false, error: message, players: [] }, { status: 500 });
  }
}
