/**
 * Incrementally refresh one or more cached Soccerway team result feeds.
 *
 * Instead of rebuilding a team's full history, this script:
 * 1. loads the existing cached payload
 * 2. fetches the current /results/ page
 * 3. optionally walks a few "show more" pages until no unseen matches appear
 * 4. hydrates stats only for newly discovered matches
 * 5. merges the new matches into fast cache and permanent store
 *
 * Examples:
 *   npx tsx scripts/refresh-soccer-team-results-cache.ts /team/manchester-city/Wtn9Stg0/
 *   npx tsx scripts/refresh-soccer-team-results-cache.ts /team/manchester-city/Wtn9Stg0/ --pages=2
 *   npx tsx scripts/refresh-soccer-team-results-cache.ts /team/manchester-city/Wtn9Stg0/ /team/everton/USLsq4nh/
 */

import { config as loadDotenv } from 'dotenv';
import type { SoccerMatchStatsCachePayload, SoccerTeamResultsCachePayload } from '../lib/soccerCache';
import type { SoccerwayMatchStats, SoccerwayRecentMatch } from '../lib/soccerwayTeamResults';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const HISTORY_CUTOFF_UNIX = Math.floor(Date.UTC(2008, 0, 1, 0, 0, 0) / 1000);
const MATCH_STATS_BATCH_SIZE = 8;
const FOREVER_CACHE_TTL_MINUTES = Number.POSITIVE_INFINITY;
const TEAM_RESULTS_COMPETITION_METADATA_VERSION = 2;
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

type CliOptions = {
  pages: number;
  persistPermanent: boolean;
  teamHrefs: string[];
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

function parseArgs(argv: string[]): CliOptions {
  const teamHrefs: string[] = [];
  let pages = 2;
  let persistPermanent = true;

  for (const arg of argv) {
    if (arg === '--no-permanent') {
      persistPermanent = false;
      continue;
    }
    if (arg.startsWith('--pages=')) {
      const value = Number.parseInt(arg.slice('--pages='.length), 10);
      if (Number.isFinite(value) && value >= 0) pages = value;
      continue;
    }
    if (arg.startsWith('--')) continue;
    teamHrefs.push(arg);
  }

  return { pages, persistPermanent, teamHrefs };
}

function buildMatchKey(match: { matchId?: string | null; summaryPath?: string | null }): string {
  const matchId = String(match.matchId || '').trim();
  if (matchId) return `match:${matchId}`;
  return `summary:${String(match.summaryPath || '').trim()}`;
}

function sortMatchesByRecency(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return [...matches].sort((a, b) => {
    const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
    if (aKickoff !== bKickoff) return bKickoff - aKickoff;
    return String(b.matchId || '').localeCompare(String(a.matchId || ''));
  });
}

function appendUniqueMatches(target: SoccerwayRecentMatch[], incoming: SoccerwayRecentMatch[]): number {
  const seen = new Set(target.map((match) => buildMatchKey(match)));
  let added = 0;
  for (const match of incoming) {
    const key = buildMatchKey(match);
    if (seen.has(key)) continue;
    seen.add(key);
    target.push(match);
    added += 1;
  }
  return added;
}

function filterMatchesFrom2008(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return matches.filter((match) => match.kickoffUnix == null || match.kickoffUnix >= HISTORY_CUTOFF_UNIX);
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

function toFastCacheTeamResultsPayload(payload: SoccerTeamResultsCachePayload): SoccerTeamResultsCachePayload {
  return {
    ...payload,
    matches: payload.matches.map((match) => ({
      ...match,
      stats: pruneFastCacheStats(match.stats),
    })),
  };
}

async function fetchMatchStatsFromSoccerway(matchId: string, feedSign: string): Promise<SoccerwayMatchStats | null> {
  const { soccerway } = await ensureModulesLoaded();
  const feedUrl = soccerway.buildSoccerwayMatchStatsFeedUrl(matchId);
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
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) return null;
  return soccerway.parseSoccerwayMatchStatsFeed(await response.text(), feedUrl);
}

async function hydrateNewMatchStats(
  matches: SoccerwayRecentMatch[],
  feedSign: string | null
): Promise<{ matches: SoccerwayRecentMatch[]; statsCacheHits: number; statsFetchedLive: number; statsMissing: number }> {
  const { soccerCache } = await ensureModulesLoaded();
  let statsCacheHits = 0;
  let statsFetchedLive = 0;
  let statsMissing = 0;
  const hydrated = [...matches];

  for (let offset = 0; offset < hydrated.length; offset += MATCH_STATS_BATCH_SIZE) {
    const batch = hydrated.slice(offset, offset + MATCH_STATS_BATCH_SIZE);
    const enriched = await Promise.all(
      batch.map(async (match) => {
        const cached = await soccerCache.getSoccerMatchStatsCache(match.matchId, { quiet: true });
        if (cached) {
          statsCacheHits += 1;
          return { ...match, stats: cached.stats };
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
        await soccerCache.setSoccerMatchStatsCache(match.matchId, payload, FOREVER_CACHE_TTL_MINUTES, true);
        statsFetchedLive += 1;
        if (!stats) statsMissing += 1;
        return { ...match, stats };
      })
    );

    for (let i = 0; i < enriched.length; i += 1) hydrated[offset + i] = enriched[i];
  }

  return { matches: hydrated, statsCacheHits, statsFetchedLive, statsMissing };
}

async function fetchIncrementalMatches(teamHref: string, maxExtraPages: number, existingKeys: Set<string>) {
  const { soccerway } = await ensureModulesLoaded();
  const resultsUrl = `https://www.soccerway.com${teamHref}/results/`;
  const response = await fetch(resultsUrl, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`Soccerway returned ${response.status} for ${resultsUrl}`);

  const html = await response.text();
  const firstPageMatches = filterMatchesFrom2008(soccerway.parseSoccerwayTeamResultsHtml(html));
  const feedSign = soccerway.extractSoccerwayFeedSign(html);
  const countryId = soccerway.extractSoccerwayCountryId(html);
  const participantId = soccerway.extractParticipantIdFromTeamHref(teamHref);

  const unseenMatches: SoccerwayRecentMatch[] = [];
  const incrementalKeys = new Set<string>();
  appendUniqueMatches(
    unseenMatches,
    firstPageMatches.filter((match) => {
      const key = buildMatchKey(match);
      if (existingKeys.has(key) || incrementalKeys.has(key)) return false;
      incrementalKeys.add(key);
      return true;
    })
  );

  let extraPagesFetched = 0;
  if (maxExtraPages > 0 && feedSign && countryId && participantId) {
    for (let page = 1; page <= maxExtraPages; page += 1) {
      const feedUrl = soccerway.buildSoccerwayParticipantResultsFeedUrl({
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
        signal: AbortSignal.timeout(30_000),
      });
      if (!feedResponse.ok) break;

      const feedText = await feedResponse.text();
      const pageMatches = filterMatchesFrom2008(soccerway.parseSoccerwayTeamResultsHtml(feedText));
      if (pageMatches.length === 0) break;

      extraPagesFetched += 1;
      const pageUnseen = pageMatches.filter((match) => {
        const key = buildMatchKey(match);
        if (existingKeys.has(key) || incrementalKeys.has(key)) return false;
        incrementalKeys.add(key);
        return true;
      });
      appendUniqueMatches(unseenMatches, pageUnseen);

      if (pageUnseen.length === 0) break;
    }
  }

  return { resultsUrl, feedSign, newMatches: sortMatchesByRecency(unseenMatches), extraPagesFetched };
}

async function refreshTeam(teamHref: string, options: CliOptions) {
  const { soccerCache, soccerPermanentStore } = await ensureModulesLoaded();
  const normalized = soccerCache.normalizeSoccerTeamHref(teamHref);
  if (!TEAM_HREF_RE.test(normalized)) {
    throw new Error(`Invalid team href: ${teamHref}`);
  }

  const cached = await soccerCache.getSoccerTeamResultsCache(normalized, { quiet: true });
  const permanent = cached?.matches?.length ? null : await soccerPermanentStore.getPermanentSoccerTeamResults(normalized);
  const basePayload = cached?.matches?.length ? cached : permanent;
  const baseMatches = Array.isArray(basePayload?.matches) ? basePayload.matches : [];
  const isBootstrap = baseMatches.length === 0;

  const existingKeys = new Set(baseMatches.map((match) => buildMatchKey(match)));
  const incremental = await fetchIncrementalMatches(normalized, options.pages, existingKeys);

  if (incremental.newMatches.length === 0) {
    console.log(`\n${normalized}`);
    console.log(isBootstrap ? '  no matches found to bootstrap' : '  no new matches found');
    return;
  }

  const hydrated = await hydrateNewMatchStats(incremental.newMatches, incremental.feedSign);
  const mergedMatches = sortMatchesByRecency([...hydrated.matches, ...baseMatches]);
  const payload: SoccerTeamResultsCachePayload = {
    teamHref: normalized,
    resultsUrl: incremental.resultsUrl || basePayload?.resultsUrl || `https://www.soccerway.com${normalized}/results/`,
    matches: mergedMatches,
    count: mergedMatches.length,
    showMorePagesFetched: Math.max(basePayload?.showMorePagesFetched ?? 0, incremental.extraPagesFetched),
    historyProbeComplete: basePayload?.historyProbeComplete ?? true,
    competitionMetadataVersion: basePayload?.competitionMetadataVersion ?? TEAM_RESULTS_COMPETITION_METADATA_VERSION,
    source: 'soccerway',
    generatedAt: new Date().toISOString(),
  };

  await soccerCache.setSoccerTeamResultsCache(normalized, toFastCacheTeamResultsPayload(payload), FOREVER_CACHE_TTL_MINUTES, true);
  if (options.persistPermanent) {
    await soccerPermanentStore.persistPermanentSoccerTeamResults(normalized, payload);
  }

  console.log(`\n${normalized}`);
  console.log(
    `${isBootstrap ? '  bootstrapped' : '  added'} ${hydrated.matches.length} match${hydrated.matches.length === 1 ? '' : 'es'}`
  );
  console.log(`  stats cache hits: ${hydrated.statsCacheHits}`);
  console.log(`  stats fetched live: ${hydrated.statsFetchedLive}`);
  console.log(`  stats missing: ${hydrated.statsMissing}`);
  console.log(`  extra feed pages fetched: ${incremental.extraPagesFetched}`);
  console.log(`  total cached matches: ${payload.matches.length}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.teamHrefs.length === 0) {
    console.error('Usage: npx tsx scripts/refresh-soccer-team-results-cache.ts /team/manchester-city/Wtn9Stg0/ [more hrefs] [--pages=2] [--no-permanent]');
    process.exit(1);
  }

  for (const teamHref of options.teamHrefs) {
    await refreshTeam(teamHref, options);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
