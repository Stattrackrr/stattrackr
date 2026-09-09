/**
 * Tennis dashboard loaders — API-Tennis cache only.
 */

import path from 'path';
import { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import { tennisLastName, tennisMatchesPlayed } from '@/lib/tennis/chartStats';
import {
  TENNIS_DVP_METRICS,
  TENNIS_DVP_MIN_MATCHES,
  type TennisDvpMetricKey,
} from '@/lib/tennis/dvpShared';
import {
  loadApiTennisCache,
  loadApiTennisMatches,
  loadApiTennisPlayers,
  loadApiTennisRankings,
  tennisBestOf,
  tennisCacheMtime,
} from '@/lib/tennis/apiTennis';
import { withTennisHands } from '@/lib/tennis/hands';
import { tennisRankHistoryMtime, withTennisMatchDayRanks } from '@/lib/tennis/rankHistory';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';

export type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
export { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS };

export function tennisDataDir(): string {
  return path.join(process.cwd(), 'data', 'tennis');
}

const ROUND_SORT: Record<string, number> = {
  R128: 1,
  R64: 2,
  R32: 3,
  R16: 4,
  QF: 5,
  RR: 5,
  SF: 6,
  BR: 7,
  F: 8,
};

function roundSortValue(round: string | null | undefined): number {
  return ROUND_SORT[String(round || '').toUpperCase().trim()] ?? 0;
}

type DataRuntime = {
  generation: number;
  matches: Map<string, TennisMatchRow[]>;
  byPlayerId: Map<string, Map<string, TennisMatchRow[]>>;
  byPlayerName: Map<string, Map<string, TennisMatchRow[]>>;
  allPlayers: TennisPlayer[] | null;
  currentPlayers: TennisPlayer[] | null;
  currentSeasonIds: Set<string> | null;
};

function dataRuntime(): DataRuntime {
  const g = globalThis as typeof globalThis & { __tennisData?: DataRuntime };
  const generation = tennisCacheMtime() + tennisRankHistoryMtime();
  if (!g.__tennisData || g.__tennisData.generation !== generation) {
    g.__tennisData = {
      generation,
      matches: new Map(),
      byPlayerId: new Map(),
      byPlayerName: new Map(),
      allPlayers: null,
      currentPlayers: null,
      currentSeasonIds: null,
    };
  }
  return g.__tennisData;
}

function matchesKey(years: readonly number[]): string {
  return `rk:${[...years].join(',')}`;
}

function indexMatches(key: string, matches: TennisMatchRow[]) {
  const runtime = dataRuntime();
  const byId = new Map<string, TennisMatchRow[]>();
  const byName = new Map<string, TennisMatchRow[]>();
  for (const row of matches) {
    const idList = byId.get(row.playerId);
    if (idList) idList.push(row);
    else byId.set(row.playerId, [row]);
    const nameKey = row.playerName.toLowerCase();
    const nameList = byName.get(nameKey);
    if (nameList) nameList.push(row);
    else byName.set(nameKey, [row]);
  }
  runtime.byPlayerId.set(key, byId);
  runtime.byPlayerName.set(key, byName);
}

export function loadTennisMatches(years?: readonly number[]): TennisMatchRow[] {
  const yearList = years ?? TENNIS_HISTORY_YEARS;
  const key = matchesKey(yearList);
  const runtime = dataRuntime();
  const cached = runtime.matches.get(key);
  if (cached) return cached;
  const api = loadApiTennisMatches(yearList);
  if (!api?.length) {
    runtime.matches.set(key, []);
    return [];
  }
  const matches = tennisMatchesPlayed(
    api.map((row) => {
      const bestOf = tennisBestOf(row.tour, row.isGrandSlam);
      const next = row.bestOf === bestOf ? row : { ...row, bestOf };
      return withTennisMatchDayRanks(withTennisHands(next));
    })
  );
  runtime.matches.set(key, matches);
  indexMatches(key, matches);
  return matches;
}

function currentSeasonPlayerIds(): Set<string> {
  const runtime = dataRuntime();
  if (runtime.currentSeasonIds) return runtime.currentSeasonIds;
  const ids = new Set<string>();
  for (const row of loadApiTennisCache()?.matches || []) {
    if (row.season === TENNIS_CURRENT_YEAR) ids.add(row.playerId);
  }
  runtime.currentSeasonIds = ids;
  return ids;
}

function sortPlayers(players: TennisPlayer[]): TennisPlayer[] {
  return [...players].sort(
    (a, b) => (a.rank ?? 9999) - (b.rank ?? 9999) || a.name.localeCompare(b.name)
  );
}

export function loadTennisPlayers(opts?: { currentOnly?: boolean }): TennisPlayer[] {
  const runtime = dataRuntime();
  if (opts?.currentOnly) {
    if (runtime.currentPlayers) return runtime.currentPlayers;
  } else if (runtime.allPlayers) {
    return runtime.allPlayers;
  }
  const apiPlayers = loadApiTennisPlayers();
  if (!apiPlayers?.length) return [];
  if (!runtime.allPlayers) runtime.allPlayers = sortPlayers(apiPlayers);
  if (!opts?.currentOnly) return runtime.allPlayers;
  const ranked = new Set(
    [...(loadApiTennisRankings('ATP') || []), ...(loadApiTennisRankings('WTA') || [])].map(
      (row) => row.playerId
    )
  );
  const played = currentSeasonPlayerIds();
  runtime.currentPlayers = runtime.allPlayers.filter(
    (p) => ranked.has(p.playerId) || played.has(p.playerId)
  );
  return runtime.currentPlayers;
}

export function tourForPlayer(playerId: string | null, name?: string | null): TennisTour | null {
  if (!playerId && !name) return null;
  const players = loadTennisPlayers();
  if (playerId) {
    const byId = players.find((p) => p.playerId === playerId);
    if (byId) return byId.tour;
  }
  if (name) {
    const key = name.toLowerCase().trim();
    const byName = players.find((p) => p.name.toLowerCase() === key);
    if (byName) return byName.tour;
  }
  return null;
}

export function loadPlayerMatches(opts: {
  playerId?: string | null;
  playerName?: string | null;
  tour?: TennisTour | null;
}): TennisMatchRow[] {
  const yearList = TENNIS_HISTORY_YEARS;
  const key = matchesKey(yearList);
  const matches = loadTennisMatches(yearList);
  const runtime = dataRuntime();
  const id = String(opts.playerId || '').trim();
  const name = String(opts.playerName || '').trim().toLowerCase();
  let rows: TennisMatchRow[] | undefined;
  if (id) rows = runtime.byPlayerId.get(key)?.get(id);
  if (!rows?.length && name) rows = runtime.byPlayerName.get(key)?.get(name);
  if (!rows?.length && name) {
    const last = tennisLastName(name).toLowerCase();
    const initial = name.replace(/[^a-z]/g, '')[0] || '';
    rows = matches.filter(
      (row) =>
        last &&
        initial &&
        tennisLastName(row.playerName).toLowerCase() === last &&
        row.playerName.toLowerCase().replace(/[^a-z]/g, '').startsWith(initial)
    );
  }
  let out = rows ? [...rows] : [];
  if (opts.tour) out = out.filter((row) => row.tour === opts.tour);
  out.sort(
    (a, b) =>
      String(a.date || '').localeCompare(String(b.date || '')) ||
      roundSortValue(a.round) - roundSortValue(b.round) ||
      a.matchId.localeCompare(b.matchId)
  );
  return out;
}

export function loadTennisRankings(
  tour: TennisTour,
  opts?: { limit?: number }
): TennisRankingRow[] {
  const limit = opts?.limit && opts.limit > 0 ? opts.limit : 50;
  const api = loadApiTennisRankings(tour);
  if (api?.length) return api.slice(0, limit);
  return loadTennisPlayers()
    .filter((p) => p.tour === tour && p.rank != null)
    .sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
    .slice(0, limit)
    .map((p) => ({
      pos: p.rank || 0,
      playerId: p.playerId,
      name: p.name,
      tour,
      points: p.rankPoints,
      ioc: p.ioc,
    }));
}

export function opponentDefenseRanks(tour: TennisTour, stat: keyof TennisMatchRow): Array<{
  opponent: string;
  opponentId: string;
  value: number;
  matches: number;
}> {
  const matches = loadTennisMatches().filter((row) => row.tour === tour && !row.isWin);
  const byOpp = new Map<string, { name: string; total: number; n: number }>();
  for (const row of matches) {
    const raw = row[stat];
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const cur = byOpp.get(row.opponentId) || { name: row.opponent, total: 0, n: 0 };
    cur.total += raw;
    cur.n += 1;
    byOpp.set(row.opponentId, cur);
  }
  return [...byOpp.entries()]
    .filter(([, v]) => v.n >= 3)
    .map(([opponentId, v]) => ({
      opponent: v.name,
      opponentId,
      value: v.total / v.n,
      matches: v.n,
    }))
    .sort((a, b) => a.value - b.value);
}

type DvpBucket = {
  name: string;
  ioc: string | null;
  date: string;
  matches: number;
  sums: Record<string, { sum: number; n: number }>;
};

function emptyDvpBucket(name: string, ioc: string | null, date: string): DvpBucket {
  return { name, ioc, date, matches: 0, sums: {} };
}

function addDvpValue(bucket: DvpBucket, key: string, raw: unknown) {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
  const cur = bucket.sums[key] || { sum: 0, n: 0 };
  cur.sum += raw;
  cur.n += 1;
  bucket.sums[key] = cur;
}

function touchDvpBucket(
  map: Map<string, DvpBucket>,
  id: string,
  name: string,
  ioc: string | null,
  date: string
): DvpBucket {
  const cur = map.get(id) || emptyDvpBucket(name, ioc, date);
  cur.matches += 1;
  if (date >= cur.date) {
    cur.name = name;
    cur.ioc = ioc;
    cur.date = date;
  }
  map.set(id, cur);
  return cur;
}

function normDvpName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function findDvpPlayerId(
  name: string,
  buckets: Map<string, DvpBucket>,
  ranked: TennisRankingRow[]
): string | null {
  const key = normDvpName(name);
  if (!key) return null;
  const rankedHit = ranked.find((p) => normDvpName(p.name) === key);
  if (rankedHit) return rankedHit.playerId;
  for (const [id, bucket] of buckets) {
    if (normDvpName(bucket.name) === key) return id;
  }
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length < 3) return null;
  const lastHits = ranked.filter((p) => {
    const parts = normDvpName(p.name).split(/\s+/);
    return parts[parts.length - 1] === last;
  });
  if (lastHits.length === 1) return lastHits[0].playerId;
  const bucketHits = [...buckets.entries()].filter(([, b]) => {
    const parts = normDvpName(b.name).split(/\s+/);
    return parts[parts.length - 1] === last;
  });
  if (bucketHits.length === 1) return bucketHits[0][0];
  return null;
}

function dvpMean(bucket: DvpBucket | undefined, key: string): number | null {
  const cell = bucket?.sums[key];
  if (!cell || cell.n <= 0) return null;
  return cell.sum / cell.n;
}

function dvpRanks(values: Array<{ id: string; value: number }>): Map<string, number> {
  const sorted = [...values].sort((a, b) => a.value - b.value || a.id.localeCompare(b.id));
  const out = new Map<string, number>();
  sorted.forEach((row, idx) => out.set(row.id, idx + 1));
  return out;
}

export type TennisDvpOpponent = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
};

export type TennisDvpMetricRow = {
  key: TennisDvpMetricKey;
  label: string;
  pct: boolean;
  value: number | null;
  rank: number | null;
  matches: number;
  fieldSize: number;
};

export type TennisDvpProfile = {
  tour: TennisTour;
  year: number;
  fieldSize: number;
  opponent: TennisDvpOpponent | null;
  opponents: TennisDvpOpponent[];
  metrics: TennisDvpMetricRow[];
};

/** Allowed rates vs one opponent, ranked against the active tour (current rankings + sample). */
export function tennisDvpProfile(opts: {
  tour: TennisTour;
  year: number;
  opponentName?: string | null;
}): TennisDvpProfile {
  const tour = opts.tour;
  const year = opts.year;
  const ranked = loadTennisRankings(tour, { limit: 200 });
  const rankedById = new Map(ranked.map((p) => [p.playerId, p]));
  const matches = loadTennisMatches().filter((row) => row.tour === tour && row.season === year);

  const allowed = new Map<string, DvpBucket>();
  const own = new Map<string, DvpBucket>();
  for (const row of matches) {
    const date = row.date || '';
    const vs = touchDvpBucket(allowed, row.opponentId, row.opponent, row.opponentIoc, date);
    const me = touchDvpBucket(own, row.playerId, row.playerName, row.ioc, date);
    for (const metric of TENNIS_DVP_METRICS) {
      const bucket = metric.source === 'own' ? me : vs;
      addDvpValue(bucket, metric.key, row[metric.key as keyof TennisMatchRow]);
    }
  }

  const activeIds = new Set<string>();
  for (const p of ranked) {
    const sample = allowed.get(p.playerId)?.matches || own.get(p.playerId)?.matches || 0;
    if (sample >= TENNIS_DVP_MIN_MATCHES) activeIds.add(p.playerId);
  }

  const opponentId = findDvpPlayerId(String(opts.opponentName || ''), allowed, ranked);
  if (opponentId) activeIds.add(opponentId);

  const opponents: TennisDvpOpponent[] = [...activeIds]
    .map((id) => {
      const rankedRow = rankedById.get(id);
      const bucket = allowed.get(id) || own.get(id);
      return {
        id,
        name: rankedRow?.name || bucket?.name || id,
        ioc: rankedRow?.ioc ?? bucket?.ioc ?? null,
        rankPos: rankedRow?.pos ?? null,
      };
    })
    .sort(
      (a, b) =>
        (a.rankPos ?? 9999) - (b.rankPos ?? 9999) || a.name.localeCompare(b.name)
    );

  const metrics: TennisDvpMetricRow[] = TENNIS_DVP_METRICS.map((metric) => {
    const source = metric.source === 'own' ? own : allowed;
    const values: Array<{ id: string; value: number }> = [];
    for (const id of activeIds) {
      const mean = dvpMean(source.get(id), metric.key);
      if (mean == null) continue;
      const n = source.get(id)?.sums[metric.key]?.n || 0;
      if (n < TENNIS_DVP_MIN_MATCHES && id !== opponentId) continue;
      values.push({ id, value: mean });
    }
    const ranks = dvpRanks(values);
    const selected = opponentId ? source.get(opponentId) : undefined;
    const value = opponentId ? dvpMean(selected, metric.key) : null;
    return {
      key: metric.key,
      label: metric.label,
      pct: metric.pct,
      value,
      rank: opponentId ? ranks.get(opponentId) ?? null : null,
      matches: selected?.sums[metric.key]?.n || 0,
      fieldSize: values.length,
    };
  });

  const fieldSize = opponents.length;
  const opponent = opponentId
    ? opponents.find((p) => p.id === opponentId) || {
        id: opponentId,
        name: allowed.get(opponentId)?.name || own.get(opponentId)?.name || String(opts.opponentName || ''),
        ioc: allowed.get(opponentId)?.ioc || own.get(opponentId)?.ioc || null,
        rankPos: rankedById.get(opponentId)?.pos ?? null,
      }
    : null;

  return { tour, year, fieldSize, opponent, opponents, metrics };
}
