/**
 * Tennis props-page list: one row per player / market / bookmaker,
 * same shape as AFL `/api/afl/player-props/list`.
 */

import sharedCache from '@/lib/sharedCache';
import { hydrateTennisMatchOverlay } from '@/lib/tennis/ingest';
import { TENNIS_CURRENT_YEAR, loadPlayerMatches, loadTennisPlayers, tennisDvpProfile } from '@/lib/tennis/data';
import { resolveTennisHeadshotUrl } from '@/lib/tennis/headshots';
import {
  listTennisOddsIndex,
  readTennisOddsSnapshot,
  refreshTennisOddsSnapshots,
  type TennisOddsIndexMatch,
  type TennisOddsSnapshot,
} from '@/lib/tennis/odds';
import {
  listUniqueUpcomingTennisGames,
  tennisCommenceTimeForMatch,
  warmTennisUpcomingFixtures,
} from '@/lib/tennis/nextGame';
import { readOddsApiTennisCatalog, tennisNamesMatch, tennisTourFromOdds } from '@/lib/tennis/oddsApi';
import {
  tennisMainLineForStat,
  tennisMoneylinePriceMeetsMin,
  tennisValueHitsOver,
  type TennisBookRow,
  type TennisOuLine,
} from '@/lib/tennis/oddsTypes';
import type { TennisDvpMetricKey } from '@/lib/tennis/dvpShared';
import { lookupTennisSurface } from '@/lib/tennis/surfaces';
import type { TennisMatchRow, TennisTour } from '@/lib/tennis/types';

export const TENNIS_USER_NO_ODDS = 'No odds available. Come back later.';
export const TENNIS_LIST_CACHE_KEY = 'tennis_player_props_list_v13';
const TENNIS_LIST_CACHE_TTL_SECONDS = 20 * 60;
const TENNIS_EMPTY_TOUR_TTL_SECONDS = 15 * 60;

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
    find(name: string): PlayerMeta | null {
      const key = name.toLowerCase().trim();
      if (byName.has(key)) return byName.get(key) ?? null;
      return (
        players.find(
          (player) => tennisNamesMatch(player.name, name)
        ) ?? null
      );
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
  await hydrateTennisMatchOverlay();
  const [index, catalog, players] = await Promise.all([
    listTennisOddsIndex(),
    readOddsApiTennisCatalog(),
    Promise.resolve(
      loadTennisPlayers({ currentOnly: true }).map((player) => ({
        playerId: player.playerId,
        tour: player.tour,
        name: player.name,
        imageUrl: player.imageUrl || null,
        ioc: player.ioc || null,
        rank: player.rank ?? null,
      }))
    ),
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

  const matchesFor = (playerName: string, playerId: string | null): TennisMatchRow[] => {
    const key = `${playerId || ''}|${playerName.toLowerCase()}`;
    const cached = matchCache.get(key);
    if (cached) return cached;
    const rows = loadPlayerMatches({ playerId, playerName });
    matchCache.set(key, rows);
    return rows;
  };

  const dvpForOpponent = (tour: TennisTour, opponentName: string, opponentId: string | null) => {
    const cacheKey = `${tour}|${opponentId || opponentName.toLowerCase()}`;
    const cached = dvpCache.get(cacheKey);
    if (cached && !Array.isArray(cached)) return cached;
    const profile = tennisDvpProfile({
      tour,
      year: TENNIS_CURRENT_YEAR,
      opponentName,
      opponentId,
    });
    dvpCache.set(cacheKey, profile);
    return profile;
  };

  for (const snapshot of snapshots) {
    if (!snapshot.bookmakers?.length) continue;
    const homeMeta = lookup.find(snapshot.homeName);
    const awayMeta = lookup.find(snapshot.awayName);
    const matchTour = inferMatchTour(snapshot, homeMeta, awayMeta);
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
      const headshotUrl = resolveTennisHeadshotUrl(playerId, meta?.imageUrl || null);
      const dvpProfile = dvpForOpponent(tour, opponent, opponentId);
      const dvpFor = (stat: TennisPropStat): DvpFields => {
        const metric = dvpProfile.metrics.find((row) => row.key === dvpMetricForStat(stat));
        return {
          dvpRating: metric?.rank ?? null,
          dvpStatValue: metric?.value ?? null,
          dvpFieldSize: metric?.fieldSize ?? dvpProfile.fieldSize ?? null,
        };
      };
      const books = orientBooks(snapshot.bookmakers, side.isHome);
      for (const book of books) {
        data.push(
          ...rowsForBook({
            game,
            playerName,
            playerId,
            tour,
            opponent,
            playerIoc: meta?.ioc ?? null,
            playerRank: meta?.rank ?? null,
            opponentIoc: side.opponentMeta?.ioc ?? null,
            opponentRank: side.opponentMeta?.rank ?? null,
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

  games.sort((a, b) => String(a.commenceTime).localeCompare(String(b.commenceTime)));
  const lastUpdated =
    snapshots.reduce((latest, row) => (row.fetchedAt > latest ? row.fetchedAt : latest), '') || null;
  const empty = data.length === 0;
  return {
    success: true,
    data,
    games,
    propsCount: data.length,
    gamesCount: games.length,
    lastUpdated,
    nextUpdate: null,
    noTennisOdds: empty,
    noAflOdds: empty,
    ingestMessage: empty ? TENNIS_USER_NO_ODDS : null,
  };
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
    if (cached?.success && Array.isArray(cached.data)) return cached;
  }
  const payload = await buildTennisPlayerPropsList();
  await sharedCache.setJSON(TENNIS_LIST_CACHE_KEY, payload, TENNIS_LIST_CACHE_TTL_SECONDS);
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
  let result = filterTennisListByTour(payload, tour);
  if (!tour || result.data.length > 0) return result;

  const emptyKey = `tennis_props_empty_${tour.toLowerCase()}_v1`;
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
  result = filterTennisListByTour(payload, tour);
  if (result.data.length === 0) {
    await sharedCache.setJSON(emptyKey, { at: Date.now() }, TENNIS_EMPTY_TOUR_TTL_SECONDS);
  } else {
    await sharedCache.deleteJSON(emptyKey).catch(() => undefined);
  }
  return result;
}
