import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import {
  getSoccerMatchStatsCache,
  getSoccerTeamResultsCache,
  normalizeSoccerTeamHref,
  setSoccerMatchStatsCache,
  setSoccerTeamResultsCache,
  type SoccerMatchStatsCachePayload,
  type SoccerTeamResultsCachePayload,
} from '@/lib/soccerCache';
import {
  buildSoccerwayMatchStatsFeedUrl,
  buildSoccerwayParticipantResultsFeedUrl,
  extractSoccerwayCountryId,
  extractSoccerwayFeedSign,
  extractParticipantIdFromTeamHref,
  parseSoccerwayMatchStatsFeed,
  parseSoccerwayTeamResultsHtml,
  type SoccerwayMatchStats,
  type SoccerwayRecentMatch,
} from '@/lib/soccerwayTeamResults';
import {
  getPermanentSoccerTeamResults,
  persistPermanentSoccerTeamResults,
} from '@/lib/soccerPermanentStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const MAX_SHOW_MORE_PAGES = 100;
const HISTORY_CUTOFF_UNIX = Math.floor(Date.UTC(2008, 0, 1, 0, 0, 0) / 1000);
const MATCH_STATS_BATCH_SIZE = 8;
const FOREVER_CACHE_TTL_MINUTES = Number.POSITIVE_INFINITY;
const TEAM_RESULTS_COMPETITION_METADATA_VERSION = 2;
const DEFAULT_INCREMENTAL_PAGES = 2;
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function appendUniqueMatches(target: SoccerwayRecentMatch[], incoming: SoccerwayRecentMatch[]): number {
  const seen = new Set(target.map((match) => String(match.matchId || '').trim() || match.summaryPath));
  let added = 0;
  for (const match of incoming) {
    const dedupeKey = String(match.matchId || '').trim() || match.summaryPath;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    target.push(match);
    added += 1;
  }
  return added;
}

function buildMatchDedupeKey(match: Pick<SoccerwayRecentMatch, 'matchId' | 'summaryPath'>): string {
  return String(match.matchId || '').trim() || String(match.summaryPath || '').trim();
}

function filterMatchesFrom2008(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return matches.filter((match) => match.kickoffUnix == null || match.kickoffUnix >= HISTORY_CUTOFF_UNIX);
}

function pageReachedHistoryCutoff(matches: SoccerwayRecentMatch[]): boolean {
  return matches.some((match) => match.kickoffUnix != null && match.kickoffUnix < HISTORY_CUTOFF_UNIX);
}

function cacheHasHistoryProbe(payload: SoccerTeamResultsCachePayload | null | undefined): boolean {
  return payload?.historyProbeComplete === true;
}

function cacheHasCompetitionMetadataVersion(payload: SoccerTeamResultsCachePayload | null | undefined): boolean {
  return payload?.competitionMetadataVersion === TEAM_RESULTS_COMPETITION_METADATA_VERSION;
}

function canServeCachedTeamResults(payload: SoccerTeamResultsCachePayload | null | undefined): payload is SoccerTeamResultsCachePayload {
  if (!payload || !Array.isArray(payload.matches) || payload.matches.length === 0) return false;
  if (!cacheHasHistoryProbe(payload)) return false;
  if (!cacheHasCompetitionMetadataVersion(payload)) return false;
  if (!matchesHaveLogoMetadata(payload.matches)) return false;
  if (!matchesHaveCompetitionMetadata(payload.matches)) return false;
  if (!matchesHaveEmbeddedStats(payload.matches)) return false;
  return true;
}

function cachePayloadIsTruncated(payload: SoccerTeamResultsCachePayload | null | undefined): boolean {
  if (!payload || !Array.isArray(payload.matches) || payload.matches.length === 0) return false;
  const expectedCount = Number(payload.count || payload.matches.length);
  return Number.isFinite(expectedCount) && expectedCount > payload.matches.length;
}

function toTeamResultsPayload(teamHref: string, resultsUrl: string, matches: SoccerwayRecentMatch[], showMorePagesFetched: number): SoccerTeamResultsCachePayload {
  return {
    teamHref,
    resultsUrl,
    matches,
    count: matches.length,
    showMorePagesFetched,
    historyProbeComplete: true,
    competitionMetadataVersion: TEAM_RESULTS_COMPETITION_METADATA_VERSION,
    source: 'soccerway',
    generatedAt: new Date().toISOString(),
  };
}

function toFastCacheTeamResultsPayload(payload: SoccerTeamResultsCachePayload): SoccerTeamResultsCachePayload {
  return {
    ...payload,
    matches: payload.matches.map((match) => ({
      ...match,
      stats: pruneFastCacheStats(match.stats),
    })),
  };
}

function pruneFastCacheStats(stats: SoccerwayMatchStats | null | undefined): SoccerwayMatchStats | null {
  if (!stats) return null;
  const matchPeriod =
    stats.periods.find((period) => String(period.name || '').trim().toLowerCase() === 'match') ?? stats.periods[0] ?? null;
  if (!matchPeriod) return null;
  return {
    feedUrl: stats.feedUrl,
    raw: '',
    periods: [
      {
        name: matchPeriod.name,
        categories: matchPeriod.categories.map((category) => ({
          name: category.name,
          stats: category.stats.map((stat) => ({
            id: stat.id,
            name: stat.name,
            homeValue: stat.homeValue,
            awayValue: stat.awayValue,
            fields: {},
          })),
        })),
      },
    ],
  };
}

function matchesHaveEmbeddedStats(matches: SoccerwayRecentMatch[]): boolean {
  return matches.every((match) => Object.prototype.hasOwnProperty.call(match, 'stats'));
}

function matchesHaveLogoMetadata(matches: SoccerwayRecentMatch[]): boolean {
  return matches.every(
    (match) =>
      Object.prototype.hasOwnProperty.call(match, 'homeLogoUrl') &&
      Object.prototype.hasOwnProperty.call(match, 'awayLogoUrl')
  );
}

function matchesHaveCompetitionMetadata(matches: SoccerwayRecentMatch[]): boolean {
  return matches.every(
    (match) =>
      Object.prototype.hasOwnProperty.call(match, 'competitionName') &&
      Object.prototype.hasOwnProperty.call(match, 'competitionCountry')
  );
}

function parseLimitMatches(value: string | null): number | null {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

function sliceRecentMatches(matches: SoccerwayRecentMatch[], limitMatches: number | null): SoccerwayRecentMatch[] {
  if (!limitMatches || matches.length <= limitMatches) return matches;
  return matches.slice(0, limitMatches);
}

function sortMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function parseIncrementalPages(value: string | null): number {
  const parsed = Number.parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_INCREMENTAL_PAGES;
  return Math.min(parsed, MAX_SHOW_MORE_PAGES);
}

async function fetchTeamResultsFromSoccerway(teamHref: string): Promise<{
  resultsUrl: string;
  matches: SoccerwayRecentMatch[];
  feedSign: string | null;
  showMorePagesFetched: number;
}> {
  const resultsUrl = `https://www.soccerway.com${teamHref}/results/`;
  const response = await fetch(resultsUrl, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway returned ${response.status}`);

  const html = await response.text();
  const matches = filterMatchesFrom2008(parseSoccerwayTeamResultsHtml(html));
  const feedSign = extractSoccerwayFeedSign(html);
  const countryId = extractSoccerwayCountryId(html);
  const participantId = extractParticipantIdFromTeamHref(teamHref);
  let showMorePagesFetched = 0;

  if (feedSign && countryId && participantId) {
    for (let page = 1; page <= MAX_SHOW_MORE_PAGES; page += 1) {
      const feedUrl = buildSoccerwayParticipantResultsFeedUrl({
        countryId,
        participantId,
        page,
        timezoneHour: 0,
        language: 'en',
        projectTypeId: 1,
      });
      const feedResponse = await fetch(feedUrl, {
        headers: {
          'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
          Accept: '*/*',
          'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
          Referer: 'https://www.soccerway.com/',
          Origin: 'https://www.soccerway.com',
          'x-fsign': feedSign,
        },
        cache: 'no-store',
      });
      if (!feedResponse.ok) break;

      const feedText = await feedResponse.text();
      const pageMatches = parseSoccerwayTeamResultsHtml(feedText);
      if (pageMatches.length === 0) break;

      showMorePagesFetched += 1;
      const added = appendUniqueMatches(matches, filterMatchesFrom2008(pageMatches));
      if (pageReachedHistoryCutoff(pageMatches) || added === 0) break;
    }
  }

  return { resultsUrl, matches, feedSign, showMorePagesFetched };
}

async function fetchIncrementalTeamResultsFromSoccerway(
  teamHref: string,
  existingMatches: SoccerwayRecentMatch[],
  maxExtraPages: number
): Promise<{
  resultsUrl: string;
  newMatches: SoccerwayRecentMatch[];
  feedSign: string | null;
  showMorePagesFetched: number;
}> {
  const resultsUrl = `https://www.soccerway.com${teamHref}/results/`;
  const response = await fetch(resultsUrl, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway returned ${response.status}`);

  const html = await response.text();
  const firstPageMatches = filterMatchesFrom2008(parseSoccerwayTeamResultsHtml(html));
  const feedSign = extractSoccerwayFeedSign(html);
  const countryId = extractSoccerwayCountryId(html);
  const participantId = extractParticipantIdFromTeamHref(teamHref);
  const existingKeys = new Set(existingMatches.map((match) => buildMatchDedupeKey(match)));
  const incrementalKeys = new Set<string>();
  const newMatches: SoccerwayRecentMatch[] = [];

  appendUniqueMatches(
    newMatches,
    firstPageMatches.filter((match) => {
      const key = buildMatchDedupeKey(match);
      if (!key || existingKeys.has(key) || incrementalKeys.has(key)) return false;
      incrementalKeys.add(key);
      return true;
    })
  );

  let showMorePagesFetched = 0;
  if (maxExtraPages > 0 && feedSign && countryId && participantId) {
    for (let page = 1; page <= maxExtraPages; page += 1) {
      const feedUrl = buildSoccerwayParticipantResultsFeedUrl({
        countryId,
        participantId,
        page,
        timezoneHour: 0,
        language: 'en',
        projectTypeId: 1,
      });
      const feedResponse = await fetch(feedUrl, {
        headers: {
          'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
          Accept: '*/*',
          'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
          Referer: 'https://www.soccerway.com/',
          Origin: 'https://www.soccerway.com',
          'x-fsign': feedSign,
        },
        cache: 'no-store',
      });
      if (!feedResponse.ok) break;

      const feedText = await feedResponse.text();
      const pageMatches = filterMatchesFrom2008(parseSoccerwayTeamResultsHtml(feedText));
      if (pageMatches.length === 0) break;

      showMorePagesFetched += 1;
      const unseenOnPage = pageMatches.filter((match) => {
        const key = buildMatchDedupeKey(match);
        if (!key || existingKeys.has(key) || incrementalKeys.has(key)) return false;
        incrementalKeys.add(key);
        return true;
      });
      appendUniqueMatches(newMatches, unseenOnPage);
      if (unseenOnPage.length === 0) break;
    }
  }

  return {
    resultsUrl,
    newMatches: sortMatchesByRecency(newMatches),
    feedSign,
    showMorePagesFetched,
  };
}

async function fetchMatchStatsFromSoccerway(matchId: string, feedSign: string): Promise<SoccerwayMatchStats | null> {
  const feedUrl = buildSoccerwayMatchStatsFeedUrl(matchId);
  const response = await fetch(feedUrl, {
    headers: {
      'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
      Accept: '*/*',
      'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
      Referer: 'https://www.soccerway.com/',
      Origin: 'https://www.soccerway.com',
      'x-fsign': feedSign,
    },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return parseSoccerwayMatchStatsFeed(await response.text(), feedUrl);
}

async function hydrateMatchStats(
  matches: SoccerwayRecentMatch[],
  feedSign: string | null,
  forceRefresh: boolean
): Promise<{
  matches: SoccerwayRecentMatch[];
  statsCacheHits: number;
  statsFetchedLive: number;
  statsMissing: number;
}> {
  let statsCacheHits = 0;
  let statsFetchedLive = 0;
  let statsMissing = 0;
  const hydrated = [...matches];

  for (let offset = 0; offset < hydrated.length; offset += MATCH_STATS_BATCH_SIZE) {
    const batch = hydrated.slice(offset, offset + MATCH_STATS_BATCH_SIZE);
    const enriched = await Promise.all(
      batch.map(async (match) => {
        if (!forceRefresh) {
          const cached = await getSoccerMatchStatsCache(match.matchId, { quiet: true });
          if (cached) {
            statsCacheHits += 1;
            return { ...match, stats: cached.stats };
          }
        }

        if (!feedSign) {
          statsMissing += 1;
          return { ...match, stats: null };
        }

        const stats = await fetchMatchStatsFromSoccerway(match.matchId, feedSign);
        const payload: SoccerMatchStatsCachePayload = {
          matchId: match.matchId,
          stats,
          source: 'soccerway',
          generatedAt: new Date().toISOString(),
        };
        await setSoccerMatchStatsCache(match.matchId, payload, FOREVER_CACHE_TTL_MINUTES, true);
        statsFetchedLive += 1;
        if (!stats) statsMissing += 1;
        return { ...match, stats };
      })
    );

    for (let i = 0; i < enriched.length; i += 1) hydrated[offset + i] = enriched[i];
  }

  return { matches: hydrated, statsCacheHits, statsFetchedLive, statsMissing };
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const forceRefresh = request.nextUrl.searchParams.get('refresh') === '1';
  const incrementalRefresh = request.nextUrl.searchParams.get('incremental') === '1';
  const cacheOnly = request.nextUrl.searchParams.get('cacheOnly') === '1';
  const limitMatches = parseLimitMatches(request.nextUrl.searchParams.get('limitMatches'));
  const incrementalPages = parseIncrementalPages(request.nextUrl.searchParams.get('pages'));

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  if (forceRefresh && process.env.NODE_ENV === 'production') {
    const auth = authorizeCronRequest(request);
    if (!auth.authorized) return auth.response;
  }

  const resultsUrl = `https://www.soccerway.com${teamHref}/results/`;

  try {
    let teamResultsSource: 'cache' | 'live' = 'live';
    let cachedPayload = forceRefresh && !incrementalRefresh
      ? null
      : await getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
    const usableCachedPayload =
      canServeCachedTeamResults(cachedPayload) && !cachePayloadIsTruncated(cachedPayload) ? cachedPayload : null;
    let baseMatches = usableCachedPayload?.matches ?? [];
    let showMorePagesFetched = usableCachedPayload?.showMorePagesFetched ?? 0;
    let feedSign: string | null = null;

    if (usableCachedPayload && cacheOnly) {
      const matches = sliceRecentMatches(usableCachedPayload.matches, limitMatches);
      const totalCount = usableCachedPayload.count ?? usableCachedPayload.matches.length;
      return NextResponse.json({
        resultsUrl: usableCachedPayload.resultsUrl || resultsUrl,
        matches,
        count: matches.length,
        totalCount,
        hasMore: matches.length < totalCount,
        showMorePagesFetched,
        cache: {
          teamResultsSource: 'cache',
          forcedRefresh: false,
          cacheOnly: true,
          statsCacheHits: 0,
          statsFetchedLive: 0,
          statsMissing: baseMatches.filter((match) => match.stats == null).length,
          teamResultsExpiresAt: (cachedPayload as { __cache_metadata?: { expires_at?: string } } | null)?.__cache_metadata?.expires_at ?? null,
        },
      });
    }

    if (!usableCachedPayload && cacheOnly) {
      const permanentPayload = await getPermanentSoccerTeamResults(teamHref, { limitMatches: limitMatches ?? undefined });
      const usablePermanentPayload = canServeCachedTeamResults(permanentPayload) ? permanentPayload : null;
      if (usablePermanentPayload) {
        const matches = sliceRecentMatches(usablePermanentPayload.matches, limitMatches);
        const totalCount = usablePermanentPayload.count ?? usablePermanentPayload.matches.length;
        if (!limitMatches || matches.length >= totalCount) {
          await setSoccerTeamResultsCache(teamHref, toFastCacheTeamResultsPayload(usablePermanentPayload), FOREVER_CACHE_TTL_MINUTES, true);
        }
        return NextResponse.json({
          resultsUrl: usablePermanentPayload.resultsUrl || resultsUrl,
          matches,
          count: matches.length,
          totalCount,
          hasMore: matches.length < totalCount,
          showMorePagesFetched: usablePermanentPayload.showMorePagesFetched,
          cache: {
            teamResultsSource: 'permanent',
            forcedRefresh: false,
            cacheOnly: true,
            statsCacheHits: 0,
            statsFetchedLive: 0,
            statsMissing: usablePermanentPayload.matches.filter((match) => match.stats == null).length,
            teamResultsExpiresAt: null,
          },
        });
      }

      return NextResponse.json({
        resultsUrl,
        matches: [],
        count: 0,
        showMorePagesFetched: 0,
        cache: {
          teamResultsSource: 'cache-miss',
          forcedRefresh: false,
          cacheOnly: true,
          statsCacheHits: 0,
          statsFetchedLive: 0,
          statsMissing: 0,
          teamResultsExpiresAt: null,
        },
      });
    }

    if (!forceRefresh) {
      if (usableCachedPayload) {
        const matches = sliceRecentMatches(usableCachedPayload.matches, limitMatches);
        const totalCount = usableCachedPayload.count ?? usableCachedPayload.matches.length;
        return NextResponse.json({
          resultsUrl: usableCachedPayload.resultsUrl || resultsUrl,
          matches,
          count: matches.length,
          totalCount,
          hasMore: matches.length < totalCount,
          showMorePagesFetched: usableCachedPayload.showMorePagesFetched,
          cache: {
            teamResultsSource: 'cache',
            forcedRefresh: false,
            cacheOnly,
            statsCacheHits: 0,
            statsFetchedLive: 0,
            statsMissing: usableCachedPayload.matches.filter((match) => match.stats == null).length,
            teamResultsExpiresAt: (cachedPayload as { __cache_metadata?: { expires_at?: string } } | null)?.__cache_metadata?.expires_at ?? null,
          },
        });
      }

      const permanentPayload = await getPermanentSoccerTeamResults(teamHref, { limitMatches: limitMatches ?? undefined });
      const usablePermanentPayload = canServeCachedTeamResults(permanentPayload) ? permanentPayload : null;
      if (usablePermanentPayload) {
        const totalCount = usablePermanentPayload.count ?? usablePermanentPayload.matches.length;
        return NextResponse.json({
          resultsUrl: usablePermanentPayload.resultsUrl || resultsUrl,
          matches: usablePermanentPayload.matches,
          count: usablePermanentPayload.matches.length,
          totalCount,
          hasMore: usablePermanentPayload.matches.length < totalCount,
          showMorePagesFetched: usablePermanentPayload.showMorePagesFetched,
          cache: {
            teamResultsSource: 'permanent',
            forcedRefresh: false,
            cacheOnly,
            statsCacheHits: 0,
            statsFetchedLive: 0,
            statsMissing: usablePermanentPayload.matches.filter((match) => match.stats == null).length,
            teamResultsExpiresAt: null,
          },
        });
      }

      return NextResponse.json({
        resultsUrl,
        matches: [],
        count: 0,
        showMorePagesFetched: 0,
        cache: {
          teamResultsSource: 'cache-miss',
          forcedRefresh: false,
          cacheOnly,
          statsCacheHits: 0,
          statsFetchedLive: 0,
          statsMissing: 0,
          teamResultsExpiresAt: null,
        },
      });
    }

    if (forceRefresh && incrementalRefresh) {
      const permanentPayload = cachedPayload?.matches?.length ? null : await getPermanentSoccerTeamResults(teamHref);
      const basePayload = cachedPayload?.matches?.length ? cachedPayload : permanentPayload;
      const existingMatches = sortMatchesByRecency(Array.isArray(basePayload?.matches) ? basePayload.matches : []);
      const incremental = await fetchIncrementalTeamResultsFromSoccerway(teamHref, existingMatches, incrementalPages);
      const hydratedNewMatches =
        incremental.newMatches.length > 0
          ? await hydrateMatchStats(incremental.newMatches, incremental.feedSign, false)
          : {
              matches: [] as SoccerwayRecentMatch[],
              statsCacheHits: 0,
              statsFetchedLive: 0,
              statsMissing: 0,
            };
      const mergedMatches = sortMatchesByRecency([...existingMatches, ...hydratedNewMatches.matches]);
      const mergedPayload = toTeamResultsPayload(
        teamHref,
        incremental.resultsUrl || basePayload?.resultsUrl || resultsUrl,
        mergedMatches,
        Math.max(basePayload?.showMorePagesFetched ?? 0, incremental.showMorePagesFetched)
      );
      await setSoccerTeamResultsCache(teamHref, toFastCacheTeamResultsPayload(mergedPayload), FOREVER_CACHE_TTL_MINUTES, true);
      await persistPermanentSoccerTeamResults(teamHref, mergedPayload);

      const matches = sliceRecentMatches(mergedMatches, limitMatches);
      const totalCount = mergedPayload.count ?? mergedMatches.length;
      return NextResponse.json({
        resultsUrl: mergedPayload.resultsUrl,
        matches,
        count: matches.length,
        totalCount,
        hasMore: matches.length < totalCount,
        showMorePagesFetched: mergedPayload.showMorePagesFetched,
        cache: {
          teamResultsSource,
          forcedRefresh: true,
          incrementalRefresh: true,
          statsCacheHits: hydratedNewMatches.statsCacheHits,
          statsFetchedLive: hydratedNewMatches.statsFetchedLive,
          statsMissing: hydratedNewMatches.statsMissing,
          newMatchesAdded: hydratedNewMatches.matches.length,
          teamResultsExpiresAt: (cachedPayload as { __cache_metadata?: { expires_at?: string } } | null)?.__cache_metadata?.expires_at ?? null,
        },
      });
    }

    const live = await fetchTeamResultsFromSoccerway(teamHref);
    baseMatches = live.matches;
    showMorePagesFetched = live.showMorePagesFetched;
    feedSign = live.feedSign;

    const shouldHydrateStats =
      forceRefresh || teamResultsSource === 'live' || !matchesHaveEmbeddedStats(baseMatches);
    const hydrated = shouldHydrateStats
      ? await hydrateMatchStats(baseMatches, feedSign, forceRefresh)
      : {
          matches: baseMatches,
          statsCacheHits: 0,
          statsFetchedLive: 0,
          statsMissing: baseMatches.filter((match) => match.stats == null).length,
        };

    const hydratedPayload = toTeamResultsPayload(teamHref, resultsUrl, hydrated.matches, showMorePagesFetched);
    await setSoccerTeamResultsCache(teamHref, toFastCacheTeamResultsPayload(hydratedPayload), FOREVER_CACHE_TTL_MINUTES, true);
    await persistPermanentSoccerTeamResults(teamHref, hydratedPayload);

    return NextResponse.json({
      resultsUrl,
      matches: hydrated.matches,
      count: hydrated.matches.length,
      totalCount: hydrated.matches.length,
      hasMore: false,
      showMorePagesFetched,
      cache: {
        teamResultsSource,
        forcedRefresh: forceRefresh,
        statsCacheHits: hydrated.statsCacheHits,
        statsFetchedLive: hydrated.statsFetchedLive,
        statsMissing: hydrated.statsMissing,
        teamResultsExpiresAt: (cachedPayload as { __cache_metadata?: { expires_at?: string } } | null)?.__cache_metadata?.expires_at ?? null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch team results';
    return NextResponse.json({ error: message, resultsUrl }, { status: 500 });
  }
}
