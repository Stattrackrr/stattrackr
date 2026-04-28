import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import {
  getSoccerPredictedLineupCache,
  getSoccerTeamResultsCache,
  normalizeSoccerTeamHref,
  setSoccerPredictedLineupCache,
  type SoccerPredictedLineupCachePayload,
} from '@/lib/soccerCache';
import {
  buildSoccerwayLineupsGraphqlUrl,
  buildSoccerwayLineupsPath,
  buildSoccerwayPredictedLineupsGraphqlUrl,
  detectSoccerwayLineupStatus,
  extractSoccerwayEventId,
  hasDisplayableSoccerLineup,
  parseSoccerwayLineupsGraphql,
  type SoccerwayLineupBundle,
} from '@/lib/soccerwayTeamResults';
import {
  getPermanentSoccerPredictedLineup,
  getPermanentSoccerTeamResults,
  persistPermanentSoccerPredictedLineup,
} from '@/lib/soccerPermanentStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const FOREVER_CACHE_TTL_MINUTES = Number.POSITIVE_INFINITY;
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};
const SOCCERWAY_GRAPHQL_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  Referer: 'https://www.soccerway.com/',
  Origin: 'https://www.soccerway.com',
};

type NextFixtureLookupResponse = {
  fixture?: {
    summaryPath?: string | null;
  } | null;
  error?: string;
};

type PredictedLineupResponse = {
  summaryPath: string | null;
  lineupsPath: string | null;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
  lineupFrom?: 'upcoming' | 'previous';
  cache: {
    source: 'cache' | 'live' | 'cache-miss' | 'permanent';
    forcedRefresh: boolean;
    cacheOnly?: boolean;
  };
};

async function resolveNextFixtureSummaryPath(
  request: NextRequest,
  teamHref: string,
  forceRefresh: boolean,
  cacheOnly: boolean
): Promise<{ summaryPath: string | null; error?: string }> {
  const params = new URLSearchParams({ href: teamHref });
  if (forceRefresh) params.set('refresh', '1');
  if (cacheOnly) params.set('cacheOnly', '1');

  const origin =
    request.nextUrl?.origin ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const headers: Record<string, string> = { Accept: 'application/json' };

  const authHeader = request.headers.get('authorization');
  const cronHeader = request.headers.get('x-cron-secret');
  if (authHeader) headers.Authorization = authHeader;
  if (cronHeader) headers['X-Cron-Secret'] = cronHeader;

  const response = await fetch(`${origin}/api/soccer/next-game?${params.toString()}`, {
    method: 'GET',
    headers,
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as NextFixtureLookupResponse | null;
  if (!response.ok) {
    return {
      summaryPath: null,
      error: payload?.error || `Failed to load next fixture (${response.status})`,
    };
  }

  return {
    summaryPath: String(payload?.fixture?.summaryPath || '').trim() || null,
  };
}

async function fetchSoccerwayLineupBundle(summaryPath: string): Promise<{
  lineupsPath: string;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
}> {
  const lineupsPath = buildSoccerwayLineupsPath(summaryPath);
  const response = await fetch(`https://www.soccerway.com${lineupsPath}`, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway lineups page returned ${response.status}`);

  const html = await response.text();
  const eventId = extractSoccerwayEventId(html);
  const statusHint = detectSoccerwayLineupStatus(html);
  if (!eventId || statusHint === 'unavailable') {
    return {
      lineupsPath,
      eventId: eventId ?? null,
      lineup: {
        status: 'unavailable',
        eventId: eventId ?? null,
        teams: [],
      },
    };
  }

  const graphqlResponse = await fetch(buildSoccerwayLineupsGraphqlUrl(eventId), {
    headers: SOCCERWAY_GRAPHQL_HEADERS,
    cache: 'no-store',
  });
  if (!graphqlResponse.ok) throw new Error(`Soccerway lineups GraphQL returned ${graphqlResponse.status}`);

  const graphqlRaw = await graphqlResponse.text();
  const parsed = parseSoccerwayLineupsGraphql(graphqlRaw, statusHint);

  const fallbackNeeded = !parsed || parsed.status === 'unavailable' || parsed.teams.length === 0;
  if (fallbackNeeded) {
    const predictedResponse = await fetch(buildSoccerwayPredictedLineupsGraphqlUrl(eventId), {
      headers: SOCCERWAY_GRAPHQL_HEADERS,
      cache: 'no-store',
    });
    if (predictedResponse.ok) {
      const predictedRaw = await predictedResponse.text();
      const predictedParsed = parseSoccerwayLineupsGraphql(predictedRaw, 'predicted');
      if (predictedParsed && predictedParsed.status !== 'unavailable' && predictedParsed.teams.length > 0) {
        return {
          lineupsPath,
          eventId,
          lineup: {
            ...predictedParsed,
            eventId,
          },
        };
      }
    }
  }

  return {
    lineupsPath,
    eventId,
    lineup: parsed
      ? {
          ...parsed,
          eventId,
        }
      : {
          status: 'unavailable',
          eventId,
          teams: [],
        },
  };
}

function normalizeSummaryPath(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .replace(/\/+$/, '');
}

function pickPreviousMatchSummaryPath(matches: Array<{ summaryPath: string }>, nextSummaryPath: string | null): string | null {
  const next = normalizeSummaryPath(nextSummaryPath);
  for (const match of matches) {
    const summaryPath = normalizeSummaryPath(match.summaryPath);
    if (!summaryPath) continue;
    if (next && summaryPath === next) continue;
    return match.summaryPath;
  }
  return null;
}

async function getCachedTeamResultsSummaryPaths(teamHref: string): Promise<Array<{ summaryPath: string }>> {
  const cached = await getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  if (cached?.matches?.length) return cached.matches;
  const permanent = await getPermanentSoccerTeamResults(teamHref);
  return permanent?.matches ?? [];
}

async function tryFetchPreviousDisplayableLineup(
  teamHref: string,
  nextSummaryPath: string | null
): Promise<{
  summaryPath: string;
  lineupsPath: string;
  eventId: string | null;
  lineup: SoccerwayLineupBundle;
} | null> {
  const matches = await getCachedTeamResultsSummaryPaths(teamHref);
  if (!matches.length) return null;
  const previousSummaryPath = pickPreviousMatchSummaryPath(matches, nextSummaryPath);
  if (!previousSummaryPath) return null;
  const previous = await fetchSoccerwayLineupBundle(previousSummaryPath);
  if (!hasDisplayableSoccerLineup(previous.lineup)) return null;
  return {
    summaryPath: previousSummaryPath,
    lineupsPath: previous.lineupsPath,
    eventId: previous.eventId,
    lineup: previous.lineup!,
  };
}

async function getCachedLineupSource(
  request: NextRequest,
  teamHref: string,
  summaryPath: string | null,
  lineup: SoccerwayLineupBundle | null
): Promise<'upcoming' | 'previous'> {
  if (!hasDisplayableSoccerLineup(lineup) || !summaryPath) return 'upcoming';
  const fixtureLookup = await resolveNextFixtureSummaryPath(request, teamHref, false, true);
  const nextSummaryPath = normalizeSummaryPath(fixtureLookup.summaryPath);
  const currentSummaryPath = normalizeSummaryPath(summaryPath);
  if (!nextSummaryPath) return 'previous';
  return nextSummaryPath === currentSummaryPath ? 'upcoming' : 'previous';
}

async function resolveLineupWithPreviousFallback(
  teamHref: string,
  nextSummaryPath: string | null,
  primary: {
    summaryPath: string | null;
    lineupsPath: string | null;
    eventId: string | null;
    lineup: SoccerwayLineupBundle | null;
  }
): Promise<{
  summaryPath: string | null;
  lineupsPath: string | null;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
  lineupFrom: 'upcoming' | 'previous';
}> {
  if (hasDisplayableSoccerLineup(primary.lineup)) {
    return { ...primary, lineupFrom: 'upcoming' as const };
  }
  const previous = await tryFetchPreviousDisplayableLineup(teamHref, nextSummaryPath);
  if (previous) {
    return {
      summaryPath: previous.summaryPath,
      lineupsPath: previous.lineupsPath,
      eventId: previous.eventId,
      lineup: previous.lineup,
      lineupFrom: 'previous' as const,
    };
  }
  return { ...primary, lineupFrom: 'upcoming' as const };
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const cacheOnly = request.nextUrl.searchParams.get('cacheOnly') === '1';

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  if (forceRefresh && process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  try {
    if (!forceRefresh && cacheOnly) {
      const cached = await getSoccerPredictedLineupCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
      if (cached) {
        const lineupFrom = await getCachedLineupSource(request, teamHref, cached.summaryPath, cached.lineup);
        return NextResponse.json({
          summaryPath: cached.summaryPath,
          lineupsPath: cached.lineupsPath,
          eventId: cached.eventId,
          lineup: cached.lineup,
          lineupFrom,
          cache: {
            source: 'cache',
            forcedRefresh: false,
            cacheOnly: true,
          },
        } satisfies PredictedLineupResponse);
      }

      const permanent = await getPermanentSoccerPredictedLineup(teamHref);
      if (permanent) {
        await setSoccerPredictedLineupCache(teamHref, permanent, FOREVER_CACHE_TTL_MINUTES, true);
        const lineupFrom = await getCachedLineupSource(request, teamHref, permanent.summaryPath, permanent.lineup);
        return NextResponse.json({
          summaryPath: permanent.summaryPath,
          lineupsPath: permanent.lineupsPath,
          eventId: permanent.eventId,
          lineup: permanent.lineup,
          lineupFrom,
          cache: {
            source: 'permanent',
            forcedRefresh: false,
            cacheOnly: true,
          },
        } satisfies PredictedLineupResponse);
      }

      return NextResponse.json({
        summaryPath: null,
        lineupsPath: null,
        eventId: null,
        lineup: null,
        cache: {
          source: 'cache-miss',
          forcedRefresh: false,
          cacheOnly: true,
        },
      } satisfies PredictedLineupResponse);
    }

    if (!forceRefresh) {
      const cached = await getSoccerPredictedLineupCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
      if (cached) {
        await persistPermanentSoccerPredictedLineup(teamHref, cached);
        const lineupFrom = await getCachedLineupSource(request, teamHref, cached.summaryPath, cached.lineup);
        return NextResponse.json({
          summaryPath: cached.summaryPath,
          lineupsPath: cached.lineupsPath,
          eventId: cached.eventId,
          lineup: cached.lineup,
          lineupFrom,
          cache: {
            source: 'cache',
            forcedRefresh: false,
            cacheOnly,
          },
        } satisfies PredictedLineupResponse);
      }

      const permanent = await getPermanentSoccerPredictedLineup(teamHref);
      if (permanent) {
        const lineupFrom = await getCachedLineupSource(request, teamHref, permanent.summaryPath, permanent.lineup);
        return NextResponse.json({
          summaryPath: permanent.summaryPath,
          lineupsPath: permanent.lineupsPath,
          eventId: permanent.eventId,
          lineup: permanent.lineup,
          lineupFrom,
          cache: {
            source: 'permanent',
            forcedRefresh: false,
            cacheOnly,
          },
        } satisfies PredictedLineupResponse);
      }

      return NextResponse.json({
        summaryPath: null,
        lineupsPath: null,
        eventId: null,
        lineup: null,
        cache: {
          source: 'cache-miss',
          forcedRefresh: false,
          cacheOnly,
        },
      } satisfies PredictedLineupResponse);
    }

    const fixtureLookup = await resolveNextFixtureSummaryPath(request, teamHref, forceRefresh, false);
    if (!fixtureLookup.summaryPath) {
      return NextResponse.json(
        {
          error: fixtureLookup.error || 'No upcoming fixture found for predicted lineups.',
          summaryPath: null,
        },
        { status: 404 }
      );
    }

    const live = await fetchSoccerwayLineupBundle(fixtureLookup.summaryPath);
    const resolved = await resolveLineupWithPreviousFallback(teamHref, fixtureLookup.summaryPath, {
      summaryPath: fixtureLookup.summaryPath,
      lineupsPath: live.lineupsPath,
      eventId: live.eventId,
      lineup: live.lineup,
    });

    if (hasDisplayableSoccerLineup(resolved.lineup) && resolved.summaryPath) {
      const cachePayload: SoccerPredictedLineupCachePayload = {
        teamHref,
        summaryPath: resolved.summaryPath,
        lineupsPath: resolved.lineupsPath!,
        eventId: resolved.eventId,
        lineup: resolved.lineup,
        source: 'soccerway',
        generatedAt: new Date().toISOString(),
      };
      await setSoccerPredictedLineupCache(teamHref, cachePayload, FOREVER_CACHE_TTL_MINUTES, true);
      await persistPermanentSoccerPredictedLineup(teamHref, cachePayload);
    }

    return NextResponse.json({
      summaryPath: resolved.summaryPath,
      lineupsPath: resolved.lineupsPath,
      eventId: resolved.eventId,
      lineup: resolved.lineup,
      lineupFrom: resolved.lineupFrom,
      cache: {
        source: 'live',
        forcedRefresh: forceRefresh,
      },
    } satisfies PredictedLineupResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch predicted lineup';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
