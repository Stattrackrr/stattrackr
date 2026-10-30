/**
 * Referee crews and their tendencies (feature-library candidate). Pure: parsing the NBA's daily
 * assignments page, and each official's free throws, fouls and points against the league average,
 * shrunk toward 0 by how few games he's worked. A crew is the average of its officials.
 */

import { NBA_CLUBS, resolveNbaClub } from '@/lib/nba/dash/teams';

export type Assignment = { away: string; home: string; officials: string[] };

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

const clean = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#8217;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** "James Capers (#19)" -> "James Capers". */
export const officialName = (raw: string) => clean(raw).replace(/\s*\(#\d+\)\s*$/, '').trim();

/** Team code from the page's city names ("Charlotte", "L.A. Lakers", "LA Clippers"). */
export function teamFromLabel(label: string): string | null {
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const byCity = NBA_CLUBS.find((c) => c.city.toLowerCase().replace(/[^a-z0-9]+/g, '') === key);
  return byCity?.code ?? resolveNbaClub(label)?.code ?? null;
}

/** The page's date (YYYY-MM-DD) and each game's crew: crew chief, referee, umpire (alternate left out). */
export function parseAssignments(html: string): { date: string | null; games: Assignment[] } {
  const meta = /entry-meta">\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(html);
  const month = meta ? MONTHS.indexOf(meta[1]!.toLowerCase()) : -1;
  const date = meta && month >= 0 ? `${meta[3]}-${String(month + 1).padStart(2, '0')}-${meta[2]!.padStart(2, '0')}` : null;
  const table = /nba-refs-content[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/.exec(html)?.[1] ?? '';
  const games: Assignment[] = [];
  for (const row of table.match(/<tr[\s\S]*?<\/tr>/g) ?? []) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/g) ?? []).map((c) => c.replace(/^<td[^>]*>|<\/td>$/g, ''));
    const [away, home] = clean(cells[0] ?? '').split(/\s*@\s*/);
    const awayCode = away ? teamFromLabel(away) : null;
    const homeCode = home ? teamFromLabel(home) : null;
    const officials = cells.slice(1, 4).map(officialName).filter(Boolean);
    if (awayCode && homeCode && officials.length) games.push({ away: awayCode, home: homeCode, officials });
  }
  return { date, games };
}

export type OfficiatedGame = { gameId: string; date: string; officials: string[]; fta: number; fouls: number; points: number };

export type Tendency = { games: number; fta: number; fouls: number; points: number };

/** Games an official needs before his own numbers count for half. */
export const REF_SHRINK_GAMES = 30;

/** Each official's average game against the league average, from games before `beforeDay`, shrunk. */
export function refTendencies(games: OfficiatedGame[], beforeDay: string): { byOfficial: Map<string, Tendency>; sd: { fta: number; points: number } } {
  const past = games.filter((g) => g.date < beforeDay);
  const mean = (read: (g: OfficiatedGame) => number) => past.reduce((a, g) => a + read(g), 0) / Math.max(1, past.length);
  const avg = { fta: mean((g) => g.fta), fouls: mean((g) => g.fouls), points: mean((g) => g.points) };
  const sd = (read: (g: OfficiatedGame) => number, m: number) => Math.sqrt(past.reduce((a, g) => a + (read(g) - m) ** 2, 0) / Math.max(1, past.length - 1));
  const sums = new Map<string, Tendency>();
  for (const g of past) {
    for (const name of g.officials) {
      const t = sums.get(name) ?? { games: 0, fta: 0, fouls: 0, points: 0 };
      t.games += 1;
      t.fta += g.fta - avg.fta;
      t.fouls += g.fouls - avg.fouls;
      t.points += g.points - avg.points;
      sums.set(name, t);
    }
  }
  const byOfficial = new Map<string, Tendency>();
  for (const [name, t] of sums) {
    const k = 1 / (t.games + REF_SHRINK_GAMES);
    byOfficial.set(name, { games: t.games, fta: t.fta * k, fouls: t.fouls * k, points: t.points * k });
  }
  return { byOfficial, sd: { fta: sd((g) => g.fta, avg.fta) || 1, points: sd((g) => g.points, avg.points) || 1 } };
}

/** A crew's expected extra free-throw attempts, fouls and points per game (both teams); unknown officials count as 0. */
export function crewEffect(officials: string[], byOfficial: Map<string, Tendency>): Tendency {
  const n = Math.max(1, officials.length);
  const out = { games: 0, fta: 0, fouls: 0, points: 0 };
  for (const name of officials) {
    const t = byOfficial.get(name);
    if (!t) continue;
    out.games += t.games;
    out.fta += t.fta / n;
    out.fouls += t.fouls / n;
    out.points += t.points / n;
  }
  return out;
}
