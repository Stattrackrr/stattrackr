import { aflEnrichedPayloadHasUsableStats } from '@/lib/aflPlayerPropsCache';
import { NextRequest, NextResponse } from 'next/server';
import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import { AFL_USER_NO_ODDS } from '@/lib/combinedPropsSnapshotTypes';
import { NBA_PUBLIC_ENABLED, TENNIS_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { GET as getNbaPlayerProps } from '@/app/api/nba/player-props/route';
import { GET as getAflPlayerPropsList } from '@/app/api/afl/player-props/list/route';
import { getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';
import { attachTennisHeadshots } from '@/lib/tennis/headshots';
import {
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  combinedSnapshotAflAssemblyReady,
  combinedTennisHasFormStats,
  getCombinedPropsSnapshot,
  persistCombinedPropsSnapshot,
} from '@/lib/combinedPropsSnapshotPaint';

export type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
export {
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  combinedSnapshotAflAssemblyReady,
  filterCombinedSnapshotAflEligibility,
  getCombinedPropsPaintSnapshot,
  getCombinedPropsSnapshot,
  isCombinedPropsSnapshotStale,
  slimCombinedPlayerPropForPaint,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';

const COMBINED_PROPS_SNAPSHOT_STALE_MS = 15 * 60 * 1000;
/** Combined paint must never wait on tennis. AFL returns; tennis fills in if it makes the budget. */
const TENNIS_COMBINED_BUDGET_MS = 2500;

function emptyTennisListPayload() {
  return {
    success: false,
    games: [] as never[],
    data: [] as never[],
    gamesCount: 0,
    propsCount: 0,
    noTennisOdds: false,
    noAflOdds: true,
    ingestMessage: 'Tennis props are still loading.',
  };
}

function tennisListFromSnapshot(previous: CombinedPropsSnapshot | null) {
  const tennis = previous?.tennis;
  if (!tennis?.props?.length) return emptyTennisListPayload();
  return {
    success: tennis.ok !== false,
    games: tennis.games || [],
    data: tennis.props,
    gamesCount: tennis.games?.length || 0,
    propsCount: tennis.props.length,
    noTennisOdds: Boolean(tennis.noTennisOdds),
    noAflOdds: true,
    ingestMessage: tennis.ingestMessage,
  };
}

function withBudget<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallback);
    }, ms);
    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

type BookmakerLine = {
  bookmaker: string;
  line: number;
  overOdds: string;
  underOdds: string;
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

function normalizeCombinedAflFantasyPosition(
  value: unknown
): CombinedPlayerProp['aflFantasyPosition'] {
  const raw = String(value ?? '').trim().toUpperCase();
  if (raw === 'DEF' || raw === 'MID' || raw === 'FWD' || raw === 'RUC') return raw;
  return null;
}

function normalizeCombinedAflDfsRole(value: unknown): string | null {
  const raw = String(value ?? '').trim();
  return raw || null;
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
    dvpFieldSize?: number | null;
    headshotUrl?: string | null;
    opponentName?: string | null;
    playerId?: string | null;
    homeTeamCode?: string | null;
    awayTeamCode?: string | null;
    homeTeamLogo?: string | null;
    awayTeamLogo?: string | null;
    playerIoc?: string | null;
    playerRank?: number | null;
    opponentId?: string | null;
    opponentIoc?: string | null;
    opponentRank?: number | null;
    playerSeed?: number | null;
    opponentSeed?: number | null;
    playerDrawRank?: number | null;
    opponentDrawRank?: number | null;
    tournamentName?: string | null;
    surface?: string | null;
    aflFantasyPosition?: CombinedPlayerProp['aflFantasyPosition'];
    aflDfsRole?: string | null;
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
      if (!existing.aflFantasyPosition) {
        existing.aflFantasyPosition = normalizeCombinedAflFantasyPosition(row.aflFantasyPosition);
      }
      if (!existing.aflDfsRole) {
        existing.aflDfsRole = normalizeCombinedAflDfsRole(row.aflDfsRole);
      }
      if (!existing.opponentId && row.opponentId != null) {
        existing.opponentId = String(row.opponentId);
      }
      if (!existing.opponentIoc && row.opponentIoc) {
        existing.opponentIoc = row.opponentIoc;
      }
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
      dvpFieldSize: row.dvpFieldSize,
      headshotUrl: row.headshotUrl ?? null,
      opponentName: typeof row.opponent === 'string' ? row.opponent : null,
      playerId: row.playerId != null ? String(row.playerId) : null,
      homeTeamCode: row.homeTeamCode ?? null,
      awayTeamCode: row.awayTeamCode ?? null,
      homeTeamLogo: row.homeTeamLogo ?? null,
      awayTeamLogo: row.awayTeamLogo ?? null,
      playerIoc: row.playerIoc ?? null,
      playerRank: row.playerRank ?? null,
      opponentId: row.opponentId != null ? String(row.opponentId) : null,
      opponentIoc: row.opponentIoc ?? null,
      opponentRank: row.opponentRank ?? null,
      playerSeed: row.playerSeed ?? null,
      opponentSeed: row.opponentSeed ?? null,
      playerDrawRank: row.playerDrawRank ?? null,
      opponentDrawRank: row.opponentDrawRank ?? null,
      tournamentName: row.tournamentName ?? null,
      surface: row.surface ?? null,
      aflFantasyPosition: normalizeCombinedAflFantasyPosition(row.aflFantasyPosition),
      aflDfsRole: normalizeCombinedAflDfsRole(row.aflDfsRole),
    });
  }

  const props = Array.from(keyToRow.values()).map((row): CombinedPlayerProp => {
    const playerTeam = row.playerTeam && String(row.playerTeam).trim() ? row.playerTeam : null;
    const homeNorm = toOfficialAflTeamDisplayName(row.homeTeam || '');
    const awayNorm = toOfficialAflTeamDisplayName(row.awayTeam || '');
    const playerNorm = playerTeam ? toOfficialAflTeamDisplayName(playerTeam) : null;
    const tennisTour = playerTeam === 'ATP' || playerTeam === 'WTA';
    const playerKey = String(row.playerName || '').trim().toLowerCase();
    const homeKey = String(row.homeTeam || '').trim().toLowerCase();
    const team = tennisTour ? playerTeam! : (playerNorm || homeNorm);
    const opponent = tennisTour
      ? String(row.opponentName || '').trim() || (playerKey && playerKey === homeKey ? awayNorm : homeNorm)
      : playerNorm
        ? (playerNorm === homeNorm ? awayNorm : playerNorm === awayNorm ? homeNorm : awayNorm)
        : awayNorm;

    return {
      playerName: row.playerName,
      playerId: tennisTour ? String(row.playerId || '') : '',
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
      homeTeamCode: row.homeTeamCode ?? null,
      awayTeamCode: row.awayTeamCode ?? null,
      homeTeamLogo: row.homeTeamLogo ?? null,
      awayTeamLogo: row.awayTeamLogo ?? null,
      playerTeam,
      playerIoc: row.playerIoc ?? null,
      playerRank: row.playerRank ?? null,
      opponentId: row.opponentId ?? null,
      opponentIoc: row.opponentIoc ?? null,
      opponentRank: row.opponentRank ?? null,
      playerSeed: row.playerSeed ?? null,
      opponentSeed: row.opponentSeed ?? null,
      playerDrawRank: row.playerDrawRank ?? null,
      opponentDrawRank: row.opponentDrawRank ?? null,
      tournamentName: row.tournamentName ?? null,
      surface: row.surface ?? null,
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
      dvpFieldSize: row.dvpFieldSize,
      headshotUrl: row.headshotUrl ?? null,
      aflFantasyPosition: row.aflFantasyPosition ?? null,
      aflDfsRole: row.aflDfsRole ?? null,
    };
  });

  return {
    games,
    props,
    ingestMessage:
      normalizeString(listData?.ingestMessage) ??
      (props.length === 0 ? AFL_USER_NO_ODDS : null),
    lastUpdated: normalizeString(listData?.lastUpdated),
    nextUpdate: normalizeString(listData?.nextUpdate),
    noAflOdds: normalizeBool(listData?.noAflOdds) || props.length === 0,
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

function withTennisHeadshots(snapshot: CombinedPropsSnapshot): CombinedPropsSnapshot {
  try {
    const tennis = snapshot.tennis;
    if (!tennis?.props?.length) return snapshot;
    const props = attachTennisHeadshots(tennis.props);
    if (props === tennis.props) return snapshot;
    return { ...snapshot, tennis: { ...tennis, props } };
  } catch {
    return snapshot;
  }
}

function snapshotReadyToCache(snapshot: CombinedPropsSnapshot): boolean {
  if (!combinedSnapshotAflAssemblyReady(snapshot)) return false;
  const props = snapshot.afl?.props ?? [];
  if (props.length === 0) return true;
  if (snapshot.afl?.noAflOdds) return true;
  return aflEnrichedPayloadHasUsableStats({ data: props });
}

async function writeCombinedPropsSnapshotCaches(snapshot: CombinedPropsSnapshot): Promise<void> {
  await persistCombinedPropsSnapshot(snapshot);
}

export async function clearCombinedPropsSnapshotCaches(): Promise<void> {
  await Promise.allSettled([
    sharedCache.deleteJSON(COMBINED_PROPS_SNAPSHOT_CACHE_KEY),
    sharedCache.deleteJSON(COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY),
  ]);
}

export async function buildCombinedPropsSnapshot(
  options: BuildCombinedPropsSnapshotOptions
): Promise<CombinedPropsSnapshot> {
  const { origin, refresh = false, debugStats = false, cronSecret, writeCache = true } = options;
  const nbaUrl = new URL('/api/nba/player-props', origin);
  const aflUrl = new URL('/api/afl/player-props/list', origin);
  aflUrl.searchParams.set('enrich', 'true');

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
  const previousSnapshot = await getCombinedPropsSnapshot();
  const tennisWork = TENNIS_PUBLIC_ENABLED
    ? getTennisPlayerPropsList({ refresh }).catch(() => null)
    : Promise.resolve(null);
  const haveTennis = (previousSnapshot?.tennis?.props?.length || 0) > 0;
  const [nbaResponse, aflResponse, tennisFresh] = await Promise.all([
    nbaPromise,
    getAflPlayerPropsList(new Request(aflUrl, { headers })),
    haveTennis && !refresh
      ? Promise.resolve(null)
      : withBudget(tennisWork, TENNIS_COMBINED_BUDGET_MS, null),
  ]);
  if (haveTennis && !refresh) void tennisWork;
  const tennisPayload =
    tennisFresh && Array.isArray(tennisFresh.data) && tennisFresh.data.length > 0
      ? tennisFresh
      : tennisListFromSnapshot(previousSnapshot);

  const [nbaPayload, aflPayload] = await Promise.all([
    nbaResponse.json().catch(() => null),
    aflResponse.json().catch(() => null),
  ]);

  const aflAggregated = aggregateAflProps(aflPayload);
  const tennisAggregated = aggregateAflProps(tennisPayload);
  const now = Date.now();
  // Degrade gracefully: the combined slate is usable as long as at least one
  // sport responded. A sport that's out of season (e.g. NBA odds cache empty →
  // 503) should not blank out the other sport's props.
  const snapshot: CombinedPropsSnapshot = {
    success: nbaResponse.ok || aflResponse.ok || Boolean(tennisPayload?.success),
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
    tennis: {
      ok: Boolean(tennisPayload?.success),
      status: tennisPayload?.success === false ? 500 : 200,
      lastUpdated: tennisAggregated.lastUpdated,
      nextUpdate: tennisAggregated.nextUpdate,
      ingestMessage: tennisPayload?.ingestMessage ?? tennisAggregated.ingestMessage,
      noTennisOdds: Boolean(tennisPayload?.noTennisOdds) && tennisAggregated.props.length === 0,
      games: tennisAggregated.games,
      props: tennisAggregated.props,
    },
  };

  if (snapshot.success && writeCache && !debugStats && snapshotReadyToCache(snapshot)) {
    let toStore = snapshot;
    if (TENNIS_PUBLIC_ENABLED) {
      const previous = previousSnapshot;
      if (!(snapshot.tennis?.props?.length) && previous?.tennis?.props?.length) {
        toStore = { ...snapshot, tennis: previous.tennis };
      } else if (
        snapshot.tennis?.props?.length &&
        !combinedTennisHasFormStats(snapshot) &&
        previous &&
        combinedTennisHasFormStats(previous)
      ) {
        toStore = { ...snapshot, tennis: previous.tennis };
      }
    }
    await writeCombinedPropsSnapshotCaches(withTennisHeadshots(toStore));
    if (TENNIS_PUBLIC_ENABLED && !tennisFresh) {
      void tennisWork
        .then(async (payload) => {
          if (!payload || payload.success === false) return;
          const latest = (await getCombinedPropsSnapshot()) || toStore;
          const nextTennis = aggregateAflProps(payload);
          if (!nextTennis.props.length) return;
          const next: CombinedPropsSnapshot = {
            ...latest,
            tennis: {
              ok: true,
              status: 200,
              lastUpdated: nextTennis.lastUpdated,
              nextUpdate: nextTennis.nextUpdate,
              ingestMessage: payload.ingestMessage ?? nextTennis.ingestMessage,
              noTennisOdds: Boolean(payload.noTennisOdds) || nextTennis.props.length === 0,
              games: nextTennis.games,
              props: nextTennis.props,
            },
          };
          if (!combinedTennisHasFormStats(next) && combinedTennisHasFormStats(latest)) return;
          await writeCombinedPropsSnapshotCaches(withTennisHeadshots(next));
        })
        .catch((error) => {
          console.warn(
            '[Props Combined] Background tennis slice failed:',
            error instanceof Error ? error.message : error
          );
        });
    }
    return withTennisHeadshots(toStore);
  }

  return withTennisHeadshots(snapshot);
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
