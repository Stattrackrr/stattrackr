/**
 * NBL shot locations via SportRadar Connect embed (same feed as nbl.com.au Shot Chart).
 *
 * GET .../fixture_detail?fixtureId={externalId}&sub=shot_chart
 */

import {
  NBL_SPORTRADAR_EMBED_BASE,
  NBL_SPORTRADAR_WEBSITE_ID,
} from '@/lib/nbl/sportRadarLineups';
import { classifyNblShotZone, type NblShotZoneId } from '@/lib/nbl/nblShotZones';

export type NblRawShot = {
  eventId: string | null;
  personId: string | null;
  name: string;
  bib: string | null;
  entityId: string | null;
  teamCode: string | null;
  teamName: string | null;
  periodId: number | null;
  clock: string | null;
  eventType: string | null;
  subType: string | null;
  desc: string | null;
  made: boolean;
  x: number;
  y: number;
  zone: NblShotZoneId | null;
};

export type NblMatchShotChart = {
  fixtureId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  homeScore: string | null;
  awayScore: string | null;
  shots: NblRawShot[];
  fetchedAt: string;
};

type SrShotRow = {
  eventId?: string | null;
  personId?: string | null;
  name?: string | null;
  bib?: string | number | null;
  entityId?: string | null;
  periodId?: number | null;
  clock?: string | null;
  eventType?: string | null;
  subType?: string | null;
  desc?: string | null;
  success?: boolean | null;
  successString?: string | null;
  x?: number | null;
  y?: number | null;
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

export async function fetchNblMatchShotChart(
  fixtureId: string,
  options: { websiteId?: string; signal?: AbortSignal } = {}
): Promise<NblMatchShotChart | null> {
  const id = String(fixtureId || '').trim();
  if (!id) return null;

  const websiteId = options.websiteId || NBL_SPORTRADAR_WEBSITE_ID;
  const url = `${NBL_SPORTRADAR_EMBED_BASE}/${websiteId}/fixture_detail?fixtureId=${encodeURIComponent(id)}&sub=shot_chart`;

  const res = await fetch(url, { headers: srHeaders(), signal: options.signal });
  if (!res.ok) return null;

  const json = (await res.json()) as {
    data?: {
      fixture?: {
        competitors?: Array<{
          name?: string;
          code?: string;
          entityId?: string;
          isHome?: boolean;
          score?: string | number | null;
        }>;
      };
      banner?: {
        fixture?: {
          competitors?: Array<{
            name?: string;
            code?: string;
            entityId?: string;
            isHome?: boolean;
            score?: string | number | null;
          }>;
        };
      };
      shotChart?: {
        shots?: SrShotRow[];
        competitors?: Record<
          string,
          { name?: string; code?: string; entityId?: string; isHome?: boolean }
        >;
      };
    };
  };

  const competitors =
    json.data?.fixture?.competitors ||
    json.data?.banner?.fixture?.competitors ||
    Object.values(json.data?.shotChart?.competitors || {});
  const homeComp = competitors.find((c) => c.isHome) || competitors[0] || null;
  const awayComp = competitors.find((c) => c.isHome === false) || competitors[1] || null;
  const teamByEntity = new Map<string, { name: string | null; code: string | null }>();
  for (const c of competitors) {
    if (c.entityId) {
      teamByEntity.set(String(c.entityId), {
        name: c.name ?? null,
        code: c.code ?? null,
      });
    }
  }

  const rawShots = Array.isArray(json.data?.shotChart?.shots) ? json.data!.shotChart!.shots! : [];
  const shots: NblRawShot[] = [];

  for (const row of rawShots) {
    const x = typeof row.x === 'number' && Number.isFinite(row.x) ? row.x : null;
    const y = typeof row.y === 'number' && Number.isFinite(row.y) ? row.y : null;
    if (x == null || y == null) continue;

    const made =
      row.success === true ||
      String(row.successString || '').toLowerCase() === 'made';
    const entityId = row.entityId ? String(row.entityId) : null;
    const team = entityId ? teamByEntity.get(entityId) : null;

    shots.push({
      eventId: row.eventId ? String(row.eventId) : null,
      personId: row.personId ? String(row.personId) : null,
      name: String(row.name || '').trim(),
      bib: row.bib != null && String(row.bib).trim() !== '' ? String(row.bib) : null,
      entityId,
      teamCode: team?.code ?? null,
      teamName: team?.name ?? null,
      periodId: typeof row.periodId === 'number' ? row.periodId : null,
      clock: row.clock != null ? String(row.clock) : null,
      eventType: row.eventType != null ? String(row.eventType) : null,
      subType: row.subType != null ? String(row.subType) : null,
      desc: row.desc != null ? String(row.desc) : null,
      made,
      x,
      y,
      zone: classifyNblShotZone({
        x,
        y,
        eventType: row.eventType,
        desc: row.desc,
      }),
    });
  }

  return {
    fixtureId: id,
    homeTeam: homeComp?.name ?? null,
    awayTeam: awayComp?.name ?? null,
    homeTeamCode: homeComp?.code ?? null,
    awayTeamCode: awayComp?.code ?? null,
    homeScore:
      homeComp?.score != null && String(homeComp.score).trim() !== ''
        ? String(homeComp.score)
        : null,
    awayScore:
      awayComp?.score != null && String(awayComp.score).trim() !== ''
        ? String(awayComp.score)
        : null,
    shots,
    fetchedAt: new Date().toISOString(),
  };
}
