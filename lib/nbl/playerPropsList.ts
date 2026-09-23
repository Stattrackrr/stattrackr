/**
 * NBL props-page list. Cache only (Pulse board + disk snapshots + player logs).
 * O/U replaces milestones when both exist. Milestone prices on this list must
 * sit between $1.55 and $2.60; the dashboard stays unfiltered.
 */

import fs from 'fs';
import path from 'path';
import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import {
  nblBookLines,
  nblFilterMilestoneLinesForPropsPage,
  nblPreferOuLines,
  parseNblOddsLine,
  type NblBookRow,
  type NblPropLine,
} from '@/lib/nbl/oddsTypes';
import {
  listNblPlayerPropSnapshots,
  type NblPlayerPropSnapshot,
} from '@/lib/nbl/playerPropSnapshots';
import { buildNblPropDvpIndex, lookupNblPropDvp, type NblPropDvpIndex } from '@/lib/nbl/playerPropsDvp';
import { lookupNblPlayerPlayType } from '@/lib/nbl/playTypes';
import {
  readNblPlayerPropsListCache,
  writeNblPlayerPropsListCache,
  type NblListCachePayload,
} from '@/lib/nbl/playerPropsListCache';
import {
  getNblPulseScoreBoard,
  namesMatch,
  pulseBooksByStat,
  type PulseNblGame,
} from '@/lib/nbl/pulseScore';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CHART_HISTORY_YEARS, NBL_CURRENT_SEASON_YEAR, resolveNblClubName } from '@/lib/nblTeamCanonical';

export const NBL_USER_NO_ODDS = 'No odds available. Come back later.';

const LIST_DISK_PATH = path.join(
  process.cwd(),
  'data',
  'nbl-model',
  'cache',
  'player-props-list.json'
);

function readListDiskCache(): NblListCachePayload | null {
  const parsed = readJson<NblListCachePayload>(LIST_DISK_PATH);
  if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) return parsed;
  return null;
}

function writeListDiskCache(payload: NblListCachePayload): void {
  try {
    fs.mkdirSync(path.dirname(LIST_DISK_PATH), { recursive: true });
    fs.writeFileSync(LIST_DISK_PATH, JSON.stringify(payload));
  } catch {
    /* ignore quota / readonly */
  }
}

async function readUsableNblListCache(): Promise<NblListCachePayload | null> {
  return (await readNblPlayerPropsListCache()) || readListDiskCache();
}

async function persistNblListCache(payload: NblPlayerPropsListPayload): Promise<void> {
  await writeNblPlayerPropsListCache(payload);
  writeListDiskCache(payload);
}

const LIST_STATS = ['points', 'rebounds', 'assists', 'threeMade'] as const;
const PREFERRED_THRESHOLDS: Record<string, number> = {
  points: 20,
  rebounds: 6,
  assists: 4,
  threeMade: 1,
};

type RosterPlayer = {
  playerId?: string | null;
  name: string;
  team?: string | null;
  imageUrl?: string | null;
  position?: string | null;
};

export type NblPlayerPropsListPayload = {
  success: boolean;
  data: CombinedPlayerProp[];
  games: CombinedAflGame[];
  propsCount: number;
  gamesCount: number;
  lastUpdated: string | null;
  nextUpdate: string | null;
  noAflOdds: boolean;
  noNblOdds: boolean;
  ingestMessage: string | null;
};

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function loadRoster(): RosterPlayer[] {
  const file = path.join(process.cwd(), 'data', `nbl-roster-${NBL_CURRENT_SEASON_YEAR}.json`);
  const snap = readJson<{ players?: RosterPlayer[] }>(file);
  return Array.isArray(snap?.players) ? snap.players : [];
}

function loadPlayerGames(playerId: string, year: number): NblGameLogRow[] {
  const file = path.join(
    process.cwd(),
    'data',
    'nbl-model',
    'cache',
    'player-logs',
    `${playerId}-${year}.json`
  );
  const snap = readJson<{ games?: NblGameLogRow[] }>(file);
  return Array.isArray(snap?.games) ? snap.games : [];
}

function mergeGameLogs(seasons: NblGameLogRow[][]): NblGameLogRow[] {
  const seen = new Set<string>();
  const out: NblGameLogRow[] = [];
  for (const games of seasons) {
    for (const game of games) {
      const key = String(game.matchId || `${game.date}|${game.opponent}`);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(game);
    }
  }
  return out.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
}

function loadPlayerFormAndSeason(playerId: string): {
  season: NblGameLogRow[];
  form: NblGameLogRow[];
  career: NblGameLogRow[];
} {
  const season = loadPlayerGames(playerId, NBL_CURRENT_SEASON_YEAR);
  const previous = loadPlayerGames(playerId, NBL_CURRENT_SEASON_YEAR - 1);
  const career = mergeGameLogs(NBL_CHART_HISTORY_YEARS.map((year) => loadPlayerGames(playerId, year)));
  return { season, form: mergeGameLogs([previous, season]), career };
}

function officialTeam(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  return resolveNblClubName(s) || s;
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ca = officialTeam(a);
  const cb = officialTeam(b);
  if (!ca || !cb) return false;
  return ca.toLowerCase() === cb.toLowerCase();
}

/** Same derby even when home/away or date stamps differ across Pulse vs snapshots. */
function matchupKey(home: string | null | undefined, away: string | null | undefined): string {
  return [officialTeam(home), officialTeam(away)].filter(Boolean).sort().join('|');
}

function mergeSnapshots(a: NblPlayerPropSnapshot, b: NblPlayerPropSnapshot): NblPlayerPropSnapshot {
  const aOfficial = Boolean(resolveNblClubName(a.homeTeam) && resolveNblClubName(a.awayTeam));
  const bOfficial = Boolean(resolveNblClubName(b.homeTeam) && resolveNblClubName(b.awayTeam));
  const base = bOfficial && !aOfficial ? b : a;
  const other = base === a ? b : a;
  const books = [...new Set([...(base.books || []), ...(other.books || [])])];
  const lines = [...(base.lines || [])];
  for (const line of other.lines || []) {
    if (
      !lines.some(
        (existing) =>
          existing.book === line.book &&
          existing.stat === line.stat &&
          existing.playerKey === line.playerKey &&
          existing.line === line.line &&
          existing.kind === line.kind
      )
    ) {
      lines.push(line);
    }
  }
  return {
    ...base,
    homeTeam: officialTeam(base.homeTeam),
    awayTeam: officialTeam(base.awayTeam),
    books,
    lines,
    lineCount: lines.length,
  };
}

function mergeBooks(a: NblBookRow[], b: NblBookRow[]): NblBookRow[] {
  const out = [...a];
  for (const book of b) {
    if (!out.some((row) => row.name === book.name)) out.push(book);
  }
  return out;
}

function mergeDuplicatePropRows(props: CombinedPlayerProp[]): CombinedPlayerProp[] {
  const byKey = new Map<string, CombinedPlayerProp>();
  for (const row of props) {
    const key = `${row.playerId}|${row.statType}|${matchupKey(row.homeTeam, row.awayTeam)}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevH2h = prev.h2hAvg != null ? 1 : 0;
    const nextH2h = row.h2hAvg != null ? 1 : 0;
    const prevBooks = prev.bookmakerLines?.length || 0;
    const nextBooks = row.bookmakerLines?.length || 0;
    const keep = nextH2h > prevH2h || (nextH2h === prevH2h && nextBooks > prevBooks) ? row : prev;
    const other = keep === row ? prev : row;
    const lines = [...(keep.bookmakerLines || [])];
    for (const line of other.bookmakerLines || []) {
      if (!lines.some((existing) => existing.bookmaker === line.bookmaker && existing.line === line.line)) {
        lines.push(line);
      }
    }
    byKey.set(key, { ...keep, bookmakerLines: lines });
  }
  return [...byKey.values()];
}

function statValue(game: NblGameLogRow, stat: string): number | null {
  const raw =
    stat === 'points'
      ? game.points
      : stat === 'rebounds'
        ? game.rebounds
        : stat === 'assists'
          ? game.assists
          : stat === 'threeMade'
            ? game.threeMade
            : null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function windowHits(
  games: NblGameLogRow[],
  stat: string,
  line: number,
  count: number | null,
  opponent?: string | null
) {
  let pool = [...games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (opponent) {
    pool = pool.filter((g) => teamsMatch(g.opponent, opponent) || teamsMatch(g.opponentCode, opponent));
  } else if (count != null) {
    pool = pool.slice(-count);
  }
  let hits = 0;
  let total = 0;
  for (const g of pool) {
    const value = statValue(g, stat);
    if (value == null) continue;
    total += 1;
    if (value > line) hits += 1;
  }
  if (!total) return { avg: null as number | null, hitRate: null as { hits: number; total: number } | null };
  const avg =
    pool.reduce((sum, g) => sum + (statValue(g, stat) ?? 0), 0) / total;
  return { avg, hitRate: { hits, total } };
}

/** Newest-first over streak, same as AFL props. */
function streakOver(games: NblGameLogRow[], stat: string, line: number): number | null {
  const newestFirst = [...games].sort((a, b) => String(a.date || '').localeCompare(String(b.date || ''))).reverse();
  const values: number[] = [];
  for (const game of newestFirst) {
    const value = statValue(game, stat);
    if (value == null) continue;
    values.push(value);
  }
  if (!values.length) return null;
  let streak = 0;
  for (const value of values) {
    if (value > line) streak += 1;
    else break;
  }
  return streak;
}

function pickMainLine(lines: NblPropLine[], stat: string): NblPropLine | null {
  const preferred = nblPreferOuLines(lines);
  if (!preferred.length) return null;
  const twoWay = preferred.find((l) => l.kind === 'ou');
  if (twoWay) return twoWay;
  const want = PREFERRED_THRESHOLDS[stat];
  if (want != null) {
    const exact = preferred.find((l) => l.label === `${want}+`);
    if (exact) return exact;
    return [...preferred].sort((a, b) => {
      const da = Math.abs((parseFloat(a.label) || parseFloat(a.line) || 0) - want);
      const db = Math.abs((parseFloat(b.label) || parseFloat(b.line) || 0) - want);
      return da - db;
    })[0];
  }
  return preferred[0];
}

function booksFromSnapshot(
  snap: NblPlayerPropSnapshot,
  player: string,
  stat: string
): NblBookRow[] {
  const rows: NblBookRow[] = [];
  const books = [...new Set(snap.lines.filter((l) => l.stat === stat && namesMatch(player, l.player)).map((l) => l.book))];
  for (const book of books) {
    const lines = nblPreferOuLines(
      snap.lines
        .filter((l) => l.book === book && l.stat === stat && namesMatch(player, l.player))
        .map((l): NblPropLine => ({
          line: String(l.line),
          over: l.over,
          under: l.under,
          kind: l.kind,
          label: l.label,
        }))
    );
    if (!lines.length) continue;
    const main = pickMainLine(lines, stat);
    if (!main) continue;
    rows.push({
      name: book,
      H2H: { home: 'N/A', away: 'N/A' },
      Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
      Total: { line: main.line, over: main.over, under: main.under },
      lines,
    });
  }
  return rows;
}

function snapshotPlayers(snap: NblPlayerPropSnapshot): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of snap.lines) {
    const key = line.playerKey || line.player.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line.player);
  }
  return out;
}

function pulsePlayers(game: PulseNblGame): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const book of game.bookmakers) {
    for (const market of book.markets || []) {
      for (const sel of market.selections || []) {
        const name = String(sel.rawName || sel.name || '')
          .replace(/\s*\([^)]*\)\s*$/g, '')
          .replace(/\s+(over|under)\b.*$/i, '')
          .trim();
        if (!name) continue;
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(name);
      }
    }
  }
  return out;
}

function toCombinedRow(opts: {
  player: RosterPlayer | { name: string; playerId?: string | null; team?: string | null; imageUrl?: string | null; position?: string | null };
  opponent: string;
  team: string;
  stat: string;
  game: { gameId: string; homeTeam: string; awayTeam: string; commenceTime: string };
  books: NblBookRow[];
  games: NblGameLogRow[];
  seasonGames: NblGameLogRow[];
  careerGames?: NblGameLogRow[];
  dvpIndex: NblPropDvpIndex;
}): CombinedPlayerProp | null {
  const filteredBooks = opts.books
    .map((book) => {
      const lines = nblFilterMilestoneLinesForPropsPage(nblBookLines(book));
      if (!lines.length) return null;
      const main = pickMainLine(lines, opts.stat);
      if (!main) return null;
      return {
        ...book,
        Total: { line: main.line, over: main.over, under: main.under },
        lines,
      };
    })
    .filter((b): b is NonNullable<typeof b> => b != null);
  if (!filteredBooks.length) return null;

  const preferred =
    filteredBooks.find((b) => /sportsbet/i.test(b.name)) ||
    filteredBooks.find((b) => /tab/i.test(b.name)) ||
    filteredBooks[0];
  const main = pickMainLine(nblBookLines(preferred), opts.stat);
  if (!main) return null;
  const line = parseNblOddsLine(main.line);
  if (line == null) return null;

  const implied = calculateImpliedProbabilities(main.over, main.under);
  const last5 = windowHits(opts.games, opts.stat, line, 5);
  const last10 = windowHits(opts.games, opts.stat, line, 10);
  const season = windowHits(opts.seasonGames, opts.stat, line, null);
  const h2hOpponent = teamsMatch(opts.opponent, opts.team)
    ? officialTeam(opts.game.homeTeam) === officialTeam(opts.team)
      ? officialTeam(opts.game.awayTeam)
      : officialTeam(opts.game.homeTeam)
    : opts.opponent;
  const h2h = windowHits(opts.careerGames?.length ? opts.careerGames : opts.games, opts.stat, line, null, h2hOpponent);

  return {
    playerName: opts.player.name,
    playerId: String(opts.player.playerId || opts.player.name),
    team: opts.team,
    opponent: h2hOpponent,
    statType: opts.stat,
    line,
    overProb: implied?.overImpliedProb ?? 0,
    underProb: implied?.underImpliedProb ?? 0,
    overOdds: main.over,
    underOdds: main.under,
    impliedOverProb: implied?.overImpliedProb ?? 0,
    impliedUnderProb: implied?.underImpliedProb ?? 0,
    bestLine: line,
    bookmaker: preferred.name,
    confidence: 'Medium',
    gameDate: opts.game.commenceTime,
    last5Avg: last5.avg,
    last10Avg: last10.avg,
    h2hAvg: h2h.avg,
    last5HitRate: last5.hitRate,
    last10HitRate: last10.hitRate,
    h2hHitRate: h2h.hitRate,
    seasonAvg: season.avg,
    seasonHitRate: season.hitRate,
    streak: streakOver(opts.games, opts.stat, line),
    ...lookupNblPropDvp(opts.dvpIndex, {
      playerId: opts.player.playerId,
      playerName: opts.player.name,
      opponent: h2hOpponent,
      stat: opts.stat,
    }),
    position: null,
    nblPosition: opts.player.position || null,
    nblPlayType: lookupNblPlayerPlayType({
      playerId: opts.player.playerId,
      playerName: opts.player.name,
    }),
    bookmakerLines: filteredBooks.map((book) => {
      const chosen = pickMainLine(nblBookLines(book), opts.stat)!;
      return {
        bookmaker: book.name,
        line: parseNblOddsLine(chosen.line) ?? line,
        overOdds: chosen.over,
        underOdds: chosen.under,
      };
    }),
    gameId: opts.game.gameId,
    homeTeam: opts.game.homeTeam,
    awayTeam: opts.game.awayTeam,
    playerTeam: opts.team,
    headshotUrl: opts.player.imageUrl || null,
  };
}

function matchRoster(roster: RosterPlayer[], name: string, team?: string | null): RosterPlayer | null {
  const named = roster.filter((p) => namesMatch(p.name, name));
  if (!named.length) return { name, playerId: null, team: team || null, imageUrl: null };
  if (team) {
    const onTeam = named.find((p) => teamsMatch(p.team, team));
    if (onTeam) return onTeam;
  }
  return named[0];
}

function emptyNblListPayload(): NblPlayerPropsListPayload {
  return {
    success: true,
    data: [],
    games: [],
    propsCount: 0,
    gamesCount: 0,
    lastUpdated: null,
    nextUpdate: null,
    noAflOdds: true,
    noNblOdds: true,
    ingestMessage: NBL_USER_NO_ODDS,
  };
}

function payloadFromCache(cached: NonNullable<Awaited<ReturnType<typeof readNblPlayerPropsListCache>>>): NblPlayerPropsListPayload {
  const data = Array.isArray(cached.data) ? cached.data : [];
  const games = Array.isArray(cached.games) ? cached.games : [];
  const empty = data.length === 0;
  return {
    success: true,
    data,
    games,
    propsCount: data.length,
    gamesCount: games.length,
    lastUpdated: cached.lastUpdated ?? null,
    nextUpdate: cached.nextUpdate ?? null,
    noAflOdds: empty,
    noNblOdds: empty,
    ingestMessage: empty ? NBL_USER_NO_ODDS : cached.ingestMessage ?? null,
  };
}

async function buildNblPlayerPropsList(): Promise<NblPlayerPropsListPayload> {
  const roster = loadRoster();
  const pulseGames = await getNblPulseScoreBoard();
  const snapshots = await listNblPlayerPropSnapshots();
  const snapshotByKey = new Map<string, NblPlayerPropSnapshot>();
  for (const snap of snapshots) {
    const key = matchupKey(snap.homeTeam, snap.awayTeam);
    const prev = snapshotByKey.get(key);
    snapshotByKey.set(key, prev ? mergeSnapshots(prev, snap) : snap);
  }

  const games: CombinedAflGame[] = [];
  const seenGames = new Set<string>();
  const props: CombinedPlayerProp[] = [];
  const dvpIndex = buildNblPropDvpIndex();

  const considerGame = (
    game: { gameId: string; homeTeam: string; awayTeam: string; commenceTime: string },
    players: string[],
    booksFor: (player: string, stat: string) => NblBookRow[]
  ) => {
    const home = officialTeam(game.homeTeam);
    const away = officialTeam(game.awayTeam);
    const key = matchupKey(home, away);
    if (!seenGames.has(key)) {
      seenGames.add(key);
      games.push({
        gameId: game.gameId,
        homeTeam: home,
        awayTeam: away,
        commenceTime: game.commenceTime,
      });
    }

    for (const playerName of players) {
      const homeHit = matchRoster(roster, playerName, home);
      const awayHit = matchRoster(roster, playerName, away);
      const rosterHit =
        (homeHit?.team && teamsMatch(homeHit.team, home) ? homeHit : null) ||
        (awayHit?.team && teamsMatch(awayHit.team, away) ? awayHit : null) ||
        homeHit ||
        awayHit;
      const team = officialTeam(rosterHit?.team) || '';
      if (!team || (!teamsMatch(team, home) && !teamsMatch(team, away))) continue;
      const opponent = teamsMatch(team, home) ? away : home;
      const logs = rosterHit?.playerId
        ? loadPlayerFormAndSeason(String(rosterHit.playerId))
        : { season: [], form: [], career: [] };

      for (const stat of LIST_STATS) {
        const books = booksFor(rosterHit?.name || playerName, stat);
        const row = toCombinedRow({
          player: rosterHit || { name: playerName },
          opponent,
          team,
          stat,
          game: { ...game, homeTeam: home, awayTeam: away },
          books,
          games: logs.form,
          seasonGames: logs.season,
          careerGames: logs.career,
          dvpIndex,
        });
        if (row) props.push(row);
      }
    }
  };

  for (const game of pulseGames) {
    const home = officialTeam(game.homeTeam);
    const away = officialTeam(game.awayTeam);
    const snap = snapshotByKey.get(matchupKey(home, away));
    const players = [...new Set([...pulsePlayers(game), ...(snap ? snapshotPlayers(snap) : [])])];
    considerGame(game, players, (player, stat) =>
      mergeBooks(pulseBooksByStat(game, player)[stat] || [], snap ? booksFromSnapshot(snap, player, stat) : [])
    );
    snapshotByKey.delete(matchupKey(home, away));
  }

  for (const snap of snapshotByKey.values()) {
    considerGame(
      {
        gameId: snap.gameId,
        homeTeam: snap.homeTeam,
        awayTeam: snap.awayTeam,
        commenceTime: snap.commenceTime,
      },
      snapshotPlayers(snap),
      (player, stat) => booksFromSnapshot(snap, player, stat)
    );
  }

  const deduped = mergeDuplicatePropRows(props);
  deduped.sort((a, b) => {
    const tip = String(a.gameDate).localeCompare(String(b.gameDate));
    if (tip) return tip;
    const name = a.playerName.localeCompare(b.playerName);
    if (name) return name;
    return a.statType.localeCompare(b.statType);
  });

  const empty = deduped.length === 0;
  return {
    success: true,
    data: deduped,
    games,
    propsCount: deduped.length,
    gamesCount: games.length,
    lastUpdated: new Date().toISOString(),
    nextUpdate: null,
    noAflOdds: empty,
    noNblOdds: empty,
    ingestMessage: empty ? NBL_USER_NO_ODDS : null,
  };
}

let listBuildInflight: Promise<NblPlayerPropsListPayload> | null = null;

/**
 * User/combined path: cache only. Pass refresh to rebuild from Pulse/disk cache.
 */
export async function getNblPlayerPropsList(opts?: {
  refresh?: boolean;
}): Promise<NblPlayerPropsListPayload> {
  if (!opts?.refresh) {
    const cached = await readUsableNblListCache();
    if (cached?.data?.length) return payloadFromCache(cached);
    return emptyNblListPayload();
  }
  if (listBuildInflight) return listBuildInflight;
  listBuildInflight = (async () => {
    const payload = await buildNblPlayerPropsList();
    if (payload.data.length > 0) {
      await persistNblListCache(payload);
      return payload;
    }
    const previous = await readUsableNblListCache();
    if (previous?.data?.length) return payloadFromCache(previous);
    return payload;
  })().finally(() => {
    listBuildInflight = null;
  });
  return listBuildInflight;
}
