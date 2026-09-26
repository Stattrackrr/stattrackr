/**
 * Tennis props-page list: one row per player / market / bookmaker,
 * then collapsed to one displayed line per market.
 * Same shape as AFL `/api/afl/player-props/list`.
 */

import sharedCache from '@/lib/sharedCache';
import { hydrateTennisMatchOverlay, getHydratedTennisOverlay } from '@/lib/tennis/ingest';
import { readTennisPlayerLogsCacheMany, readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import { loadPlayerMatchesCached, tennisLogsNeedHistory } from '@/lib/tennis/loadCached';
import { upsertCombinedSnapshotTennisFromList } from '@/lib/combinedPropsSnapshotPaint';
import { tennisMatchesPlayed } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR, loadPlayerMatches, loadTennisPlayers, tennisDvpProfile } from '@/lib/tennis/data';
import {
  ensureTennisDvpBoardRanks,
  findCachedTennisDvpEvent,
  readTennisDvpLiveStore,
  type TennisCachedDvpEvent,
} from '@/lib/tennis/dvpLiveCache';
import { attachTennisHeadshots, resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import {
  listTennisOddsIndex,
  readTennisOddsSnapshot,
  type TennisOddsIndexMatch,
  type TennisOddsSnapshot,
} from '@/lib/tennis/odds';
import {
  listLiveTennisEventIndex,
  listUniqueUpcomingTennisGames,
  tennisUpcomingTipoffFor,
  tennisLiveEventPlayerIds,
  tennisLiveEventStage,
  findLiveTennisEvent,
  findLiveTennisEventForPlayers,
  peekLiveTennisEventIndex,
  listUpcomingTennisByPlayer,
  type TennisNextGame,
} from '@/lib/tennis/nextGame';
import {
  readOddsApiTennisCatalog,
  tennisIdentityMatch,
  tennisNamesMatch,
  tennisTourFromOdds,
} from '@/lib/tennis/oddsApi';
import { resolveTennisIoc } from '@/lib/tennis/resolveIoc';
import {
  tennisMainLineForStat,
  tennisMoneylinePriceMeetsMin,
  tennisValueHitsOver,
  type TennisBookRow,
  type TennisOuLine,
} from '@/lib/tennis/oddsTypes';
import { collapseTennisRowsToPrimaryMarketLine } from '@/lib/tennis/propsMarketCollapse';
import {
  TENNIS_DVP_METRICS,
  tennisDvpTournamentBestOf,
  tennisLiveFieldRank,
  tennisPositiveRank,
  type TennisDvpMetricKey,
} from '@/lib/tennis/dvpShared';
import { tennisAssignDrawRanks, tennisAssignDrawSeeds } from '@/lib/tennis/seeds';
import { lookupTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';
import {
  TENNIS_LIST_CACHE_KEY,
  readTennisPlayerPropsListCache,
  writeTennisPlayerPropsListCache,
} from '@/lib/tennis/playerPropsListCache';

export { TENNIS_LIST_CACHE_KEY } from '@/lib/tennis/playerPropsListCache';

export const TENNIS_USER_NO_ODDS = 'No odds available. Come back later.';

export async function invalidateTennisPlayerPropsList(): Promise<void> {
  await Promise.allSettled([
    sharedCache.deleteJSON(TENNIS_LIST_CACHE_KEY),
    sharedCache.deleteJSON('tennis_props_empty_atp_v1'),
    sharedCache.deleteJSON('tennis_props_empty_wta_v1'),
    sharedCache.deleteJSON('tennis_props_empty_all_v1'),
  ]);
}

export const TENNIS_PROP_STATS = [
  'moneyline',
  'spread',
  'totalGames',
  'gamesWon',
  'gamesLost',
  'totalSets',
] as const;

export type TennisPropStat = (typeof TENNIS_PROP_STATS)[number];

export type TennisListGame = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  tournamentName?: string | null;
  surface?: string | null;
};

export type TennisListPropRow = {
  gameId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  playerName: string;
  playerId?: string | null;
  playerTeam?: string | null;
  opponent?: string | null;
  opponentId?: string | null;
  playerIoc?: string | null;
  playerRank?: number | null;
  opponentIoc?: string | null;
  opponentRank?: number | null;
  playerSeed?: number | null;
  opponentSeed?: number | null;
  playerDrawRank?: number | null;
  opponentDrawRank?: number | null;
  tournamentName?: string | null;
  surface?: string | null;
  homeTeamCode?: string | null;
  awayTeamCode?: string | null;
  homeTeamLogo?: string | null;
  awayTeamLogo?: string | null;
  statType: string;
  line: number;
  overOdds: string;
  underOdds: string;
  bookmaker: string;
  last5Avg?: number | null;
  last10Avg?: number | null;
  seasonAvg?: number | null;
  last5HitRate?: { hits: number; total: number } | null;
  last10HitRate?: { hits: number; total: number } | null;
  seasonHitRate?: { hits: number; total: number } | null;
  streak?: number | null;
  h2hAvg?: number | null;
  h2hHitRate?: { hits: number; total: number } | null;
  headshotUrl?: string | null;
  dvpRating?: number | null;
  dvpStatValue?: number | null;
  dvpFieldSize?: number | null;
};

export type TennisPlayerPropsListPayload = {
  success: boolean;
  data: TennisListPropRow[];
  games: TennisListGame[];
  propsCount: number;
  gamesCount: number;
  lastUpdated: string | null;
  nextUpdate: string | null;
  noTennisOdds: boolean;
  noAflOdds: boolean;
  ingestMessage: string | null;
};

function tourLogo(tour: string | null | undefined): string | null {
  const t = String(tour || '').toUpperCase();
  if (t === 'WTA') return '/images/wta-logo.png';
  if (t === 'ATP') return '/images/atp-logo.webp';
  return '/images/atp-logo.webp';
}

function parseLineNumber(raw: string | number | null | undefined): number | null {
  const n = Number.parseFloat(String(raw ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function oddsPresent(value: string | undefined): boolean {
  const v = String(value || '').trim();
  return Boolean(v) && v !== 'N/A';
}

function tennisListHasFormStats(rows: TennisListPropRow[] | null | undefined): boolean {
  const list = rows || [];
  if (!list.length) return false;
  const withStats = list.filter(
    (row) =>
      row.last10Avg != null ||
      row.last5Avg != null ||
      row.seasonAvg != null ||
      row.h2hAvg != null
  ).length;
  return withStats >= Math.max(1, Math.ceil(list.length * 0.15));
}

function matchesInFormWindow(rows: TennisMatchRow[]): TennisMatchRow[] {
  const sorted = [...rows].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  const recent = sorted.filter((row) => {
    const season = Number(row.season);
    return season === TENNIS_CURRENT_YEAR || season === TENNIS_CURRENT_YEAR - 1;
  });
  return recent.length ? recent : sorted.slice(-40);
}

async function readUsableTennisListCache(): Promise<TennisPlayerPropsListPayload | null> {
  const cached = (await readTennisPlayerPropsListCache()) as TennisPlayerPropsListPayload | null;
  if (cached?.data?.length) return cached;
  return null;
}

function avg(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, n) => sum + n, 0) / values.length) * 10) / 10;
}

function hitRate(
  stat: TennisPropStat,
  values: number[],
  line: number,
  over: boolean
): { hits: number; total: number } | null {
  const usable = values.filter((n) => Number.isFinite(n));
  if (!usable.length) return null;
  const hits = usable.filter((n) => {
    const hitOver = tennisValueHitsOver(stat, n, line);
    return over ? hitOver : !hitOver;
  }).length;
  return { hits, total: usable.length };
}

function streakOver(stat: TennisPropStat, values: number[], line: number): number | null {
  if (!values.length) return null;
  let n = 0;
  const newestFirst = [...values].reverse();
  const firstOver = tennisValueHitsOver(stat, newestFirst[0]!, line);
  for (const value of newestFirst) {
    if (tennisValueHitsOver(stat, value, line) === firstOver) n += firstOver ? 1 : -1;
    else break;
  }
  return n;
}

function statValue(row: TennisMatchRow, stat: TennisPropStat): number | null {
  if (stat === 'moneyline') return row.isWin ? 1 : 0;
  if (stat === 'spread') return row.spread;
  if (stat === 'totalGames') return row.totalGames;
  if (stat === 'gamesWon') return row.gamesWon;
  if (stat === 'gamesLost') return row.gamesLost;
  if (stat === 'totalSets') return row.totalSets;
  return null;
}

function recentValues(rows: TennisMatchRow[], stat: TennisPropStat, n: number): number[] {
  return rows
    .slice(-n)
    .map((row) => statValue(row, stat))
    .filter((v): v is number => v != null && Number.isFinite(v));
}

type PlayerMeta = {
  playerId: string;
  tour: TennisTour;
  name: string;
  imageUrl: string | null;
  ioc: string | null;
  rank: number | null;
};

type DvpFields = {
  dvpRating: number | null;
  dvpStatValue: number | null;
  dvpFieldSize: number | null;
};

function dvpMetricForStat(stat: TennisPropStat): TennisDvpMetricKey {
  if (stat === 'gamesWon') return 'oppGamesWon';
  if (stat === 'gamesLost') return 'gamesWon';
  return 'totalGames';
}

function asTennisPropStat(statType: string): TennisPropStat | null {
  return (TENNIS_PROP_STATS as readonly string[]).includes(statType)
    ? (statType as TennisPropStat)
    : null;
}

function liveFieldRank(opp: {
  drawRank?: number | null;
  seed?: number | null;
  rankPos?: number | null;
}): number | null {
  return tennisLiveFieldRank(opp);
}

/** Same last-10 ranks the dashboard DVP card shows for this opponent. */
function dashboardDvpFieldsForStat(
  stat: TennisPropStat,
  opp: {
    drawRank?: number | null;
    seed?: number | null;
    rankPos?: number | null;
    metrics?: Array<{
      key: string;
      rank: number | null;
      value: number | null;
      fieldSize?: number | null;
    }>;
  } | null,
  fieldSize: number | null
): DvpFields | null {
  if (!opp) return null;
  const fallbackRank = liveFieldRank(opp);
  if (stat === 'moneyline') {
    if (fallbackRank == null) return null;
    return {
      dvpRating: fallbackRank,
      dvpStatValue: opp.rankPos ?? null,
      dvpFieldSize: fieldSize,
    };
  }
  const metricKey = dvpMetricForStat(stat);
  const metric = opp.metrics?.find((item) => item.key === metricKey);
  const metricRank = tennisPositiveRank(metric?.rank);
  if (metricRank != null) {
    return {
      dvpRating: metricRank,
      dvpStatValue: metric?.value ?? null,
      dvpFieldSize: metric?.fieldSize ?? fieldSize,
    };
  }
  if (fallbackRank == null) {
    return metric ? { dvpRating: null, dvpStatValue: null, dvpFieldSize: fieldSize } : null;
  }
  return {
    dvpRating: fallbackRank,
    dvpStatValue: metric?.value ?? opp.rankPos ?? null,
    dvpFieldSize: metric?.fieldSize ?? fieldSize,
  };
}

function isH2hMatch(row: TennisMatchRow, opponentName: string, opponentId: string | null): boolean {
  if (opponentId && row.opponentId && String(row.opponentId) === String(opponentId)) return true;
  return tennisNamesMatch(row.opponent, opponentName);
}

function inferMatchTour(
  snapshot: TennisOddsSnapshot,
  homeMeta: PlayerMeta | null,
  awayMeta: PlayerMeta | null
): TennisTour {
  const keyBlob = `${snapshot.sportKey || ''} ${snapshot.tournamentName || ''}`.toLowerCase();
  if (keyBlob.includes('wta') || keyBlob.includes('atp')) {
    return tennisTourFromOdds(snapshot.sportKey, snapshot.tournamentName);
  }
  if (homeMeta?.tour && homeMeta.tour === awayMeta?.tour) return homeMeta.tour;
  if (homeMeta?.tour === 'ATP' || awayMeta?.tour === 'ATP') return 'ATP';
  if (homeMeta?.tour === 'WTA' || awayMeta?.tour === 'WTA') return 'WTA';
  const snapTour = String(snapshot.tour || '').toUpperCase();
  if (snapTour === 'WTA' || snapTour === 'ATP') return snapTour;
  return tennisTourFromOdds(snapshot.sportKey, snapshot.tournamentName);
}

function buildPlayerLookup(players: PlayerMeta[]) {
  const byName = new Map<string, PlayerMeta>();
  for (const player of players) {
    byName.set(player.name.toLowerCase().trim(), player);
  }
  return {
    find(name: string, tour?: TennisTour | null): PlayerMeta | null {
      const key = name.toLowerCase().trim();
      if (!key) return null;
      const exact = byName.get(key);
      const identityHits = players.filter((player) => tennisIdentityMatch(player.name, name));
      const scoped = tour ? identityHits.filter((player) => player.tour === tour) : identityHits;
      const pool = scoped.length ? scoped : identityHits;
      const ranked = pool
        .filter((player) => player.rank != null)
        .sort((a, b) => (a.rank ?? 99999) - (b.rank ?? 99999));
      if (ranked.length) return ranked[0];
      if (pool.length === 1) return pool[0];
      if (exact && (!tour || exact.tour === tour)) return exact;
      return exact ?? null;
    },
  };
}

function orientBooks(books: TennisBookRow[], playerIsHome: boolean): TennisBookRow[] {
  if (playerIsHome) return books;
  return books.map((book) => ({
    ...book,
    H2H: { home: book.H2H.away, away: book.H2H.home },
    Spread: flipOu(book.Spread),
    GamesWon: book.GamesLost,
    GamesLost: book.GamesWon,
    SpreadLines: (book.SpreadLines || []).map(flipOu),
    GamesWonLines: book.GamesLostLines || [],
    GamesLostLines: book.GamesWonLines || [],
  }));
}

function flipOu(line: TennisOuLine): TennisOuLine {
  const n = parseLineNumber(line.line);
  if (n == null) return line;
  return { line: String(-n), over: line.under, under: line.over };
}

function rowsForBook(opts: {
  game: TennisListGame;
  playerName: string;
  playerId: string | null;
  tour: string | null;
  opponent: string;
  opponentId: string | null;
  playerIoc: string | null;
  playerRank: number | null;
  opponentIoc: string | null;
  opponentRank: number | null;
  playerSeed: number | null;
  opponentSeed: number | null;
  playerDrawRank: number | null;
  opponentDrawRank: number | null;
  book: TennisBookRow;
  playerIsHome: boolean;
  recentMatches: TennisMatchRow[];
  h2hRows: TennisMatchRow[];
  headshotUrl: string | null;
  dvpFor: (stat: TennisPropStat) => DvpFields;
}): TennisListPropRow[] {
  const {
    game,
    playerName,
    playerId,
    tour,
    opponent,
    opponentId,
    playerIoc,
    playerRank,
    opponentIoc,
    opponentRank,
    playerSeed,
    opponentSeed,
    playerDrawRank,
    opponentDrawRank,
    book,
    recentMatches,
    h2hRows,
    headshotUrl,
    dvpFor,
  } = opts;
  const identity = {
    playerIoc,
    playerRank,
    opponentId,
    opponentIoc,
    opponentRank,
    playerSeed,
    opponentSeed,
    playerDrawRank,
    opponentDrawRank,
    tournamentName: game.tournamentName ?? null,
    surface: game.surface ?? null,
  };
  const out: TennisListPropRow[] = [];

  const pushOu = (stat: TennisPropStat, line: TennisOuLine | undefined) => {
    if (!line) return;
    const n = parseLineNumber(line.line);
    if (n == null) return;
    if (!oddsPresent(line.over) && !oddsPresent(line.under)) return;
    const last5 = recentValues(recentMatches, stat, 5);
    const last10 = recentValues(recentMatches, stat, 10);
    const season = recentValues(recentMatches, stat, 40);
    const h2h = recentValues(h2hRows, stat, 10);
    const dvp = dvpFor(stat);
    out.push({
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      playerName,
      playerId,
      playerTeam: tour,
      opponent,
      homeTeamCode: tour,
      awayTeamCode: tour,
      homeTeamLogo: tourLogo(tour),
      awayTeamLogo: tourLogo(tour),
      ...identity,
      statType: stat,
      line: n,
      overOdds: oddsPresent(line.over) ? line.over : 'N/A',
      underOdds: oddsPresent(line.under) ? line.under : 'N/A',
      bookmaker: book.name,
      last5Avg: avg(last5),
      last10Avg: avg(last10),
      seasonAvg: avg(season),
      last5HitRate: hitRate(stat, last5, n, true),
      last10HitRate: hitRate(stat, last10, n, true),
      seasonHitRate: hitRate(stat, season, n, true),
      streak: streakOver(stat, last10, n),
      h2hAvg: avg(h2h),
      h2hHitRate: hitRate(stat, h2h, n, true),
      headshotUrl,
      dvpRating: dvp.dvpRating,
      dvpStatValue: dvp.dvpStatValue,
      dvpFieldSize: dvp.dvpFieldSize,
    });
  };

  if (oddsPresent(book.H2H.home) && tennisMoneylinePriceMeetsMin(book.H2H.home)) {
    const last5 = recentValues(recentMatches, 'moneyline', 5);
    const last10 = recentValues(recentMatches, 'moneyline', 10);
    const season = recentValues(recentMatches, 'moneyline', 40);
    const h2h = recentValues(h2hRows, 'moneyline', 10);
    const dvp = dvpFor('moneyline');
    out.push({
      gameId: game.gameId,
      homeTeam: game.homeTeam,
      awayTeam: game.awayTeam,
      commenceTime: game.commenceTime,
      playerName,
      playerId,
      playerTeam: tour,
      opponent,
      homeTeamCode: tour,
      awayTeamCode: tour,
      homeTeamLogo: tourLogo(tour),
      awayTeamLogo: tourLogo(tour),
      ...identity,
      statType: 'moneyline',
      line: 0.5,
      overOdds: book.H2H.home,
      underOdds: oddsPresent(book.H2H.away) ? book.H2H.away : 'N/A',
      bookmaker: book.name,
      last5Avg: avg(last5),
      last10Avg: avg(last10),
      seasonAvg: avg(season),
      last5HitRate: hitRate('moneyline', last5, 0.5, true),
      last10HitRate: hitRate('moneyline', last10, 0.5, true),
      seasonHitRate: hitRate('moneyline', season, 0.5, true),
      streak: streakOver('moneyline', last10, 0.5),
      h2hAvg: avg(h2h),
      h2hHitRate: hitRate('moneyline', h2h, 0.5, true),
      headshotUrl,
      dvpRating: dvp.dvpRating,
      dvpStatValue: dvp.dvpStatValue,
      dvpFieldSize: dvp.dvpFieldSize,
    });
  }

  pushOu('spread', tennisMainLineForStat(book, 'spread'));
  pushOu('totalGames', tennisMainLineForStat(book, 'totalGames'));
  pushOu('gamesWon', tennisMainLineForStat(book, 'gamesWon'));
  pushOu('gamesLost', tennisMainLineForStat(book, 'gamesLost'));
  pushOu('totalSets', tennisMainLineForStat(book, 'totalSets'));
  return out;
}

function fillMissingTennisOpponentIoc(rows: TennisListPropRow[]): TennisListPropRow[] {
  const iocById = new Map<string, string>();
  const iocByName = new Map<string, string>();
  for (const row of rows) {
    const ioc = String(row.playerIoc || '').trim();
    if (!ioc) continue;
    const id = String(row.playerId || '').trim();
    if (id) iocById.set(id, ioc);
    iocByName.set(String(row.playerName || '').trim().toLowerCase(), ioc);
  }
  return rows.map((row) => {
    if (row.opponentIoc) return row;
    const oppId = String(row.opponentId || '').trim();
    if (oppId && iocById.has(oppId)) return { ...row, opponentIoc: iocById.get(oppId) || row.opponentIoc };
    const opponent = String(row.opponent || '').trim();
    if (!opponent) return row;
    const fromName = iocByName.get(opponent.toLowerCase());
    if (fromName) return { ...row, opponentIoc: fromName };
    const named = [...iocByName.entries()].filter(([name]) => tennisIdentityMatch(name, opponent));
    if (named.length === 1) return { ...row, opponentIoc: named[0][1] };
    const sibling = rows.find(
      (other) =>
        other.playerIoc &&
        other.gameId === row.gameId &&
        tennisIdentityMatch(other.playerName, opponent)
    );
    if (sibling?.playerIoc) return { ...row, opponentIoc: sibling.playerIoc };
    const resolved = resolveTennisIoc(oppId || null, opponent);
    return resolved ? { ...row, opponentIoc: resolved } : row;
  });
}

function dvpPlayersFromBoard(board: TennisCachedDvpEvent | null | undefined) {
  return board?.windows?.last10 || [];
}

function findDvpPlayer(
  players: NonNullable<TennisCachedDvpEvent['windows']['last10']>,
  opponentName: string,
  opponentId: string | null
) {
  if (opponentId) {
    const want = String(opponentId).trim();
    const byId = players.find((row) => String(row.id) === want);
    if (byId) return byId;
  }
  const key = opponentName.trim().toLowerCase();
  if (!key) return null;
  const byName = players.find((row) => row.name.toLowerCase() === key);
  if (byName) return byName;
  const identity = players.filter((row) => tennisIdentityMatch(row.name, opponentName));
  if (identity.length === 1) return identity[0];
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length >= 3) {
    const lastHits = players.filter(
      (row) => row.name.toLowerCase().split(/\s+/).pop() === last
    );
    if (lastHits.length === 1) return lastHits[0];
  }
  return identity[0] || null;
}

function snapshotToGame(
  snapshot: TennisOddsSnapshot,
  tour: TennisTour,
  index?: TennisOddsIndexMatch
): TennisListGame {
  const logo = tourLogo(tour);
  const tournamentName = snapshot.tournamentName || index?.tournamentName || null;
  return {
    gameId: snapshot.matchId,
    homeTeam: snapshot.homeName,
    awayTeam: snapshot.awayName,
    commenceTime: String(snapshot.commenceTime || index?.commenceTime || ''),
    homeTeamCode: tour,
    awayTeamCode: tour,
    homeTeamLogo: logo,
    awayTeamLogo: logo,
    tournamentName,
    surface: lookupTennisSurface(tournamentName),
  };
}

async function buildTennisPlayerPropsList(): Promise<TennisPlayerPropsListPayload> {
  await hydrateTennisMatchOverlay({ allowRemote: false });
  const roster = await readTennisRosterCache();
  let playerRows = roster?.players || [];
  if (!playerRows.length) {
    playerRows = loadTennisPlayers();
    if (!playerRows.length) playerRows = loadTennisPlayers({ currentOnly: true });
  }
  const [index, catalog, players, liveEvents, dvpStore] = await Promise.all([
    listTennisOddsIndex(),
    readOddsApiTennisCatalog(),
    Promise.resolve(
      playerRows.map((player) => ({
        playerId: player.playerId,
        tour: player.tour,
        name: player.name,
        imageUrl: player.imageUrl || null,
        ioc: player.ioc || null,
        rank: player.rank ?? null,
      }))
    ),
    listLiveTennisEventIndex(),
    readTennisDvpLiveStore(),
  ]);
  const lookup = buildPlayerLookup(players);
  const indexById = new Map(index.map((row) => [row.matchId, row]));
  const matchIds = new Set<string>(index.map((row) => row.matchId));
  for (const match of catalog?.matches ?? []) {
    matchIds.add(`odds:${match.eventId}`);
  }

  const snapshots: TennisOddsSnapshot[] = [];
  const ids = [...matchIds];
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const found = await Promise.all(batch.map((id) => readTennisOddsSnapshot(id)));
    for (const snapshot of found) {
      if (snapshot?.bookmakers?.length) snapshots.push(snapshot);
    }
  }

  if (!snapshots.length && catalog?.matches?.length) {
    for (const match of catalog.matches) {
      if (!match.books?.length) continue;
      snapshots.push({
        matchId: `odds:${match.eventId}`,
        homeName: match.homeTeam,
        awayName: match.awayTeam,
        bookmakers: match.books,
        fetchedAt: catalog.fetchedAt,
        oddsApiEventId: match.eventId,
        commenceTime: match.commenceTime,
        tour: tennisTourFromOdds(match.sportKey, match.sportTitle),
        tournamentName: match.sportTitle || null,
        sportKey: match.sportKey,
      });
    }
  }

  const games: TennisListGame[] = [];
  const data: TennisListPropRow[] = [];
  const seenGames = new Set<string>();
  const matchCache = new Map<string, TennisMatchRow[]>();
  const dvpCache = new Map<string, ReturnType<typeof tennisDvpProfile>>();
  const dvpBoards = new Map<string, TennisCachedDvpEvent>();
  const listPlayerIds = [
    ...new Set(
      snapshots.flatMap((snapshot) => {
        const home = lookup.find(snapshot.homeName);
        const away = lookup.find(snapshot.awayName);
        return [home?.playerId, away?.playerId].filter((id): id is string => Boolean(id));
      })
    ),
  ];
  const redisLogs = listPlayerIds.length
    ? await readTennisPlayerLogsCacheMany(listPlayerIds)
    : new Map<string, TennisMatchRow[]>();
  if (listPlayerIds.length && redisLogs.size === 0) {
    const retry = await readTennisPlayerLogsCacheMany(listPlayerIds);
    retry.forEach((games, id) => redisLogs.set(id, games));
  }
  const historyIds = listPlayerIds.filter((id) => tennisLogsNeedHistory(redisLogs.get(id)));
  if (historyIds.length) {
    const filled = await Promise.all(historyIds.map((id) => loadPlayerMatchesCached({ playerId: id })));
    historyIds.forEach((id, index) => {
      if (filled[index]?.length) redisLogs.set(id, filled[index]);
    });
  }
  const overlayReady = Boolean(getHydratedTennisOverlay()?.matches?.length);

  const matchesFor = (playerName: string, playerId: string | null): TennisMatchRow[] => {
    const key = `${playerId || ''}|${playerName.toLowerCase()}`;
    const cached = matchCache.get(key);
    if (cached) return cached;
    const fromRedis = playerId ? redisLogs.get(playerId) || [] : [];
    const rows = fromRedis.length
      ? fromRedis
      : overlayReady
        ? loadPlayerMatches({ playerId, playerName })
        : [];
    const prepared = tennisMatchesPlayed(rows);
    matchCache.set(key, prepared);
    return prepared;
  };

  const boardFor = (
    tour: TennisTour,
    tournamentName: string | null,
    stage: 'main' | 'qualifying',
    tournamentKey?: string | null
  ) => {
    const boardKey = `${tour}|${stage}|${String(tournamentKey || '').trim() || (tournamentName || '').toLowerCase()}`;
    const hit = dvpBoards.get(boardKey);
    if (hit) return hit;
    const cached =
      findCachedTennisDvpEvent(dvpStore, {
        tour,
        tournamentKey: tournamentKey || null,
        tournamentName,
        stage,
      }) ||
      findCachedTennisDvpEvent(dvpStore, {
        tour,
        tournamentKey: null,
        tournamentName,
        stage,
      });
    if (cached) {
      const prepared = ensureTennisDvpBoardRanks(cached) || cached;
      dvpBoards.set(boardKey, prepared);
      return prepared;
    }
    const extras = tennisLiveEventPlayerIds(liveEvents, tournamentKey || null, tournamentName, stage);
    const profile = tennisDvpProfile({
      tour,
      year: TENNIS_CURRENT_YEAR,
      tournamentName,
      tournamentKey: tournamentKey || null,
      window: 'last10',
      stage,
      extraPlayerIds: extras,
      liveTournamentKeys: liveEvents.keys,
      liveTournamentNames: liveEvents.names,
      includeField: true,
    });
    const board: TennisCachedDvpEvent = {
      tour,
      stage,
      bestOf: profile.bestOf,
      tournamentKey: profile.tournamentKey,
      tournamentName: profile.tournamentName,
      fieldSize: profile.fieldSize,
      topSeed: null,
      windows: {
        last10: (profile.field || []).map((row) => ({
          id: row.id,
          name: row.name,
          ioc: row.ioc,
          rankPos: row.rankPos,
          seed: row.seed ?? null,
          drawRank: row.drawRank ?? null,
          metrics: row.metrics,
        })),
      },
    };
    const last10 = board.windows.last10 || [];
    if (!last10.some((row) => row.seed != null)) {
      const assigned = tennisAssignDrawSeeds(last10, {
        stage,
        fieldSize: board.fieldSize || last10.length,
      });
      for (const row of last10) row.seed = assigned.get(row.id) ?? null;
    }
    if (!last10.some((row) => row.drawRank != null)) {
      const assigned = tennisAssignDrawRanks(last10);
      for (const row of last10) row.drawRank = assigned.get(row.id) ?? null;
    }
    board.topSeed = last10.find((row) => row.seed === 1) || null;
    const prepared = ensureTennisDvpBoardRanks(board) || board;
    dvpBoards.set(boardKey, prepared);
    return prepared;
  };

  const dvpForOpponent = (
    tour: TennisTour,
    opponentName: string,
    opponentId: string | null,
    playerId: string | null,
    tournamentName: string | null,
    tournamentKey?: string | null
  ) => {
    const stage = tennisLiveEventStage(liveEvents, {
      playerId,
      opponentId,
      tournamentKey: tournamentKey || null,
      tournamentName,
    });
    const cacheKey = `${tour}|${stage}|${String(tournamentKey || '').trim() || (tournamentName || '').toLowerCase()}|${opponentId || opponentName.toLowerCase()}`;
    const cached = dvpCache.get(cacheKey);
    if (cached && !Array.isArray(cached)) return cached;
    const extras = [
      ...tennisLiveEventPlayerIds(liveEvents, tournamentKey || null, tournamentName, stage),
      ...[opponentId, playerId]
        .map((id) => String(id || '').trim())
        .filter((id) => /^\d+$/.test(id)),
    ];
    const board = boardFor(tour, tournamentName, stage, tournamentKey);
    const livePlayer = findDvpPlayer(dvpPlayersFromBoard(board), opponentName, opponentId);
    if (!livePlayer) {
      const computed = tennisDvpProfile({
        tour,
        year: TENNIS_CURRENT_YEAR,
        opponentName,
        opponentId,
        playerId,
        tournamentName,
        tournamentKey: tournamentKey || null,
        window: 'last10',
        stage,
        extraPlayerIds: extras,
        liveTournamentKeys: liveEvents.keys,
        liveTournamentNames: liveEvents.names,
      });
      dvpCache.set(cacheKey, computed);
      return computed;
    }
    const profile = {
      tour,
      year: TENNIS_CURRENT_YEAR,
      window: 'last10' as const,
      stage,
      bestOf:
        board.bestOf ||
        tennisDvpTournamentBestOf({
          tour,
          stage,
          tournamentName: board.tournamentName || tournamentName,
        }),
      tournamentName: board.tournamentName,
      tournamentKey: board.tournamentKey,
      fieldSize: board.fieldSize,
      opponent: livePlayer
        ? {
            id: livePlayer.id,
            name: livePlayer.name,
            ioc: livePlayer.ioc,
            rankPos: livePlayer.rankPos,
            seed: livePlayer.seed ?? null,
            drawRank: livePlayer.drawRank ?? null,
          }
        : null,
      opponents: (board.windows.last10 || []).map((row) => ({
        id: row.id,
        name: row.name,
        ioc: row.ioc,
        rankPos: row.rankPos,
        seed: row.seed ?? null,
        drawRank: row.drawRank ?? null,
      })),
      topSeed: board.topSeed
        ? {
            id: board.topSeed.id,
            name: board.topSeed.name,
            ioc: board.topSeed.ioc,
            rankPos: board.topSeed.rankPos,
            seed: board.topSeed.seed ?? 1,
            drawRank: board.topSeed.drawRank ?? 1,
          }
        : null,
      metrics: livePlayer?.metrics?.length
        ? livePlayer.metrics
        : TENNIS_DVP_METRICS.map((metric) => ({
            key: metric.key,
            label: metric.label,
            pct: metric.pct,
            value: null,
            rank: null,
            matches: 0,
            fieldSize: board.fieldSize,
          })),
    };
    dvpCache.set(cacheKey, profile);
    return profile;
  };

  for (const snapshot of snapshots) {
    if (!snapshot.bookmakers?.length) continue;
    let homeMeta = lookup.find(snapshot.homeName);
    let awayMeta = lookup.find(snapshot.awayName);
    const matchTour = inferMatchTour(snapshot, homeMeta, awayMeta);
    if (matchTour) {
      homeMeta = lookup.find(snapshot.homeName, matchTour) || homeMeta;
      awayMeta = lookup.find(snapshot.awayName, matchTour) || awayMeta;
    }
    if (matchTour) {
      homeMeta = lookup.find(snapshot.homeName, matchTour) || homeMeta;
      awayMeta = lookup.find(snapshot.awayName, matchTour) || awayMeta;
    }
    const game = snapshotToGame(snapshot, matchTour, indexById.get(snapshot.matchId));
    if (!seenGames.has(game.gameId)) {
      seenGames.add(game.gameId);
      games.push(game);
    }
    const sides: Array<{ name: string; isHome: boolean; meta: PlayerMeta | null; opponentMeta: PlayerMeta | null }> = [
      { name: snapshot.homeName, isHome: true, meta: homeMeta, opponentMeta: awayMeta },
      { name: snapshot.awayName, isHome: false, meta: awayMeta, opponentMeta: homeMeta },
    ];
    for (const side of sides) {
      const meta = side.meta;
      const playerName = meta?.name || side.name;
      const playerId = meta?.playerId || null;
      const tour = matchTour;
      const opponent = side.isHome ? snapshot.awayName : snapshot.homeName;
      const opponentId = side.opponentMeta?.playerId || null;
      const allMatches = matchesFor(playerName, playerId);
      const recentMatches = matchesInFormWindow(allMatches);
      const h2hRows = allMatches.filter((row) => isH2hMatch(row, opponent, opponentId));
      const headshotUrl = clientTennisHeadshotUrl(
        playerId,
        resolveTennisHeadshotUrl(playerId, meta?.imageUrl || null)
      );
      const liveEvent =
        (playerId &&
          liveEvents.events.find(
            (event) =>
              event.playerIds.includes(playerId) || event.qualifyingPlayerIds.includes(playerId)
          )) ||
        findLiveTennisEvent(liveEvents, null, game.tournamentName || snapshot.tournamentName || null);
      const liveTournamentName =
        liveEvent?.tournamentName || game.tournamentName || snapshot.tournamentName || null;
      const liveTournamentKey = liveEvent?.tournamentKey || null;
      if (liveEvent?.tournamentName && game.tournamentName !== liveEvent.tournamentName) {
        game.tournamentName = liveEvent.tournamentName;
        game.surface = lookupTennisSurface(liveEvent.tournamentName, liveEvent.tournamentKey);
      }
      const dvpProfile = dvpForOpponent(
        tour,
        opponent,
        opponentId,
        playerId,
        liveTournamentName,
        liveTournamentKey
      );
      const dvpFor = (stat: TennisPropStat): DvpFields => {
        const liveOpp = dvpProfile.opponent
          ? { ...dvpProfile.opponent, metrics: dvpProfile.metrics }
          : null;
        return (
          dashboardDvpFieldsForStat(stat, liveOpp, dvpProfile.fieldSize ?? null) || {
            dvpRating: null,
            dvpStatValue: null,
            dvpFieldSize: dvpProfile.fieldSize ?? null,
          }
        );
      };
      const playerBoard =
        dvpProfile.opponents.find((row) => row.id === playerId) ||
        dvpProfile.opponents.find(
          (row) => row.name.toLowerCase() === playerName.trim().toLowerCase()
        ) ||
        null;
      const books = orientBooks(snapshot.bookmakers, side.isHome);
      for (const book of books) {
        data.push(
          ...rowsForBook({
            game,
            playerName,
            playerId,
            tour,
            opponent,
            opponentId,
            playerIoc: meta?.ioc || resolveTennisIoc(playerId, playerName),
            playerRank: meta?.rank ?? null,
            opponentIoc:
              side.opponentMeta?.ioc ||
              resolveTennisIoc(opponentId, opponent) ||
              dvpProfile.opponent?.ioc ||
              null,
            opponentRank: side.opponentMeta?.rank ?? null,
            playerSeed: playerBoard?.seed ?? null,
            opponentSeed: dvpProfile.opponent?.seed ?? null,
            playerDrawRank: playerBoard?.drawRank ?? null,
            opponentDrawRank: dvpProfile.opponent?.drawRank ?? null,
            book,
            playerIsHome: side.isHome,
            recentMatches,
            h2hRows,
            headshotUrl,
            dvpFor,
          })
        );
      }
    }
  }

  const primaryData = attachTennisHeadshots(
    collapseTennisRowsToPrimaryMarketLine(data, {
      keepAllWinningLineRows: true,
    })
  );
  const filledData = fillMissingTennisOpponentIoc(primaryData);
  games.sort((a, b) => String(a.commenceTime).localeCompare(String(b.commenceTime)));
  const lastUpdated =
    snapshots.reduce((latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest), '') || null;
  const empty = filledData.length === 0;
  return {
    success: true,
    data: filledData,
    games,
    propsCount: primaryData.length,
    gamesCount: games.length,
    lastUpdated,
    nextUpdate: null,
    noTennisOdds: empty,
    noAflOdds: empty,
    ingestMessage: empty ? TENNIS_USER_NO_ODDS : null,
  };
}

export async function overlayLiveTennisDvp(
  payload: TennisPlayerPropsListPayload
): Promise<TennisPlayerPropsListPayload> {
  if (!payload.data.length) return payload;
  const store = await readTennisDvpLiveStore();
  const live = peekLiveTennisEventIndex() || {
    keys: new Set<string>(),
    names: new Set<string>(),
    playerIdsByKey: new Map<string, string[]>(),
    playerIdsByName: new Map<string, string[]>(),
    events: [],
  };
  if (!live.events.length && !store?.events?.length) return payload;
  const boards = new Map<string, TennisCachedDvpEvent>();
  const boardFor = (
    tour: TennisTour,
    tournamentName: string | null,
    tournamentKey: string | null,
    stage: 'main' | 'qualifying'
  ) => {
    const boardKey = `${tour}|${stage}|${String(tournamentKey || '').trim() || (tournamentName || '').toLowerCase()}`;
    const hit = boards.get(boardKey);
    if (hit) return hit;
    const cached =
      findCachedTennisDvpEvent(store, {
        tour,
        tournamentKey,
        tournamentName,
        stage,
      }) ||
      findCachedTennisDvpEvent(store, {
        tour,
        tournamentKey: null,
        tournamentName,
        stage,
      });
    if (cached) boards.set(boardKey, cached);
    return cached;
  };

  const data = payload.data.map((row) => {
    const tour: TennisTour =
      `${row.playerTeam || ''} ${row.homeTeamCode || ''}`.toUpperCase().includes('WTA') ? 'WTA' : 'ATP';
    const playerId = String(row.playerId || '').trim() || null;
    const opponentId = String(row.opponentId || '').trim() || null;
    const opponentName = String(row.opponent || '');
    const event = findLiveTennisEventForPlayers(live, {
      playerId,
      opponentId,
      tournamentKey: null,
      tournamentName: row.tournamentName || null,
    }) || findLiveTennisEvent(live, null, row.tournamentName || null);
    const patchedName = event?.tournamentName || row.tournamentName;
    const tournamentName = event?.tournamentName || row.tournamentName || null;
    const tournamentKey = event?.tournamentKey || null;
    const stage = tennisLiveEventStage(live, {
      playerId,
      opponentId,
      tournamentKey,
      tournamentName,
    });
    const board = boardFor(event?.tour || tour, tournamentName, tournamentKey, stage);
    const opp = findDvpPlayer(dvpPlayersFromBoard(board), opponentName, opponentId);
    const withIoc = {
      ...row,
      opponentIoc: row.opponentIoc || opp?.ioc || null,
      tournamentName: patchedName,
    };
    const stat = asTennisPropStat(row.statType);
    if (!stat) return withIoc;
    const next = dashboardDvpFieldsForStat(stat, opp, board?.fieldSize ?? null);
    const nextRank = typeof next?.dvpRating === 'number' && Number.isFinite(next.dvpRating) && next.dvpRating > 0;
    const prevRank = typeof row.dvpRating === 'number' && Number.isFinite(row.dvpRating) && row.dvpRating > 0;
    if (!nextRank) return withIoc;
    const prevField = Number(row.dvpFieldSize) || 0;
    const nextField = Number(next?.dvpFieldSize) || 0;
    if (prevRank && prevField > nextField) return withIoc;
    return {
      ...withIoc,
      dvpRating: next!.dvpRating,
      dvpStatValue: next!.dvpStatValue,
      dvpFieldSize: next!.dvpFieldSize,
    };
  });
  const games = payload.games.map((game) => {
    const row = data.find((item) => item.gameId === game.gameId && item.tournamentName);
    if (!row?.tournamentName || row.tournamentName === game.tournamentName) return game;
    return { ...game, tournamentName: row.tournamentName };
  });
  return { ...payload, data, games };
}

export async function bakeCachedTennisDvp(): Promise<{ props: number; withDvp: number }> {
  const cached = await readUsableTennisListCache();
  if (!cached?.data?.length) {
    return { props: 0, withDvp: 0 };
  }
  const baked = await overlayLiveTennisDvp(cached);
  const withDvp = baked.data.filter(
    (row) => typeof row.dvpRating === 'number' && Number.isFinite(row.dvpRating) && row.dvpRating > 0
  ).length;
  await writeTennisPlayerPropsListCache(baked);
  try {
    const { patchCombinedSnapshotTennisDvp } = await import('@/lib/combinedPropsSnapshotPaint');
    await patchCombinedSnapshotTennisDvp(baked.data);
  } catch {
    /* list cache still has DVP even if combined patch fails */
  }
  return { props: baked.data.length, withDvp };
}

function overlayUpcomingTimes(
  payload: TennisPlayerPropsListPayload,
  upcoming: Awaited<ReturnType<typeof listUniqueUpcomingTennisGames>>,
  byPlayerId?: Map<string, TennisNextGame>
): TennisPlayerPropsListPayload {
  if (!upcoming.length && !byPlayerId?.size) return payload;
  const tipFor = (
    gameId: string,
    home: string,
    away: string,
    playerId?: string | null,
    playerName?: string | null
  ) =>
    tennisUpcomingTipoffFor(byPlayerId || new Map(), upcoming, {
      playerId,
      playerName,
      matchId: gameId,
      homeName: home,
      awayName: away,
    });
  const games = payload.games.map((game) => {
    const tip = tipFor(game.gameId, game.homeTeam, game.awayTeam);
    return tip && tip !== game.commenceTime ? { ...game, commenceTime: tip } : game;
  });
  const data = payload.data.map((row) => {
    const tip = tipFor(row.gameId, row.homeTeam, row.awayTeam, row.playerId, row.playerName);
    return tip && tip !== row.commenceTime ? { ...row, commenceTime: tip } : row;
  });
  return { ...payload, games, data };
}

function upcomingNameKey(name: string): string {
  return `name:${name.trim().toLowerCase()}`;
}

function upcomingForPropRow(
  row: TennisListPropRow,
  byPlayerId: Map<string, TennisNextGame>
): TennisNextGame | null {
  const id = String(row.playerId || '').trim();
  if (id && byPlayerId.has(id)) return byPlayerId.get(id) || null;
  const name = String(row.playerName || '').trim();
  if (!name) return null;
  const named = byPlayerId.get(upcomingNameKey(name));
  if (named) return named;
  for (const game of byPlayerId.values()) {
    if (tennisIdentityMatch(game.opponent, name)) continue;
    if (tennisIdentityMatch(game.homeName, name) || tennisIdentityMatch(game.awayName, name)) {
      return game;
    }
  }
  return null;
}

function overlayUpcomingOpponentMeta(
  payload: TennisPlayerPropsListPayload,
  byPlayerId: Map<string, TennisNextGame>
): TennisPlayerPropsListPayload {
  if (!byPlayerId.size) return payload;
  const data = payload.data.map((row) => {
    const next = upcomingForPropRow(row, byPlayerId);
    if (!next) return row;
    let patched = row;
    if (next.opponentIoc) patched = { ...patched, opponentIoc: next.opponentIoc };
    if (next.opponentRank != null) patched = { ...patched, opponentRank: next.opponentRank };
    if (next.opponentId) patched = { ...patched, opponentId: next.opponentId };
    return patched;
  });
  return data === payload.data ? payload : { ...payload, data: fillMissingTennisOpponentIoc(data) };
}

function overlayRosterOpponentMeta(
  payload: TennisPlayerPropsListPayload,
  roster: {
    players?: Array<{ playerId: string; name: string; ioc: string | null; rank: number | null }>;
    standings?: { ATP?: Array<{ playerId: string; name: string; ioc: string | null; pos?: number | null }>; WTA?: Array<{ playerId: string; name: string; ioc: string | null; pos?: number | null }> };
  } | null | undefined
): TennisPlayerPropsListPayload {
  const players = roster?.players || [];
  const ranked = [...(roster?.standings?.ATP || []), ...(roster?.standings?.WTA || [])];
  if (!players.length && !ranked.length) return payload;
  const iocFor = (
    id: string | null,
    name: string,
    fallbackIoc?: string | null
  ): { ioc: string | null; id: string | null; rank: number | null } | null => {
    const byId = id ? players.find((player) => player.playerId === id) : null;
    const nameHits = name ? players.filter((player) => tennisIdentityMatch(player.name, name)) : [];
    const hit =
      byId ||
      nameHits.find((player) => player.name.toLowerCase() === name.toLowerCase()) ||
      (nameHits.length === 1 ? nameHits[0] : null);
    const rankedHit =
      (hit?.playerId && ranked.find((row) => row.playerId === hit.playerId)) ||
      (id && ranked.find((row) => row.playerId === id)) ||
      (name
        ? ranked.filter((row) => tennisIdentityMatch(row.name, name)).length === 1
          ? ranked.find((row) => tennisIdentityMatch(row.name, name))
          : null
        : null);
    const resolvedId = hit?.playerId || rankedHit?.playerId || id || null;
    const ioc = hit?.ioc || rankedHit?.ioc || fallbackIoc || resolveTennisIoc(resolvedId, name);
    if (!ioc && !resolvedId) return null;
    return {
      ioc: ioc || null,
      id: resolvedId,
      rank: hit?.rank ?? rankedHit?.pos ?? null,
    };
  };
  const data = payload.data.map((row) => {
    if (row.opponentIoc && row.opponentId) return row;
    const found = iocFor(String(row.opponentId || '').trim() || null, String(row.opponent || '').trim(), row.opponentIoc);
    if (!found) return row;
    return {
      ...row,
      opponentIoc: row.opponentIoc || found.ioc,
      opponentId: row.opponentId || found.id,
      opponentRank: row.opponentRank ?? found.rank,
    };
  });
  return { ...payload, data };
}

function filterTennisListByTour(
  payload: TennisPlayerPropsListPayload,
  tour: TennisTour | null
): TennisPlayerPropsListPayload {
  if (!tour) return payload;
  const data = payload.data.filter((row) => String(row.playerTeam || '').toUpperCase() === tour);
  const gameIds = new Set(data.map((row) => row.gameId));
  const games = payload.games.filter(
    (game) => gameIds.has(game.gameId) || String(game.homeTeamCode || '').toUpperCase() === tour
  );
  const empty = data.length === 0;
  return {
    ...payload,
    data,
    games,
    propsCount: data.length,
    gamesCount: games.length,
    noTennisOdds: empty,
    noAflOdds: empty,
    ingestMessage: empty ? TENNIS_USER_NO_ODDS : payload.ingestMessage,
  };
}

export async function applyTennisListLiveOverlay(
  payload: TennisPlayerPropsListPayload
): Promise<TennisPlayerPropsListPayload> {
  let next = payload;
  try {
    const byPlayerId = await listUpcomingTennisByPlayer({ waitForFresh: false });
    const upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
    next = overlayUpcomingTimes(next, upcoming, byPlayerId);
    next = overlayUpcomingOpponentMeta(next, byPlayerId);
  } catch {
    /* keep snapshot times if upcoming is cold */
  }
  try {
    const roster = await readTennisRosterCache();
    next = overlayRosterOpponentMeta(next, roster);
  } catch {
    /* keep baked identity if roster is cold */
  }
  try {
    next = await overlayLiveTennisDvp(next);
  } catch {
    /* keep baked DVP if live overlay fails */
  }
  return { ...next, data: fillMissingTennisOpponentIoc(next.data) };
}

let listBuildInflight: Promise<TennisPlayerPropsListPayload> | null = null;

async function loadTennisPlayerPropsList(refresh?: boolean): Promise<TennisPlayerPropsListPayload> {
  if (!refresh) {
    const cached = await readUsableTennisListCache();
    if (cached) {
      try {
        const data = attachTennisHeadshots(cached.data);
        return data === cached.data ? cached : { ...cached, data };
      } catch {
        return cached;
      }
    }
    return {
      success: true,
      data: [],
      games: [],
      propsCount: 0,
      gamesCount: 0,
      lastUpdated: null,
      nextUpdate: null,
      noTennisOdds: true,
      noAflOdds: true,
      ingestMessage: TENNIS_USER_NO_ODDS,
    };
  }
  if (listBuildInflight) return listBuildInflight;
  listBuildInflight = (async () => {
    let payload = await buildTennisPlayerPropsList();
    if (payload.data.length > 0) {
      payload = await applyTennisListLiveOverlay(payload);
      if (payload.data.length > 0) {
        await writeTennisPlayerPropsListCache(payload);
        try {
          await upsertCombinedSnapshotTennisFromList(payload);
        } catch {
          /* the tennis list is already saved */
        }
        return payload;
      }
    }
    const previous = await readUsableTennisListCache();
    if (previous) {
      try {
        const data = attachTennisHeadshots(previous.data);
        return data === previous.data ? previous : { ...previous, data };
      } catch {
        return previous;
      }
    }
    return payload;
  })().finally(() => {
    listBuildInflight = null;
  });
  return listBuildInflight;
}

export async function getTennisPlayerPropsList(opts?: {
  refresh?: boolean;
  tour?: TennisTour | null;
}): Promise<TennisPlayerPropsListPayload> {
  const tour = opts?.tour === 'ATP' || opts?.tour === 'WTA' ? opts.tour : null;
  const payload = filterTennisListByTour(await loadTennisPlayerPropsList(opts?.refresh), tour);
  try {
    return await overlayLiveTennisDvp(payload);
  } catch {
    return payload;
  }
}
