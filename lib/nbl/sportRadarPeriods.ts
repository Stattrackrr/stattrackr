/**
 * NBL quarter scores via SportRadar Connect embed
 * (same fixture_detail feed as nbl.com.au box scores).
 *
 * GET .../fixture_detail?fixtureId={rosettaMatchId}&sub=period_scores
 */

import {
  NBL_SPORTRADAR_EMBED_BASE,
  NBL_SPORTRADAR_WEBSITE_ID,
} from '@/lib/nbl/sportRadarLineups';

export type NblPeriodScores = {
  fixtureId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  home_q1: number | null;
  home_q2: number | null;
  home_q3: number | null;
  home_q4: number | null;
  visitor_q1: number | null;
  visitor_q2: number | null;
  visitor_q3: number | null;
  visitor_q4: number | null;
};

type SrCompetitor = {
  id?: string | null;
  entityId?: string | null;
  competitorId?: string | null;
  uuid?: string | null;
  name?: string | null;
  code?: string | null;
  isHome?: boolean | null;
  score?: string | number | null;
};

type SrPeriodScore = {
  periodId?: number | null;
  score?: string | number | null;
};

function srHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Origin: 'https://nbl.com.au',
    Referer: 'https://nbl.com.au/',
  };
}

function toNum(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function competitorId(c: SrCompetitor | null | undefined): string | null {
  if (!c) return null;
  const raw = c.id ?? c.entityId ?? c.competitorId ?? c.uuid;
  const id = String(raw ?? '').trim();
  return id || null;
}

function scoreForPeriod(rows: SrPeriodScore[] | undefined, periodId: number): number | null {
  if (!Array.isArray(rows)) return null;
  const hit = rows.find((r) => Number(r.periodId) === periodId);
  return hit ? toNum(hit.score) : null;
}

function periodMapFromPayload(json: unknown): {
  competitors: SrCompetitor[];
  teamScores: Record<string, SrPeriodScore[]>;
} | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;

  const banner = data.banner as { fixture?: Record<string, unknown> } | undefined;
  const fixture = (data.fixture as Record<string, unknown> | undefined) || banner?.fixture;
  const periodData =
    (data.periodData as { teamScores?: Record<string, SrPeriodScore[]> } | undefined) ||
    (fixture?.periodData as { teamScores?: Record<string, SrPeriodScore[]> } | undefined) ||
    (banner?.fixture?.periodData as { teamScores?: Record<string, SrPeriodScore[]> } | undefined);

  const competitors = (
    (fixture?.competitors as SrCompetitor[] | undefined) ||
    (banner?.fixture?.competitors as SrCompetitor[] | undefined) ||
    []
  ).filter(Boolean);

  const teamScores = periodData?.teamScores;
  if (!teamScores || typeof teamScores !== 'object') return null;
  return { competitors, teamScores };
}

export function parseNblPeriodScores(fixtureId: string, json: unknown): NblPeriodScores | null {
  const parsed = periodMapFromPayload(json);
  if (!parsed) return null;

  const homeComp =
    parsed.competitors.find((c) => c.isHome === true) || parsed.competitors[0] || null;
  const awayComp =
    parsed.competitors.find((c) => c.isHome === false) || parsed.competitors[1] || null;
  const homeId = competitorId(homeComp);
  const awayId = competitorId(awayComp);
  if (!homeId || !awayId) return null;

  const homeRows = parsed.teamScores[homeId];
  const awayRows = parsed.teamScores[awayId];
  if (!homeRows && !awayRows) return null;

  const home_q1 = scoreForPeriod(homeRows, 1);
  const home_q2 = scoreForPeriod(homeRows, 2);
  const home_q3 = scoreForPeriod(homeRows, 3);
  const home_q4 = scoreForPeriod(homeRows, 4);
  const visitor_q1 = scoreForPeriod(awayRows, 1);
  const visitor_q2 = scoreForPeriod(awayRows, 2);
  const visitor_q3 = scoreForPeriod(awayRows, 3);
  const visitor_q4 = scoreForPeriod(awayRows, 4);

  const hasAny =
    home_q1 != null ||
    home_q2 != null ||
    home_q3 != null ||
    home_q4 != null ||
    visitor_q1 != null ||
    visitor_q2 != null ||
    visitor_q3 != null ||
    visitor_q4 != null;
  if (!hasAny) return null;

  return {
    fixtureId,
    homeTeam: homeComp?.name ? String(homeComp.name) : null,
    awayTeam: awayComp?.name ? String(awayComp.name) : null,
    home_q1,
    home_q2,
    home_q3,
    home_q4,
    visitor_q1,
    visitor_q2,
    visitor_q3,
    visitor_q4,
  };
}

export async function fetchNblMatchPeriodScores(
  fixtureId: string,
  options: { websiteId?: string; signal?: AbortSignal } = {}
): Promise<NblPeriodScores | null> {
  const id = String(fixtureId || '').trim();
  if (!id) return null;

  const websiteId = options.websiteId || NBL_SPORTRADAR_WEBSITE_ID;
  const url = `${NBL_SPORTRADAR_EMBED_BASE}/${websiteId}/fixture_detail?fixtureId=${encodeURIComponent(id)}&sub=period_scores`;

  const res = await fetch(url, { headers: srHeaders(), signal: options.signal });
  if (!res.ok) return null;
  const json = await res.json();
  return parseNblPeriodScores(id, json);
}
