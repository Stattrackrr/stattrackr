import { NextRequest, NextResponse } from 'next/server';
import { extractSoccerwayEventId } from '@/lib/soccerwayTeamResults';
import { normalizeSoccerTeamHref } from '@/lib/soccerCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const ODDS_GEO = {
  countryCode: 'AU',
  subdivisionCode: 'AUNSW',
};
const SOCCERWAY_HTML_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};
const SOCCERWAY_JSON_HEADERS = {
  'User-Agent': SOCCERWAY_HTML_HEADERS['User-Agent'],
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': SOCCERWAY_HTML_HEADERS['Accept-Language'],
  Referer: 'https://www.soccerway.com/',
};

type NextFixturePayload = {
  fixture?: {
    matchId?: string | null;
    homeTeam?: string | null;
    awayTeam?: string | null;
    opponentName?: string | null;
    kickoffUnix?: number | null;
    summaryPath?: string | null;
  } | null;
  error?: string;
};

type TeamParticipant = {
  participantId: string | null;
  participant: string | null;
  side: 'home' | 'away' | null;
};

type SoccerOddsOutcome = {
  participantId: string | null;
  participant: string | null;
  side: 'home' | 'away' | null;
  selection: string | null;
  value: string | null;
  opening: string | null;
  active: boolean;
  handicap: string | null;
  handicapType: string | null;
  score: string | null;
  winner: string | null;
  bothTeamsToScore: boolean | null;
  position: string | null;
};

type SoccerOddsOffer = {
  bookmakerId: number | string | null;
  bookmakerName: string | null;
  hasLiveBettingOffers: boolean;
  odds: SoccerOddsOutcome[];
};

type SoccerOddsMarket = {
  key: string;
  bettingType: string | null;
  bettingScope: string | null;
  offerCount: number;
  offers: SoccerOddsOffer[];
};

function stringifyNullable(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeSummaryPath(value: string | null | undefined): string {
  return String(value || '').trim().replace(/\/+$/, '');
}

function normalizeMatchId(value: string | null | undefined): string {
  return String(value || '').trim();
}

function decimalFromRaw(value: unknown): string | null {
  const text = stringifyNullable(value);
  if (!text) return null;
  const parsed = Number.parseFloat(text);
  return Number.isFinite(parsed) ? parsed.toFixed(2) : text;
}

async function resolveNextFixture(request: NextRequest, teamHref: string): Promise<NextFixturePayload> {
  const origin =
    request.nextUrl?.origin ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : 'http://localhost:3000');
  const params = new URLSearchParams({ href: teamHref, cacheOnly: '1' });
  const response = await fetch(`${origin}/api/soccer/next-game?${params.toString()}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => null)) as NextFixturePayload | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Failed to resolve next fixture (${response.status})`);
  }
  return payload ?? {};
}

async function fetchSummaryHtml(summaryPath: string): Promise<string> {
  const normalizedPath = normalizeSummaryPath(summaryPath);
  if (!normalizedPath) throw new Error('Next fixture has no Soccerway summary path');
  const response = await fetch(`https://www.soccerway.com${normalizedPath}/`, {
    headers: SOCCERWAY_HTML_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway summary returned ${response.status}`);
  return response.text();
}

async function fetchParticipants(eventId: string, homeTeam: string | null, awayTeam: string | null): Promise<TeamParticipant[]> {
  const endpoint = `https://2020.ds.lsapp.eu/pq_graphql?_hash=dsos2&eventId=${encodeURIComponent(eventId)}&projectId=2020`;
  const response = await fetch(endpoint, {
    headers: SOCCERWAY_JSON_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) return [];
  const payload = await response.json().catch(() => null) as {
    data?: { findEventById?: { eventParticipants?: Array<{ id?: string | null; type?: { side?: string | null } | null }> | null } | null } | null;
  } | null;
  const rows = payload?.data?.findEventById?.eventParticipants ?? [];
  return rows
    .map((participant, index): TeamParticipant => {
      const side = participant?.type?.side === 'HOME' ? 'home' : participant?.type?.side === 'AWAY' ? 'away' : index === 0 ? 'home' : index === 1 ? 'away' : null;
      return {
        participantId: stringifyNullable(participant?.id),
        side,
        participant: side === 'home' ? homeTeam : side === 'away' ? awayTeam : null,
      };
    })
    .filter((participant) => participant.participantId);
}

async function fetchOdds(eventId: string, participantMap: Map<string, TeamParticipant>): Promise<{ bookmakers: unknown[]; groupedMarkets: SoccerOddsMarket[]; marketCount: number; endpoint: string }> {
  const endpoint = `https://global.ds.lsapp.eu/odds/pq_graphql?_hash=oce&eventId=${encodeURIComponent(eventId)}&projectId=2020&geoIpCode=${ODDS_GEO.countryCode}&geoIpSubdivisionCode=${ODDS_GEO.subdivisionCode}`;
  const response = await fetch(endpoint, {
    headers: SOCCERWAY_JSON_HEADERS,
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Soccerway odds returned ${response.status}`);

  const payload = await response.json().catch(() => null) as {
    data?: {
      findOddsByEventId?: {
        settings?: { bookmakers?: Array<{ bookmaker?: { id?: number | string | null; name?: string | null } | null; numOrder?: number | null; premiumStatusId?: number | null; linkPrematchOddsType?: string | null }> | null } | null;
        odds?: Array<{ bookmakerId?: number | string | null; bettingType?: string | null; bettingScope?: string | null; hasLiveBettingOffers?: boolean | null; odds?: Array<Record<string, unknown>> | null }> | null;
      } | null;
    } | null;
  } | null;

  const root = payload?.data?.findOddsByEventId;
  const bookmakers = Array.isArray(root?.settings?.bookmakers)
    ? root.settings.bookmakers.map((entry) => ({
        id: entry?.bookmaker?.id ?? null,
        name: entry?.bookmaker?.name || null,
        numOrder: entry?.numOrder ?? null,
        premiumStatusId: entry?.premiumStatusId ?? null,
        linkPrematchOddsType: entry?.linkPrematchOddsType ?? null,
      }))
    : [];
  const bookmakerMap = new Map(bookmakers.map((entry) => [entry.id, entry.name]));
  const marketRows = Array.isArray(root?.odds) ? root.odds : [];
  const groupedMarketMap = new Map<string, SoccerOddsMarket>();

  for (const market of marketRows) {
    const marketKey = `${market?.bettingType || 'UNKNOWN'}__${market?.bettingScope || 'UNKNOWN'}`;
    const normalizedOdds = Array.isArray(market?.odds)
      ? market.odds.map((item): SoccerOddsOutcome => {
          const participantId = stringifyNullable(item?.eventParticipantId);
          const participant = participantId ? participantMap.get(participantId) ?? null : null;
          return {
            participantId,
            participant: participant?.participant ?? null,
            side: participant?.side ?? null,
            selection:
              stringifyNullable(item?.selection) ||
              (typeof item?.bothTeamsToScore === 'boolean' ? (item.bothTeamsToScore ? 'YES' : 'NO') : null) ||
              stringifyNullable(item?.score) ||
              stringifyNullable(item?.winner) ||
              stringifyNullable(item?.position) ||
              (market?.bettingType === 'HOME_DRAW_AWAY' && !participantId ? 'DRAW' : null),
            value: decimalFromRaw(item?.value),
            opening: decimalFromRaw(item?.opening),
            active: item?.active !== false,
            handicap: stringifyNullable((item?.handicap as { value?: unknown } | null | undefined)?.value),
            handicapType: stringifyNullable((item?.handicap as { type?: unknown } | null | undefined)?.type),
            score: stringifyNullable(item?.score),
            winner: stringifyNullable(item?.winner),
            bothTeamsToScore: typeof item?.bothTeamsToScore === 'boolean' ? item.bothTeamsToScore : null,
            position: stringifyNullable(item?.position),
          };
        })
      : [];

    const offer: SoccerOddsOffer = {
      bookmakerId: market?.bookmakerId ?? null,
      bookmakerName: bookmakerMap.get(market?.bookmakerId ?? null) || null,
      hasLiveBettingOffers: Boolean(market?.hasLiveBettingOffers),
      odds: normalizedOdds,
    };

    const existing = groupedMarketMap.get(marketKey);
    if (existing) {
      existing.offerCount += 1;
      existing.offers.push(offer);
    } else {
      groupedMarketMap.set(marketKey, {
        key: marketKey,
        bettingType: market?.bettingType || null,
        bettingScope: market?.bettingScope || null,
        offerCount: 1,
        offers: [offer],
      });
    }
  }

  return {
    bookmakers,
    groupedMarkets: Array.from(groupedMarketMap.values()).sort((a, b) => {
      const typeCompare = String(a.bettingType || '').localeCompare(String(b.bettingType || ''));
      if (typeCompare !== 0) return typeCompare;
      return String(a.bettingScope || '').localeCompare(String(b.bettingScope || ''));
    }),
    marketCount: marketRows.length,
    endpoint,
  };
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const expectedMatchId = normalizeMatchId(request.nextUrl.searchParams.get('matchId'));

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  try {
    const nextFixturePayload = await resolveNextFixture(request, teamHref);
    const fixture = nextFixturePayload.fixture ?? null;
    if (!fixture?.matchId || !fixture.summaryPath) {
      return NextResponse.json({
        success: true,
        data: [],
        groupedMarkets: [],
        message: 'No next fixture available for soccer odds.',
        fixture: null,
      });
    }

    if (expectedMatchId && expectedMatchId !== normalizeMatchId(fixture.matchId)) {
      return NextResponse.json({
        success: true,
        data: [],
        groupedMarkets: [],
        message: 'Requested match is not the current next fixture.',
        fixture,
      });
    }

    const summaryHtml = await fetchSummaryHtml(fixture.summaryPath);
    const eventId = extractSoccerwayEventId(summaryHtml);
    if (!eventId) {
      return NextResponse.json({
        success: true,
        data: [],
        groupedMarkets: [],
        message: 'No Soccerway odds event id found for next fixture.',
        fixture,
      });
    }

    const participants = await fetchParticipants(eventId, fixture.homeTeam ?? null, fixture.awayTeam ?? null);
    const participantMap = new Map(participants.map((participant) => [participant.participantId!, participant]));
    const odds = await fetchOdds(eventId, participantMap);

    return NextResponse.json({
      success: true,
      fixture,
      eventId,
      homeTeam: fixture.homeTeam ?? null,
      awayTeam: fixture.awayTeam ?? null,
      data: odds.groupedMarkets,
      groupedMarkets: odds.groupedMarkets,
      bookmakers: odds.bookmakers,
      summary: {
        bookmakerCount: odds.bookmakers.length,
        marketCount: odds.marketCount,
        groupedMarketCount: odds.groupedMarkets.length,
      },
      geo: ODDS_GEO,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to fetch soccer odds';
    return NextResponse.json({ success: false, error: message, data: [], groupedMarkets: [] }, { status: 500 });
  }
}
