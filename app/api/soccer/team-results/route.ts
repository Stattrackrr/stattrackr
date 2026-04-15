import { NextRequest, NextResponse } from 'next/server';
import {
  buildSoccerwayMatchStatsFeedUrl,
  buildSoccerwayParticipantResultsFeedUrl,
  extractSoccerwayCountryId,
  extractSoccerwayFeedSign,
  parseSoccerwayMatchStatsFeed,
  parseSoccerwayTeamResultsHtml,
  type SoccerwayRecentMatch,
} from '@/lib/soccerwayTeamResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only allow Soccerway team profile paths (blocks open redirects / SSRF). */
const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const MAX_SHOW_MORE_PAGES = 100;
const HISTORY_CUTOFF_UNIX = Math.floor(Date.UTC(2008, 0, 1, 0, 0, 0) / 1000);
const MATCH_STATS_BATCH_SIZE = 8;
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function appendUniqueMatches(target: SoccerwayRecentMatch[], incoming: SoccerwayRecentMatch[]): number {
  const seen = new Set(target.map((match) => match.summaryPath));
  let added = 0;

  for (const match of incoming) {
    if (seen.has(match.summaryPath)) continue;
    seen.add(match.summaryPath);
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

async function attachStatsToMatches(matches: SoccerwayRecentMatch[], feedSign: string): Promise<void> {
  for (let offset = 0; offset < matches.length; offset += MATCH_STATS_BATCH_SIZE) {
    const batch = matches.slice(offset, offset + MATCH_STATS_BATCH_SIZE);
    const enriched = await Promise.all(
      batch.map(async (match) => {
        const feedUrl = buildSoccerwayMatchStatsFeedUrl(match.matchId);
        try {
          const response = await fetch(feedUrl, {
            headers: {
              'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
              Accept: '*/*',
              'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
              Referer: 'https://www.soccerway.com/',
              Origin: 'https://www.soccerway.com',
              'x-fsign': feedSign,
            },
            next: { revalidate: 60 * 60 * 24 },
          });

          if (!response.ok) return { ...match, stats: null };

          const raw = await response.text();
          return {
            ...match,
            stats: parseSoccerwayMatchStatsFeed(raw, feedUrl),
          };
        } catch {
          return { ...match, stats: null };
        }
      })
    );

    for (let i = 0; i < enriched.length; i += 1) {
      matches[offset + i] = enriched[i];
    }
  }
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const normalized = href.startsWith('/') ? href : `/${href}`;
  if (!TEAM_HREF_RE.test(normalized)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  const base = normalized.replace(/\/+$/, '');
  const resultsUrl = `https://www.soccerway.com${base}/results/`;

  try {
    const response = await fetch(resultsUrl, {
      headers: SOCCERWAY_HTML_HEADERS,
      next: { revalidate: 0 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: `Soccerway returned ${response.status}`, resultsUrl },
        { status: 502 }
      );
    }

    const html = await response.text();
    const matches = filterMatchesFrom2008(parseSoccerwayTeamResultsHtml(html));
    const feedSign = extractSoccerwayFeedSign(html);
    const countryId = extractSoccerwayCountryId(html);
    const participantId = base.split('/').filter(Boolean).at(-1) || '';
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
          next: { revalidate: 0 },
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

    if (feedSign) {
      await attachStatsToMatches(matches, feedSign);
    }

    return NextResponse.json({
      resultsUrl,
      matches,
      count: matches.length,
      showMorePagesFetched,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch team results';
    return NextResponse.json({ error: message, resultsUrl }, { status: 500 });
  }
}
