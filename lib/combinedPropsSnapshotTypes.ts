/** Shared combined-props snapshot types (client + server safe — no Node imports). */

export type CombinedPropsBookmakerLine = {
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
  bookmakerLines?: CombinedPropsBookmakerLine[];
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

/** Grace after scheduled kickoff while AFL props remain visible (includes LIVE window). */
export const AFL_PROPS_LIVE_GRACE_MS = 60 * 60 * 1000;

/** Shown on the props page when there are no player lines left to display. */
export const AFL_USER_NO_ODDS = 'No odds available. Come back later.';

export type AflPropsGameRef = {
  gameId?: string;
  commenceTime?: string | null;
};

export type AflPropsRowRef = {
  commenceTime?: string | null;
  gameDate?: string | null;
  gameId?: string | null;
};

export function isAflCommenceTimePropsEligible(
  commenceTime: string | null | undefined,
  nowMs = Date.now()
): boolean {
  if (!commenceTime) return true;
  const t = Date.parse(commenceTime);
  if (!Number.isFinite(t)) return true;
  return t >= nowMs - AFL_PROPS_LIVE_GRACE_MS;
}

export function filterAflPropsEligibleGames<T extends AflPropsGameRef>(
  games: T[],
  nowMs = Date.now()
): T[] {
  return (games ?? []).filter((g) => isAflCommenceTimePropsEligible(g.commenceTime, nowMs));
}

export function filterAflPropRowsByCommenceTime<T extends AflPropsRowRef>(
  rows: T[],
  eligibleGameIds: Set<string>,
  nowMs = Date.now()
): T[] {
  return (rows ?? []).filter((row) => {
    if (row.gameId && eligibleGameIds.has(row.gameId)) return true;
    const commenceTime = row.commenceTime ?? row.gameDate;
    return isAflCommenceTimePropsEligible(commenceTime, nowMs);
  });
}

export function applyLiveAflPropsCutoff<
  T extends AflPropsRowRef,
  G extends AflPropsGameRef,
>(props: T[], games: G[], nowMs = Date.now()) {
  const gamesFiltered = filterAflPropsEligibleGames(games, nowMs);
  const gameIds = new Set(
    gamesFiltered
      .map((g) => g.gameId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );
  const propsFiltered = filterAflPropRowsByCommenceTime(props, gameIds, nowMs);
  return {
    props: propsFiltered,
    games: gamesFiltered,
    noAflOdds: propsFiltered.length === 0,
    ingestMessage: propsFiltered.length === 0 ? AFL_USER_NO_ODDS : null,
  };
}

export function filterAflEnrichedListPayload(
  payload: Record<string, unknown> | null | undefined,
  nowMs = Date.now()
): Record<string, unknown> | null {
  if (!payload || typeof payload !== 'object') return null;

  const gamesRaw = Array.isArray(payload.games) ? payload.games : [];
  const eligibleGames = filterAflPropsEligibleGames(
    gamesRaw.filter((g): g is AflPropsGameRef => g != null && typeof g === 'object'),
    nowMs
  );
  const eligibleGameIds = new Set(
    eligibleGames
      .map((g) => g.gameId)
      .filter((id): id is string => typeof id === 'string' && id.length > 0)
  );

  const dataRaw = Array.isArray(payload.data) ? payload.data : [];
  const filteredData = filterAflPropRowsByCommenceTime(
    dataRaw.filter((r): r is AflPropsRowRef => r != null && typeof r === 'object'),
    eligibleGameIds,
    nowMs
  );

  if (filteredData.length === dataRaw.length && eligibleGames.length === gamesRaw.length) {
    return payload;
  }

  const result: Record<string, unknown> = {
    ...payload,
    data: filteredData,
    games: eligibleGames,
    propsCount: filteredData.length,
    gamesCount: eligibleGames.length,
  };

  if (filteredData.length === 0) {
    result.noAflOdds = true;
    result.ingestMessage = AFL_USER_NO_ODDS;
    result.message = AFL_USER_NO_ODDS;
  }

  return result;
}

/** False when cached enriched payload only contains past games (live cutoff removes all rows). */
export function aflEnrichedPayloadHasEligibleLiveRows(
  payload: Record<string, unknown> | null | undefined,
  nowMs = Date.now()
): boolean {
  const filtered = filterAflEnrichedListPayload(payload, nowMs);
  const data = Array.isArray(filtered?.data) ? filtered.data : [];
  return data.length > 0;
}
