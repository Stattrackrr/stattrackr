import { NextRequest, NextResponse } from 'next/server';
import {
  normalizeSoccerTeamHref,
  getSoccerPlayerStatsCacheWithFallback,
  setSoccerPlayerStatsCache,
  type SoccerPlayerStatsCachePayload,
} from '@/lib/soccerCache';
import { enrichPlayerStatsWithPositions } from '@/lib/soccerPlayerPosition';
import { parseSoccerSeasonYearParam } from '@/lib/soccerOpponentBreakdown';
import {
  findMissingSeasonMatches,
  mergePlayerMatchStats,
} from '@/lib/soccerPlayerStatsIncremental';
import {
  applySeasonAndLimitToRecentMatches,
  buildPlayerAliasesFromDisplayName,
  buildPlayerStatsForAliases,
  enrichPlayerMatchesFromTeamCache,
  loadRecentMatchesForScrape,
  parsePlayerStatsMatchLimit,
  parseRequestedPlayerStatCategories,
  type PlayerMatchStats,
  PLAYER_STAT_CATEGORIES,
} from '@/lib/soccerPlayerStatsScrape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const PLAYER_KEY_SAFE = /^[a-z0-9-]{2,80}$/;
const DEFAULT_PLAYER = 'Bernardo Silva';
const DEFAULT_PLAYER_KEY = 'bernardo-silva';
const BERNARDO_ALLOWED_REQUEST = new Set(['bernardo silva', 'bernado silva', 'silva b', 'b silva']);
const PLAYER_STATS_CACHE_TTL_MINUTES = 24 * 60;

function normalizeText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugToDisplayName(slug: string): string {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function bernardoScrapeAliases(): string[] {
  return [...new Set([...buildPlayerAliasesFromDisplayName('Bernardo Silva'), ...BERNARDO_ALLOWED_REQUEST])];
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const explicitKey = request.nextUrl.searchParams.get('playerKey')?.trim().toLowerCase() || '';
  const rawPlayer = request.nextUrl.searchParams.get('player')?.trim() || '';
  const requestedPlayer = rawPlayer || DEFAULT_PLAYER;
  const seasonYear = parseSoccerSeasonYearParam(request.nextUrl.searchParams.get('season'));
  const limit = parsePlayerStatsMatchLimit(request.nextUrl.searchParams.get('limit'), { seasonYear });
  const playerStatCategories = parseRequestedPlayerStatCategories(request.nextUrl.searchParams.get('categories'));
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const forceFull = request.nextUrl.searchParams.get('full') === '1';
  const incrementalRefresh =
    request.nextUrl.searchParams.get('incremental') !== '0' &&
    request.nextUrl.searchParams.get('incremental') !== 'false';
  const cacheOnly = request.nextUrl.searchParams.get('cacheOnly') === '1' || !forceRefresh;

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  let playerKey = DEFAULT_PLAYER_KEY;
  let displayNameForCache = DEFAULT_PLAYER;
  let scrapeAliases: string[] = [];

  if (explicitKey && PLAYER_KEY_SAFE.test(explicitKey)) {
    playerKey = explicitKey;
    displayNameForCache = rawPlayer ? rawPlayer : slugToDisplayName(explicitKey);
    scrapeAliases = [...new Set([...buildPlayerAliasesFromDisplayName(displayNameForCache)])];
  } else {
    if (!BERNARDO_ALLOWED_REQUEST.has(normalizeText(requestedPlayer))) {
      return NextResponse.json(
        { error: 'Pass playerKey (squad slug, e.g. haaland-erling) or search for Bernardo Silva.' },
        { status: 400 }
      );
    }
    scrapeAliases = bernardoScrapeAliases();
  }

  try {
    if (cacheOnly) {
      // Large `player_stats` rows (many matches × categories) can exceed short timeouts; roster-report uses 1200ms.
      const cached = await getSoccerPlayerStatsCacheWithFallback<PlayerMatchStats>(
        teamHref,
        playerKey,
        limit,
        playerStatCategories,
        {
          seasonYear,
          quiet: true,
          restTimeoutMs: 8000,
          jsTimeoutMs: 8000,
        }
      );
      if (cached && Array.isArray(cached.matches)) {
        const cachedMatches = await enrichPlayerMatchesFromTeamCache(teamHref, cached.matches);
        return NextResponse.json({
          success: true,
          player: cached.playerName || displayNameForCache,
          playerKey,
          aliases: [...scrapeAliases],
          categories: cached.categories?.length ? cached.categories : playerStatCategories,
          availableCategories: PLAYER_STAT_CATEGORIES,
          matches: cachedMatches,
          seasonYear: cached.seasonYear ?? seasonYear,
          summary: {
            matchCount: cachedMatches.length,
          },
          cache: {
            source: 'cache',
            generatedAt: cached.generatedAt,
            forcedRefresh: false,
          },
        });
      }

      return NextResponse.json({
        success: true,
        player: displayNameForCache,
        playerKey,
        aliases: [...scrapeAliases],
        categories: playerStatCategories,
        availableCategories: PLAYER_STAT_CATEGORIES,
        matches: [],
        summary: {
          matchCount: 0,
        },
        cache: {
          source: 'cache-miss',
          generatedAt: null,
          forcedRefresh: false,
        },
      });
    }

    const seasonMatches = applySeasonAndLimitToRecentMatches(
      await loadRecentMatchesForScrape(teamHref, limit, { mergeLiveSoccerway: true, seasonYear }),
      limit,
      seasonYear
    );

    let matches: PlayerMatchStats[] = [];
    let updateMode: 'full' | 'incremental' | 'cache-only' = 'full';
    let scrapedNewMatches = seasonMatches.length;

    if (incrementalRefresh && !forceFull) {
      const cached = await getSoccerPlayerStatsCacheWithFallback<PlayerMatchStats>(
        teamHref,
        playerKey,
        limit,
        playerStatCategories,
        { seasonYear, quiet: true, restTimeoutMs: 8000, jsTimeoutMs: 8000 }
      );
      const existing = Array.isArray(cached?.matches)
        ? await enrichPlayerMatchesFromTeamCache(teamHref, cached!.matches)
        : [];
      const missing = findMissingSeasonMatches(seasonMatches, existing);

      if (cached && missing.length > 0) {
        const scraped = await buildPlayerStatsForAliases(
          teamHref,
          limit,
          playerStatCategories,
          scrapeAliases,
          { seasonYear, prefetchedMatches: missing }
        );
        matches = await enrichPlayerMatchesFromTeamCache(teamHref, mergePlayerMatchStats(existing, scraped));
        updateMode = 'incremental';
        scrapedNewMatches = missing.length;
      } else if (cached && existing.length > 0) {
        matches = existing;
        updateMode = 'incremental';
        scrapedNewMatches = 0;
      } else {
        matches = await buildPlayerStatsForAliases(teamHref, limit, playerStatCategories, scrapeAliases, {
          seasonYear,
          prefetchedMatches: seasonMatches,
        });
        matches = await enrichPlayerMatchesFromTeamCache(teamHref, matches);
        updateMode = 'full';
      }
    } else {
      matches = await buildPlayerStatsForAliases(teamHref, limit, playerStatCategories, scrapeAliases, {
        seasonYear,
        prefetchedMatches: seasonMatches,
      });
      matches = await enrichPlayerMatchesFromTeamCache(teamHref, matches);
      updateMode = 'full';
    }

    const generatedAt = new Date().toISOString();
    const cachePayload = enrichPlayerStatsWithPositions({
      teamHref,
      playerName: displayNameForCache,
      playerKey,
      limit,
      categories: [...playerStatCategories],
      matches,
      source: 'soccerway',
      generatedAt,
      seasonYear,
    }) satisfies SoccerPlayerStatsCachePayload<PlayerMatchStats>;
    let cacheWriteOk = false;
    if (matches.length > 0) {
      cacheWriteOk = await setSoccerPlayerStatsCache(
        teamHref,
        playerKey,
        limit,
        playerStatCategories,
        cachePayload,
        PLAYER_STATS_CACHE_TTL_MINUTES,
        false
      );
    }
    return NextResponse.json({
      success: true,
      player: displayNameForCache,
      playerKey,
      aliases: [...scrapeAliases],
      categories: playerStatCategories,
      availableCategories: PLAYER_STAT_CATEGORIES,
      matches,
      seasonYear,
      updateMode,
      scrapedNewMatches,
      summary: {
        matchCount: matches.length,
        seasonMatchCount: seasonMatches.length,
      },
      cache: {
        source: 'live',
        generatedAt,
        forcedRefresh: forceRefresh,
        incrementalRefresh: incrementalRefresh && !forceFull,
        writeOk: cacheWriteOk,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch soccer player props test data';
    return NextResponse.json({ success: false, error: message, player: displayNameForCache, playerKey, matches: [] }, { status: 500 });
  }
}
