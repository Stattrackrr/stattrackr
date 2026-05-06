/**
 * Refresh the selected team's next-fixture and predicted-lineup caches.
 *
 * This is the fast path for dashboard cards that do not read directly from the
 * team-results cache, such as the formation / lineup card.
 *
 * Example:
 *   npm run refresh:soccer:view-cache -- /team/manchester-city/Wtn9Stg0/
 */

import { config as loadDotenv } from 'dotenv';
import type { SoccerNextFixtureCachePayload, SoccerPredictedLineupCachePayload } from '../lib/soccerCache';
import type { SoccerwayLineupBundle, SoccerwayUpcomingFixture } from '../lib/soccerwayTeamResults';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const FOREVER_CACHE_TTL_MINUTES = Number.POSITIVE_INFINITY;
const UPCOMING_GRACE_SECONDS = 30 * 60;
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

let soccerCacheModule: typeof import('../lib/soccerCache') | null = null;
let soccerPermanentStoreModule: typeof import('../lib/soccerPermanentStore') | null = null;
let soccerwayModule: typeof import('../lib/soccerwayTeamResults') | null = null;

async function ensureModulesLoaded() {
  if (soccerCacheModule && soccerPermanentStoreModule && soccerwayModule) {
    return {
      soccerCache: soccerCacheModule,
      soccerPermanentStore: soccerPermanentStoreModule,
      soccerway: soccerwayModule,
    };
  }

  loadDotenv({ path: '.env.local' });
  loadDotenv();

  const [soccerCache, soccerPermanentStore, soccerway] = await Promise.all([
    import('../lib/soccerCache'),
    import('../lib/soccerPermanentStore'),
    import('../lib/soccerwayTeamResults'),
  ]);
  soccerCacheModule = soccerCache;
  soccerPermanentStoreModule = soccerPermanentStore;
  soccerwayModule = soccerway;
  return { soccerCache, soccerPermanentStore, soccerway };
}

function parseTeamHrefs(argv: string[]): string[] {
  return argv.filter((arg) => !arg.startsWith('--'));
}

function pickNextFixture(fixtures: SoccerwayUpcomingFixture[]): SoccerwayUpcomingFixture | null {
  const nowUnix = Math.floor(Date.now() / 1000);
  const eligible = fixtures
    .filter((fixture) => fixture.kickoffUnix != null && fixture.kickoffUnix >= nowUnix - UPCOMING_GRACE_SECONDS)
    .sort((a, b) => (a.kickoffUnix ?? Number.MAX_SAFE_INTEGER) - (b.kickoffUnix ?? Number.MAX_SAFE_INTEGER));
  if (eligible.length > 0) return eligible[0];
  return (
    fixtures
      .filter((fixture) => fixture.kickoffUnix != null)
      .sort((a, b) => (a.kickoffUnix ?? Number.MAX_SAFE_INTEGER) - (b.kickoffUnix ?? Number.MAX_SAFE_INTEGER))[0] ?? null
  );
}

function deriveDetailedCompetitionStage(params: {
  ogDescription: string | null;
  competitionCountry: string | null;
  competitionName: string | null;
}): string | null {
  const ogDescription = String(params.ogDescription || '').trim();
  const competitionCountry = String(params.competitionCountry || '').trim();
  const competitionName = String(params.competitionName || '').trim();
  if (!ogDescription || !competitionName) return null;

  let value = ogDescription;
  if (competitionCountry && value.toLowerCase().startsWith(`${competitionCountry.toLowerCase()}:`)) {
    value = value.slice(competitionCountry.length + 1).trim();
  }
  if (!value.toLowerCase().startsWith(competitionName.toLowerCase())) return null;
  value = value.slice(competitionName.length).trim().replace(/^[-:]\s*/, '').trim();
  return value || null;
}

async function fetchDetailedFixtureStage(summaryPath: string, fixture: SoccerwayUpcomingFixture): Promise<string | null> {
  const normalizedPath = String(summaryPath || '').trim();
  if (!normalizedPath) return fixture.competitionStage ?? null;
  try {
    const response = await fetch(`https://www.soccerway.com${normalizedPath}`, {
      headers: SOCCERWAY_HTML_HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return fixture.competitionStage ?? null;
    const html = await response.text();
    const ogDescription =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i)?.[1] ??
      html.match(/<meta[^>]+content="([^"]+)"[^>]+property="og:description"/i)?.[1] ??
      null;
    return (
      deriveDetailedCompetitionStage({
        ogDescription,
        competitionCountry: fixture.competitionCountry,
        competitionName: fixture.competitionName,
      }) ?? fixture.competitionStage ?? null
    );
  } catch {
    return fixture.competitionStage ?? null;
  }
}

async function fetchSoccerwayLineupBundle(summaryPath: string): Promise<{
  lineupsPath: string;
  eventId: string | null;
  lineup: SoccerwayLineupBundle | null;
}> {
  const { soccerway } = await ensureModulesLoaded();
  const lineupsPath = soccerway.buildSoccerwayLineupsPath(summaryPath);
  const response = await fetch(`https://www.soccerway.com${lineupsPath}`, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Soccerway lineups page returned ${response.status}`);

  const html = await response.text();
  const eventId = soccerway.extractSoccerwayEventId(html);
  const statusHint = soccerway.detectSoccerwayLineupStatus(html);
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

  const graphqlResponse = await fetch(soccerway.buildSoccerwayLineupsGraphqlUrl(eventId), {
    headers: SOCCERWAY_GRAPHQL_HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!graphqlResponse.ok) throw new Error(`Soccerway lineups GraphQL returned ${graphqlResponse.status}`);

  const graphqlRaw = await graphqlResponse.text();
  const parsed = soccerway.parseSoccerwayLineupsGraphql(graphqlRaw, statusHint);
  const fallbackNeeded = !parsed || parsed.status === 'unavailable' || parsed.teams.length === 0;
  if (fallbackNeeded) {
    const predictedResponse = await fetch(soccerway.buildSoccerwayPredictedLineupsGraphqlUrl(eventId), {
      headers: SOCCERWAY_GRAPHQL_HEADERS,
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (predictedResponse.ok) {
      const predictedRaw = await predictedResponse.text();
      const predictedParsed = soccerway.parseSoccerwayLineupsGraphql(predictedRaw, 'predicted');
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
  const { soccerCache, soccerPermanentStore } = await ensureModulesLoaded();
  const cached = await soccerCache.getSoccerTeamResultsCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
  if (cached?.matches?.length) return cached.matches;
  const permanent = await soccerPermanentStore.getPermanentSoccerTeamResults(teamHref);
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
  const { soccerway } = await ensureModulesLoaded();
  const matches = await getCachedTeamResultsSummaryPaths(teamHref);
  if (!matches.length) return null;
  const previousSummaryPath = pickPreviousMatchSummaryPath(matches, nextSummaryPath);
  if (!previousSummaryPath) return null;
  const previous = await fetchSoccerwayLineupBundle(previousSummaryPath);
  if (!soccerway.hasDisplayableSoccerLineup(previous.lineup)) return null;
  return {
    summaryPath: previousSummaryPath,
    lineupsPath: previous.lineupsPath,
    eventId: previous.eventId,
    lineup: previous.lineup!,
  };
}

async function refreshViewCache(teamHref: string) {
  const { soccerCache, soccerPermanentStore, soccerway } = await ensureModulesLoaded();
  const normalized = soccerCache.normalizeSoccerTeamHref(teamHref);
  if (!TEAM_HREF_RE.test(normalized)) throw new Error(`Invalid team href: ${teamHref}`);

  const fixturesUrl = `https://www.soccerway.com${normalized}/fixtures/`;
  const fixturesResponse = await fetch(fixturesUrl, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!fixturesResponse.ok) throw new Error(`Soccerway returned ${fixturesResponse.status} for ${fixturesUrl}`);

  const fixturesHtml = await fixturesResponse.text();
  const fixtures = soccerway.parseSoccerwayTeamFixturesHtml(fixturesHtml);
  const nextFixture = pickNextFixture(fixtures);
  const participantId = soccerway.extractParticipantIdFromTeamHref(normalized);

  let fixturePayload: SoccerNextFixtureCachePayload['fixture'] = null;
  if (nextFixture) {
    const competitionStage = await fetchDetailedFixtureStage(nextFixture.summaryPath, nextFixture);
    const isHome =
      nextFixture.homeParticipantId === participantId ? true : nextFixture.awayParticipantId === participantId ? false : null;
    fixturePayload = {
      matchId: nextFixture.matchId,
      homeTeam: nextFixture.homeTeam,
      awayTeam: nextFixture.awayTeam,
      opponentName: isHome === true ? nextFixture.awayTeam : isHome === false ? nextFixture.homeTeam : nextFixture.awayTeam,
      isHome,
      teamLogoUrl: isHome === true ? nextFixture.homeLogoUrl : isHome === false ? nextFixture.awayLogoUrl : nextFixture.homeLogoUrl,
      opponentLogoUrl: isHome === true ? nextFixture.awayLogoUrl : isHome === false ? nextFixture.homeLogoUrl : nextFixture.awayLogoUrl,
      kickoffUnix: nextFixture.kickoffUnix,
      summaryPath: nextFixture.summaryPath,
      competitionName: nextFixture.competitionName,
      competitionCountry: nextFixture.competitionCountry,
      competitionStage,
    };
  }

  const nextFixtureCachePayload: SoccerNextFixtureCachePayload = {
    teamHref: normalized,
    fixturesUrl,
    fixture: fixturePayload,
    count: fixtures.length,
    source: 'soccerway',
    generatedAt: new Date().toISOString(),
  };
  await soccerCache.setSoccerNextFixtureCache(normalized, nextFixtureCachePayload, FOREVER_CACHE_TTL_MINUTES, true);
  await soccerPermanentStore.persistPermanentSoccerNextFixture(normalized, nextFixtureCachePayload);

  let lineupSource: 'upcoming' | 'previous' | 'none' = 'none';
  if (fixturePayload?.summaryPath) {
    const live = await fetchSoccerwayLineupBundle(fixturePayload.summaryPath);
    let resolved = {
      summaryPath: fixturePayload.summaryPath as string | null,
      lineupsPath: live.lineupsPath as string | null,
      eventId: live.eventId,
      lineup: live.lineup,
    };

    if (!soccerway.hasDisplayableSoccerLineup(resolved.lineup)) {
      const previous = await tryFetchPreviousDisplayableLineup(normalized, fixturePayload.summaryPath);
      if (previous) {
        lineupSource = 'previous';
        resolved = previous;
      }
    } else {
      lineupSource = 'upcoming';
    }

    if (soccerway.hasDisplayableSoccerLineup(resolved.lineup) && resolved.summaryPath) {
      const lineupPayload: SoccerPredictedLineupCachePayload = {
        teamHref: normalized,
        summaryPath: resolved.summaryPath,
        lineupsPath: resolved.lineupsPath,
        eventId: resolved.eventId,
        lineup: resolved.lineup,
        source: 'soccerway',
        generatedAt: new Date().toISOString(),
      };
      await soccerCache.setSoccerPredictedLineupCache(normalized, lineupPayload, FOREVER_CACHE_TTL_MINUTES, true);
      await soccerPermanentStore.persistPermanentSoccerPredictedLineup(normalized, lineupPayload);
      if (lineupSource === 'none') lineupSource = 'upcoming';
    }
  }

  console.log(`\n${normalized}`);
  console.log(`  next fixture: ${fixturePayload?.homeTeam ?? 'n/a'} vs ${fixturePayload?.awayTeam ?? 'n/a'}`);
  console.log(`  lineup cache: ${lineupSource}`);
}

async function main() {
  const teamHrefs = parseTeamHrefs(process.argv.slice(2));
  if (teamHrefs.length === 0) {
    console.error('Usage: npx tsx scripts/refresh-soccer-view-cache.ts /team/manchester-city/Wtn9Stg0/ [more hrefs]');
    process.exit(1);
  }

  for (const teamHref of teamHrefs) {
    await refreshViewCache(teamHref);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
