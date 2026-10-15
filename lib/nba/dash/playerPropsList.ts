/**
 * NBA props-page list, built the same way as the NBL list: the cron-fed odds board
 * (BallDontLie + odds-api.net), stored game logs and the dashboard's DvP.
 * O/U replaces milestones when both exist; milestone prices must sit between $1.55 and $2.60.
 * Users and the combined snapshot read the cached list only.
 */

import type { CombinedAflGame, CombinedPlayerProp } from '@/lib/combinedPropsSnapshotTypes';
import { applyLiveAflPropsCutoff, isAflCommenceTimePropsEligible } from '@/lib/combinedPropsSnapshotTypes';
import { calculateImpliedProbabilities } from '@/lib/impliedProbability';
import { getBookmakerRegion } from '@/lib/bookmakers';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { getNbaOddsCache, nbaPlayerPropsByStat, normalizeNbaPropPlayerName } from './odds';
import {
  nbaBookLines,
  nbaFilterMilestoneLinesForPropsPage,
  nbaPreferOuLines,
  parseNbaOddsLine,
  type NbaBookRow,
  type NbaGameOdds,
  type NbaPropLine,
} from './oddsTypes';
import { buildNbaPropDvpIndex, type NbaPropDvpIndex } from './playerPropsDvp';
import {
  NBA_LIST_SCHEMA,
  readNbaPlayerPropsListCache,
  writeNbaPlayerPropsListCache,
  type NbaListCachePayload,
} from './playerPropsListCache';
import { BOX_COLUMNS, selectAllParallel, toNbaGameLogRow } from './season';
import { loadNbaRoster, type NbaRosterPlayer } from './server';
import { NBA_CHART_HISTORY_YEARS, NBA_CURRENT_SEASON_YEAR, normalizeTeamKey, resolveNbaClub } from './teams';
import type { NbaGameLogRow } from './types';

export const NBA_USER_NO_ODDS = 'No odds available. Come back later.';

const LIST_STATS = ['points', 'rebounds', 'assists', 'threeMade', 'pra', 'pr', 'pa', 'ra'] as const;
const PREFERRED_THRESHOLDS: Record<string, number> = {
  points: 20,
  rebounds: 6,
  assists: 4,
  threeMade: 2,
  pra: 30,
  pr: 25,
  pa: 25,
  ra: 10,
};
/** Props-page NBA stat keys (the page's NBA labels, ordering and dashboard links use these). */
const PROPS_STAT_TYPE: Record<string, string> = {
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  threeMade: 'THREES',
  pra: 'PRA',
  pr: 'PR',
  pa: 'PA',
  ra: 'RA',
};
/** Box rows for this many players per query (each player is a few hundred games). */
const LOG_PLAYERS_PER_QUERY = 12;

export type NbaPlayerPropsListPayload = {
  success: boolean;
  listSchema?: number;
  data: CombinedPlayerProp[];
  games: CombinedAflGame[];
  propsCount: number;
  gamesCount: number;
  lastUpdated: string | null;
  nextUpdate: string | null;
  noNbaOdds: boolean;
  ingestMessage: string | null;
};

type PlayerLogs = { form: NbaGameLogRow[]; season: NbaGameLogRow[]; career: NbaGameLogRow[] };

function teamKey(raw: string | null | undefined): string {
  const club = resolveNbaClub(String(raw || ''));
  return normalizeTeamKey(club?.name || String(raw || ''));
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = teamKey(a);
  return Boolean(ka) && ka === teamKey(b);
}

async function loadLogsByPlayer(playerIds: string[]): Promise<Map<string, PlayerLogs>> {
  const ids = [...new Set(playerIds.map(Number).filter(Number.isFinite))];
  const raw = new Map<string, NbaGameLogRow[]>();
  const chunks: number[][] = [];
  for (let i = 0; i < ids.length; i += LOG_PLAYERS_PER_QUERY) chunks.push(ids.slice(i, i + LOG_PLAYERS_PER_QUERY));
  for (let i = 0; i < chunks.length; i += 3) {
    await Promise.all(
      chunks.slice(i, i + 3).map(async (chunk) => {
        const rows = await selectAllParallel(() =>
          supabaseAdmin
            .from('nba_player_game_stats')
            .select(BOX_COLUMNS)
            .in('player_id', chunk)
            .in('season', [...NBA_CHART_HISTORY_YEARS])
            .eq('period', 0)
            .order('player_id')
            .order('game_id')
        );
        for (const r of rows) {
          if (!((Number(r.minutes) || 0) > 0)) continue;
          const id = String(r.player_id);
          const list = raw.get(id) ?? [];
          list.push(toNbaGameLogRow(r, undefined, undefined));
          raw.set(id, list);
        }
      })
    );
  }
  const out = new Map<string, PlayerLogs>();
  for (const [id, logs] of raw) {
    const career = logs.sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
    out.set(id, {
      career,
      season: career.filter((g) => g.season === NBA_CURRENT_SEASON_YEAR),
      form: career.filter((g) => g.season >= NBA_CURRENT_SEASON_YEAR - 1),
    });
  }
  return out;
}

function statValue(game: NbaGameLogRow, stat: string): number | null {
  const v = (game as Record<string, unknown>)[stat];
  return v == null || !Number.isFinite(Number(v)) ? null : Number(v);
}

function windowHits(games: NbaGameLogRow[], stat: string, line: number, count: number | null, opponent?: string | null) {
  let pool = games;
  if (opponent) pool = pool.filter((g) => teamsMatch(g.opponent, opponent) || teamsMatch(g.opponentCode, opponent));
  else if (count != null) pool = pool.slice(-count);
  let hits = 0;
  let total = 0;
  let sum = 0;
  for (const g of pool) {
    const value = statValue(g, stat);
    if (value == null) continue;
    total += 1;
    sum += value;
    if (value > line) hits += 1;
  }
  if (!total) return { avg: null as number | null, hitRate: null as { hits: number; total: number } | null };
  return { avg: sum / total, hitRate: { hits, total } };
}

/** Newest-first over streak, same as NBL / AFL props. */
function streakOver(games: NbaGameLogRow[], stat: string, line: number): number | null {
  let streak = 0;
  let seen = false;
  for (let i = games.length - 1; i >= 0; i -= 1) {
    const value = statValue(games[i], stat);
    if (value == null) continue;
    seen = true;
    if (value > line) streak += 1;
    else break;
  }
  return seen ? streak : null;
}

function pickMainLine(lines: NbaPropLine[], stat: string): NbaPropLine | null {
  const preferred = nbaPreferOuLines(lines);
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

function isTwoWayOuLine(line: NbaPropLine): boolean {
  return line.kind === 'ou' && line.under !== 'N/A' && line.over !== 'N/A';
}

function bookLineAt(book: NbaBookRow, value: number): NbaPropLine | null {
  return (
    nbaBookLines(book).find((line) => {
      const next = parseNbaOddsLine(line.line);
      return next != null && Math.abs(next - value) < 0.01;
    }) ?? null
  );
}

/** Consensus line for the props list. Two-way O/U wins the market even if more books only have a milestone. */
export function nbaListConsensusLine(books: NbaBookRow[], stat: string): number | null {
  const counts = new Map<number, { books: number; twoWay: number }>();
  for (const book of books) {
    const seen = new Set<number>();
    for (const line of nbaBookLines(book)) {
      const value = parseNbaOddsLine(line.line);
      if (value == null) continue;
      const key = Math.round(value * 2) / 2;
      if (seen.has(key)) continue;
      seen.add(key);
      const row = counts.get(key) ?? { books: 0, twoWay: 0 };
      row.books += 1;
      if (isTwoWayOuLine(line)) row.twoWay += 1;
      counts.set(key, row);
    }
  }
  if (!counts.size) return null;
  const ouPool = [...counts.entries()].filter(([, row]) => row.twoWay > 0);
  const pool = ouPool.length ? ouPool : [...counts.entries()];
  const want = PREFERRED_THRESHOLDS[stat];
  const wantChart = want != null ? want - 0.5 : null;
  return pool.sort((a, b) => {
    if (b[1].twoWay !== a[1].twoWay) return b[1].twoWay - a[1].twoWay;
    if (b[1].books !== a[1].books) return b[1].books - a[1].books;
    if (wantChart != null) {
      const da = Math.abs(a[0] - wantChart);
      const db = Math.abs(b[0] - wantChart);
      if (da !== db) return da - db;
    }
    return a[0] - b[0];
  })[0][0];
}

function toCombinedRow(opts: {
  player: NbaRosterPlayer;
  team: string;
  opponent: string;
  opponentCode: string | null;
  stat: string;
  game: NbaGameOdds;
  books: NbaBookRow[];
  logs: PlayerLogs;
  dvpIndex: NbaPropDvpIndex;
}): CombinedPlayerProp | null {
  const filteredBooks = opts.books
    .map((book) => {
      const lines = nbaFilterMilestoneLinesForPropsPage(nbaBookLines(book));
      if (!lines.length) return null;
      const main = pickMainLine(lines, opts.stat);
      if (!main) return null;
      return { ...book, Total: { line: main.line, over: main.over, under: main.under }, lines };
    })
    .filter((b): b is NonNullable<typeof b> => b != null);
  if (!filteredBooks.length) return null;

  const line = nbaListConsensusLine(filteredBooks, opts.stat);
  if (line == null) return null;
  const booksAtLine = filteredBooks
    .map((book) => {
      const match = bookLineAt(book, line);
      return match ? { book, match } : null;
    })
    .filter((row): row is NonNullable<typeof row> => row != null);
  if (!booksAtLine.length) return null;

  const isAu = (row: { book: NbaBookRow }) => getBookmakerRegion(row.book.name) === 'au';
  const preferred =
    booksAtLine.find((row) => isTwoWayOuLine(row.match) && isAu(row)) ||
    booksAtLine.find((row) => isTwoWayOuLine(row.match)) ||
    booksAtLine.find(isAu) ||
    booksAtLine[0];
  const main = preferred.match;

  const implied = calculateImpliedProbabilities(main.over, main.under);
  const last5 = windowHits(opts.logs.form, opts.stat, line, 5);
  const last10 = windowHits(opts.logs.form, opts.stat, line, 10);
  const season = windowHits(opts.logs.season, opts.stat, line, null);
  const h2h = windowHits(opts.logs.career, opts.stat, line, null, opts.opponent);
  const position = opts.dvpIndex.positionFor(opts.player);

  return {
    playerName: opts.player.name,
    playerId: String(opts.player.playerId || opts.player.name),
    team: resolveNbaClub(opts.team)?.code ?? opts.team,
    opponent: opts.opponentCode ?? opts.opponent,
    statType: PROPS_STAT_TYPE[opts.stat] ?? opts.stat,
    line,
    overProb: implied?.overImpliedProb ?? 0,
    underProb: implied?.underImpliedProb ?? 0,
    overOdds: main.over,
    underOdds: main.under,
    impliedOverProb: implied?.overImpliedProb ?? 0,
    impliedUnderProb: implied?.underImpliedProb ?? 0,
    bestLine: line,
    bookmaker: preferred.book.name,
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
    streak: streakOver(opts.logs.form, opts.stat, line),
    ...opts.dvpIndex.lookup({ opponentCode: opts.opponentCode, position, stat: opts.stat }),
    position,
    nbaPosition: opts.player.position || null,
    bookmakerLines: booksAtLine
      .map(({ book, match }) => ({ bookmaker: book.name, line, overOdds: match.over, underOdds: match.under }))
      .sort((a, b) => {
        const aOu = a.underOdds !== 'N/A' && a.overOdds !== 'N/A' ? 1 : 0;
        const bOu = b.underOdds !== 'N/A' && b.overOdds !== 'N/A' ? 1 : 0;
        if (bOu !== aOu) return bOu - aOu;
        return (getBookmakerRegion(a.bookmaker) === 'au' ? 0 : 1) - (getBookmakerRegion(b.bookmaker) === 'au' ? 0 : 1);
      }),
    gameId: opts.game.gameId,
    homeTeam: opts.game.homeTeam,
    awayTeam: opts.game.awayTeam,
    homeTeamCode: resolveNbaClub(opts.game.homeTeam)?.code ?? null,
    awayTeamCode: resolveNbaClub(opts.game.awayTeam)?.code ?? null,
    playerTeam: opts.team,
    headshotUrl: opts.player.imageUrl || null,
    sportSource: 'nba',
  };
}

function gamePlayers(game: NbaGameOdds): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const players of Object.values(game.playerProps || {})) {
    for (const name of Object.keys(players || {})) {
      const key = normalizeNbaPropPlayerName(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

function emptyNbaListPayload(): NbaPlayerPropsListPayload {
  return {
    success: true,
    listSchema: NBA_LIST_SCHEMA,
    data: [],
    games: [],
    propsCount: 0,
    gamesCount: 0,
    lastUpdated: null,
    nextUpdate: null,
    noNbaOdds: true,
    ingestMessage: NBA_USER_NO_ODDS,
  };
}

function payloadFromCache(cached: NbaListCachePayload): NbaPlayerPropsListPayload {
  const live = applyLiveAflPropsCutoff(
    Array.isArray(cached.data) ? cached.data : [],
    Array.isArray(cached.games) ? cached.games : []
  );
  const empty = live.props.length === 0;
  return {
    success: true,
    listSchema: Number(cached.listSchema) || 0,
    data: live.props,
    games: live.games,
    propsCount: live.props.length,
    gamesCount: live.games.length,
    lastUpdated: cached.lastUpdated ?? null,
    nextUpdate: cached.nextUpdate ?? null,
    noNbaOdds: empty,
    ingestMessage: empty ? NBA_USER_NO_ODDS : cached.ingestMessage ?? null,
  };
}

async function buildNbaPlayerPropsList(): Promise<NbaPlayerPropsListPayload> {
  const board = await getNbaOddsCache();
  const slate = (board?.games ?? []).filter(
    (g) => g.playerProps && Object.keys(g.playerProps).length && isAflCommenceTimePropsEligible(g.commenceTime)
  );
  if (!slate.length) return emptyNbaListPayload();

  const roster = await loadNbaRoster();
  const rosterByName = new Map<string, NbaRosterPlayer[]>();
  for (const p of roster) {
    const key = normalizeNbaPropPlayerName(p.name);
    rosterByName.set(key, [...(rosterByName.get(key) ?? []), p]);
  }

  type Candidate = { game: NbaGameOdds; player: NbaRosterPlayer; propName: string; team: string; opponent: string };
  const candidates: Candidate[] = [];
  const games: CombinedAflGame[] = [];
  for (const game of slate) {
    games.push({ gameId: game.gameId, homeTeam: game.homeTeam, awayTeam: game.awayTeam, commenceTime: game.commenceTime });
    for (const propName of gamePlayers(game)) {
      const named = rosterByName.get(normalizeNbaPropPlayerName(propName)) ?? [];
      const player =
        named.find((p) => teamsMatch(p.team, game.homeTeam) || teamsMatch(p.team, game.awayTeam)) ?? null;
      if (!player) continue;
      const home = teamsMatch(player.team, game.homeTeam);
      candidates.push({
        game,
        player,
        propName,
        team: home ? game.homeTeam : game.awayTeam,
        opponent: home ? game.awayTeam : game.homeTeam,
      });
    }
  }

  const teamCodes = [...new Set(candidates.map((c) => c.player.teamCode).filter((c): c is string => !!c))];
  const [logsByPlayer, dvpIndex] = await Promise.all([
    loadLogsByPlayer(candidates.map((c) => String(c.player.playerId))),
    buildNbaPropDvpIndex(teamCodes),
  ]);
  const noLogs: PlayerLogs = { form: [], season: [], career: [] };

  const props: CombinedPlayerProp[] = [];
  for (const c of candidates) {
    const byStat = nbaPlayerPropsByStat(c.game, c.propName);
    const logs = logsByPlayer.get(String(c.player.playerId)) ?? noLogs;
    for (const stat of LIST_STATS) {
      const row = toCombinedRow({
        player: c.player,
        team: c.team,
        opponent: c.opponent,
        opponentCode: resolveNbaClub(c.opponent)?.code ?? null,
        stat,
        game: c.game,
        books: byStat[stat] ?? [],
        logs,
        dvpIndex,
      });
      if (row) props.push(row);
    }
  }
  props.sort(
    (a, b) =>
      String(a.gameDate).localeCompare(String(b.gameDate)) ||
      a.playerName.localeCompare(b.playerName) ||
      a.statType.localeCompare(b.statType)
  );

  const live = applyLiveAflPropsCutoff(props, games);
  const empty = live.props.length === 0;
  return {
    success: true,
    listSchema: NBA_LIST_SCHEMA,
    data: live.props,
    games: live.games,
    propsCount: live.props.length,
    gamesCount: live.games.length,
    lastUpdated: new Date().toISOString(),
    nextUpdate: board?.nextUpdate ?? null,
    noNbaOdds: empty,
    ingestMessage: empty ? NBA_USER_NO_ODDS : null,
  };
}

let listBuildInflight: Promise<NbaPlayerPropsListPayload> | null = null;

/**
 * Users and the combined snapshot read the cache only (never rebuild).
 * The NBA odds cron passes `refresh` to rebuild from the stored board; `dryRun` skips the write.
 */
export async function getNbaPlayerPropsList(opts?: {
  refresh?: boolean;
  dryRun?: boolean;
}): Promise<NbaPlayerPropsListPayload> {
  if (!opts?.refresh) {
    const cached = await readNbaPlayerPropsListCache();
    if (cached?.data?.length && Number(cached.listSchema) === NBA_LIST_SCHEMA) return payloadFromCache(cached);
    return emptyNbaListPayload();
  }
  if (listBuildInflight) return listBuildInflight;
  listBuildInflight = (async () => {
    const payload = await buildNbaPlayerPropsList();
    if (payload.data.length > 0) {
      if (!opts.dryRun) await writeNbaPlayerPropsListCache(payload);
      return payload;
    }
    const previous = await readNbaPlayerPropsListCache();
    if (previous?.data?.length && Number(previous.listSchema) === NBA_LIST_SCHEMA) return payloadFromCache(previous);
    return payload;
  })().finally(() => {
    listBuildInflight = null;
  });
  return listBuildInflight;
}
