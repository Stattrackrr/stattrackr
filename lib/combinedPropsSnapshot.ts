import { NextRequest, NextResponse } from 'next/server';
import sharedCache from '@/lib/sharedCache';
import type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
import {
  AFL_USER_NO_ODDS,
  filterAflPropRowsByCommenceTime,
  filterAflPropsEligibleGames,
} from '@/lib/combinedPropsSnapshotTypes';
import { aflEnrichedPayloadHasUsableStats } from '@/lib/aflPlayerPropsCache';
import { NBA_PUBLIC_ENABLED, TENNIS_PUBLIC_ENABLED } from '@/lib/nbaConstants';
import { toOfficialAflTeamDisplayName } from '@/lib/aflTeamMapping';
import { GET as getNbaPlayerProps } from '@/app/api/nba/player-props/route';
import { GET as getAflPlayerPropsList } from '@/app/api/afl/player-props/list/route';
import { getTennisPlayerPropsList } from '@/lib/tennis/playerPropsList';
import { attachTennisHeadshots } from '@/lib/tennis/headshots';
import {
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';

export type { CombinedAflGame, CombinedPlayerProp, CombinedPropsSnapshot } from '@/lib/combinedPropsSnapshotTypes';
export {
  COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
  COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
  slimCombinedPlayerPropForPaint,
  slimCombinedPropsSnapshotForClient,
} from '@/lib/combinedPropsSnapshotPaint';

const COMBINED_PROPS_SNAPSHOT_TTL_SECONDS = 4 * 60 * 60;
const COMBINED_PROPS_SNAPSHOT_STALE_MS = 15 * 60 * 1000;

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

export async function getCombinedPropsSnapshot(): Promise<CombinedPropsSnapshot | null> {
  const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(COMBINED_PROPS_SNAPSHOT_CACHE_KEY);
  return snapshot ? withTennisHeadshots(snapshot) : null;
}

export async function getCombinedPropsPaintSnapshot(): Promise<CombinedPropsSnapshot | null> {
  const snapshot = await sharedCache.getJSON<CombinedPropsSnapshot>(COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY);
  return snapshot ? withTennisHeadshots(snapshot) : null;
}

async function writeCombinedPropsSnapshotCaches(snapshot: CombinedPropsSnapshot): Promise<void> {
  await sharedCache.setJSON(
    COMBINED_PROPS_SNAPSHOT_CACHE_KEY,
    snapshot,
    COMBINED_PROPS_SNAPSHOT_TTL_SECONDS
  );
  await sharedCache.setJSON(
    COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY,
    slimCombinedPropsSnapshotForClient(snapshot),
    COMBINED_PROPS_SNAPSHOT_TTL_SECONDS
  );
}

export function isCombinedPropsSnapshotStale(snapshot: CombinedPropsSnapshot): boolean {
  const staleAt = Date.parse(snapshot?.staleAt ?? '');
  return !Number.isFinite(staleAt) || staleAt <= Date.now();
}

/**
 * Empty AFL with live games on the slate is a failed assembly, not a cacheable "no odds" result.
 * Caching that blanks the home /props page until TTL even after list starts returning lines.
 */
export function combinedSnapshotAflAssemblyReady(snapshot: CombinedPropsSnapshot): boolean {
  const games = snapshot.afl?.games ?? [];
  const props = snapshot.afl?.props ?? [];
  if (games.length > 0 && props.length === 0) return false;
  if (props.length === 0) return true;
  return aflEnrichedPayloadHasUsableStats({ data: props });
}

export async function clearCombinedPropsSnapshotCaches(): Promise<void> {
  await Promise.allSettled([
    sharedCache.deleteJSON(COMBINED_PROPS_SNAPSHOT_CACHE_KEY),
    sharedCache.deleteJSON(COMBINED_PROPS_PAINT_SNAPSHOT_CACHE_KEY),
  ]);
}

/** Drop AFL props/games whose kickoff was more than one hour ago (even from cached snapshots). */
export function filterCombinedSnapshotAflEligibility(
  snapshot: CombinedPropsSnapshot,
  nowMs = Date.now()
): CombinedPropsSnapshot {
  const eligibleGames = filterAflPropsEligibleGames(snapshot.afl.games ?? [], nowMs);
  const eligibleGameIds = new Set(eligibleGames.map((g) => g.gameId));
  const filteredProps = filterAflPropRowsByCommenceTime(snapshot.afl.props ?? [], eligibleGameIds, nowMs);

  if (
    filteredProps.length === (snapshot.afl.props?.length ?? 0) &&
    eligibleGames.length === (snapshot.afl.games?.length ?? 0)
  ) {
    return snapshot;
  }

  return {
    ...snapshot,
    afl: {
      ...snapshot.afl,
      games: eligibleGames,
      props: filteredProps,
      noAflOdds: filteredProps.length === 0,
      ingestMessage: filteredProps.length === 0 ? AFL_USER_NO_ODDS : snapshot.afl.ingestMessage,
    },
  };
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
  const tennisPromise = TENNIS_PUBLIC_ENABLED
    ? getTennisPlayerPropsList({ refresh })
    : Promise.resolve({
        success: true,
        games: [] as never[],
        data: [] as never[],
        gamesCount: 0,
        propsCount: 0,
        noTennisOdds: true,
        noAflOdds: true,
        ingestMessage: 'Tennis props are not available.',
      });
  const [nbaResponse, aflResponse, tennisPayload] = await Promise.all([
    nbaPromise,
    getAflPlayerPropsList(new Request(aflUrl, { headers })),
    tennisPromise,
  ]);

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
      noTennisOdds: Boolean(tennisPayload?.noTennisOdds) || tennisAggregated.props.length === 0,
      games: tennisAggregated.games,
      props: tennisAggregated.props,
    },
  };

  if (snapshot.success && writeCache && !debugStats && combinedSnapshotAflAssemblyReady(snapshot)) {
    let toStore = snapshot;
    if (TENNIS_PUBLIC_ENABLED && !(snapshot.tennis?.props?.length)) {
      const previous = await getCombinedPropsSnapshot();
      if (previous?.tennis?.props?.length) {
        toStore = { ...snapshot, tennis: previous.tennis };
      }
    }
    await writeCombinedPropsSnapshotCaches(withTennisHeadshots(toStore));
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
