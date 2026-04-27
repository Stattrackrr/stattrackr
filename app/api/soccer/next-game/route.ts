import { NextRequest, NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import {
  getSoccerNextFixtureCache,
  normalizeSoccerTeamHref,
  setSoccerNextFixtureCache,
  type SoccerNextFixtureCachePayload,
} from '@/lib/soccerCache';
import {
  extractParticipantIdFromTeamHref,
  parseSoccerwayTeamFixturesHtml,
  type SoccerwayUpcomingFixture,
} from '@/lib/soccerwayTeamResults';
import {
  getPermanentSoccerNextFixture,
  persistPermanentSoccerNextFixture,
} from '@/lib/soccerPermanentStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};
const UPCOMING_GRACE_SECONDS = 30 * 60;
const FOREVER_CACHE_TTL_MINUTES = Number.POSITIVE_INFINITY;

type NextFixtureResponse = {
  matchId: string;
  homeTeam: string;
  awayTeam: string;
  opponentName: string;
  isHome: boolean | null;
  teamLogoUrl: string | null;
  opponentLogoUrl: string | null;
  kickoffUnix: number | null;
  summaryPath: string;
  competitionName: string | null;
  competitionCountry: string | null;
  competitionStage: string | null;
};

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

  const fixturesUrl = `https://www.soccerway.com${teamHref}/fixtures/`;

  try {
    if (!forceRefresh && cacheOnly) {
      const cached = await getSoccerNextFixtureCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
      if (cached) {
        return NextResponse.json({
          fixturesUrl: cached.fixturesUrl,
          fixture: cached.fixture,
          count: cached.count,
          cache: {
            source: 'cache',
            forcedRefresh: false,
            cacheOnly: true,
          },
        });
      }

      return NextResponse.json({
        fixturesUrl,
        fixture: null,
        count: 0,
        cache: {
          source: 'cache-miss',
          forcedRefresh: false,
          cacheOnly: true,
        },
      });
    }

    if (!forceRefresh) {
      const cached = await getSoccerNextFixtureCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
      if (cached) {
        await persistPermanentSoccerNextFixture(teamHref, cached);
        return NextResponse.json({
          fixturesUrl: cached.fixturesUrl,
          fixture: cached.fixture,
          count: cached.count,
          cache: {
            source: 'cache',
            forcedRefresh: false,
            cacheOnly,
          },
        });
      }

      const permanent = await getPermanentSoccerNextFixture(teamHref);
      if (permanent) {
        return NextResponse.json({
          fixturesUrl: permanent.fixturesUrl,
          fixture: permanent.fixture,
          count: permanent.count,
          cache: {
            source: 'permanent',
            forcedRefresh: false,
            cacheOnly,
          },
        });
      }

      return NextResponse.json({
        fixturesUrl,
        fixture: null,
        count: 0,
        cache: {
          source: 'cache-miss',
          forcedRefresh: false,
          cacheOnly,
        },
      });
    }

    const response = await fetch(fixturesUrl, {
      headers: SOCCERWAY_HTML_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`Soccerway returned ${response.status}`);

    const html = await response.text();
    const fixtures = parseSoccerwayTeamFixturesHtml(html);
    const nextFixture = pickNextFixture(fixtures);
    const participantId = extractParticipantIdFromTeamHref(teamHref);

    let payload: NextFixtureResponse | null = null;
    if (nextFixture) {
      const competitionStage = await fetchDetailedFixtureStage(nextFixture.summaryPath, nextFixture);
      const isHome =
        nextFixture.homeParticipantId === participantId ? true : nextFixture.awayParticipantId === participantId ? false : null;
      payload = {
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

    const cachePayload: SoccerNextFixtureCachePayload = {
      teamHref,
      fixturesUrl,
      fixture: payload,
      count: fixtures.length,
      source: 'soccerway',
      generatedAt: new Date().toISOString(),
    };
    await setSoccerNextFixtureCache(teamHref, cachePayload, FOREVER_CACHE_TTL_MINUTES, true);
    await persistPermanentSoccerNextFixture(teamHref, cachePayload);

    return NextResponse.json({
      fixturesUrl,
      fixture: payload,
      count: fixtures.length,
      cache: {
        source: 'live',
        forcedRefresh: forceRefresh,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch next fixture';
    return NextResponse.json({ error: message, fixturesUrl }, { status: 500 });
  }
}
