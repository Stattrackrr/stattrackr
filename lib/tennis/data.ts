/**
 * Tennis dashboard loaders — API-Tennis cache only.
 */

import path from 'path';
import { TENNIS_CURRENT_YEAR, TENNIS_HISTORY_YEARS } from '@/lib/tennis/constants';
import {
  tennisEventPlaceCore,
  tennisLastName,
  tennisMatchesPlayed,
  resolveTennisMatchBestOf,
  compareTennisMatchesNewestFirst,
} from '@/lib/tennis/chartStats';
import {
  TENNIS_DVP_METRICS,
  TENNIS_DVP_WINDOWS,
  isTennisQualifyingLabel,
  tennisDvpTournamentBestOf,
  tennisFillMetricRank,
  tennisQualifyingEventLabel,
  type TennisDvpBestOf,
  type TennisDvpMetricKey,
  type TennisDvpStage,
  type TennisDvpWindow,
} from '@/lib/tennis/dvpShared';
import {
  loadApiTennisCache,
  loadApiTennisMatches,
  loadApiTennisPlayers,
  loadApiTennisRankings,
  loadApiTennisRoster,
  tennisCacheMtime,
  isApiGrandSlam,
} from '@/lib/tennis/apiTennis';
import { tennisOverlayGeneration } from '@/lib/tennis/ingest';
import { withTennisHands } from '@/lib/tennis/hands';
import { tennisRankHistoryMtime, withTennisMatchDayRanks } from '@/lib/tennis/rankHistory';
import { tennisAssignDrawRanks, tennisAssignDrawSeeds } from '@/lib/tennis/seeds';
import { applyTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisMatchRow, TennisPlayer, TennisRankingRow, TennisTour } from '@/lib/tennis/types';
import { tennisIdentityMatch } from '@/lib/tennis/oddsApi';

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

function prepareMatchRows(rows: TennisMatchRow[]): TennisMatchRow[] {
  return tennisMatchesPlayed(
    rows.map((row) => {
      const bestOf = resolveTennisMatchBestOf(row);
      const next = row.bestOf === bestOf ? row : { ...row, bestOf };
      return withTennisMatchDayRanks(withTennisHands(applyTennisSurface(next)));
    })
  );
}

type TourneyGroup = {
  key: string;
  tourneyId: string;
  tourneyName: string;
  season: number;
  latestDate: string;
  drawSize: number;
  playerIds: Set<string>;
  qualifyingPlayerIds: Set<string>;
  matches: TennisMatchRow[];
};

type CachedTourMatchIndex = {
  byPlayerId: Map<string, TennisMatchRow[]>;
  byOpponentId: Map<string, TennisMatchRow[]>;
  groups: TourneyGroup[];
};

type DataRuntime = {
  generation: number;
  matches: Map<string, TennisMatchRow[]>;
  byPlayerId: Map<string, Map<string, TennisMatchRow[]>>;
  byPlayerName: Map<string, Map<string, TennisMatchRow[]>>;
  allPlayers: TennisPlayer[] | null;
  currentPlayers: TennisPlayer[] | null;
  currentSeasonIds: Set<string> | null;
  dvpTours: Map<string, CachedTourMatchIndex>;
};

const DVP_GROUP_VERSION = 4;

function dataRuntime(): DataRuntime {
  const g = globalThis as typeof globalThis & { __tennisData?: DataRuntime };
  const generation = tennisCacheMtime() + tennisRankHistoryMtime() + tennisOverlayGeneration() + DVP_GROUP_VERSION;
  if (!g.__tennisData || g.__tennisData.generation !== generation) {
    g.__tennisData = {
      generation,
      matches: new Map(),
      byPlayerId: new Map(),
      byPlayerName: new Map(),
      allPlayers: null,
      currentPlayers: null,
      currentSeasonIds: null,
      dvpTours: new Map(),
    };
  } else if (!g.__tennisData.dvpTours) {
    g.__tennisData.dvpTours = new Map();
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
  const matches = prepareMatchRows(api);
  runtime.matches.set(key, matches);
  indexMatches(key, matches);
  return matches;
}

function currentSeasonPlayerIds(): Set<string> {
  const runtime = dataRuntime();
  if (runtime.currentSeasonIds) return runtime.currentSeasonIds;
  const ids = new Set<string>();
  const roster = loadApiTennisRoster();
  for (const row of roster?.standings?.ATP || []) ids.add(row.playerId);
  for (const row of roster?.standings?.WTA || []) ids.add(row.playerId);
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
  const ranked = currentSeasonPlayerIds();
  runtime.currentPlayers = runtime.allPlayers.filter((p) => ranked.has(p.playerId));
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
  const wantedYears = new Set(yearList);
  const id = String(opts.playerId || '').trim();
  const name = String(opts.playerName || '').trim().toLowerCase();
  const key = matchesKey(yearList);
  const runtime = dataRuntime();
  if (runtime.matches.has(key)) {
    let rows: TennisMatchRow[] | undefined;
    if (id) rows = runtime.byPlayerId.get(key)?.get(id);
    if (!rows?.length && name) rows = runtime.byPlayerName.get(key)?.get(name);
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

  const api = loadApiTennisCache()?.matches || [];
  const last = name ? tennisLastName(name).toLowerCase() : '';
  const initial = name.replace(/[^a-z]/g, '')[0] || '';
  const raw = api.filter((row) => {
    if (!wantedYears.has(row.season)) return false;
    if (id && row.playerId === id) return true;
    if (name && row.playerName.toLowerCase() === name) return true;
    return Boolean(
      last &&
        initial &&
        tennisLastName(row.playerName).toLowerCase() === last &&
        row.playerName.toLowerCase().replace(/[^a-z]/g, '').startsWith(initial)
    );
  });
  let out = prepareMatchRows(raw);
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

function normDvpName(name: string | null | undefined): string {
  return String(name || '')
    .trim()
    .toLowerCase();
}

function isNumericTennisId(value: string | null | undefined): boolean {
  return /^\d+$/.test(String(value || '').trim());
}

function humanTennisDvpName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isNumericTennisId(name)) return name;
  }
  return '';
}

function findDvpPlayerId(
  name: string,
  buckets: Map<string, DvpBucket>,
  ranked: TennisRankingRow[],
  extraPlayers: TennisPlayer[] = []
): string | null {
  const key = String(name || '').trim();
  if (!key || isNumericTennisId(key)) return null;
  const roster = [...loadTennisPlayers(), ...extraPlayers];
  const exact = roster.find((p) => normDvpName(p.name) === normDvpName(key));
  if (exact) return exact.playerId;
  const rankedHit = ranked.find((p) => normDvpName(p.name) === normDvpName(key));
  if (rankedHit) return rankedHit.playerId;
  const identity = roster.filter((p) => tennisIdentityMatch(p.name, key));
  if (identity.length === 1) return identity[0].playerId;
  for (const [id, bucket] of buckets) {
    if (normDvpName(bucket.name) === normDvpName(key) || tennisIdentityMatch(bucket.name, key)) return id;
  }
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length < 3) return null;
  const lastKey = last.toLowerCase();
  const lastHits = roster.filter((p) => normDvpName(p.name).split(/\s+/).pop() === lastKey);
  if (lastHits.length === 1) return lastHits[0].playerId;
  const rankedLast = ranked.filter((p) => normDvpName(p.name).split(/\s+/).pop() === lastKey);
  if (rankedLast.length === 1) return rankedLast[0].playerId;
  const bucketHits = [...buckets.entries()].filter(
    ([, bucket]) => normDvpName(bucket.name).split(/\s+/).pop() === lastKey
  );
  if (bucketHits.length === 1) return bucketHits[0][0];
  return null;
}

function dvpMatchKey(row: TennisMatchRow): string {
  return String(row.matchId || '').trim() || `${matchDateKey(row)}|${row.playerId}|${row.opponentId}`;
}

function compareDvpMatchesNewestFirst(a: TennisMatchRow, b: TennisMatchRow): number {
  return compareTennisMatchesNewestFirst(a, b);
}

function pushUniqueDvpMatch(map: Map<string, TennisMatchRow[]>, id: string, row: TennisMatchRow) {
  const key = String(id || '').trim();
  if (!key) return;
  const list = map.get(key) || [];
  const matchKey = dvpMatchKey(row);
  const idx = list.findIndex((prev) => dvpMatchKey(prev) === matchKey);
  if (idx >= 0) {
    if (dvpRowRichness(row) >= dvpRowRichness(list[idx])) list[idx] = row;
  } else {
    list.push(row);
  }
  map.set(key, list);
}

function extraMatchLookup(rows: TennisMatchRow[] | undefined): {
  byPlayerId: Map<string, TennisMatchRow[]>;
  byOpponentId: Map<string, TennisMatchRow[]>;
} {
  const byPlayerId = new Map<string, TennisMatchRow[]>();
  const byOpponentId = new Map<string, TennisMatchRow[]>();
  for (const row of prepareMatchRows(rows || [])) {
    pushUniqueDvpMatch(byPlayerId, row.playerId, row);
    pushUniqueDvpMatch(byOpponentId, row.opponentId, row);
  }
  for (const list of byPlayerId.values()) list.sort(compareDvpMatchesNewestFirst);
  for (const list of byOpponentId.values()) list.sort(compareDvpMatchesNewestFirst);
  return { byPlayerId, byOpponentId };
}

function dvpRowRichness(row: TennisMatchRow): number {
  let n = 0;
  if (typeof row.gamesWon === 'number') n += 1;
  if (typeof row.gamesLost === 'number') n += 1;
  if (typeof row.aces === 'number') n += 1;
  if (typeof row.breakPointsConverted === 'number') n += 1;
  if (typeof row.returnPointsWonPct === 'number') n += 1;
  if (typeof row.servicePointsWonPct === 'number') n += 1;
  return n;
}

function mergeDvpMatchRows(overlay: TennisMatchRow[], extra: TennisMatchRow[]): TennisMatchRow[] {
  if (!extra.length) return overlay;
  if (!overlay.length) return extra;
  const byKey = new Map<string, TennisMatchRow>();
  for (const row of overlay) byKey.set(dvpMatchKey(row), row);
  for (const row of extra) byKey.set(dvpMatchKey(row), row);
  return [...byKey.values()].sort(compareDvpMatchesNewestFirst);
}

function toAllowedView(row: TennisMatchRow): TennisMatchRow {
  const faced = typeof row.breakPointsFaced === 'number' ? row.breakPointsFaced : null;
  const saved = typeof row.breakPointsSaved === 'number' ? row.breakPointsSaved : null;
  const spw = typeof row.servicePointsWonPct === 'number' ? row.servicePointsWonPct : null;
  return {
    ...row,
    opponent: row.playerName,
    opponentIoc: row.ioc,
    gamesWon: row.gamesLost,
    aces: row.opponentAces,
    breakPointsConverted:
      faced != null && saved != null ? Math.max(0, faced - saved) : row.breakPointsConverted,
    returnPointsWonPct: spw != null ? 100 - spw : row.returnPointsWonPct,
  };
}

function dvpMean(bucket: DvpBucket | undefined, key: string): number | null {
  const cell = bucket?.sums[key];
  if (!cell || cell.n <= 0) return null;
  return Math.round((cell.sum / cell.n) * 10) / 10;
}

function dvpRanks(
  values: Array<{ id: string; value: number }>,
  descending = false
): Map<string, number> {
  const sorted = [...values].sort(
    (a, b) => (descending ? b.value - a.value : a.value - b.value) || a.id.localeCompare(b.id)
  );
  const out = new Map<string, number>();
  sorted.forEach((row, idx) => out.set(row.id, idx + 1));
  return out;
}

function matchDateKey(row: TennisMatchRow): string {
  return String(row.date || row.tourneyDate || '');
}

function normalizeTourneyLabel(name: string | null | undefined): string {
  return tennisEventPlaceCore(name);
}

function scoreTourneyName(query: string, candidate: string): number {
  const q = normalizeTourneyLabel(query);
  const c = normalizeTourneyLabel(candidate);
  if (!q || !c) return 0;
  if (q === c) return 100;
  if (c.includes(q) || q.includes(c)) return 80;
  const qTokens = q.split(' ').filter((t) => t.length > 2);
  if (!qTokens.length) return 0;
  const cSet = new Set(c.split(' ').filter((t) => t.length > 2));
  let hits = 0;
  for (const t of qTokens) if (cSet.has(t)) hits++;
  if (hits === qTokens.length) return 70;
  return hits * 18;
}

function isQualifyingRound(round: string | null | undefined, tourneyName?: string | null): boolean {
  return isTennisQualifyingLabel(round, tourneyName);
}

function firstMainDrawDate(matches: TennisMatchRow[]): string | null {
  let first: string | null = null;
  for (const row of matches) {
    const round = String(row.round || '').toUpperCase();
    if (round !== 'R128' && round !== 'R64' && round !== 'R32') continue;
    const date = matchDateKey(row);
    if (!date) continue;
    if (!first || date < first) first = date;
  }
  return first;
}

function isQualifyingMatch(row: TennisMatchRow, firstMainDate: string | null): boolean {
  if (isQualifyingRound(row.round, row.tourneyName)) return true;
  if (!firstMainDate) return false;
  const date = matchDateKey(row);
  const round = String(row.round || '').toUpperCase();
  return Boolean(date && date < firstMainDate && (round === 'QF' || round === 'SF' || round === 'F'));
}

function inferDrawFromRounds(rounds: Iterable<string>): number {
  let best = 0;
  for (const round of rounds) {
    if (isQualifyingRound(round)) continue;
    const key = String(round || '').toUpperCase().trim();
    if (key === 'R128') best = Math.max(best, 128);
    else if (key === 'R64') best = Math.max(best, 64);
    else if (key === 'R32') best = Math.max(best, 32);
    else if (key === 'R16') best = Math.max(best, 16);
    else if (key === 'QF') best = Math.max(best, 8);
    else if (key === 'SF') best = Math.max(best, 4);
    else if (key === 'F') best = Math.max(best, 2);
  }
  return best;
}

function sliceDvpWindow(rows: TennisMatchRow[], window: TennisDvpWindow, year: number): TennisMatchRow[] {
  if (window === 'season') return rows.filter((row) => row.season === year);
  const n = window === 'last5' ? 5 : 10;
  return rows.slice(0, n);
}

function filterDvpRowsByBestOf(rows: TennisMatchRow[], bestOf: TennisDvpBestOf): TennisMatchRow[] {
  return rows.filter((row) => resolveTennisMatchBestOf(row) === bestOf);
}

function pushIndexedMatch(map: Map<string, TennisMatchRow[]>, id: string, row: TennisMatchRow) {
  const key = String(id || '').trim();
  if (!key) return;
  const list = map.get(key);
  if (list) list.push(row);
  else map.set(key, [row]);
}

function buildTourMatchIndex(tour: TennisTour): CachedTourMatchIndex {
  const matches = loadTennisMatches().filter((row) => row.tour === tour);
  const byPlayerId = new Map<string, TennisMatchRow[]>();
  const byOpponentId = new Map<string, TennisMatchRow[]>();
  const grouped = new Map<string, TourneyGroup>();
  for (const row of matches) {
    pushIndexedMatch(byPlayerId, row.playerId, row);
    pushIndexedMatch(byOpponentId, row.opponentId, row);
    const tourneyId = String(row.tourneyId || '').trim();
    const nameKey = normalizeTourneyLabel(row.tourneyName) || 'unknown';
    const key = tourneyId ? `${row.season}|id:${tourneyId}` : `${row.season}|name:${nameKey}`;
    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        tourneyId,
        tourneyName: row.tourneyName || nameKey,
        season: row.season,
        latestDate: matchDateKey(row),
        drawSize: typeof row.drawSize === 'number' && row.drawSize > 0 ? row.drawSize : 0,
        playerIds: new Set<string>(),
        qualifyingPlayerIds: new Set<string>(),
        matches: [],
      };
      grouped.set(key, group);
    }
    group.matches.push(row);
    const date = matchDateKey(row);
    if (date > group.latestDate) {
      group.latestDate = date;
      if (row.tourneyName) group.tourneyName = row.tourneyName;
    }
    if (typeof row.drawSize === 'number' && row.drawSize > group.drawSize) group.drawSize = row.drawSize;
  }
  for (const group of grouped.values()) {
    const firstMain = firstMainDrawDate(group.matches);
    for (const row of group.matches) {
      const ids = isQualifyingMatch(row, firstMain) ? group.qualifyingPlayerIds : group.playerIds;
      if (row.playerId) ids.add(row.playerId);
      if (row.opponentId) ids.add(row.opponentId);
    }
    if (!group.playerIds.size && !group.qualifyingPlayerIds.size) {
      for (const row of group.matches) {
        const ids = isQualifyingRound(row.round, row.tourneyName)
          ? group.qualifyingPlayerIds
          : group.playerIds;
        if (row.playerId) ids.add(row.playerId);
        if (row.opponentId) ids.add(row.opponentId);
      }
    }
    group.drawSize = Math.max(
      group.drawSize,
      inferDrawFromRounds(
        group.matches.filter((row) => !isQualifyingMatch(row, firstMain)).map((row) => row.round)
      )
    );
  }
  for (const list of byPlayerId.values()) list.sort((a, b) => matchDateKey(b).localeCompare(matchDateKey(a)));
  for (const list of byOpponentId.values()) list.sort((a, b) => matchDateKey(b).localeCompare(matchDateKey(a)));
  const groups = [...grouped.values()].sort((a, b) => b.latestDate.localeCompare(a.latestDate));
  return { byPlayerId, byOpponentId, groups };
}

function emptyTourMatchIndex(): CachedTourMatchIndex {
  return { byPlayerId: new Map(), byOpponentId: new Map(), groups: [] };
}

function tourMatchIndex(tour: TennisTour): CachedTourMatchIndex {
  const runtime = dataRuntime();
  const cached = runtime.dvpTours.get(tour);
  if (cached) return cached;
  const index = buildTourMatchIndex(tour);
  runtime.dvpTours.set(tour, index);
  return index;
}

function resolveTourneyGroup(
  index: CachedTourMatchIndex,
  opts: {
    year: number;
    tournamentName?: string | null;
    tournamentKey?: string | null;
    opponentId?: string | null;
    opponentName?: string | null;
    liveTournamentKeys?: Set<string>;
  }
): TourneyGroup | null {
  const liveKeys = opts.liveTournamentKeys;
  const groups = liveKeys?.size
    ? index.groups.filter((g) => g.season === opts.year && g.tourneyId && liveKeys.has(g.tourneyId))
    : [];
  const key = String(opts.tournamentKey || '').trim();
  if (key) {
    const byId =
      groups.find((g) => g.tourneyId === key) ||
      index.groups.find((g) => g.tourneyId === key && g.season === opts.year);
    return byId || null;
  }
  const opponentId = String(opts.opponentId || '').trim();
  const opponentName = normDvpName(opts.opponentName);
  const query = String(opts.tournamentName || '').trim();
  if (query) {
    let best: TourneyGroup | null = null;
    let bestScore = 0;
    const pool = groups.length ? groups : index.groups.filter((g) => g.season === opts.year);
    for (const group of pool) {
      if (liveKeys?.size && group.tourneyId && !liveKeys.has(group.tourneyId)) continue;
      let score = Math.max(scoreTourneyName(query, group.tourneyName), scoreTourneyName(query, group.tourneyId));
      if (group.season === opts.year) score += 8;
      if (opponentId && group.playerIds.has(opponentId)) score += 24;
      else if (opponentName) {
        const played = group.matches.some(
          (row) => normDvpName(row.playerName) === opponentName || normDvpName(row.opponent) === opponentName
        );
        if (played) score += 24;
      }
      if (
        score > bestScore ||
        (score === bestScore &&
          best &&
          (group.playerIds.size > best.playerIds.size ||
            (group.playerIds.size === best.playerIds.size && group.latestDate > best.latestDate)))
      ) {
        bestScore = score;
        best = group;
      }
    }
    if (best && bestScore >= 70) return best;
  }
  return null;
}

function dvpFieldCap(
  tournamentName: string | null | undefined,
  group: TourneyGroup | null,
  stage: TennisDvpStage
): number {
  const name = `${tournamentName || ''} ${group?.tourneyName || ''}`.toLowerCase();
  const inferred = group
    ? inferDrawFromRounds(
        group.matches.filter((row) => !isQualifyingRound(row.round, row.tourneyName)).map((row) => row.round)
      )
    : 0;
  const slam =
    group?.matches.some((row) => row.isGrandSlam) ||
    isApiGrandSlam(name) ||
    inferred >= 128 ||
    group?.matches.some((row) => String(row.round || '').toUpperCase() === 'R128');
  if (stage === 'qualifying') return slam ? 128 : 32;
  if (slam) return 128;
  if (
    inferred >= 96 ||
    /\b(masters|1000|indian wells|miami open|monte[- ]?carlo|madrid|rome|canada masters|cincinnati|shanghai|paris masters)\b/.test(
      name
    )
  ) {
    return 96;
  }
  if (inferred >= 64) return 64;
  return 32;
}

function completeDrawSize(n: number, cap: number): number {
  if (n <= 0) return n;
  if ((cap === 32 || cap === 64 || cap === 96 || cap === 128) && n === cap - 1) return cap;
  return n;
}

function trimDvpField(
  fieldIds: string[],
  cap: number,
  mustKeep: Iterable<string | null | undefined>,
  preferred: Iterable<string>,
  rankedById: Map<string, TennisRankingRow>,
  rosterById: Map<string, TennisPlayer>
): string[] {
  const unique = [...new Set(fieldIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (unique.length <= cap) return unique;
  const keep = new Set([...mustKeep].map((id) => String(id || '').trim()).filter(Boolean));
  const prefer = new Set([...preferred].map((id) => String(id || '').trim()).filter(Boolean));
  const rankOf = (id: string) => rankedById.get(id)?.pos ?? rosterById.get(id)?.rank ?? 9999;
  const locked = unique.filter((id) => keep.has(id));
  const alive = unique.filter((id) => !keep.has(id) && prefer.has(id)).sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  const rest = unique.filter((id) => !keep.has(id) && !prefer.has(id)).sort((a, b) => rankOf(a) - rankOf(b) || a.localeCompare(b));
  return [...locked, ...alive, ...rest].slice(0, Math.max(cap, locked.length));
}

function emptyDvpProfile(opts: {
  tour: TennisTour;
  year: number;
  window: TennisDvpWindow;
  stage?: TennisDvpStage;
  tournamentName?: string | null;
  tournamentKey?: string | null;
}): TennisDvpProfile {
  const stage: TennisDvpStage = opts.stage === 'qualifying' ? 'qualifying' : 'main';
  const bestOf = tennisDvpTournamentBestOf({
    tour: opts.tour,
    stage,
    tournamentName: opts.tournamentName,
  });
  return {
    tour: opts.tour,
    year: opts.year,
    window: opts.window,
    stage,
    bestOf,
    tournamentName:
      stage === 'qualifying'
        ? tennisQualifyingEventLabel(opts.tournamentName)
        : String(opts.tournamentName || '').trim() || null,
    tournamentKey: String(opts.tournamentKey || '').trim() || null,
    fieldSize: 0,
    opponent: null,
    opponents: [],
    topSeed: null,
    metrics: TENNIS_DVP_METRICS.map((metric) => ({
      key: metric.key,
      label: metric.label,
      pct: metric.pct,
      value: null,
      rank: null,
      matches: 0,
      fieldSize: 0,
    })),
  };
}

function playersFromExtraMatches(rows: TennisMatchRow[] | undefined): TennisPlayer[] {
  const byId = new Map<string, TennisPlayer>();
  const upsert = (
    id: string,
    name: string,
    tour: TennisTour,
    ioc: string | null,
    rank: number | null,
    rankPoints: number | null
  ) => {
    const playerId = String(id || '').trim();
    if (!playerId) return;
    const human = humanTennisDvpName(name);
    const existing = byId.get(playerId);
    if (existing) {
      if (human && isNumericTennisId(existing.name)) existing.name = human;
      else if (human && !existing.name) existing.name = human;
      if (!existing.ioc && ioc) existing.ioc = ioc;
      if (existing.rank == null && rank != null) existing.rank = rank;
      if (existing.rankPoints == null && rankPoints != null) existing.rankPoints = rankPoints;
      return;
    }
    byId.set(playerId, {
      playerId,
      name: human || String(name || '').trim() || playerId,
      tour,
      ioc,
      hand: null,
      height: null,
      rank,
      rankPoints,
    });
  };
  for (const row of rows || []) {
    upsert(row.playerId, row.playerName, row.tour, row.ioc, row.playerRank, row.rankPoints);
    upsert(row.opponentId, row.opponent, row.tour, row.opponentIoc, row.opponentRank, row.opponentRankPoints);
  }
  return [...byId.values()];
}

function bucketsFromRows(rows: TennisMatchRow[], fieldId: string, kind: 'allowed' | 'own'): DvpBucket {
  const bucket = emptyDvpBucket('', null, '');
  for (const row of rows) {
    const nextName = kind === 'allowed' ? row.opponent : row.playerName;
    const nextIoc = kind === 'allowed' ? row.opponentIoc : row.ioc;
    const human = humanTennisDvpName(nextName);
    if (human) bucket.name = human;
    if (nextIoc) bucket.ioc = nextIoc;
    bucket.matches += 1;
    const date = matchDateKey(row);
    if (date >= bucket.date) bucket.date = date;
    for (const metric of TENNIS_DVP_METRICS) {
      if (metric.source === 'own' && kind !== 'own') continue;
      if (metric.source === 'allowed' && kind !== 'allowed') continue;
      const fieldKey = metric.key === 'oppGamesWon' ? 'gamesWon' : metric.key;
      const raw =
        fieldKey === 'totalGames' &&
        (typeof row.totalGames !== 'number' || !Number.isFinite(row.totalGames)) &&
        typeof row.gamesWon === 'number' &&
        typeof row.gamesLost === 'number'
          ? row.gamesWon + row.gamesLost
          : row[fieldKey as keyof TennisMatchRow];
      addDvpValue(bucket, metric.key, raw);
    }
  }
  if (!humanTennisDvpName(bucket.name)) bucket.name = fieldId;
  return bucket;
}

export type TennisDvpOpponent = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
  seed: number | null;
  drawRank: number | null;
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
  window: TennisDvpWindow;
  stage: TennisDvpStage;
  bestOf: TennisDvpBestOf;
  tournamentName: string | null;
  tournamentKey: string | null;
  fieldSize: number;
  opponent: TennisDvpOpponent | null;
  opponents: TennisDvpOpponent[];
  topSeed: TennisDvpOpponent | null;
  metrics: TennisDvpMetricRow[];
  field?: Array<TennisDvpOpponent & { metrics: TennisDvpMetricRow[] }>;
  windows?: Partial<Record<TennisDvpWindow, Array<TennisDvpOpponent & { metrics: TennisDvpMetricRow[] }>>>;
};

/** Per-live-tournament allowed rates, ranked among everyone who played this event (not just who is still alive). */
export function tennisDvpProfile(opts: {
  tour: TennisTour;
  year?: number;
  opponentName?: string | null;
  opponentId?: string | null;
  playerName?: string | null;
  playerId?: string | null;
  tournamentName?: string | null;
  tournamentKey?: string | null;
  window?: TennisDvpWindow;
  extraPlayerIds?: string[];
  extraMatches?: TennisMatchRow[];
  extraPlayers?: TennisPlayer[];
  liveTournamentKeys?: Iterable<string>;
  liveTournamentNames?: Iterable<string>;
  activeOnly?: boolean;
  includeField?: boolean;
  includeAllWindows?: boolean;
  stage?: TennisDvpStage;
  skipOverlay?: boolean;
}): TennisDvpProfile {
  const tour = opts.tour;
  const year = opts.year && opts.year >= 2000 ? opts.year : TENNIS_CURRENT_YEAR;
  const window: TennisDvpWindow = opts.window === 'last5' || opts.window === 'season' ? opts.window : 'last10';
  const stage: TennisDvpStage =
    opts.stage === 'main' || opts.stage === 'qualifying'
      ? opts.stage
      : isTennisQualifyingLabel(null, opts.tournamentName)
        ? 'qualifying'
        : 'main';
  const extraPlayerIds = (opts.extraPlayerIds || []).map((id) => String(id || '').trim()).filter(Boolean);
  const liveKeys = new Set(
    [...(opts.liveTournamentKeys || [])].map((id) => String(id || '').trim()).filter(Boolean)
  );
  const liveNames = [...(opts.liveTournamentNames || [])]
    .map((name) => tennisEventPlaceCore(name))
    .filter(Boolean);
  const key = String(opts.tournamentKey || '').trim();
  const place = tennisEventPlaceCore(opts.tournamentName);
  const nameIsLive = Boolean(place) && liveNames.some((name) => name === place);
  const isLive = extraPlayerIds.length > 0 || (key ? liveKeys.has(key) : nameIsLive);
  if (opts.activeOnly !== false && !isLive) {
    return emptyDvpProfile({
      tour,
      year,
      window,
      stage,
      tournamentName: opts.tournamentName,
      tournamentKey: opts.tournamentKey,
    });
  }
  const index = opts.skipOverlay ? emptyTourMatchIndex() : tourMatchIndex(tour);
  const extraLookup = extraMatchLookup(opts.extraMatches);
  const extraPlayers = [...(opts.extraPlayers || []), ...playersFromExtraMatches(opts.extraMatches)];
  const ranked = opts.skipOverlay
    ? extraPlayers
        .filter((player) => player.tour === tour && player.rank != null)
        .map((player) => ({
          pos: Number(player.rank),
          playerId: player.playerId,
          name: player.name,
          tour: player.tour,
          points: player.rankPoints ?? null,
          ioc: player.ioc ?? null,
        }))
    : loadTennisRankings(tour, { limit: 500 });
  const roster = opts.skipOverlay ? extraPlayers : loadTennisPlayers();
  const rosterById = new Map(roster.map((p) => [p.playerId, p]));
  for (const player of extraPlayers) {
    const existing = rosterById.get(player.playerId);
    if (!existing) {
      rosterById.set(player.playerId, player);
      continue;
    }
    if (humanTennisDvpName(player.name) && isNumericTennisId(existing.name)) {
      rosterById.set(player.playerId, { ...existing, name: player.name, ioc: player.ioc ?? existing.ioc });
    }
  }
  const rankedById = new Map(ranked.map((p) => [p.playerId, p]));
  const group = resolveTourneyGroup(index, {
    year,
    tournamentName: opts.tournamentName,
    tournamentKey: opts.tournamentKey,
    opponentId: opts.opponentId,
    opponentName: opts.opponentName,
    liveTournamentKeys: liveKeys,
  });
  const liveField = extraPlayerIds.length > 0;
  const groupMatchesLive =
    Boolean(key && group?.tourneyId && group.tourneyId === key) ||
    Boolean(place && group && scoreTourneyName(place, group.tourneyName) >= 70);
  const fieldSet = new Set<string>();
  if (liveField) {
    for (const id of extraPlayerIds) fieldSet.add(id);
  } else if (group) {
    for (const id of stage === 'qualifying' ? group.qualifyingPlayerIds : group.playerIds) {
      fieldSet.add(id);
    }
  }
  if (liveField && groupMatchesLive && group) {
    for (const id of stage === 'qualifying' ? group.qualifyingPlayerIds : group.playerIds) {
      fieldSet.add(id);
    }
  }
  const seedOpponentId =
    String(opts.opponentId || '').trim() ||
    findDvpPlayerId(String(opts.opponentName || ''), new Map(), ranked, extraPlayers);
  const seedPlayerId =
    String(opts.playerId || '').trim() ||
    findDvpPlayerId(String(opts.playerName || ''), new Map(), ranked, extraPlayers);
  if (seedOpponentId) fieldSet.add(seedOpponentId);
  if (seedPlayerId) fieldSet.add(seedPlayerId);

  const cap = dvpFieldCap(opts.tournamentName, group, stage);
  // Live slates (Davis Cup especially) can have more than 32 nominated players.
  // Never drop someone who is actually in this event just to fit a draw cap —
  // that is what left props DVP as N/A for the lower-ranked opponent.
  const fieldIds = trimDvpField(
    [...fieldSet],
    cap,
    liveField ? [seedOpponentId, seedPlayerId, ...extraPlayerIds] : [seedOpponentId, seedPlayerId],
    extraPlayerIds,
    rankedById,
    rosterById
  );
  const slam =
    Boolean(group?.matches.some((row) => row.isGrandSlam)) || isApiGrandSlam(opts.tournamentName);
  const bestOf = tennisDvpTournamentBestOf({
    tour,
    stage,
    tournamentName: opts.tournamentName || group?.tourneyName,
    isGrandSlam: slam,
  });
  const preparedById = new Map<string, { ownRows: TennisMatchRow[]; vsRows: TennisMatchRow[] }>();
  const preparedRowsFor = (id: string) => {
    const hit = preparedById.get(id);
    if (hit) return hit;
    const overlayOwn = index.byPlayerId.get(id) || [];
    const overlayVs = index.byOpponentId.get(id) || [];
    const extraOwn = extraLookup.byPlayerId.get(id) || [];
    const extraVs = extraLookup.byOpponentId.get(id) || [];
    const mergedOwn = mergeDvpMatchRows(overlayOwn, extraOwn);
    const mergedVs = mergeDvpMatchRows(overlayVs, extraVs);
    const next = {
      ownRows: filterDvpRowsByBestOf(
        opts.skipOverlay ? mergedOwn : prepareMatchRows(mergedOwn),
        bestOf
      ),
      vsRows: filterDvpRowsByBestOf(
        opts.skipOverlay ? mergedVs : prepareMatchRows(mergedVs),
        bestOf
      ),
    };
    preparedById.set(id, next);
    return next;
  };
  const allowed = new Map<string, DvpBucket>();
  const own = new Map<string, DvpBucket>();
  const fillBuckets = (id: string, forWindow: TennisDvpWindow = window) => {
    const { ownRows, vsRows } = preparedRowsFor(id);
    const ownSlice = sliceDvpWindow(ownRows.length ? ownRows : vsRows, forWindow, year);
    own.set(id, bucketsFromRows(ownSlice, id, 'own'));
    allowed.set(
      id,
      bucketsFromRows(
        ownRows.length ? ownSlice.map(toAllowedView) : sliceDvpWindow(vsRows, forWindow, year),
        id,
        'allowed'
      )
    );
  };
  for (const id of fieldIds) fillBuckets(id);

  const opponentId =
    String(opts.opponentId || '').trim() ||
    findDvpPlayerId(String(opts.opponentName || ''), allowed, ranked, extraPlayers);
  if (opponentId && !allowed.has(opponentId)) fillBuckets(opponentId);
  if (opponentId && !fieldIds.includes(opponentId)) {
    const next = trimDvpField(
      [...fieldIds, opponentId],
      cap,
      liveField ? [opponentId, seedPlayerId, ...extraPlayerIds] : [opponentId, seedPlayerId],
      extraPlayerIds,
      rankedById,
      rosterById
    );
    fieldIds.splice(0, fieldIds.length, ...next);
  }
  const fieldSize = completeDrawSize(fieldIds.length, cap);

  const opponentsUnseeded: TennisDvpOpponent[] = fieldIds
    .map((id) => {
      const rankedRow = rankedById.get(id);
      const rosterRow = rosterById.get(id);
      const bucket = allowed.get(id) || own.get(id);
      return {
        id,
        name:
          humanTennisDvpName(
            rankedRow?.name,
            rosterRow?.name,
            bucket?.name,
            id === seedOpponentId ? opts.opponentName : null
          ) || id,
        ioc: rankedRow?.ioc ?? rosterRow?.ioc ?? bucket?.ioc ?? null,
        rankPos: rankedRow?.pos ?? rosterRow?.rank ?? null,
        seed: null as number | null,
        drawRank: null as number | null,
      };
    })
    .sort(
      (a, b) =>
        (a.rankPos ?? 9999) - (b.rankPos ?? 9999) || a.name.localeCompare(b.name)
    );
  const seedById = tennisAssignDrawSeeds(opponentsUnseeded, {
    slam,
    stage,
    fieldSize: opponentsUnseeded.length || fieldSize,
  });
  const drawRankById = tennisAssignDrawRanks(opponentsUnseeded);
  const opponents: TennisDvpOpponent[] = opponentsUnseeded.map((row) => ({
    ...row,
    seed: seedById.get(row.id) ?? null,
    drawRank: drawRankById.get(row.id) ?? null,
  }));
  const topSeed = opponents.find((row) => row.seed === 1) || null;

  const metricBoards = TENNIS_DVP_METRICS.map((metric) => {
    const source = metric.source === 'own' ? own : allowed;
    const values: Array<{ id: string; value: number }> = [];
    for (const id of fieldIds) {
      const mean = dvpMean(source.get(id), metric.key);
      if (mean == null) continue;
      values.push({ id, value: mean });
    }
    return { metric, source, ranks: dvpRanks(values, metric.key === 'oppGamesWon') };
  });

  const rowFor = (id: string | null): TennisDvpMetricRow[] =>
    metricBoards.map(({ metric, source, ranks }) => {
      const selected = id ? source.get(id) : undefined;
      const opp = id ? opponents.find((row) => row.id === id) || null : null;
      return {
        key: metric.key,
        label: metric.label,
        pct: metric.pct,
        value: id ? dvpMean(selected, metric.key) : null,
        rank: id ? tennisFillMetricRank(ranks.get(id), opp) : null,
        matches: selected?.sums[metric.key]?.n || 0,
        fieldSize,
      };
    });

  const metrics = rowFor(opponentId);
  const fieldRows = opts.includeField
    ? opponents.map((row) => ({
        ...row,
        metrics: rowFor(row.id),
      }))
    : undefined;
  const windows =
    opts.includeAllWindows && opts.includeField
      ? Object.fromEntries(
          TENNIS_DVP_WINDOWS.map((nextWindow) => {
            if (nextWindow === window) return [nextWindow, fieldRows || []];
            const windowAllowed = new Map<string, DvpBucket>();
            const windowOwn = new Map<string, DvpBucket>();
            for (const id of fieldIds) {
              const { ownRows, vsRows } = preparedRowsFor(id);
              const ownSlice = sliceDvpWindow(ownRows.length ? ownRows : vsRows, nextWindow, year);
              windowOwn.set(id, bucketsFromRows(ownSlice, id, 'own'));
              windowAllowed.set(
                id,
                bucketsFromRows(
                  ownRows.length ? ownSlice.map(toAllowedView) : sliceDvpWindow(vsRows, nextWindow, year),
                  id,
                  'allowed'
                )
              );
            }
            const windowBoards = TENNIS_DVP_METRICS.map((metric) => {
              const source = metric.source === 'own' ? windowOwn : windowAllowed;
              const values: Array<{ id: string; value: number }> = [];
              for (const id of fieldIds) {
                const mean = dvpMean(source.get(id), metric.key);
                if (mean == null) continue;
                values.push({ id, value: mean });
              }
              return { metric, source, ranks: dvpRanks(values, metric.key === 'oppGamesWon') };
            });
            return [
              nextWindow,
              opponents.map((row) => ({
                ...row,
                metrics: windowBoards.map(({ metric, source, ranks }) => {
                  const selected = source.get(row.id);
                  return {
                    key: metric.key,
                    label: metric.label,
                    pct: metric.pct,
                    value: dvpMean(selected, metric.key),
                    rank: tennisFillMetricRank(ranks.get(row.id), row),
                    matches: selected?.sums[metric.key]?.n || 0,
                    fieldSize,
                  };
                }),
              })),
            ];
          })
        )
      : undefined;

  const opponent = opponentId
    ? opponents.find((p) => p.id === opponentId) || {
        id: opponentId,
        name:
          humanTennisDvpName(
            allowed.get(opponentId)?.name,
            own.get(opponentId)?.name,
            rosterById.get(opponentId)?.name,
            opts.opponentName
          ) || opponentId,
        ioc: allowed.get(opponentId)?.ioc || own.get(opponentId)?.ioc || rosterById.get(opponentId)?.ioc || null,
        rankPos: rankedById.get(opponentId)?.pos ?? rosterById.get(opponentId)?.rank ?? null,
        seed: seedById.get(opponentId) ?? null,
        drawRank: drawRankById.get(opponentId) ?? null,
      }
    : null;

  return {
    tour,
    year,
    window,
    stage,
    bestOf,
    tournamentName:
      stage === 'qualifying'
        ? tennisQualifyingEventLabel(String(opts.tournamentName || '').trim() || group?.tourneyName)
        : String(opts.tournamentName || '').trim() || (groupMatchesLive ? group?.tourneyName : null) || null,
    tournamentKey: key || (groupMatchesLive ? group?.tourneyId : null) || null,
    fieldSize,
    opponent,
    opponents,
    topSeed,
    metrics,
    field: fieldRows,
    windows,
  };
}
