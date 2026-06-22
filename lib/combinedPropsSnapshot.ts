import { NextRequest, NextResponse } from 'next/server';
import sharedCache from '@/lib/sharedCache';
import { NBA_PUBLIC_ENABLED, WORLD_CUP_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { GET as getNbaPlayerProps } from '@/app/api/nba/player-props/route';
import { GET as getAflPlayerPropsList } from '@/app/api/afl/player-props/list/route';
import { GET as getWorldCupPlayerPropsList } from '@/app/api/world-cup/dashboard/route';
import {
  filterWorldCupListPropsByMinOdds,
} from '@/lib/worldCupCache';

const COMBINED_PROPS_SNAPSHOT_CACHE_KEY = 'combined_props_snapshot_v2';
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
  wcGamesAvg?: number | null;
  wcGamesHitRate?: { hits: number; total: number } | null;
  wcGameLog?: Array<{ opponent: string; value: number; date?: string }>;
  headshotUrl?: string | null;
  wcPosition?: string | null;
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
  worldCup: {
    ok: boolean;
    status: number;
    lastUpdated: string | null;
    nextUpdate: string | null;
    ingestMessage: string | null;
    noWorldCupOdds: boolean;
    games: CombinedAflGame[];
    props: CombinedPlayerProp[];
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

function aggregateWorldCupProps(listData: any): {
  games: CombinedAflGame[];
  props: CombinedPlayerProp[];
  ingestMessage: string | null;
  lastUpdated: string | null;
  nextUpdate: string | null;
  noWorldCupOdds: boolean;
} {
  const games: CombinedAflGame[] = Array.isArray(listData?.games) ? listData.games : [];
  // Match the WC-only props list: min-odds filter only. Stats may still be warming —
  // requiring category stats here empties the combined "All" feed on first load.
  const rows: any[] = filterWorldCupListPropsByMinOdds(
    Array.isArray(listData?.data) ? listData.data : []
  );
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
    seasonAvg?: number | null;
    streak?: number | null;
    last5HitRate?: { hits: number; total: number } | null;
    last10HitRate?: { hits: number; total: number } | null;
    seasonHitRate?: { hits: number; total: number } | null;
    wcGamesAvg?: number | null;
    wcGamesHitRate?: { hits: number; total: number } | null;
    wcGameLog?: Array<{ opponent: string; value: number; date?: string }>;
    dvpRating?: number | null;
    dvpStatValue?: number | null;
    headshotUrl?: string | null;
    wcPosition?: string | null;
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
      seasonAvg: row.seasonAvg,
      streak: row.streak,
      last5HitRate: row.last5HitRate,
      last10HitRate: row.last10HitRate,
      seasonHitRate: row.seasonHitRate,
      wcGamesAvg: row.wcGamesAvg,
      wcGamesHitRate: row.wcGamesHitRate,
      wcGameLog: row.wcGameLog,
      dvpRating: row.dvpRating,
      dvpStatValue: row.dvpStatValue,
      headshotUrl: row.headshotUrl ?? null,
      wcPosition: row.wcPosition ?? null,
    });
  }

  const props = Array.from(keyToRow.values()).map((row): CombinedPlayerProp => {
    const playerTeam = row.playerTeam && String(row.playerTeam).trim() ? row.playerTeam : null;
    const homeNorm = String(row.homeTeam || '').trim();
    const awayNorm = String(row.awayTeam || '').trim();
    const playerNorm = playerTeam ? String(playerTeam).trim() : null;
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
      seasonAvg: row.seasonAvg,
      streak: row.streak,
      last5HitRate: row.last5HitRate,
      last10HitRate: row.last10HitRate,
      seasonHitRate: row.seasonHitRate,
      dvpRating: row.dvpRating,
      dvpStatValue: row.dvpStatValue,
      wcGamesAvg: row.wcGamesAvg,
      wcGamesHitRate: row.wcGamesHitRate,
      wcGameLog: row.wcGameLog,
      headshotUrl: row.headshotUrl,
      wcPosition: row.wcPosition,
    };
  });

  return {
    games,
    props,
    ingestMessage: normalizeString(listData?.ingestMessage),
    lastUpdated: normalizeString(listData?.lastUpdated),
    nextUpdate: normalizeString(listData?.nextUpdate),
    noWorldCupOdds: normalizeBool(listData?.noWorldCupOdds),
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
  const wcUrl = new URL('/api/world-cup/dashboard', origin);
  wcUrl.searchParams.set('playerPropsList', '1');

  if (refresh) {
    nbaUrl.searchParams.set('refresh', '1');
    aflUrl.searchParams.set('refresh', '1');
  }
  if (debugStats) {
    aflUrl.searchParams.set('debugStats', '1');
  }

  const headers = createHeaders(cronSecret);
  const nbaPromise = NBA_PUBLIC_ENABLED
    ? getNbaPlayerProps(new NextRequest(nbaUrl))
    : Promise.resolve(
        NextResponse.json({ success: true, data: [], cached: false, lastUpdated: null, gameDate: null })
      );
  const wcPromise = WORLD_CUP_PUBLIC_ENABLED
    ? getWorldCupPlayerPropsList(new NextRequest(wcUrl, { headers }))
    : Promise.resolve(
        NextResponse.json({
          success: true,
          games: [],
          data: [],
          gamesCount: 0,
          propsCount: 0,
          noWorldCupOdds: true,
          noAflOdds: true,
          ingestMessage: 'World Cup props are not available.',
        })
      );
  const [nbaResponse, aflResponse, wcResponse] = await Promise.all([
    nbaPromise,
    getAflPlayerPropsList(new Request(aflUrl, { headers })),
    wcPromise,
  ]);

  const [nbaPayload, aflPayload, wcPayload] = await Promise.all([
    nbaResponse.json().catch(() => null),
    aflResponse.json().catch(() => null),
    wcResponse.json().catch(() => null),
  ]);

  const aflAggregated = aggregateAflProps(aflPayload);
  const worldCupAggregated = aggregateWorldCupProps(wcPayload);
  const now = Date.now();
  // Degrade gracefully: the combined slate is usable as long as at least one
  // sport responded. A sport that's out of season (e.g. NBA odds cache empty →
  // 503) should not blank out the other sport's props.
  const snapshot: CombinedPropsSnapshot = {
    success: nbaResponse.ok || aflResponse.ok || wcResponse.ok,
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
    worldCup: {
      ok: wcResponse.ok,
      status: wcResponse.status,
      lastUpdated: worldCupAggregated.lastUpdated,
      nextUpdate: worldCupAggregated.nextUpdate,
      ingestMessage: worldCupAggregated.ingestMessage,
      noWorldCupOdds: worldCupAggregated.noWorldCupOdds,
      games: worldCupAggregated.games,
      props: worldCupAggregated.props,
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
