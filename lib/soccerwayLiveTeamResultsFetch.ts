import {
  buildSoccerwayParticipantResultsFeedUrl,
  extractSoccerwayCountryId,
  extractSoccerwayFeedSign,
  extractParticipantIdFromTeamHref,
  parseSoccerwayTeamResultsHtml,
  type SoccerwayRecentMatch,
} from '@/lib/soccerwayTeamResults';

const HISTORY_CUTOFF_UNIX = Math.floor(Date.UTC(2008, 0, 1, 0, 0, 0) / 1000);

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

function filterMatchesFrom2008(matches: SoccerwayRecentMatch[]): SoccerwayRecentMatch[] {
  return matches.filter((match) => match.kickoffUnix == null || match.kickoffUnix >= HISTORY_CUTOFF_UNIX);
}

function pageReachedHistoryCutoff(matches: SoccerwayRecentMatch[]): boolean {
  return matches.some((match) => match.kickoffUnix != null && match.kickoffUnix < HISTORY_CUTOFF_UNIX);
}

/**
 * Fetches recent finished matches from Soccerway (HTML + optional feed pages).
 * Used when DB/cache lag behind the public results page so downstream scrapers see current fixtures.
 */
export async function fetchLiveSoccerwayTeamResultsMatches(
  teamHref: string,
  maxFeedPages: number
): Promise<SoccerwayRecentMatch[]> {
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
  const cappedPages = Math.max(0, Math.min(maxFeedPages, 20));

  if (feedSign && countryId && participantId && cappedPages > 0) {
    for (let page = 1; page <= cappedPages; page += 1) {
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

      const added = appendUniqueMatches(matches, filterMatchesFrom2008(pageMatches));
      if (pageReachedHistoryCutoff(pageMatches) || added === 0) break;
    }
  }

  return matches;
}
