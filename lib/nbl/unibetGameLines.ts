/**
 * Unibet AU NBL game lines through its Kambi offering (`ub`, market AU). odds-api.net does not carry
 * Unibet's NBL lines, and Unibet prices about 14 spreads and 14 totals per game, one bet offer per line.
 * Full-game markets include overtime. Lines and odds are in thousandths.
 */

import { officialNblClubName } from '@/lib/nblTeamCanonical';
import { americanFromDecimal } from '@/lib/nbl/oddsApiNet';
import type { NblBookRow, NblGameOdds } from '@/lib/nbl/oddsTypes';
import { fetchSiteJson, mapLimit } from '@/lib/tennis/extraBooks/shared';

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const QUERY = 'lang=en_AU&market=AU';
export const UNIBET_BOOK = 'Unibet';
const START_TOLERANCE_MS = 12 * 60 * 60 * 1000;

type Outcome = { englishLabel?: string; label?: string; participant?: string; type?: string; line?: number; odds?: number; status?: string };
type BetOffer = { criterion?: { englishLabel?: string; label?: string }; outcomes?: Outcome[] };
type Pair = { line: number; a: number; b: number };

const price = (o: Outcome | undefined) =>
  o && (o.status ?? 'OPEN') === 'OPEN' && typeof o.odds === 'number' && o.odds > 1000 ? o.odds / 1000 : null;
const lineOf = (o: Outcome | undefined) => (o && typeof o.line === 'number' ? o.line / 1000 : null);
const labelOf = (o: Outcome) => String(o.englishLabel ?? o.label ?? '');

function teamSide(o: Outcome, game: { homeTeam: string; awayTeam: string }): 'home' | 'away' | null {
  const club = officialNblClubName(o.participant ?? labelOf(o));
  if (!club) return null;
  if (club === game.homeTeam) return 'home';
  if (club === game.awayTeam) return 'away';
  return null;
}

/** Most even pair first; that is the book's main line. */
function rowsOf(pairs: Pair[]): { main: NblBookRow['Spread']; all: NonNullable<NblBookRow['SpreadLines']> } {
  const byLine = new Map<number, Pair>();
  for (const p of pairs) byLine.set(p.line, p);
  const sorted = [...byLine.values()].sort((x, y) => x.line - y.line);
  const all = sorted.map((p) => ({ line: String(p.line), over: americanFromDecimal(p.a), under: americanFromDecimal(p.b) }));
  let main: Pair | null = null;
  for (const p of sorted) if (!main || Math.abs(p.a - p.b) < Math.abs(main.a - main.b)) main = p;
  return {
    main: main ? { line: String(main.line), over: americanFromDecimal(main.a), under: americanFromDecimal(main.b) } : { line: 'N/A', over: 'N/A', under: 'N/A' },
    all,
  };
}

/** One Unibet book row in our home orientation (`homeTeam`/`awayTeam` are official club names). */
export function unibetNblOffersToRow(offers: BetOffer[], game: { homeTeam: string; awayTeam: string }): NblBookRow | null {
  let h2h: { home: number; away: number } | null = null;
  const spreads: Pair[] = [];
  const totals: Pair[] = [];
  for (const offer of offers) {
    const label = String(offer.criterion?.englishLabel ?? offer.criterion?.label ?? '').trim();
    const outcomes = offer.outcomes ?? [];
    if (label === 'Moneyline - Including Overtime') {
      const side: { home?: number | null; away?: number | null } = {};
      for (const o of outcomes) {
        const s = teamSide(o, game);
        if (s) side[s] = price(o);
      }
      if (side.home && side.away) h2h = { home: side.home, away: side.away };
    } else if (label === 'Point Spread - Including Overtime') {
      let home: Outcome | undefined;
      let away: Outcome | undefined;
      for (const o of outcomes) {
        const s = teamSide(o, game);
        if (s === 'home') home = o;
        else if (s === 'away') away = o;
      }
      const homeLine = lineOf(home) ?? (lineOf(away) != null ? -lineOf(away)! : null);
      const h = price(home);
      const a = price(away);
      if (homeLine != null && h && a) spreads.push({ line: homeLine, a: h, b: a });
    } else if (label === 'Total Points - Including Overtime') {
      const over = outcomes.find((o) => o.type === 'OT_OVER' || /^over/i.test(labelOf(o)));
      const under = outcomes.find((o) => o.type === 'OT_UNDER' || /^under/i.test(labelOf(o)));
      const line = lineOf(over) ?? lineOf(under);
      const o = price(over);
      const u = price(under);
      if (line != null && o && u) totals.push({ line, a: o, b: u });
    }
  }
  if (!h2h && !spreads.length && !totals.length) return null;
  const spread = rowsOf(spreads);
  const total = rowsOf(totals);
  return {
    name: UNIBET_BOOK,
    H2H: h2h ? { home: americanFromDecimal(h2h.home), away: americanFromDecimal(h2h.away) } : { home: 'N/A', away: 'N/A' },
    Spread: spread.main,
    Total: total.main,
    SpreadLines: spread.all,
    TotalLines: total.all,
  };
}

/**
 * Adds (or replaces) the Unibet row on each game Unibet lists. Games Unibet does not list are unchanged;
 * a failed fetch leaves every game unchanged.
 */
export async function withUnibetNblGameLines(games: NblGameOdds[]): Promise<NblGameOdds[]> {
  if (!games.length) return games;
  const list = await fetchSiteJson(`${BASE}/listView/basketball/australia/nbl.json?${QUERY}`);
  const events: Array<{ id: string; home: string | null; away: string | null; start: number }> = [];
  for (const row of list?.events ?? []) {
    const ev = row?.event;
    if (ev?.id == null || ev.state !== 'NOT_STARTED') continue;
    events.push({ id: String(ev.id), home: officialNblClubName(ev.homeName), away: officialNblClubName(ev.awayName), start: Date.parse(String(ev.start ?? '')) });
  }
  if (!events.length) return games;

  const rows = await mapLimit(games, 4, async (game) => {
    const tip = Date.parse(game.commenceTime);
    const ev = events.find(
      (e) =>
        ((e.home === game.homeTeam && e.away === game.awayTeam) || (e.home === game.awayTeam && e.away === game.homeTeam)) &&
        (!Number.isFinite(tip) || !Number.isFinite(e.start) || Math.abs(e.start - tip) <= START_TOLERANCE_MS)
    );
    if (!ev) return null;
    const data = await fetchSiteJson(`${BASE}/betoffer/event/${encodeURIComponent(ev.id)}.json?${QUERY}&includeParticipants=true`);
    return Array.isArray(data?.betOffers) ? unibetNblOffersToRow(data.betOffers, game) : null;
  });

  return games.map((game, i) => {
    const row = rows[i];
    if (!row) return game;
    return { ...game, bookmakers: [...game.bookmakers.filter((b) => b.name !== UNIBET_BOOK), row] };
  });
}
