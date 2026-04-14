import { NextRequest } from 'next/server';
import sharedCache from '@/lib/sharedCache';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { GET as getNbaPlayerProps } from '@/app/api/nba/player-props/route';
import { GET as getAflPlayerPropsList } from '@/app/api/afl/player-props/list/route';

const COMBINED_PROPS_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_v1';
const COMBINED_PROPS_SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;
const COMBINED_PROPS_SNAPSHOT_STALE_MS = 60 * 1000;

type BookmakerLine = {
  bookmaker: string;
  line: number;
  overOdds: string;
  underOdds: string;
};

export type CombinedPlayerProp = {
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  statType: string;
  line: number;
  overProb: number;
  underProb: number;
  overOdds: string;
  underOdds: string;
  impliedOverProb: number;
  impliedUnderProb: number;
  bestLine: number;
  bookmaker: string;
  confidence: 'High' | 'Medium' | 'Low';
  expectedValue?: number;
  gameDate: string;
  last5Avg?: number | null;
  last10Avg?: number | null;
  h2hAvg?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  h2hHitRate?: { hits: number; total: number } | null;
  seasonAvg?: number | null;
  seasonHitRate?: { hits: number; total: number } | null;
  streak?: number | null;
  position?: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  bookmakerLines?: BookmakerLine[];
  gameId?: string;
  homeTeam?: string;
  awayTeam?: string;
};

export type CombinedAflGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
};

export type CombinedPropsSnapshot = {
  success: boolean;
  snapshotVersion: 1;
  generatedAt: string;
  staleAt: string;
  nba: {
    ok: boolean;
    status: number;
    cached: boolean;
    lastUpdated: string | null;
    gameDate: string | null;
    props: CombinedPlayerProp[];
  };
  afl: {
    ok: boolean;
    status: number;
    lastUpdated: string | null;
    nextUpdate: string | null;
    ingestMessage: string | null;
    noAflOdds: boolean;
    games: CombinedAflGame[];
    props: CombinedPlayerProp[];
    debugMeta?: Record<string, unknown> | null;
  };
};

type BuildCombinedPropsSnapshotOptions = {
  origin: string;
  refresh?: boolean;
  debugStats?: boolean;
  cronSecret?: string;
  writeCache?: boolean;
};

let inFlightSnapshotBuild: Promise<CombinedPropsSnapshot> | null = null;

function normalizeString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function normalizeBool(value: unknown): boolean {
  return value === true;
}

function aggregateAflProps(listData: any): {
  games: CombinedAflGame[];
  props: CombinedPlayerProp[];
  ingestMessage: string | null;
  lastUpdated: string | null;
  nextUpdate: string | null;
  noAflOdds: boolean;
  debugMeta?: Record<string, unknown> | null;
} {
  const games: CombinedAflGame[] = Array.isArray(listData?.games) ? listData.games : [];
  const rows: any[] = Array.isArray(listData?.data) ? listData.data : [];
  const keyToRow = new Map<string, {
    playerName: string;
    gameId: string;
    homeTeam: string;
    awayTeam: string;
    playerTeam?: string | null;
    statType: string;
    line: number;
    commenceTime: string;
    bookmakerLines: BookmakerLine[];
    last5Avg?: number | null;
    last10Avg?: number | null;
    h2hAvg?: number | null;
    seasonAvg?: number | null;
    streak?: number | null;
    last5HitRate?: { hits: number; total: number } | null;
    last10HitRate?: { hits: number; total: number } | null;
    h2hHitRate?: { hits: number; total: number } | null;
    seasonHitRate?: { hits: number; total: number } | null;
    dvpRating?: number | null;
    dvpStatValue?: number | null;
  }>();

  for (const row of rows) {
    const key = `${row.playerName}|${row.gameId}|${row.statType}|${row.line}`;
    const existing = keyToRow.get(key);
    const line: BookmakerLine = {
      bookmaker: row.bookmaker,
      line: row.line,
      overOdds: row.overOdds || 'N/A',
      underOdds: row.underOdds || 'N/A',
    };
    if (existing) {
      existing.bookmakerLines.push(line);
      continue;
    }

    keyToRow.set(key, {
      playerName: row.playerName,
      gameId: row.gameId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      playerTeam: row.playerTeam ?? null,
      statType: row.statType,
      line: row.line,
      commenceTime: row.commenceTime || '',
      bookmakerLines: [line],
      last5Avg: row.last5Avg,
      last10Avg: row.last10Avg,
      h2hAvg: row.h2hAvg,
      seasonAvg: row.seasonAvg,
      streak: row.streak,
      last5HitRate: row.last5HitRate,
      last10HitRate: row.last10HitRate,
      h2hHitRate: row.h2hHitRate,
      seasonHitRate: row.seasonHitRate,
      dvpRating: row.dvpRating,
      dvpStatValue: row.dvpStatValue,
    });
  }

  const props = Array.from(keyToRow.values()).map((row): CombinedPlayerProp => {
    const playerTeam = row.playerTeam && String(row.playerTeam).trim() ? row.playerTeam : null;
    const homeNorm = toOfficialAflTeamDisplayName(row.homeTeam || '');
    const awayNorm = toOfficialAflTeamDisplayName(row.awayTeam || '');
    const playerNorm = playerTeam ? toOfficialAflTeamDisplayName(playerTeam) : null;
    const team = playerNorm || homeNorm;
    const opponent = playerNorm
      ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
      : awayNorm;

    return {
      playerName: row.playerName,
      playerId: '',
      team,
      opponent,
      statType: row.statType,
      line: row.line,
      overProb: 0,
      underProb: 0,
      overOdds: row.bookmakerLines[0]?.overOdds ?? 'N/A',
      underOdds: row.bookmakerLines[0]?.underOdds ?? 'N/A',
      impliedOverProb: 0,
      impliedUnderProb: 0,
      bestLine: row.line,
      bookmaker: row.bookmakerLines[0]?.bookmaker ?? '',
      confidence: 'Medium',
      gameDate: row.commenceTime,
      bookmakerLines: row.bookmakerLines,
      gameId: row.gameId,
      homeTeam: row.homeTeam,
      awayTeam: row.awayTeam,
      last5Avg: row.last5Avg,
      last10Avg: row.last10Avg,
      h2hAvg: row.h2hAvg,
      seasonAvg: row.seasonAvg,
      streak: row.streak,
      last5HitRate: row.last5HitRate,
      last10HitRate: row.last10HitRate,
      h2hHitRate: row.h2hHitRate,
      seasonHitRate: row.seasonHitRate,
      dvpRating: row.dvpRating,
      dvpStatValue: row.dvpStatValue,
    };
  });

  return {
    games,
    props,
    ingestMessage: normalizeString(listData?.ingestMessage),
    lastUpdated: normalizeString(listData?.lastUpdated),
    nextUpdate: normalizeString(listData?.nextUpdate),
    noAflOdds: normalizeBool(listData?.noAflOdds),
    debugMeta: listData?._meta as Record<string, unknown> | null | undefined,
  };
}

function createHeaders(cronSecret?: string): Headers {
  const headers = new Headers({ Accept: 'application/json' });
  if (cronSecret) {
    headers.set('Authorization', `Bearer ${cronSecret}`);
    headers.set('X-Cron-Secret', cronSecret);
  }
  return headers;
}

export async function getCombinedPropsSnapshot(): Promise<CombinedPropsSnapshot | null> {
  return sharedCache.getJSON<CombinedPropsSnapshot>(COMBINED_PROPS_SNAPSHOT_CACHE_KEY);
}

export function isCombinedPropsSnapshotStale(snapshot: CombinedPropsSnapshot): boolean {
  const staleAt = Date.parse(snapshot?.staleAt ?? '');
  return !Number.isFinite(staleAt) || staleAt <= Date.now();
}

export async function buildCombinedPropsSnapshot(
  options: BuildCombinedPropsSnapshotOptions
): Promise<CombinedPropsSnapshot> {
  const { origin, refresh = false, debugStats = false, cronSecret, writeCache = true } = options;
  const nbaUrl = new URL('/api/nba/player-props', origin);
  const aflUrl = new URL('/api/afl/player-props/list', origin);

  if (refresh) {
    nbaUrl.searchParams.set('refresh', '1');
    aflUrl.searchParams.set('refresh', '1');
  }
  if (debugStats) {
    aflUrl.searchParams.set('debugStats', '1');
  }

  const [nbaResponse, aflResponse] = await Promise.all([
    getNbaPlayerProps(new NextRequest(nbaUrl)),
    getAflPlayerPropsList(new Request(aflUrl, { headers: createHeaders(cronSecret) })),
  ]);

  const [nbaPayload, aflPayload] = await Promise.all([
    nbaResponse.json().catch(() => null),
    aflResponse.json().catch(() => null),
  ]);

  const aflAggregated = aggregateAflProps(aflPayload);
  const now = Date.now();
  const snapshot: CombinedPropsSnapshot = {
    success: nbaResponse.ok && aflResponse.ok,
    snapshotVersion: 1,
    generatedAt: new Date(now).toISOString(),
    staleAt: new Date(now + COMBINED_PROPS_SNAPSHOT_STALE_MS).toISOString(),
    nba: {
      ok: nbaResponse.ok,
      status: nbaResponse.status,
      cached: normalizeBool(nbaPayload?.cached),
      lastUpdated: normalizeString(nbaPayload?.lastUpdated),
      gameDate: normalizeString(nbaPayload?.gameDate),
      props: Array.isArray(nbaPayload?.data) ? nbaPayload.data : [],
    },
    afl: {
      ok: aflResponse.ok,
      status: aflResponse.status,
      lastUpdated: aflAggregated.lastUpdated,
      nextUpdate: aflAggregated.nextUpdate,
      ingestMessage: aflAggregated.ingestMessage,
      noAflOdds: aflAggregated.noAflOdds,
      games: aflAggregated.games,
      props: aflAggregated.props,
      debugMeta: debugStats ? aflAggregated.debugMeta ?? null : undefined,
    },
  };

  if (snapshot.success && writeCache && !debugStats) {
    await sharedCache.setJSON(
      COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
      snapshot,
      COMBINED_PROPS_SNAPSHOT_TTL_SECONDS
    );
  }

  return snapshot;
}

export async function warmCombinedPropsSnapshot(
  options: Omit<BuildCombinedPropsSnapshotOptions, 'writeCache'>
): Promise<CombinedPropsSnapshot> {
  if (!inFlightSnapshotBuild) {
    inFlightSnapshotBuild = buildCombinedPropsSnapshot({
      ...options,
      writeCache: true,
    }).finally(() => {
      inFlightSnapshotBuild = null;
    });
  }
  return inFlightSnapshotBuild;
}
