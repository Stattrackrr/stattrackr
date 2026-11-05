/**
 * Build ToolsSnapshots from the same Redis boards the AI / props crons already refresh.
 * Zero extra odds-api.net credits when the board is warm.
 */

import { getNbaOddsCache, NBA_STAT_TO_PROP_KEY } from '@/lib/nba/dash/odds';
import type { NbaBookRow, NbaGameOdds, NbaPlayerPropsByBook } from '@/lib/nba/dash/oddsTypes';
import {
  classifyPulseNblMarket,
  pulseMarketPlayerName,
  readNblPulseScoreBoardCache,
  type PulseNblGame,
} from '@/lib/nbl/pulseScore';
import { getNblOddsCache } from '@/lib/nbl/refreshNblOdds';
import type { NblBookRow, NblGameOdds } from '@/lib/nbl/oddsTypes';
import { listTennisOddsIndex, readTennisOddsSnapshot } from '@/lib/tennis/odds';
import type { TennisBookRow } from '@/lib/tennis/oddsTypes';
import { expandTennisDisplayName } from '@/lib/tennis/playerNames';
import { decimalFromBook } from '@/lib/tennisAi/availability';
import { canonBook, TOOLS_BOOK_SET } from './books';
import type { ToolsEvent, ToolsSnapshot } from './fetch';
import type { OddsNetItem } from './markets';
import type { ToolsSport } from './types';

const NBA_PROP_KEY_TO_METRIC = Object.fromEntries(
  Object.entries(NBA_STAT_TO_PROP_KEY).map(([stat, key]) => [key, stat])
) as Record<string, string>;

const HORIZON_MS = 24 * 3600_000;
/** Allow boards slightly past tip (live hedges) but drop finished leftovers. */
const PAST_TIP_GRACE_MS = 3 * 3600_000;

function boardBookKey(name: string): string | null {
  const stripped = String(name || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9]+/g, '');
  const noAu = stripped.replace(/_?au$/, '');
  for (const cand of [noAu, stripped, canonBook(name)]) {
    if (TOOLS_BOOK_SET.has(cand)) return cand;
  }
  // Common display aliases.
  if (noAu === 'sportsbetting' && TOOLS_BOOK_SET.has('sportsbet')) return 'sportsbet';
  if (noAu === 'betright' || noAu === 'bet right') return 'betright';
  return null;
}

function pushItem(items: OddsNetItem[], item: OddsNetItem) {
  if (!(Number(item.odds) > 1)) return;
  items.push(item);
}

type OuLine = { line?: string; over?: string; under?: string };

function pushHandicap(
  items: OddsNetItem[],
  book: string,
  row: OuLine | undefined,
  metric = 'points'
) {
  if (!row) return;
  const homeLine = Number.parseFloat(String(row.line ?? '').replace(/[^0-9.+-]/g, ''));
  const homeOdds = decimalFromBook(row.over);
  const awayOdds = decimalFromBook(row.under);
  if (!Number.isFinite(homeLine) || homeOdds == null || awayOdds == null) return;
  pushItem(items, {
    bookmaker: book,
    bet_type: 'handicap',
    metric,
    period: 'full time',
    side: 'home',
    line: String(homeLine),
    odds: homeOdds,
    is_available: true,
  });
  pushItem(items, {
    bookmaker: book,
    bet_type: 'handicap',
    metric,
    period: 'full time',
    side: 'away',
    line: String(-homeLine),
    odds: awayOdds,
    is_available: true,
  });
}

function pushTotal(
  items: OddsNetItem[],
  book: string,
  row: OuLine | undefined,
  metric = 'points'
) {
  if (!row) return;
  const line = Number.parseFloat(String(row.line ?? '').replace(/[^0-9.+-]/g, ''));
  const over = decimalFromBook(row.over);
  const under = decimalFromBook(row.under);
  if (!Number.isFinite(line)) return;
  if (over != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'total',
      metric,
      period: 'full time',
      line: `over ${line}`,
      odds: over,
      is_available: true,
    });
  }
  if (under != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'total',
      metric,
      period: 'full time',
      line: `under ${line}`,
      odds: under,
      is_available: true,
    });
  }
}

function pushTeamTotal(
  items: OddsNetItem[],
  book: string,
  side: 'home' | 'away',
  row: OuLine | undefined,
  metric = 'games'
) {
  if (!row) return;
  const line = Number.parseFloat(String(row.line ?? '').replace(/[^0-9.+-]/g, ''));
  const over = decimalFromBook(row.over);
  const under = decimalFromBook(row.under);
  if (!Number.isFinite(line)) return;
  if (over != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'team total',
      metric,
      period: 'full time',
      side,
      line: `over ${line}`,
      odds: over,
      is_available: true,
    });
  }
  if (under != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'team total',
      metric,
      period: 'full time',
      side,
      line: `under ${line}`,
      odds: under,
      is_available: true,
    });
  }
}

function pushMoneyline(items: OddsNetItem[], book: string, h2h: { home?: string; away?: string } | undefined) {
  if (!h2h) return;
  const home = decimalFromBook(h2h.home);
  const away = decimalFromBook(h2h.away);
  if (home != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'moneyline',
      metric: 'match',
      period: 'full time',
      side: 'home',
      odds: home,
      is_available: true,
    });
  }
  if (away != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'moneyline',
      metric: 'match',
      period: 'full time',
      side: 'away',
      odds: away,
      is_available: true,
    });
  }
}

function inWindow(startMs: number, now: number): boolean {
  return startMs > now - PAST_TIP_GRACE_MS && startMs < now + HORIZON_MS;
}

function pushPlayerOu(
  items: OddsNetItem[],
  book: string,
  player: string,
  metric: string,
  line: number,
  over: number | null,
  under: number | null,
  period = 'full time'
) {
  if (!player || !Number.isFinite(line)) return;
  if (over != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'player prop',
      metric,
      period,
      player_name: player,
      line: `over ${line}`,
      odds: over,
      is_available: true,
    });
  }
  if (under != null) {
    pushItem(items, {
      bookmaker: book,
      bet_type: 'player prop',
      metric,
      period,
      player_name: player,
      line: `under ${line}`,
      odds: under,
      is_available: true,
    });
  }
}

function nbaPlayerPropsToItems(playerProps: NbaPlayerPropsByBook | undefined): OddsNetItem[] {
  const items: OddsNetItem[] = [];
  if (!playerProps) return items;
  for (const [bookName, players] of Object.entries(playerProps)) {
    const book = boardBookKey(bookName);
    if (!book) continue;
    for (const [player, byStat] of Object.entries(players ?? {})) {
      for (const [propKey, entries] of Object.entries(byStat ?? {})) {
        const metric = NBA_PROP_KEY_TO_METRIC[propKey] || propKey.toLowerCase();
        const qMatch = propKey.match(/_(\d)Q$/i);
        const period = qMatch ? `q${qMatch[1]}` : 'full time';
        for (const e of entries ?? []) {
          if (e.milestone) continue; // over-only — tools needs two-way
          const line = Number(e.line);
          pushPlayerOu(
            items,
            book,
            player,
            metric,
            line,
            decimalFromBook(e.over),
            decimalFromBook(e.under),
            period
          );
        }
      }
    }
  }
  return items;
}

/** Two-way player props from the NBL pulse board (same cache AI props use). */
function nblPulsePropsToItems(game: PulseNblGame): OddsNetItem[] {
  type Acc = { over?: number; under?: number; player: string; metric: string; line: number; book: string };
  const acc = new Map<string, Acc>();
  for (const bookRow of game.bookmakers ?? []) {
    const book = boardBookKey(bookRow.name);
    if (!book) continue;
    for (const market of bookRow.markets ?? []) {
      if (market.isActive === false) continue;
      const classified = classifyPulseNblMarket(market);
      if (!classified || classified.kind !== 'ou') continue;
      for (const sel of market.selections ?? []) {
        if (sel.isActive === false) continue;
        const player = pulseMarketPlayerName(market, sel);
        if (!player) continue;
        const odds = Number(sel.odds);
        if (!(odds > 1)) continue;
        const line =
          typeof sel.line === 'number' && Number.isFinite(sel.line)
            ? sel.line
            : typeof market.line === 'number' && Number.isFinite(market.line)
              ? market.line
              : NaN;
        if (!Number.isFinite(line)) continue;
        if (classified.stat === 'points' && line > 80) continue;
        const blob = `${sel.canonicalOutcome || ''} ${sel.rawName || ''} ${sel.name || ''}`.toLowerCase();
        const side: 'over' | 'under' = /\bunder\b/.test(blob) ? 'under' : 'over';
        const key = `${book}|${player.toLowerCase()}|${classified.stat}|${line}`;
        const row = acc.get(key) ?? { player, metric: classified.stat, line, book };
        if (side === 'under') row.under = odds;
        else row.over = odds;
        acc.set(key, row);
      }
    }
  }
  const items: OddsNetItem[] = [];
  for (const row of acc.values()) {
    if (row.over == null || row.under == null) continue;
    pushPlayerOu(items, row.book, row.player, row.metric, row.line, row.over, row.under);
  }
  return items;
}

function basketballBooksToItems(books: Array<NbaBookRow | NblBookRow>): OddsNetItem[] {
  const items: OddsNetItem[] = [];
  for (const row of books) {
    const book = boardBookKey(row.name);
    if (!book) continue;
    pushMoneyline(items, book, row.H2H);
    pushHandicap(items, book, row.Spread);
    for (const alt of row.SpreadLines ?? []) pushHandicap(items, book, alt);
    pushTotal(items, book, row.Total);
    for (const alt of row.TotalLines ?? []) pushTotal(items, book, alt);
  }
  return items;
}

function tennisBooksToItems(books: TennisBookRow[]): OddsNetItem[] {
  const items: OddsNetItem[] = [];
  for (const row of books) {
    const book = boardBookKey(row.name);
    if (!book) continue;
    pushMoneyline(items, book, row.H2H);
    pushHandicap(items, book, row.Spread, 'games');
    for (const alt of row.SpreadLines ?? []) pushHandicap(items, book, alt, 'games');
    pushTotal(items, book, row.Total, 'games');
    for (const alt of row.TotalLines ?? []) pushTotal(items, book, alt, 'games');
    pushTotal(items, book, row.TotalSets, 'sets');
    for (const alt of row.TotalSetsLines ?? []) pushTotal(items, book, alt, 'sets');
    pushTeamTotal(items, book, 'home', row.GamesWon, 'games');
    for (const alt of row.GamesWonLines ?? []) pushTeamTotal(items, book, 'home', alt, 'games');
    pushTeamTotal(items, book, 'away', row.GamesLost, 'games');
    for (const alt of row.GamesLostLines ?? []) pushTeamTotal(items, book, 'away', alt, 'games');
    if (row.SetsWon) pushTeamTotal(items, book, 'home', row.SetsWon, 'sets');
    for (const alt of row.SetsWonLines ?? []) pushTeamTotal(items, book, 'home', alt, 'sets');
    if (row.SetsLost) pushTeamTotal(items, book, 'away', row.SetsLost, 'sets');
    for (const alt of row.SetsLostLines ?? []) pushTeamTotal(items, book, 'away', alt, 'sets');
  }
  return items;
}

function stampAsOf(items: OddsNetItem[], asOf: Record<string, number>, fetchedAtMs: number) {
  for (const it of items) {
    const b = canonBook(it.bookmaker);
    if (b && asOf[b] == null) asOf[b] = fetchedAtMs;
  }
}

function nbaGameToSnapshot(game: NbaGameOdds, fetchedAtMs: number): ToolsSnapshot | null {
  const startMs = Date.parse(game.commenceTime);
  if (!Number.isFinite(startMs)) return null;
  const items = [
    ...basketballBooksToItems(game.bookmakers ?? []),
    ...nbaPlayerPropsToItems(game.playerProps),
  ];
  if (!items.length) return null;
  const asOf: Record<string, number> = {};
  for (const [book, iso] of Object.entries(game.propBookTimes ?? {})) {
    const key = boardBookKey(book);
    const t = Date.parse(iso);
    if (key && Number.isFinite(t)) asOf[key] = t;
  }
  stampAsOf(items, asOf, fetchedAtMs);
  return {
    event: {
      sport: 'nba',
      apiSport: 'basketball',
      league: 'NBA',
      eventId: String(game.gameId),
      home: game.homeTeam,
      away: game.awayTeam,
      startMs,
    },
    items,
    asOf,
  };
}

function nblTeamsKey(home: string, away: string): string {
  return `${home}`.toLowerCase().replace(/[^a-z0-9]+/g, '') + '|' + `${away}`.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function nblGameToSnapshot(
  game: NblGameOdds,
  pulse: PulseNblGame | undefined,
  fetchedAtMs: number
): ToolsSnapshot | null {
  const startMs = Date.parse(game.commenceTime);
  if (!Number.isFinite(startMs)) return null;
  const items = [
    ...basketballBooksToItems(game.bookmakers ?? []),
    ...(pulse ? nblPulsePropsToItems(pulse) : []),
  ];
  if (!items.length) return null;
  const asOf: Record<string, number> = {};
  stampAsOf(items, asOf, fetchedAtMs);
  return {
    event: {
      sport: 'nbl',
      apiSport: 'basketball',
      league: 'NBL',
      eventId: String(game.gameId),
      home: game.homeTeam,
      away: game.awayTeam,
      startMs,
    },
    items,
    asOf,
  };
}

/** Load tools snapshots from cron-backed boards. Returns [] when a sport board is cold. */
export async function loadToolsSnapshotsFromBoards(
  sports: ToolsSport[]
): Promise<{ snapshots: ToolsSnapshot[]; source: 'board'; sportsHit: ToolsSport[] }> {
  const now = Date.now();
  const snapshots: ToolsSnapshot[] = [];
  const sportsHit: ToolsSport[] = [];

  if (sports.includes('nba')) {
    const board = await getNbaOddsCache().catch(() => null);
    const fetchedAtMs = Date.parse(board?.oddsNetNearFetchedAt || board?.oddsNetFetchedAt || board?.lastUpdated || '') || now;
    let hit = false;
    for (const game of board?.games ?? []) {
      const startMs = Date.parse(game.commenceTime);
      if (!Number.isFinite(startMs) || !inWindow(startMs, now)) continue;
      const snap = nbaGameToSnapshot(game, fetchedAtMs);
      if (snap) {
        snapshots.push(snap);
        hit = true;
      }
    }
    if (hit) sportsHit.push('nba');
  }

  if (sports.includes('nbl')) {
    const [board, pulseBoard] = await Promise.all([
      getNblOddsCache().catch(() => null),
      readNblPulseScoreBoardCache().catch(() => ({ lastUpdated: null, games: [] as PulseNblGame[] })),
    ]);
    const fetchedAtMs =
      Date.parse(pulseBoard.lastUpdated || '') || Date.parse(board?.lastUpdated || '') || now;
    const pulseById = new Map((pulseBoard.games ?? []).map((g) => [String(g.gameId), g]));
    const pulseByTeams = new Map(
      (pulseBoard.games ?? []).map((g) => [nblTeamsKey(g.homeTeam, g.awayTeam), g])
    );
    let hit = false;
    const seen = new Set<string>();
    for (const game of board?.games ?? []) {
      const startMs = Date.parse(game.commenceTime);
      if (!Number.isFinite(startMs) || !inWindow(startMs, now)) continue;
      const pulse =
        pulseById.get(String(game.gameId)) ||
        pulseByTeams.get(nblTeamsKey(game.homeTeam, game.awayTeam));
      const snap = nblGameToSnapshot(game, pulse, fetchedAtMs);
      if (snap) {
        snapshots.push(snap);
        seen.add(String(game.gameId));
        hit = true;
      }
    }
    // Props-only pulse games (no game-line row yet) still belong on Tools.
    for (const pulse of pulseBoard.games ?? []) {
      if (seen.has(String(pulse.gameId))) continue;
      const startMs = Date.parse(pulse.commenceTime);
      if (!Number.isFinite(startMs) || !inWindow(startMs, now)) continue;
      const propItems = nblPulsePropsToItems(pulse);
      if (!propItems.length) continue;
      const asOf: Record<string, number> = {};
      stampAsOf(propItems, asOf, fetchedAtMs);
      snapshots.push({
        event: {
          sport: 'nbl',
          apiSport: 'basketball',
          league: 'NBL',
          eventId: String(pulse.gameId),
          home: pulse.homeTeam,
          away: pulse.awayTeam,
          startMs,
        },
        items: propItems,
        asOf,
      });
      hit = true;
    }
    if (hit) sportsHit.push('nbl');
  }

  if (sports.includes('tennis')) {
    const index = await listTennisOddsIndex().catch(() => []);
    let hit = false;
    const upcoming = index.filter((row) => {
      const startMs = Date.parse(String(row.commenceTime || ''));
      return Number.isFinite(startMs) && inWindow(startMs, now);
    });
    // Cap parallel reads — index can be large.
    const slice = upcoming.slice(0, 100);
    const snaps = await Promise.all(
      slice.map(async (row) => {
        const stored = await readTennisOddsSnapshot(row.matchId).catch(() => null);
        if (!stored?.bookmakers?.length) return null;
        const startMs =
          Date.parse(String(stored.commenceTime || row.commenceTime || '')) ||
          Date.parse(String(row.commenceTime || ''));
        if (!Number.isFinite(startMs) || !inWindow(startMs, now)) return null;
        const items = tennisBooksToItems(stored.bookmakers);
        if (!items.length) return null;
        const fetchedAtMs = Date.parse(stored.fetchedAt) || now;
        const asOf: Record<string, number> = {};
        for (const it of items) {
          const b = canonBook(it.bookmaker);
          if (b) asOf[b] = fetchedAtMs;
        }
        const snap: ToolsSnapshot = {
          event: {
            sport: 'tennis',
            apiSport: 'tennis',
            league: String(row.tournamentName || row.tour || 'tennis'),
            eventId: String(row.matchId),
            home: expandTennisDisplayName(stored.homeName || row.homeName),
            away: expandTennisDisplayName(stored.awayName || row.awayName),
            startMs,
          },
          items,
          asOf,
        };
        return snap;
      })
    );
    for (const snap of snaps) {
      if (snap) {
        snapshots.push(snap);
        hit = true;
      }
    }
    if (hit) sportsHit.push('tennis');
  }

  snapshots.sort((a, b) => a.event.startMs - b.event.startMs);
  return { snapshots, source: 'board', sportsHit };
}
