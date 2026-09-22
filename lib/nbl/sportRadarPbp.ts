/**
 * NBL play-by-play via SportRadar Connect embed (nbl.com.au Play By Play tab).
 *
 * GET .../fixture_detail?fixtureId={externalId}&sub=pbp
 * Derives player points, rebounds, and assists by quarter.
 */

import {
  NBL_SPORTRADAR_EMBED_BASE,
  NBL_SPORTRADAR_WEBSITE_ID,
} from '@/lib/nbl/sportRadarLineups';

export type NblPbpPlayerPoints = {
  personId: string | null;
  name: string;
  teamCode: string | null;
  teamName: string | null;
  q1_pts: number;
  q2_pts: number;
  q3_pts: number;
  q4_pts: number;
  ot_pts: number;
  total: number;
  q1_reb: number;
  q2_reb: number;
  q3_reb: number;
  q4_reb: number;
  ot_reb: number;
  total_reb: number;
  q1_ast: number;
  q2_ast: number;
  q3_ast: number;
  q4_ast: number;
  ot_ast: number;
  total_ast: number;
};

export type NblMatchPbpPoints = {
  fixtureId: string;
  homeTeam: string | null;
  awayTeam: string | null;
  homeTeamCode: string | null;
  awayTeamCode: string | null;
  eventCount: number;
  scoringEventCount: number;
  reboundEventCount: number;
  assistEventCount: number;
  players: NblPbpPlayerPoints[];
  fetchedAt: string;
};

type SrPbpEvent = {
  clock?: string | null;
  desc?: string | null;
  entityId?: string | null;
  eventId?: string | null;
  eventSubType?: string | null;
  eventType?: string | null;
  name?: string | null;
  periodId?: number | null;
  personId?: string | null;
  success?: boolean | null;
  successString?: string | null;
};

type SrCompetitor = {
  name?: string;
  code?: string;
  entityId?: string;
  isHome?: boolean;
};

type PeriodSlot = 'q1' | 'q2' | 'q3' | 'q4' | 'ot';
type StatKind = 'pts' | 'reb' | 'ast';

function srHeaders(): HeadersInit {
  return {
    Accept: 'application/json',
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Origin: 'https://nbl.com.au',
    Referer: 'https://nbl.com.au/',
  };
}

function isMade(ev: SrPbpEvent): boolean {
  if (ev.success === true) return true;
  if (ev.success === false) return false;
  const flag = String(ev.successString || '').toLowerCase();
  if (flag === 'made' || flag === 'scored' || flag === 'good') return true;
  if (flag === 'missed' || flag === 'miss') return false;
  const desc = String(ev.desc || '').toLowerCase();
  if (/\bmiss(?:ed|es)?\b/.test(desc) || /\blocked\b/.test(desc)) return false;
  if (/\bmade\b|\bscored\b|\bgood\b/.test(desc)) return true;
  return false;
}

function pointsForEvent(ev: SrPbpEvent): number {
  if (!isMade(ev)) return 0;
  const t = String(ev.eventType || '').toLowerCase().replace(/[\s_-]/g, '');
  if (t === '3pt' || t === '3p' || t === 'threepoint') return 3;
  if (t === '2pt' || t === '2p' || t === 'twopoint') return 2;
  if (t === 'freethrow' || t === 'ft' || t === '1pt') return 1;
  return 0;
}

function normalizeEventType(ev: SrPbpEvent): string {
  return String(ev.eventType || '').toLowerCase().replace(/[\s_-]/g, '');
}

function periodSlot(periodId: number | null | undefined): PeriodSlot | null {
  const n = Number(periodId);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n === 1) return 'q1';
  if (n === 2) return 'q2';
  if (n === 3) return 'q3';
  if (n === 4) return 'q4';
  return 'ot';
}

function eventsFromPeriod(period: unknown): SrPbpEvent[] {
  if (Array.isArray(period)) return period as SrPbpEvent[];
  if (period && typeof period === 'object') {
    const ev = (period as { events?: unknown }).events;
    if (Array.isArray(ev)) return ev as SrPbpEvent[];
  }
  return [];
}

function emptyPlayerRow(
  personId: string | null,
  name: string,
  team: { name: string | null; code: string | null } | null | undefined
): NblPbpPlayerPoints {
  return {
    personId,
    name,
    teamCode: team?.code ?? null,
    teamName: team?.name ?? null,
    q1_pts: 0,
    q2_pts: 0,
    q3_pts: 0,
    q4_pts: 0,
    ot_pts: 0,
    total: 0,
    q1_reb: 0,
    q2_reb: 0,
    q3_reb: 0,
    q4_reb: 0,
    ot_reb: 0,
    total_reb: 0,
    q1_ast: 0,
    q2_ast: 0,
    q3_ast: 0,
    q4_ast: 0,
    ot_ast: 0,
    total_ast: 0,
  };
}

function bumpStat(row: NblPbpPlayerPoints, slot: PeriodSlot, kind: StatKind, amount: number): void {
  const key = `${slot}_${kind}` as keyof NblPbpPlayerPoints;
  const current = row[key];
  if (typeof current === 'number') {
    (row[key] as number) = current + amount;
  }
  if (kind === 'pts') row.total += amount;
  else if (kind === 'reb') row.total_reb += amount;
  else row.total_ast += amount;
}

export function parseNblPbpPoints(fixtureId: string, json: unknown): NblMatchPbpPoints | null {
  const data = (json as { data?: Record<string, unknown> } | null)?.data;
  if (!data || typeof data !== 'object') return null;

  const banner = data.banner as { fixture?: { competitors?: SrCompetitor[] } } | undefined;
  const fixture = (data.fixture as { competitors?: SrCompetitor[] } | undefined) || banner?.fixture;
  const competitors = fixture?.competitors || [];
  const homeComp = competitors.find((c) => c.isHome) || competitors[0] || null;
  const awayComp = competitors.find((c) => c.isHome === false) || competitors[1] || null;
  const teamByEntity = new Map<string, { name: string | null; code: string | null }>();
  for (const c of competitors) {
    if (c.entityId) {
      teamByEntity.set(String(c.entityId), { name: c.name ?? null, code: c.code ?? null });
    }
  }
  const teamNames = new Set(
    [homeComp?.name, awayComp?.name].map((n) => String(n || '').trim().toLowerCase()).filter(Boolean)
  );

  const pbp = data.pbp;
  if (!pbp || typeof pbp !== 'object') return null;

  const byPlayer = new Map<string, NblPbpPlayerPoints>();
  let eventCount = 0;
  let scoringEventCount = 0;
  let reboundEventCount = 0;
  let assistEventCount = 0;

  const ensureRow = (ev: SrPbpEvent): NblPbpPlayerPoints | null => {
    const name = String(ev.name || '').trim();
    const personId = ev.personId ? String(ev.personId) : null;
    if (!name && !personId) return null;
    if (name && teamNames.has(name.toLowerCase())) return null;

    const key = personId || `name:${name.toLowerCase()}`;
    let row = byPlayer.get(key);
    if (!row) {
      const team = ev.entityId ? teamByEntity.get(String(ev.entityId)) : null;
      row = emptyPlayerRow(personId, name, team);
      byPlayer.set(key, row);
    } else if (!row.name && name) {
      row.name = name;
    }
    return row;
  };

  for (const period of Object.values(pbp as Record<string, unknown>)) {
    for (const ev of eventsFromPeriod(period)) {
      eventCount += 1;
      const slot = periodSlot(ev.periodId);
      if (!slot) continue;
      const t = normalizeEventType(ev);

      if (t === 'assist' || t === 'ast') {
        const row = ensureRow(ev);
        if (!row) continue;
        bumpStat(row, slot, 'ast', 1);
        assistEventCount += 1;
        continue;
      }

      if (t === 'rebound' || t === 'reb') {
        const row = ensureRow(ev);
        if (!row) continue;
        bumpStat(row, slot, 'reb', 1);
        reboundEventCount += 1;
        continue;
      }

      const pts = pointsForEvent(ev);
      if (pts <= 0) continue;
      const row = ensureRow(ev);
      if (!row) continue;
      bumpStat(row, slot, 'pts', pts);
      scoringEventCount += 1;
    }
  }

  return {
    fixtureId,
    homeTeam: homeComp?.name ?? null,
    awayTeam: awayComp?.name ?? null,
    homeTeamCode: homeComp?.code ?? null,
    awayTeamCode: awayComp?.code ?? null,
    eventCount,
    scoringEventCount,
    reboundEventCount,
    assistEventCount,
    players: [...byPlayer.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    fetchedAt: new Date().toISOString(),
  };
}

export async function fetchNblMatchPbpJson(
  fixtureId: string,
  options: { websiteId?: string; signal?: AbortSignal } = {}
): Promise<unknown | null> {
  const id = String(fixtureId || '').trim();
  if (!id) return null;

  const websiteId = options.websiteId || NBL_SPORTRADAR_WEBSITE_ID;
  const url = `${NBL_SPORTRADAR_EMBED_BASE}/${websiteId}/fixture_detail?fixtureId=${encodeURIComponent(id)}&sub=pbp`;
  const res = await fetch(url, { headers: srHeaders(), signal: options.signal });
  if (!res.ok) return null;
  return res.json();
}

export async function fetchNblMatchPbpPoints(
  fixtureId: string,
  options: { websiteId?: string; signal?: AbortSignal } = {}
): Promise<NblMatchPbpPoints | null> {
  const id = String(fixtureId || '').trim();
  if (!id) return null;
  const json = await fetchNblMatchPbpJson(id, options);
  if (!json) return null;
  return parseNblPbpPoints(id, json);
}
