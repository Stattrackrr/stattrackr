/**
 * NBL player props from odds-api.net. Any book that returns a line is shown.
 */

import { nblBookLines, nblPlayerPropMarketForStat, nblPreferOuLines, type NblBookRow, type NblPropLine } from '@/lib/nbl/oddsTypes';
import {
  listNblPlayerPropSnapshots,
  readNblPlayerPropSnapshot,
  type NblPlayerPropSnapshot,
  type NblSnapStat,
} from '@/lib/nbl/playerPropSnapshots';
import {
  findPulseNblGame,
  getNblPulseScoreBoard,
  namesMatch,
  pulseBooksByStat,
} from '@/lib/nbl/pulseScore';
import { officialNblClubName, resolveNblClubName } from '@/lib/nblTeamCanonical';

const SNAP_STATS: NblSnapStat[] = ['points', 'rebounds', 'assists', 'threeMade'];

function emptyBook(name: string, lines: NblPropLine[]): NblBookRow {
  const preferred = nblPreferOuLines(lines);
  const main = preferred[0];
  return {
    name,
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: main
      ? { line: main.line, over: main.over, under: main.under }
      : { line: 'N/A', over: 'N/A', under: 'N/A' },
    lines: preferred,
  };
}

function booksFromSnapshot(snap: NblPlayerPropSnapshot, player: string, stat: string): NblBookRow[] {
  const rows: NblBookRow[] = [];
  const books = [
    ...new Set(snap.lines.filter((l) => l.stat === stat && namesMatch(player, l.player)).map((l) => l.book)),
  ];
  for (const book of books) {
    const lines = snap.lines
      .filter((l) => l.book === book && l.stat === stat && namesMatch(player, l.player))
      .map(
        (l): NblPropLine => ({
          line: String(l.line),
          over: l.over,
          under: l.under,
          kind: l.kind,
          label: l.label,
        })
      );
    if (lines.length) rows.push(emptyBook(book, lines));
  }
  return rows;
}

function mergeBooks(a: NblBookRow[], b: NblBookRow[]): NblBookRow[] {
  const byName = new Map<string, NblBookRow>();
  for (const book of [...a, ...b]) {
    const prev = byName.get(book.name);
    if (!prev) {
      byName.set(book.name, book);
      continue;
    }
    const lines: NblPropLine[] = [];
    const seen = new Set<string>();
    for (const line of [...nblBookLines(prev), ...nblBookLines(book)]) {
      const key = `${line.kind}|${line.line}|${line.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      lines.push({ ...line });
    }
    byName.set(book.name, emptyBook(book.name, lines));
  }
  return [...byName.values()];
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ka = String(officialNblClubName(a) || resolveNblClubName(a) || a || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  const kb = String(officialNblClubName(b) || resolveNblClubName(b) || b || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
  if (!ka || !kb) return false;
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

export async function resolveNblPlayerPropBooks(options: {
  player: string;
  stat: string;
  team?: string | null;
  opponent?: string | null;
}): Promise<{
  books: NblBookRow[];
  byStat: Record<string, NblBookRow[]>;
  homeTeam: string;
  awayTeam: string;
  gameId: string | null;
  market: string | null;
}> {
  const market = nblPlayerPropMarketForStat(options.stat);
  const empty = {
    books: [] as NblBookRow[],
    byStat: {} as Record<string, NblBookRow[]>,
    homeTeam: '',
    awayTeam: '',
    gameId: null as string | null,
    market,
  };
  if (!options.player) return empty;

  const team = options.team ? resolveNblClubName(options.team) || options.team : null;
  const opponent = options.opponent ? resolveNblClubName(options.opponent) || options.opponent : null;
  const games = await getNblPulseScoreBoard();
  const game = findPulseNblGame(games, team, opponent);
  const snap =
    (game
      ? await readNblPlayerPropSnapshot(game.homeTeam, game.awayTeam, game.commenceTime)
      : null) ??
    (await listNblPlayerPropSnapshots()).find(
      (row) =>
        (team &&
          (teamsMatch(row.homeTeam, team) || teamsMatch(row.awayTeam, team)) &&
          (!opponent || teamsMatch(row.homeTeam, opponent) || teamsMatch(row.awayTeam, opponent))) ||
        (opponent && (teamsMatch(row.homeTeam, opponent) || teamsMatch(row.awayTeam, opponent)))
    ) ??
    null;

  if (!game && !snap) return empty;

  const byStat: Record<string, NblBookRow[]> = game ? pulseBooksByStat(game, options.player) : {};
  if (snap) {
    for (const stat of SNAP_STATS) {
      byStat[stat] = mergeBooks(byStat[stat] || [], booksFromSnapshot(snap, options.player, stat));
    }
  }

  return {
    books: (options.stat && byStat[options.stat]) || [],
    byStat,
    homeTeam: game?.homeTeam || snap?.homeTeam || '',
    awayTeam: game?.awayTeam || snap?.awayTeam || '',
    gameId: game?.gameId || snap?.gameId || null,
    market,
  };
}
