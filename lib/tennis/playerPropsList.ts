/**
 * Tennis props-page list: one row per player / market / bookmaker,
 * then collapsed to one displayed line per market.
 * Same shape as AFL `/api/afl/player-props/list`.
 */

import sharedCache from '@/lib/sharedCache';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import { readTennisRosterCache } from '@/lib/tennis/dashboardCache';
import { TENNIS_CURRENT_YEAR, loadPlayerMatches, loadTennisPlayers, tennisDvpProfile } from '@/lib/tennis/data';
import {
  findCachedTennisDvpEvent,
  readTennisDvpLiveStore,
  type TennisCachedDvpEvent,
} from '@/lib/tennis/dvpLiveCache';
import { attachTennisHeadshots, resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import { clientTennisHeadshotUrl } from '@/lib/tennis/headshotDisplay';
import {
  listTennisOddsIndex,
  readTennisOddsSnapshot,
  refreshTennisOddsSnapshots,
  type TennisOddsIndexMatch,
  type TennisOddsSnapshot,
} from '@/lib/tennis/odds';
import {
  listLiveTennisEventIndex,
  listUniqueUpcomingTennisGames,
  tennisCommenceTimeForMatch,
  tennisLiveEventPlayerIds,
  tennisLiveEventStage,
  findLiveTennisEvent,
  warmTennisUpcomingFixtures,
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
import { TENNIS_DVP_METRICS, type TennisDvpMetricKey } from '@/lib/tennis/dvpShared';
import { tennisAssignDrawRanks, tennisAssignDrawSeeds } from '@/lib/tennis/seeds';
import { lookupTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

export const TENNIS_USER_NO_ODDS = 'No odds available. Come back later.';
export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v29';
const TENNIS_LIST_CACHE_TTL_SECONDS = 20 * 60;
const TENNIS_EMPTY_TOUR_TTL_SECONDS = 2 * 60;

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
  if (stat === 'gamesWon' || stat === 'gamesLost') return 'gamesWon';
  return 'totalGames';
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
    const opponent = String(row.opponent || '').trim();
    if (!opponent) return row;
    const fromName = iocByName.get(opponent.toLowerCase());
    if (fromName) return { ...row, opponentIoc: fromName };
    const sibling = rows.find(
      (other) =>
        other.playerIoc &&
        other.gameId === row.gameId &&
        tennisIdentityMatch(other.playerName, opponent)
    );
    if (sibling?.playerIoc) return { ...row, opponentIoc: sibling.playerIoc };
    const resolved = resolveTennisIoc(null, opponent);
    return resolved ? { ...row, opponentIoc: resolved } : row;
  });
}

function findDvpPlayer(
  players: NonNullable<TennisCachedDvpEvent['windows']['last10']>,
  opponentName: string,
  opponentId: string | null
) {
  if (opponentId) {
    const byId = players.find((row) => row.id === opponentId);
    if (byId) return byId;
  }
  const key = opponentName.trim().toLowerCase();
  const byName = players.find((row) => row.name.toLowerCase() === key);
  if (byName) return byName;
  const last = key.split(/\s+/).filter(Boolean).pop() || '';
  if (last.length < 3) return null;
  return players.find((row) => row.name.toLowerCase().split(/\s+/).pop() === last) || null;
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
  let playerRows = loadTennisPlayers();
  if (!playerRows.length) {
    playerRows = loadTennisPlayers({ currentOnly: true });
  }
  if (!playerRows.length) {
    const roster = await readTennisRosterCache();
    playerRows = roster?.players || [];
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

  const matchesFor = (playerName: string, playerId: string | null): TennisMatchRow[] => {
    const key = `${playerId || ''}|${playerName.toLowerCase()}`;
    const cached = matchCache.get(key);
    if (cached) return cached;
    const rows = loadPlayerMatches({ playerId, playerName });
    matchCache.set(key, rows);
    return rows;
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
    const cached = findCachedTennisDvpEvent(dvpStore, {
      tour,
      tournamentKey: tournamentKey || null,
      tournamentName,
      stage,
    });
    if (cached) {
      const rows = cached.windows.last10 || [];
      if (!rows.some((row) => row.drawRank != null)) {
        const assigned = tennisAssignDrawRanks(rows);
        for (const row of rows) row.drawRank = assigned.get(row.id) ?? null;
      }
      dvpBoards.set(boardKey, cached);
      return cached;
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
    dvpBoards.set(boardKey, board);
    return board;
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
    const board = boardFor(tour, tournamentName, stage, tournamentKey);
    const livePlayer = findDvpPlayer(board.windows.last10 || [], opponentName, opponentId);
    const profile = {
      tour,
      year: TENNIS_CURRENT_YEAR,
      window: 'last10' as const,
      stage,
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
      const recentMatches = allMatches.filter(
        (row) => row.season === TENNIS_CURRENT_YEAR || row.season === TENNIS_CURRENT_YEAR - 1
      );
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
        if (stat === 'moneyline') {
          const drawRank =
            dvpProfile.opponent?.drawRank ?? dvpProfile.opponent?.seed ?? null;
          return {
            dvpRating: drawRank,
            dvpStatValue: dvpProfile.opponent?.rankPos ?? null,
            dvpFieldSize: dvpProfile.fieldSize ?? null,
          };
        }
        const metric = dvpProfile.metrics.find((row) => row.key === dvpMetricForStat(stat));
        return {
          dvpRating: metric?.rank ?? null,
          dvpStatValue: metric?.value ?? null,
          dvpFieldSize: metric?.fieldSize ?? dvpProfile.fieldSize ?? null,
        };
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

async function overlayLiveTennisDvp(
  payload: TennisPlayerPropsListPayload
): Promise<TennisPlayerPropsListPayload> {
  if (!payload.data.length) return payload;
  const [live, store] = await Promise.all([listLiveTennisEventIndex(), readTennisDvpLiveStore()]);
  if (!live.events.length) return payload;
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
    const cached = findCachedTennisDvpEvent(store, {
      tour,
      tournamentKey,
      tournamentName,
      stage,
    });
    if (cached) boards.set(boardKey, cached);
    return cached;
  };

  const data = payload.data.map((row) => {
    const tour: TennisTour = String(row.playerTeam || '').toUpperCase() === 'WTA' ? 'WTA' : 'ATP';
    const playerId = String(row.playerId || '').trim() || null;
    const event =
      (playerId &&
        live.events.find(
          (item) => item.playerIds.includes(playerId) || item.qualifyingPlayerIds.includes(playerId)
        )) ||
      findLiveTennisEvent(live, null, row.tournamentName || null);
    if (!event) return row;
    const patchedName = event.tournamentName || row.tournamentName;
    const stage = tennisLiveEventStage(live, {
      playerId,
      tournamentKey: event.tournamentKey,
      tournamentName: event.tournamentName,
    });
    const board = boardFor(event.tour || tour, event.tournamentName, event.tournamentKey, stage);
    if (!board) return patchedName === row.tournamentName ? row : { ...row, tournamentName: patchedName };
    const opp = findDvpPlayer(board.windows.last10 || [], String(row.opponent || ''), null);
    const stat = row.statType as TennisPropStat;
    const withIoc =
      !row.opponentIoc && opp?.ioc ? { ...row, opponentIoc: opp.ioc, tournamentName: patchedName } : { ...row, tournamentName: patchedName };
    if (stat === 'moneyline') {
      return {
        ...withIoc,
        dvpRating: opp?.drawRank ?? opp?.seed ?? null,
        dvpStatValue: opp?.rankPos ?? null,
        dvpFieldSize: board.fieldSize,
      };
    }
    const metric = opp?.metrics?.find((item) => item.key === dvpMetricForStat(stat));
    return {
      ...withIoc,
      dvpRating: metric?.rank ?? null,
      dvpStatValue: metric?.value ?? null,
      dvpFieldSize: metric?.fieldSize ?? board.fieldSize,
    };
  });
  const games = payload.games.map((game) => {
    const row = data.find((item) => item.gameId === game.gameId && item.tournamentName);
    if (!row?.tournamentName || row.tournamentName === game.tournamentName) return game;
    return { ...game, tournamentName: row.tournamentName };
  });
  return { ...payload, data, games };
}

function overlayUpcomingTimes(
  payload: TennisPlayerPropsListPayload,
  upcoming: Awaited<ReturnType<typeof listUniqueUpcomingTennisGames>>
): TennisPlayerPropsListPayload {
  if (!upcoming.length) return payload;
  const tipFor = (gameId: string, home: string, away: string) =>
    tennisCommenceTimeForMatch(upcoming, { matchId: gameId, homeName: home, awayName: away });
  const games = payload.games.map((game) => {
    const tip = tipFor(game.gameId, game.homeTeam, game.awayTeam);
    return tip && tip !== game.commenceTime ? { ...game, commenceTime: tip } : game;
  });
  const data = payload.data.map((row) => {
    const tip = tipFor(row.gameId, row.homeTeam, row.awayTeam);
    return tip && tip !== row.commenceTime ? { ...row, commenceTime: tip } : row;
  });
  return { ...payload, games, data };
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

async function loadTennisPlayerPropsList(refresh?: boolean): Promise<TennisPlayerPropsListPayload> {
  if (!refresh) {
    const cached = await sharedCache.getJSON<TennisPlayerPropsListPayload>(TENNIS_LIST_CACHE_KEY);
    if (cached?.success && Array.isArray(cached.data) && cached.data.length > 0) {
      try {
        const data = attachTennisHeadshots(cached.data);
        return data === cached.data ? cached : { ...cached, data };
      } catch {
        return cached;
      }
    }
  }
  const payload = await buildTennisPlayerPropsList();
  if (payload.data.length > 0) {
    await sharedCache.setJSON(TENNIS_LIST_CACHE_KEY, payload, TENNIS_LIST_CACHE_TTL_SECONDS);
  }
  return payload;
}

export async function getTennisPlayerPropsList(opts?: {
  refresh?: boolean;
  tour?: TennisTour | null;
}): Promise<TennisPlayerPropsListPayload> {
  const tour = opts?.tour === 'ATP' || opts?.tour === 'WTA' ? opts.tour : null;
  let payload = await loadTennisPlayerPropsList(opts?.refresh);
  try {
    const upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
    payload = overlayUpcomingTimes(payload, upcoming);
  } catch {
    /* keep snapshot times if upcoming is cold */
  }
  try {
    payload = await overlayLiveTennisDvp(payload);
  } catch {
    /* keep baked DVP if live overlay fails */
  }
  let result = filterTennisListByTour(payload, tour);
  if (result.data.length > 0) return result;

  const emptyKey = tour ? `tennis_props_empty_${tour.toLowerCase()}_v1` : 'tennis_props_empty_all_v1';
  const markedEmpty =
    !opts?.refresh && (await sharedCache.getJSON<{ at?: number }>(emptyKey));
  if (markedEmpty) return result;

  await warmTennisUpcomingFixtures({ force: true });
  await refreshTennisOddsSnapshots({ force: true });
  payload = await loadTennisPlayerPropsList(true);
  try {
    const upcoming = await listUniqueUpcomingTennisGames({ waitForFresh: false });
    payload = overlayUpcomingTimes(payload, upcoming);
  } catch {
    /* keep snapshot times */
  }
  try {
    payload = await overlayLiveTennisDvp(payload);
  } catch {
    /* keep baked DVP */
  }
  result = filterTennisListByTour(payload, tour);
  if (result.data.length === 0) {
    await sharedCache.setJSON(emptyKey, { at: Date.now() }, TENNIS_EMPTY_TOUR_TTL_SECONDS);
  } else {
    await Promise.allSettled([
      sharedCache.deleteJSON(emptyKey),
      sharedCache.deleteJSON('tennis_props_empty_all_v1'),
      sharedCache.deleteJSON('tennis_props_empty_atp_v1'),
      sharedCache.deleteJSON('tennis_props_empty_wta_v1'),
    ]);
  }
  return result;
}
