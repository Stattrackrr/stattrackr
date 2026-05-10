import { NextRequest, NextResponse } from 'next/server';
import {
  getSoccerInjuriesCache,
  normalizeSoccerTeamHref,
  setSoccerInjuriesCache,
  type SoccerInjuriesCachePayload,
} from '@/lib/soccerCache';
import {
  buildSoccerwayPlayerInjuryHistoryUrl,
  buildSoccerwayTeamSquadUrl,
  parseSoccerwayPlayerInjuryHistoryHtml,
  parseSoccerwaySquadAbsencesHtml,
} from '@/lib/soccerwayTeamResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TTL_MINUTES = 60;
const TEAM_HREF_RE = /^\/team\/[a-z0-9-]+\/[a-zA-Z0-9]+\/?$/;
const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml',
  'Accept-Language': 'en-US,en;q=0.9',
};

function getUnsupportedPayload(teamHref: string, teamName: string | null): SoccerInjuriesCachePayload {
  return {
    teamHref,
    teamName: String(teamName || '').trim(),
    sourcePage: '',
    supported: false,
    source: 'soccerway',
    generatedAt: new Date().toISOString(),
    injuries: [],
  };
}

function normalizeReason(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isRealEstimatedReturn(value: string): boolean {
  const normalized = String(value || '').trim();
  return Boolean(normalized && normalized !== '?');
}

async function enrichInjuryWithEstimatedReturn<T extends { status: string; reason: string; playerUrl: string | null }>(
  injury: T
): Promise<T & { estimatedReturn: string | null }> {
  if (injury.status !== 'injury' || !injury.playerUrl) {
    return { ...injury, estimatedReturn: null };
  }

  const historyUrl = buildSoccerwayPlayerInjuryHistoryUrl(injury.playerUrl);
  if (!historyUrl) {
    return { ...injury, estimatedReturn: null };
  }

  try {
    const response = await fetch(historyUrl, {
      headers: FETCH_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) {
      return { ...injury, estimatedReturn: null };
    }

    const html = await response.text();
    const historyRows = parseSoccerwayPlayerInjuryHistoryHtml(html);
    if (historyRows.length === 0) {
      return { ...injury, estimatedReturn: null };
    }

    const currentReason = normalizeReason(injury.reason);
    const similarReasonRow =
      currentReason.length > 0
        ? historyRows.find((row) => {
            const normalizedRowReason = normalizeReason(row.injury);
            return (
              normalizedRowReason.length > 0 &&
              (normalizedRowReason.includes(currentReason) || currentReason.includes(normalizedRowReason))
            );
          })
        : null;
    const currentRow =
      historyRows.find((row) => normalizeReason(row.injury) === currentReason) ??
      similarReasonRow ??
      historyRows[0];

    const until = String(currentRow?.until || '').trim();
    return {
      ...injury,
      estimatedReturn: isRealEstimatedReturn(until) ? until : null,
    };
  } catch {
    return { ...injury, estimatedReturn: null };
  }
}

async function fetchLiveInjuries(teamHref: string, teamName: string | null): Promise<SoccerInjuriesCachePayload | null> {
  const sourcePage = buildSoccerwayTeamSquadUrl(teamHref);
  if (!sourcePage) return getUnsupportedPayload(teamHref, teamName);

  try {
    const response = await fetch(sourcePage, {
      headers: FETCH_HEADERS,
      cache: 'no-store',
    });
    if (!response.ok) return null;

    const html = await response.text();
    const injuries = await Promise.all(parseSoccerwaySquadAbsencesHtml(html).map((injury) => enrichInjuryWithEstimatedReturn(injury)));

    return {
      teamHref,
      teamName: String(teamName || '').trim(),
      sourcePage,
      supported: true,
      source: 'soccerway',
      generatedAt: new Date().toISOString(),
      injuries,
    };
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  const href = request.nextUrl.searchParams.get('href')?.trim() || '';
  const teamName = request.nextUrl.searchParams.get('teamName')?.trim() || '';
  const teamHref = normalizeSoccerTeamHref(href);
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  if (!TEAM_HREF_RE.test(teamHref)) {
    return NextResponse.json({ error: 'Invalid or missing href (expected /team/{slug}/{id}/).' }, { status: 400 });
  }

  if (!refresh) {
    const cached = await getSoccerInjuriesCache(teamHref, { quiet: true, restTimeoutMs: 700, jsTimeoutMs: 700 });
    if (cached) {
      return NextResponse.json(cached);
    }
  }

  const live = await fetchLiveInjuries(teamHref, teamName);
  if (live) {
    await setSoccerInjuriesCache(teamHref, live, TTL_MINUTES, true);
    return NextResponse.json(live);
  }

  const fallback = await getSoccerInjuriesCache(teamHref, { quiet: true });
  if (fallback) {
    return NextResponse.json(fallback);
  }

  return NextResponse.json({ error: 'Failed to fetch soccer injuries.' }, { status: 500 });
}
