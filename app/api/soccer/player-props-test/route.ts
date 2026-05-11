import { NextRequest, NextResponse } from 'next/server';
import { normalizeSoccerTeamHref, getSoccerPlayerStatsCache, setSoccerPlayerStatsCache, type SoccerPlayerStatsCachePayload } from '@/lib/soccerCache';
import {
  buildPlayerAliasesFromDisplayName,
  buildPlayerStatsForAliases,
  enrichPlayerMatchesFromTeamCache,
  parseRequestedPlayerStatCategories,
  type PlayerMatchStats,
  PLAYER_STAT_CATEGORIES,
  DEFAULT_MATCH_LIMIT,
  MAX_MATCH_LIMIT,
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
  const rawLimit = request.nextUrl.searchParams.get('limit')?.trim().toLowerCase() ?? '';
  const limit =
    !rawLimit || rawLimit === 'all' || rawLimit === '0'
      ? DEFAULT_MATCH_LIMIT
      : Math.max(1, Math.min(MAX_MATCH_LIMIT, Number.parseInt(rawLimit, 10) || DEFAULT_MATCH_LIMIT));
  const playerStatCategories = parseRequestedPlayerStatCategories(request.nextUrl.searchParams.get('categories'));
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
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
      const cached = await getSoccerPlayerStatsCache<PlayerMatchStats>(
        teamHref,
        playerKey,
        limit,
        playerStatCategories,
        {
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

    const matches = await buildPlayerStatsForAliases(teamHref, limit, playerStatCategories, scrapeAliases);
    const generatedAt = new Date().toISOString();
    const cachePayload: SoccerPlayerStatsCachePayload<PlayerMatchStats> = {
      teamHref,
      playerName: displayNameForCache,
      playerKey,
      limit,
      categories: [...playerStatCategories],
      matches,
      source: 'soccerway',
      generatedAt,
    };
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
      summary: {
        matchCount: matches.length,
      },
      cache: {
        source: 'live',
        generatedAt,
        forcedRefresh: forceRefresh,
        writeOk: cacheWriteOk,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch soccer player props test data';
    return NextResponse.json({ success: false, error: message, player: displayNameForCache, playerKey, matches: [] }, { status: 500 });
  }
}
