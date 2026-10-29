/**
 * Cron-only NBA odds ingest: BallDontLie v2 game lines and player props for the coming week, plus
 * odds-api.net player props and game lines (alternates included) from the AU books, stored as one
 * board in Redis. Dashboard reads stay cache-only.
 *
 * Once a game tips, its last pre-game board is kept as-is so in-play prices never reach the dashboard.
 */

import sharedCache from '@/lib/sharedCache';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { BdlClient } from '@/lib/nba/bdl/client';
import { NBA_DASH_ODDS_KEY, normalizeNbaPropPlayerName } from './odds';
import { recordNbaLineMoves } from './lineMovement';
import { fetchNbaOddsNetProps, isNbaOddsNetBook, isNbaOddsNetGameBook, type NbaOddsNetResult } from './oddsApiNet';
import type { NbaBookRow, NbaGameOdds, NbaOddsCache, NbaPlayerPropsByBook } from './oddsTypes';
import { getNbaClubById } from './teams';

const DAYS_BACK = 1;
const DAYS_AHEAD = 6;
const PROPS_WINDOW_MS = (DAYS_AHEAD + 1) * 24 * 60 * 60 * 1000;
/**
 * odds-api.net costs 1 credit per request (250k/month on Starter, shared with NBL): the soonest
 * games every 25 minutes, the day's slate every run inside 6 hours of tip, and the last 90 minutes
 * every 3 minutes (refreshNbaNearTipOdds). About 60k a month for NBA.
 */
const ODDS_NET_MAX_GAMES = 15;
const ODDS_NET_MIN_INTERVAL_MS = 25 * 60 * 1000;
/** Games inside this of tip are pulled every cron run (10 minutes; a little under so jitter never skips one). */
const ODDS_NET_NEAR_TIP_MS = 6 * 60 * 60 * 1000;
const ODDS_NET_NEAR_INTERVAL_MS = 9 * 60 * 1000;
/** The quick refresh covers games this close to tip. */
const ODDS_NET_FINAL_MS = 90 * 60 * 1000;
/** Matches findNbaOddsGame's 4h cutoff with some slack. */
const KEEP_AFTER_TIP_MS = 6 * 60 * 60 * 1000;
const BOARD_TTL_SECONDS = 3 * 24 * 60 * 60;
const CRON_INTERVAL_MS = 10 * 60 * 1000;
/** Prediction exchanges, not sportsbooks. */
const EXCLUDED_VENDORS = new Set(['kalshi', 'polymarket']);

const PROP_TYPE_TO_KEY: Record<string, string> = {
  points: 'PTS',
  rebounds: 'REB',
  assists: 'AST',
  threes: 'THREES',
  steals: 'STL',
  blocks: 'BLK',
  turnovers: 'TO',
  points_rebounds_assists: 'PRA',
  points_rebounds: 'PR',
  points_assists: 'PA',
  rebounds_assists: 'RA',
  double_double: 'DD',
  triple_double: 'TD',
  points_1q: 'PTS_1Q',
  rebounds_1q: 'REB_1Q',
  assists_1q: 'AST_1Q',
};

type BdlOddsRow = {
  game_id: number;
  vendor: string;
  spread_home_value: string | null;
  spread_home_odds: number | null;
  spread_away_odds: number | null;
  moneyline_home_odds: number | null;
  moneyline_away_odds: number | null;
  total_value: string | null;
  total_over_odds: number | null;
  total_under_odds: number | null;
};

type BdlPlayerProp = {
  game_id: number;
  player_id: number;
  vendor: string;
  prop_type: string;
  line_value: string;
  market: { type: 'over_under' | 'milestone'; over_odds?: number | null; under_odds?: number | null; odds?: number | null };
  /** When BallDontLie last scraped this vendor (shared by all of its rows in a game). */
  updated_at?: string | null;
};

type GameMeta = { gameId: string; homeTeam: string; awayTeam: string; commenceTime: string; tipMs: number };

export type NbaOddsIngestResult = {
  success: boolean;
  games: number;
  gamesWithProps: number;
  frozen: number;
  props: number;
  lineMoveWrites: number;
  bdlRequests: number;
  oddsNetRequests: number;
  lastUpdated: string;
  error?: string;
  /** Dry runs only. */
  board?: NbaOddsCache;
};

function american(raw: number | null | undefined): string {
  if (raw == null || !Number.isFinite(Number(raw))) return 'N/A';
  const n = Math.round(Number(raw));
  if (n === 0) return 'N/A';
  return n > 0 ? `+${n}` : String(n);
}

function lineText(raw: string | number | null | undefined): string | null {
  const n = Number(raw);
  return raw != null && raw !== '' && Number.isFinite(n) ? String(n) : null;
}

function etDate(ms: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(ms));
}

async function loadGameMeta(gameIds: number[]): Promise<Map<string, GameMeta>> {
  const out = new Map<string, GameMeta>();
  for (let i = 0; i < gameIds.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('nba_games')
      .select('id, tipoff_at, home_team_id, visitor_team_id, postponed')
      .in('id', gameIds.slice(i, i + 200));
    if (error) throw new Error(`nba_games lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      const home = getNbaClubById(row.home_team_id)?.name;
      const away = getNbaClubById(row.visitor_team_id)?.name;
      const tipMs = Date.parse(String(row.tipoff_at || ''));
      if (!home || !away || !Number.isFinite(tipMs) || row.postponed) continue;
      out.set(String(row.id), {
        gameId: String(row.id),
        homeTeam: home,
        awayTeam: away,
        commenceTime: new Date(tipMs).toISOString(),
        tipMs,
      });
    }
  }
  return out;
}

async function loadPlayerNames(playerIds: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (let i = 0; i < playerIds.length; i += 200) {
    const { data, error } = await supabaseAdmin
      .from('nba_players')
      .select('id, full_name')
      .in('id', playerIds.slice(i, i + 200));
    if (error) throw new Error(`nba_players lookup failed: ${error.message}`);
    for (const row of data ?? []) {
      if (row.full_name) out.set(Number(row.id), String(row.full_name));
    }
  }
  return out;
}

/** Spread is stored from the home side, like the NBL board: line = home spread, over = home price, under = away. */
function gameBooks(rows: BdlOddsRow[]): NbaBookRow[] {
  const byVendor = new Map<string, NbaBookRow>();
  for (const row of rows) {
    const vendor = String(row.vendor || '').trim().toLowerCase();
    if (!vendor || EXCLUDED_VENDORS.has(vendor)) continue;
    const book = byVendor.get(vendor) ?? {
      name: vendor,
      H2H: { home: 'N/A', away: 'N/A' },
      Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
      Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    };
    if (book.H2H.home === 'N/A' && book.H2H.away === 'N/A') {
      book.H2H = { home: american(row.moneyline_home_odds), away: american(row.moneyline_away_odds) };
    }
    const spread = lineText(row.spread_home_value);
    if (book.Spread.line === 'N/A' && spread != null) {
      book.Spread = { line: spread, over: american(row.spread_home_odds), under: american(row.spread_away_odds) };
    }
    const total = lineText(row.total_value);
    if (book.Total.line === 'N/A' && total != null) {
      book.Total = { line: total, over: american(row.total_over_odds), under: american(row.total_under_odds) };
    }
    byVendor.set(vendor, book);
  }
  return [...byVendor.values()].filter(
    (b) => b.H2H.home !== 'N/A' || b.H2H.away !== 'N/A' || b.Spread.line !== 'N/A' || b.Total.line !== 'N/A'
  );
}

function playerPropsFor(rows: BdlPlayerProp[], names: Map<number, string>): NbaPlayerPropsByBook {
  const out: NbaPlayerPropsByBook = {};
  for (const prop of rows) {
    const key = PROP_TYPE_TO_KEY[prop.prop_type];
    const vendor = String(prop.vendor || '').trim().toLowerCase();
    const player = names.get(Number(prop.player_id));
    const line = lineText(prop.line_value);
    if (!key || !vendor || EXCLUDED_VENDORS.has(vendor) || !player || line == null) continue;
    let entry: { line: string; over: string; under: string; milestone?: boolean } | null = null;
    if (prop.market?.type === 'over_under') {
      const over = american(prop.market.over_odds);
      const under = american(prop.market.under_odds);
      if (over !== 'N/A' || under !== 'N/A') entry = { line, over, under };
    } else if (prop.market?.type === 'milestone') {
      const over = american(prop.market.odds);
      if (over !== 'N/A') entry = { line, over, under: 'N/A', milestone: true };
    }
    if (!entry) continue;
    const list = (((out[vendor] ??= {})[player] ??= {})[key] ??= []);
    if (!list.some((e) => e.line === entry!.line && Boolean(e.milestone) === Boolean(entry!.milestone))) list.push(entry);
  }
  return out;
}

/** Latest scrape time per vendor in a game's BallDontLie prop rows. */
export function bdlPropBookTimes(rows: BdlPlayerProp[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const vendor = String(r.vendor || '').trim().toLowerCase();
    const ms = Date.parse(String(r.updated_at ?? ''));
    if (!vendor || EXCLUDED_VENDORS.has(vendor) || !Number.isFinite(ms)) continue;
    if (!out[vendor] || ms > Date.parse(out[vendor]!)) out[vendor] = new Date(ms).toISOString();
  }
  return out;
}

function pickTimes(times: Record<string, string> | undefined, fromOddsNet: boolean): Record<string, string> {
  return Object.fromEntries(Object.entries(times ?? {}).filter(([book]) => isNbaOddsNetBook(book) === fromOddsNet));
}

function pickBooks(props: NbaPlayerPropsByBook | undefined, fromOddsNet: boolean): NbaPlayerPropsByBook {
  const out: NbaPlayerPropsByBook = {};
  for (const [book, players] of Object.entries(props ?? {})) {
    if (isNbaOddsNetBook(book) === fromOddsNet) out[book] = players;
  }
  return out;
}

/** Same player keyed the same way across sources (BallDontLie's roster name wins). */
function mergeProps(bdl: NbaPlayerPropsByBook, oddsNet: NbaPlayerPropsByBook): NbaPlayerPropsByBook | undefined {
  const canonical = new Map<string, string>();
  for (const players of Object.values(bdl)) {
    for (const name of Object.keys(players)) canonical.set(normalizeNbaPropPlayerName(name), name);
  }
  const merged: NbaPlayerPropsByBook = { ...bdl };
  for (const [book, players] of Object.entries(oddsNet)) {
    const renamed: NbaPlayerPropsByBook[string] = {};
    for (const [name, stats] of Object.entries(players)) {
      renamed[canonical.get(normalizeNbaPropPlayerName(name)) ?? name] = stats;
    }
    merged[book] = renamed;
  }
  return Object.keys(merged).length ? merged : undefined;
}

function countProps(props: NbaPlayerPropsByBook | undefined): number {
  let n = 0;
  for (const players of Object.values(props ?? {})) {
    for (const stats of Object.values(players)) {
      for (const lines of Object.values(stats)) n += lines.length;
    }
  }
  return n;
}

export async function refreshNbaDashOdds(options?: { dryRun?: boolean }): Promise<NbaOddsIngestResult> {
  const apiKey = String(process.env.BALLDONTLIE_API_KEY || process.env.BALL_DONT_LIE_API_KEY || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
  const bdl = new BdlClient({ apiKey, perMinute: 240, maxRetries: 2 });
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const dates = new Set<string>();
  for (let d = -DAYS_BACK; d <= DAYS_AHEAD; d++) dates.add(etDate(nowMs + d * 86_400_000));
  const dateQuery = [...dates].map((d) => `dates[]=${d}`).join('&');
  const oddsRows = await bdl.all<BdlOddsRow>(`/v2/odds?${dateQuery}`);

  const rowsByGame = new Map<string, BdlOddsRow[]>();
  for (const row of oddsRows) {
    const id = String(row.game_id);
    const list = rowsByGame.get(id) ?? [];
    list.push(row);
    rowsByGame.set(id, list);
  }
  const meta = await loadGameMeta([...rowsByGame.keys()].map(Number));
  const previous = await sharedCache.getJSON<NbaOddsCache>(NBA_DASH_ODDS_KEY);
  const previousById = new Map((previous?.games ?? []).map((g) => [g.gameId, g]));

  const games: NbaGameOdds[] = [];
  const propsTargets: GameMeta[] = [];
  let frozen = 0;
  for (const [gameId, rows] of rowsByGame) {
    const m = meta.get(gameId);
    if (!m || m.tipMs < nowMs - KEEP_AFTER_TIP_MS) continue;
    if (m.tipMs <= nowMs) {
      const prev = previousById.get(gameId);
      if (prev) {
        games.push(prev);
        frozen += 1;
      }
      continue;
    }
    const bookmakers = gameBooks(rows);
    if (!bookmakers.length) continue;
    games.push({
      gameId,
      homeTeam: m.homeTeam,
      awayTeam: m.awayTeam,
      commenceTime: m.commenceTime,
      bookmakers,
    });
    if (m.tipMs - nowMs <= PROPS_WINDOW_MS) propsTargets.push(m);
  }
  // Started games BDL no longer lists still keep their closing board until the cutoff.
  for (const prev of previous?.games ?? []) {
    const tipMs = Date.parse(prev.commenceTime);
    if (rowsByGame.has(prev.gameId) || !Number.isFinite(tipMs)) continue;
    if (tipMs <= nowMs && tipMs >= nowMs - KEEP_AFTER_TIP_MS) {
      games.push(prev);
      frozen += 1;
    }
  }

  const propRows = new Map<string, BdlPlayerProp[]>();
  for (const target of propsTargets) {
    try {
      propRows.set(target.gameId, await bdl.all<BdlPlayerProp>(`/v2/odds/player_props?game_id=${target.gameId}`));
    } catch (err) {
      console.warn(
        `[NBA odds] props failed for game ${target.gameId}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
  const playerIds = new Set<number>();
  for (const rows of propRows.values()) for (const r of rows) playerIds.add(Number(r.player_id));
  const names = await loadPlayerNames([...playerIds]);

  const allNetTargets = [...propsTargets].sort((a, b) => a.tipMs - b.tipMs).slice(0, ODDS_NET_MAX_GAMES);
  const lastOddsNetMs = Date.parse(previous?.oddsNetFetchedAt ?? '');
  const lastNearMs = Math.max(lastOddsNetMs || 0, Date.parse(previous?.oddsNetNearFetchedAt ?? '') || 0);
  const fullDue = !Number.isFinite(lastOddsNetMs) || nowMs - lastOddsNetMs >= ODDS_NET_MIN_INTERVAL_MS;
  // Injury news lands in the last couple of hours: games that close get the AU prices more often.
  const nearTargets = allNetTargets.filter((t) => t.tipMs - nowMs <= ODDS_NET_NEAR_TIP_MS);
  const nearDue = !fullDue && nearTargets.length > 0 && nowMs - lastNearMs >= ODDS_NET_NEAR_INTERVAL_MS;
  const oddsNetTargets = fullDue ? allNetTargets : nearDue ? nearTargets : [];
  let oddsNet: NbaOddsNetResult | null = null;
  if (oddsNetTargets.length) {
    try {
      oddsNet = await fetchNbaOddsNetProps(oddsNetTargets);
    } catch (err) {
      console.warn('[NBA odds] odds-api.net failed:', err instanceof Error ? err.message : err);
    }
  }
  const oddsNetPulled = Boolean(oddsNet && oddsNet.props.size);
  const fullPulled = fullDue && oddsNetPulled;
  const nearPulled = nearDue && oddsNetPulled;

  let props = 0;
  let gamesWithProps = 0;
  const targetIds = new Set(propsTargets.map((t) => t.gameId));
  for (const game of games) {
    if (!targetIds.has(game.gameId)) continue;
    const prev = previousById.get(game.gameId);
    const prevProps = prev?.playerProps;
    const rows = propRows.get(game.gameId);
    const bdlProps = rows ? playerPropsFor(rows, names) : pickBooks(prevProps, false);
    const freshNet = oddsNet?.props.get(game.gameId);
    const netProps = freshNet ?? pickBooks(prevProps, true);
    game.playerProps = mergeProps(bdlProps, netProps);
    game.propBookTimes = {
      ...(rows ? bdlPropBookTimes(rows) : pickTimes(prev?.propBookTimes, false)),
      ...(freshNet ? (oddsNet?.bookTimes.get(game.gameId) ?? {}) : pickTimes(prev?.propBookTimes, true)),
    };
    const auLines =
      oddsNet?.gameLines.get(game.gameId) ??
      (previousById.get(game.gameId)?.bookmakers ?? []).filter((b) => isNbaOddsNetGameBook(b.name));
    game.bookmakers = [...game.bookmakers.filter((b) => !isNbaOddsNetGameBook(b.name)), ...auLines];
  }
  for (const game of games) {
    const count = countProps(game.playerProps);
    props += count;
    if (count) gamesWithProps += 1;
  }

  games.sort((a, b) => Date.parse(a.commenceTime) - Date.parse(b.commenceTime));
  const board: NbaOddsCache = {
    games,
    lastUpdated: nowIso,
    nextUpdate: new Date(nowMs + CRON_INTERVAL_MS).toISOString(),
    ...(fullPulled
      ? { oddsNetFetchedAt: nowIso }
      : previous?.oddsNetFetchedAt
        ? { oddsNetFetchedAt: previous.oddsNetFetchedAt }
        : {}),
    ...(nearPulled
      ? { oddsNetNearFetchedAt: nowIso }
      : previous?.oddsNetNearFetchedAt
        ? { oddsNetNearFetchedAt: previous.oddsNetNearFetchedAt }
        : {}),
  };

  let lineMoveWrites = 0;
  if (!options?.dryRun) {
    await sharedCache.setJSON(NBA_DASH_ODDS_KEY, board, BOARD_TTL_SECONDS);
    for (const game of games) {
      if (!game.playerProps || Date.parse(game.commenceTime) <= nowMs) continue;
      try {
        if (await recordNbaLineMoves(game, nowIso)) lineMoveWrites += 1;
      } catch (err) {
        console.warn(`[NBA odds] line movement failed for ${game.gameId}:`, err instanceof Error ? err.message : err);
      }
    }
  }

  return {
    success: true,
    games: games.length,
    gamesWithProps,
    frozen,
    props,
    lineMoveWrites,
    bdlRequests: bdl.requests,
    oddsNetRequests: oddsNet?.requests ?? 0,
    lastUpdated: nowIso,
    ...(options?.dryRun ? { board } : {}),
  };
}

export type NbaNearTipRefreshResult = { success: boolean; games: number; updated: number; oddsNetRequests: number; error?: string };

/**
 * Quick refresh between full ingests: only the AU prices (odds-api.net) of games inside 90 minutes
 * of tip, laid onto the stored board. BallDontLie books are left as the last full ingest stored them.
 */
export async function refreshNbaNearTipOdds(): Promise<NbaNearTipRefreshResult> {
  const nowMs = Date.now();
  const board = await sharedCache.getJSON<NbaOddsCache>(NBA_DASH_ODDS_KEY);
  if (!board?.games?.length) return { success: false, games: 0, updated: 0, oddsNetRequests: 0, error: 'No NBA board stored yet' };
  const targets = board.games
    .map((g) => ({ gameId: g.gameId, homeTeam: g.homeTeam, awayTeam: g.awayTeam, tipMs: Date.parse(g.commenceTime) }))
    .filter((t) => Number.isFinite(t.tipMs) && t.tipMs > nowMs && t.tipMs - nowMs <= ODDS_NET_FINAL_MS);
  if (!targets.length) return { success: true, games: 0, updated: 0, oddsNetRequests: 0 };

  const oddsNet = await fetchNbaOddsNetProps(targets);
  const nowIso = new Date(nowMs).toISOString();
  let updated = 0;
  for (const game of board.games) {
    const fresh = oddsNet.props.get(game.gameId);
    if (!fresh || oddsNet.failed.has(game.gameId)) continue;
    game.playerProps = mergeProps(pickBooks(game.playerProps, false), fresh);
    game.propBookTimes = { ...pickTimes(game.propBookTimes, false), ...(oddsNet.bookTimes.get(game.gameId) ?? {}) };
    const auLines = oddsNet.gameLines.get(game.gameId);
    if (auLines) game.bookmakers = [...game.bookmakers.filter((b) => !isNbaOddsNetGameBook(b.name)), ...auLines];
    updated += 1;
  }
  if (updated) {
    board.oddsNetNearFetchedAt = nowIso;
    await sharedCache.setJSON(NBA_DASH_ODDS_KEY, board, BOARD_TTL_SECONDS);
    for (const game of board.games) {
      if (!oddsNet.props.has(game.gameId) || !game.playerProps) continue;
      try {
        await recordNbaLineMoves(game, nowIso);
      } catch (err) {
        console.warn(`[NBA odds near] line movement failed for ${game.gameId}:`, err instanceof Error ? err.message : err);
      }
    }
  }
  return { success: true, games: targets.length, updated, oddsNetRequests: oddsNet.requests };
}
