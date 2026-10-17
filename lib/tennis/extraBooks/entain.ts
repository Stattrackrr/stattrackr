/**
 * Ladbrokes / Neds (Entain) public site API. Tennis is one category; `event-card` returns every market.
 * A market's `handicap` is the away player's line (home gets the negative).
 */

import {
  emptySourceMatch,
  fetchSiteJson,
  parseNumber,
  sideOf,
  validPrice,
  type ExtraBookFeed,
  type ListedEvent,
  type SourceMatch,
} from '@/lib/tennis/extraBooks/shared';

const TENNIS_CATEGORY = 'a0b910b8-85f0-4f6e-821d-c9fd9e3bdf93';
const HEADERS = { 'Content-Type': 'application/json' };

type Card = {
  events?: Record<string, { name?: string }>;
  markets?: Record<string, { name?: string; handicap?: number; entrant_ids?: string[] }>;
  entrants?: Record<string, { id: string; name?: string; home_away?: string }>;
  prices?: Record<string, { odds?: { numerator?: number; denominator?: number } }>;
};

function splitVs(name: string): { home: string; away: string } | null {
  const parts = String(name || '').split(/\s+vs\.?\s+/i);
  return parts.length === 2 ? { home: parts[0].trim(), away: parts[1].trim() } : null;
}

export function entainCardToSource(card: Card, book: string, names: { home: string; away: string }): SourceMatch {
  const src = emptySourceMatch(book, names.home, names.away, 'au');
  const priceByEntrant = new Map<string, number>();
  for (const [key, value] of Object.entries(card.prices ?? {})) {
    const odds = value?.odds;
    if (!odds?.numerator || !odds?.denominator) continue;
    priceByEntrant.set(key.split(':')[0], Math.round((odds.numerator / odds.denominator + 1) * 1000) / 1000);
  }
  for (const market of Object.values(card.markets ?? {})) {
    const name = String(market.name || '').trim();
    const entrants = (market.entrant_ids ?? []).map((id) => card.entrants?.[id]).filter(Boolean) as NonNullable<Card['entrants']>[string][];
    const price = (pred: (e: (typeof entrants)[number]) => boolean) => {
      const e = entrants.find(pred);
      return e ? priceByEntrant.get(e.id) : undefined;
    };
    const home = price((e) => e.home_away === 'HOME');
    const away = price((e) => e.home_away === 'AWAY');
    const over = price((e) => /^over/i.test(String(e.name)));
    const under = price((e) => /^under/i.test(String(e.name)));
    const yes = price((e) => /^yes$/i.test(String(e.name)));
    const no = price((e) => /^no$/i.test(String(e.name)));
    if (/^Set \d/i.test(name)) continue;
    if (name === 'Match Betting') {
      if (validPrice(home) && validPrice(away)) src.h2h = { home, away };
    } else if (name === 'Games Handicap' && typeof market.handicap === 'number') {
      if (validPrice(home) && validPrice(away)) src.handicaps.push({ homeLine: -market.handicap, home, away });
    } else if (name === 'Set Handicap' && typeof market.handicap === 'number') {
      if (validPrice(home) && validPrice(away)) src.setHandicaps.push({ homeLine: -market.handicap, home, away });
    } else if (/^Total Games\s+[\d.]+$/i.test(name)) {
      const line = parseNumber(name.replace(/^Total Games/i, ''));
      if (line != null && validPrice(over) && validPrice(under)) src.totals.push({ line, over, under });
    } else if (name === 'Total Sets') {
      const two = price((e) => /^2 sets$/i.test(String(e.name)));
      const three = price((e) => /^3 sets$/i.test(String(e.name)));
      if (validPrice(two) && validPrice(three)) src.totalSets.push({ line: 2.5, over: three, under: two });
    } else {
      const winSet = name.match(/^(.+?) to win a set$/i);
      const games = name.match(/^(.+?) Total Games\s+([\d.]+)$/i);
      if (winSet && validPrice(yes) && validPrice(no)) {
        const side = sideOf(winSet[1], src);
        if (side === 'home') src.homeWinSet = { yes, no };
        else if (side === 'away') src.awayWinSet = { yes, no };
      } else if (games && validPrice(over) && validPrice(under)) {
        const side = sideOf(games[1], src);
        const row = { line: Number(games[2]), over, under };
        if (side === 'home') src.homeGames.push(row);
        else if (side === 'away') src.awayGames.push(row);
      }
    }
  }
  return src;
}

function entainFeed(host: string, book: string): ExtraBookFeed {
  return {
    name: book,
    async list(): Promise<ListedEvent[]> {
      const qs = new URLSearchParams({ category_ids: JSON.stringify([TENNIS_CATEGORY]) });
      const data = await fetchSiteJson(`https://${host}/v2/sport/event-request?${qs}`, HEADERS);
      const out: ListedEvent[] = [];
      for (const ev of Object.values((data?.events ?? {}) as Record<string, any>)) {
        const names = splitVs(ev?.name);
        if (!names || !ev?.id) continue;
        if (ev.match_status && ev.match_status !== 'BettingOpen') continue;
        out.push({ id: String(ev.id), ...names, startsAt: ev.advertised_start ?? null });
      }
      return out;
    },
    async detail(event) {
      const card = (await fetchSiteJson(`https://${host}/v2/sport/event-card?id=${encodeURIComponent(event.id)}`, HEADERS)) as Card | null;
      return card ? entainCardToSource(card, book, event) : null;
    },
  };
}

export const ladbrokesTennisFeed = entainFeed('api.ladbrokes.com.au', 'Ladbrokes');
export const nedsTennisFeed = entainFeed('api.neds.com.au', 'Neds');
