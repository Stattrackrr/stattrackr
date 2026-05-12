import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { normalizeSoccerTeamHref, setSoccerPlayerStatsCache } from '@/lib/soccerCache';
import {
  buildPlayerAliasesFromDisplayName,
  buildSquadPlayerStats,
  loadRecentMatchesForScrape,
  parseRequestedPlayerStatCategories,
  DEFAULT_MATCH_LIMIT,
  MAX_MATCH_LIMIT,
  PLAYER_STAT_CATEGORIES,
} from '@/lib/soccerPlayerStatsScrape';
import { fetchSoccerwaySquadPlayers, type SoccerwaySquadListPlayer } from '@/lib/soccerwaySquadHtml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/** Full-squad runs exceed 5 minutes; raise on hosts that allow it, or use keys= to chunk. */
export const maxDuration = 800;

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const PLAYER_STATS_CACHE_TTL_MINUTES = 24 * 60;
const DEFAULT_PLAYER_CONCURRENCY = 3;
const MAX_PLAYER_CONCURRENCY = 6;
/** First N in squad table order (see fetchSoccerwaySquadPlayers sort=document); cap 35 = senior/top slice only. */
const DEFAULT_MAX_PLAYERS = 35;
const MAX_MAX_PLAYERS = 35;
const DEFAULT_MATCH_SCRAPE_CONCURRENCY = 12;
const MAX_MATCH_SCRAPE_CONCURRENCY = 25;
const DEFAULT_FETCH_CONCURRENCY = 30;
const MAX_FETCH_CONCURRENCY = 60;

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const n = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(max, n);
}

/** Soccerway player-stats pages are client-rendered; plain fetch returns a shell. Defaults favor Puppeteer. */
function parseQueryBool(value: string | null, defaultValue: boolean): boolean {
  if (value == null || value === '') return defaultValue;
  const v = value.trim().toLowerCase();
  if (v === '0' || v === 'false' || v === 'no') return false;
  if (v === '1' || v === 'true' || v === 'yes') return true;
  return defaultValue;
}

function filterSquadByKeys(players: SoccerwaySquadListPlayer[], keysParam: string | null): SoccerwaySquadListPlayer[] {
  const raw = String(keysParam || '').trim();
  if (!raw) return players;
  const want = new Set(
    raw
      .split(',')
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean)
  );
  return players.filter((p) => want.has(p.playerKey));
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const rawLimit = request.nextUrl.searchParams.get('limit')?.trim().toLowerCase() ?? '';
  const limit =
    !rawLimit || rawLimit === 'all' || rawLimit === '0'
      ? DEFAULT_MATCH_LIMIT
      : Math.max(1, Math.min(MAX_MATCH_LIMIT, Number.parseInt(rawLimit, 10) || DEFAULT_MATCH_LIMIT));
  const categories = parseRequestedPlayerStatCategories(request.nextUrl.searchParams.get('categories'));
  const playerConcurrency = parsePositiveInt(
    request.nextUrl.searchParams.get('playerConcurrency'),
    DEFAULT_PLAYER_CONCURRENCY,
    MAX_PLAYER_CONCURRENCY
  );
  const maxPlayers = parsePositiveInt(request.nextUrl.searchParams.get('maxPlayers'), DEFAULT_MAX_PLAYERS, MAX_MAX_PLAYERS);
  const matchConcurrency = parsePositiveInt(
    request.nextUrl.searchParams.get('matchConcurrency'),
    DEFAULT_MATCH_SCRAPE_CONCURRENCY,
    MAX_MATCH_SCRAPE_CONCURRENCY
  );
  const fetchConcurrency = parsePositiveInt(
    request.nextUrl.searchParams.get('fetchConcurrency'),
    DEFAULT_FETCH_CONCURRENCY,
    MAX_FETCH_CONCURRENCY
  );
  const puppeteerOnly = parseQueryBool(request.nextUrl.searchParams.get('puppeteerOnly'), true);
  const puppeteerFallback = parseQueryBool(request.nextUrl.searchParams.get('puppeteerFallback'), true);
  const keysFilter = request.nextUrl.searchParams.get('keys');

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  if (!forceRefresh) {
    return NextResponse.json(
      {
        error: 'Batch scrape is explicit: add refresh=1 (long-running, many browser tabs).',
        hint: 'Optional: keys=slug1,slug2 — default maxPlayers=35. Player-stats HTML is JS-rendered; batch defaults puppeteerOnly=1 (skip dead fetch). Try fetch first: puppeteerOnly=0&puppeteerFallback=1.',
      },
      { status: 400 }
    );
  }

  if (process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const startedAt = new Date().toISOString();

  try {
    const squad = filterSquadByKeys(await fetchSoccerwaySquadPlayers(teamHref, { sort: 'document' }), keysFilter).slice(
      0,
      maxPlayers
    );
    if (!squad.length) {
      return NextResponse.json(
        { success: false, error: 'No squad players found (check href or keys filter).', players: [], startedAt },
        { status: 404 }
      );
    }

    const prefetchedMatches = await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true });
    if (!prefetchedMatches.length) {
      return NextResponse.json(
        { success: false, error: 'No recent matches to scrape for this team.', players: [], startedAt },
        { status: 404 }
      );
    }

    const ZERO_MATCH_HINT =
      'No player-stats rows matched for prefetched games: often the player did not appear in those squads (DNP), or the match table name differs from the squad list. Confirm playerKey matches roster-report displayName; try categories=all after a top-only miss.';

    const results: Array<{
      playerKey: string;
      displayName: string;
      matchCount: number;
      writeOk: boolean;
      error?: string;
      hint?: string;
    }> = [];

    const squadInputs = squad.map((p) => ({
      playerKey: p.playerKey,
      displayName: p.displayName,
      aliases: buildPlayerAliasesFromDisplayName(p.displayName),
    }));

    let scrapeError: string | null = null;
    let perPlayer: Awaited<ReturnType<typeof buildSquadPlayerStats>> = [];
    try {
      perPlayer = await buildSquadPlayerStats(teamHref, limit, categories, squadInputs, {
        prefetchedMatches,
        matchConcurrency,
        fetchConcurrency,
        disablePuppeteerFallback: !(puppeteerFallback || puppeteerOnly),
        puppeteerOnly,
      });
    } catch (err) {
      scrapeError = err instanceof Error ? err.message : String(err);
    }

    const perPlayerByKey = new Map(perPlayer.map((r) => [r.playerKey, r] as const));

    for (let offset = 0; offset < squadInputs.length; offset += playerConcurrency) {
      const chunk = squadInputs.slice(offset, offset + playerConcurrency);
      const chunkOut = await Promise.all(
        chunk.map(async (p) => {
          if (scrapeError) {
            return {
              playerKey: p.playerKey,
              displayName: p.displayName,
              matchCount: 0,
              writeOk: false,
              error: scrapeError,
            };
          }
          const matches = perPlayerByKey.get(p.playerKey)?.matches ?? [];
          const generatedAt = new Date().toISOString();
          const cachePayload = {
            teamHref,
            playerName: p.displayName,
            playerKey: p.playerKey,
            limit,
            categories: [...categories],
            matches,
            source: 'soccerway' as const,
            generatedAt,
          };
          let writeOk = false;
          if (matches.length > 0) {
            try {
              writeOk = await setSoccerPlayerStatsCache(
                teamHref,
                p.playerKey,
                limit,
                categories,
                cachePayload,
                PLAYER_STATS_CACHE_TTL_MINUTES,
                false
              );
            } catch (err) {
              return {
                playerKey: p.playerKey,
                displayName: p.displayName,
                matchCount: matches.length,
                writeOk: false,
                error: err instanceof Error ? err.message : String(err),
              };
            }
          }
          return {
            playerKey: p.playerKey,
            displayName: p.displayName,
            matchCount: matches.length,
            writeOk,
            ...(matches.length === 0 ? { hint: ZERO_MATCH_HINT } : {}),
          };
        })
      );
      results.push(...chunkOut);
    }

    const finishedAt = new Date().toISOString();
    const ok = results.filter((r) => r.matchCount > 0 && r.writeOk).length;
    const partial = results.filter((r) => r.matchCount > 0 && !r.writeOk).length;
    const errored = results.filter((r) => typeof r.error === 'string' && r.error.trim().length > 0).length;
    /** "Did not play" — squad member with no rows in any of the scraped matches (manager/reserve/injured/etc). */
    const noAppearances = results.filter((r) => r.matchCount === 0 && !r.error).length;

    return NextResponse.json({
      success: true,
      teamHref,
      startedAt,
      finishedAt,
      categories,
      availableCategories: PLAYER_STAT_CATEGORIES,
      summary: {
        squadSize: squad.length,
        prefetchedMatchCount: prefetchedMatches.length,
        playerConcurrency,
        matchConcurrency,
        fetchConcurrency,
        puppeteerFallback,
        puppeteerOnly,
        limit,
        cacheWritesOk: ok,
        cacheWritesPartial: partial,
        scrapeErrors: errored,
        noAppearances,
      },
      players: results,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch player stats failed';
    return NextResponse.json({ success: false, error: message, startedAt }, { status: 500 });
  }
}
