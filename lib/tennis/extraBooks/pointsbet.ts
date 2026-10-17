/**
 * PointsBet AU public API. Competitions -> events per competition -> every market of one event (mes/v3).
 * Outcomes carry `side` (Home/Away/Neither) and `points`, and one market can hold several lines.
 */

import {
  emptySourceMatch,
  fetchSiteJson,
  mapLimit,
  tennisDisplayName,
  validPrice,
  type ExtraBookFeed,
  type ListedEvent,
  type SourceHandicap,
  type SourceMatch,
  type SourceOu,
} from '@/lib/tennis/extraBooks/shared';

const BASE = 'https://api.au.pointsbet.com/api';

type Outcome = { name?: string; side?: string; points?: number; price?: number; isOpenForBetting?: boolean };
type Market = { eventName?: string; eventClass?: string; outcomes?: Outcome[] };

const open = (o: Outcome) => o.isOpenForBetting !== false && validPrice(o.price);

function handicaps(outcomes: Outcome[]): SourceHandicap[] {
  const byLine = new Map<number, { home?: number; away?: number }>();
  for (const o of outcomes.filter(open)) {
    if (typeof o.points !== 'number') continue;
    const side = String(o.side).toLowerCase();
    if (side !== 'home' && side !== 'away') continue;
    const homeLine = side === 'home' ? o.points : -o.points;
    const row = byLine.get(homeLine) ?? {};
    row[side] = o.price;
    byLine.set(homeLine, row);
  }
  return [...byLine.entries()]
    .filter(([, r]) => validPrice(r.home) && validPrice(r.away))
    .map(([homeLine, r]) => ({ homeLine, home: r.home!, away: r.away! }));
}

function overUnders(outcomes: Outcome[]): SourceOu[] {
  const byLine = new Map<number, { over?: number; under?: number }>();
  for (const o of outcomes.filter(open)) {
    if (typeof o.points !== 'number') continue;
    const key = /^over/i.test(String(o.name)) ? 'over' : /^under/i.test(String(o.name)) ? 'under' : null;
    if (!key) continue;
    const row = byLine.get(o.points) ?? {};
    row[key] = o.price;
    byLine.set(o.points, row);
  }
  return [...byLine.entries()]
    .filter(([, r]) => validPrice(r.over) && validPrice(r.under))
    .map(([line, r]) => ({ line, over: r.over!, under: r.under! }));
}

function sideOfOutcomes(outcomes: Outcome[]): 'home' | 'away' | null {
  const side = String(outcomes[0]?.side || '').toLowerCase();
  return side === 'home' || side === 'away' ? side : null;
}

export function pointsbetEventToSource(markets: Market[], names: { home: string; away: string }): SourceMatch {
  const src = emptySourceMatch('PointsBet', names.home, names.away, 'au');
  for (const market of markets) {
    const cls = String(market.eventClass || '').trim();
    const outcomes = market.outcomes ?? [];
    if (cls === 'Match Result') {
      const home = outcomes.find((o) => /home/i.test(String(o.side)) && open(o))?.price;
      const away = outcomes.find((o) => /away/i.test(String(o.side)) && open(o))?.price;
      if (validPrice(home) && validPrice(away)) src.h2h = { home, away };
    } else if (cls === 'Games Handicap') {
      src.handicaps.push(...handicaps(outcomes));
    } else if (cls === 'Sets Handicap') {
      src.setHandicaps.push(...handicaps(outcomes));
    } else if (cls === 'Total Games') {
      src.totals.push(...overUnders(outcomes));
    } else if (cls === 'Total Sets Over/Under') {
      src.totalSets.push(...overUnders(outcomes));
    } else if (/^Player [AB] Total Games$/.test(cls)) {
      const side = sideOfOutcomes(outcomes);
      if (side === 'home') src.homeGames.push(...overUnders(outcomes));
      else if (side === 'away') src.awayGames.push(...overUnders(outcomes));
    } else if (/^Player [AB] To Win A Set$/.test(cls)) {
      const side = sideOfOutcomes(outcomes);
      const yes = outcomes.find((o) => /^yes$/i.test(String(o.name)) && open(o))?.price;
      const no = outcomes.find((o) => /^no$/i.test(String(o.name)) && open(o))?.price;
      if (validPrice(yes) && validPrice(no)) {
        if (side === 'home') src.homeWinSet = { yes, no };
        else if (side === 'away') src.awayWinSet = { yes, no };
      }
    }
  }
  return src;
}

export const pointsbetTennisFeed: ExtraBookFeed = {
  name: 'PointsBet',
  async list(): Promise<ListedEvent[]> {
    const data = await fetchSiteJson(`${BASE}/v2/sports/tennis/competitions`);
    const comps = ((data?.locales ?? []) as any[])
      .flatMap((l) => l?.competitions ?? [])
      .filter((c: any) => c?.key && !/doubles|futures/i.test(String(c.name)));
    const pages = await mapLimit(comps, 4, (c: any) =>
      fetchSiteJson(`${BASE}/v2/competitions/${encodeURIComponent(c.key)}/events/featured?includeLive=false`)
    );
    const out: ListedEvent[] = [];
    for (const page of pages) {
      for (const ev of page?.events ?? []) {
        if (!ev?.key || ev.isLive || !ev.homeTeam || !ev.awayTeam) continue;
        out.push({ id: String(ev.key), home: tennisDisplayName(ev.homeTeam), away: tennisDisplayName(ev.awayTeam), startsAt: ev.startsAt ?? null });
      }
    }
    return out;
  },
  async detail(event) {
    const data = await fetchSiteJson(`${BASE}/mes/v3/events/${encodeURIComponent(event.id)}`);
    return Array.isArray(data?.fixedOddsMarkets) ? pointsbetEventToSource(data.fixedOddsMarkets, event) : null;
  },
};
