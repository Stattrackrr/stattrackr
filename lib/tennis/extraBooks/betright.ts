/**
 * BetRight public site API (next-api.betright.com.au). The tennis tree lists every match; MasterEventEvents
 * returns each match's markets with prices. Lines live in the outcome names ("Hugo Dellien -4.5").
 */

import { randomUUID } from 'node:crypto';
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
import type { TennisExtraMarket } from '@/lib/tennis/oddsTypes';

const BASE = 'https://next-api.betright.com.au';
const TENNIS_EVENT_TYPE = 104;
const CLIENT_ID = randomUUID();
const HEADERS = { 'X-Client-Id': CLIENT_ID, Origin: 'https://betright.com.au', Referer: 'https://betright.com.au/' };

type Outcome = { outcomeName?: string; price?: number };
type Market = { eventName?: string; outcomes?: Outcome[] };

function splitV(name: string): { home: string; away: string } | null {
  const parts = String(name || '').split(/\s+v\s+/i);
  return parts.length === 2 ? { home: parts[0].trim(), away: parts[1].trim() } : null;
}

/** "Hugo Dellien -4.5" -> { name, line }. */
function nameAndLine(outcome: string): { name: string; line: number } | null {
  const m = String(outcome || '').trim().match(/^(.+?)\s+([+-]?\d+(?:\.\d+)?)$/);
  return m ? { name: m[1], line: Number(m[2]) } : null;
}

function handicapPair(src: SourceMatch, outcomes: Outcome[]): { homeLine: number; home: number; away: number } | null {
  let homeLine: number | null = null;
  let home: number | undefined;
  let away: number | undefined;
  for (const o of outcomes) {
    const parsed = nameAndLine(String(o.outcomeName));
    if (!parsed) continue;
    const side = sideOf(parsed.name, src);
    if (side === 'home') {
      homeLine = parsed.line;
      home = o.price;
    } else if (side === 'away') {
      homeLine ??= -parsed.line;
      away = o.price;
    }
  }
  return homeLine != null && validPrice(home) && validPrice(away) ? { homeLine, home, away } : null;
}

/** "Over 21.5", or "Sara Bejlek Over 9.5" on the per-player games markets. */
function overUnder(outcomes: Outcome[]): { line: number; over: number; under: number } | null {
  const over = outcomes.find((o) => /(^|\s)over\s/i.test(String(o.outcomeName)));
  const under = outcomes.find((o) => /(^|\s)under\s/i.test(String(o.outcomeName)));
  const line = parseNumber(over?.outcomeName) ?? parseNumber(under?.outcomeName);
  return line != null && validPrice(over?.price) && validPrice(under?.price) ? { line: Math.abs(line), over: over!.price!, under: under!.price! } : null;
}

const SET_NUMBER: Record<string, number> = { first: 1, '1st': 1, second: 2, '2nd': 2, third: 3, '3rd': 3, fourth: 4, '4th': 4, fifth: 5, '5th': 5 };

/** A player name in an outcome as "home" / "away" (left as it is when it isn't one of the two). */
function sideText(text: string, src: SourceMatch): string {
  const side = sideOf(text, src);
  if (side) return side;
  let out = text;
  for (const [player, token] of [
    [src.home, 'home'],
    [src.away, 'away'],
  ] as const) {
    if (player) out = out.split(player).join(token);
  }
  return out;
}

/**
 * Every market the standard columns don't hold: set winners, set betting, set correct scores, set
 * totals, odd/even, and anything new under its own name, so nothing BetRight prices is dropped.
 */
function extraMarkets(name: string, outcomes: Outcome[], src: SourceMatch): TennisExtraMarket[] {
  const priced = outcomes.filter((o) => validPrice(o.price));
  const set = name.match(/^(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th) set\b/i);
  const setNo = set ? SET_NUMBER[set[1]!.toLowerCase()] : null;
  const scored = (key: string) =>
    priced.map((o) => {
      const m = String(o.outcomeName).trim().match(/^(.+?)\s+(\d+-\d+)$/);
      return { market: key, selection: m ? `${sideText(m[1]!, src)} ${m[2]}` : sideText(String(o.outcomeName).trim(), src), line: null, price: o.price! };
    });
  if (setNo && /\bwinner$/i.test(name)) return priced.map((o) => ({ market: `set${setNo}_winner`, selection: sideText(String(o.outcomeName).trim(), src), line: null, price: o.price! }));
  if (setNo && /correct score/i.test(name)) return scored(`set${setNo}_correct_score`);
  if (setNo && /total games/i.test(name)) {
    return priced.map((o) => ({ market: `set${setNo}_total_games`, selection: /^over/i.test(String(o.outcomeName)) ? 'over' : 'under', line: Math.abs(parseNumber(o.outcomeName) ?? parseNumber(name) ?? NaN), price: o.price! }));
  }
  if (/^set betting$/i.test(name)) return scored('set_betting');
  if (/^total games odd\/even$/i.test(name)) return priced.map((o) => ({ market: 'total_games_odd_even', selection: String(o.outcomeName).trim().toLowerCase(), line: null, price: o.price! }));
  const key = setNo ? `set${setNo}_${name.replace(/^\S+\s+set\s+/i, '')}` : name;
  return priced.map((o) => ({ market: `other:${sideText(key, src).toLowerCase()}`, selection: sideText(String(o.outcomeName).trim(), src), line: parseNumber(o.outcomeName), price: o.price! }));
}

export function betrightEventsToSource(markets: Market[], names: { home: string; away: string }): SourceMatch {
  const src = emptySourceMatch('BetRight', names.home, names.away, 'au');
  const extra: TennisExtraMarket[] = [];
  for (const market of markets) {
    const name = String(market.eventName || '').trim();
    const outcomes = market.outcomes ?? [];
    if (/^(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th) set|odd\/even|correct score|set betting/i.test(name)) {
      extra.push(...extraMarkets(name, outcomes, src));
      continue;
    }
    if (name === 'Match Result') {
      let home: number | undefined;
      let away: number | undefined;
      for (const o of outcomes) {
        const side = sideOf(String(o.outcomeName), src);
        if (side === 'home') home = o.price;
        else if (side === 'away') away = o.price;
      }
      if (validPrice(home) && validPrice(away)) src.h2h = { home, away };
    } else if (/^games handicap/i.test(name)) {
      const pair = handicapPair(src, outcomes);
      if (pair) src.handicaps.push(pair);
    } else if (/^sets? handicap/i.test(name)) {
      const pair = handicapPair(src, outcomes);
      if (pair) src.setHandicaps.push(pair);
    } else if (/^total games over\/under/i.test(name)) {
      const ou = overUnder(outcomes);
      if (ou) src.totals.push(ou);
    } else if (/^total sets/i.test(name)) {
      const ou = overUnder(outcomes);
      if (ou) src.totalSets.push(ou);
      const two = outcomes.find((o) => /^2 sets$/i.test(String(o.outcomeName)));
      const three = outcomes.find((o) => /^3 sets$/i.test(String(o.outcomeName)));
      if (!ou && validPrice(two?.price) && validPrice(three?.price)) src.totalSets.push({ line: 2.5, over: three!.price!, under: two!.price! });
    } else {
      const winSet = name.match(/^(.+?) to win a set$/i);
      const games = name.match(/^(.+?) (?:match )?total games(?: over\/under)?/i);
      if (winSet) {
        const yes = outcomes.find((o) => /^yes$/i.test(String(o.outcomeName)))?.price;
        const no = outcomes.find((o) => /^no$/i.test(String(o.outcomeName)))?.price;
        const side = sideOf(winSet[1], src);
        if (validPrice(yes) && validPrice(no)) {
          if (side === 'home') src.homeWinSet = { yes, no };
          else if (side === 'away') src.awayWinSet = { yes, no };
        }
      } else if (games) {
        const ou = overUnder(outcomes);
        const side = sideOf(games[1].trim(), src);
        if (ou && side === 'home') src.homeGames.push(ou);
        else if (ou && side === 'away') src.awayGames.push(ou);
        else extra.push(...extraMarkets(name, outcomes, src));
      } else {
        extra.push(...extraMarkets(name, outcomes, src));
      }
    }
  }
  if (extra.length) src.extraMarkets = extra;
  return src;
}

export const betrightTennisFeed: ExtraBookFeed = {
  name: 'BetRight',
  async list(): Promise<ListedEvent[]> {
    const data = await fetchSiteJson(`${BASE}/Sports/MasterCategory?eventTypeId=${TENNIS_EVENT_TYPE}`, HEADERS);
    const out: ListedEvent[] = [];
    for (const master of data?.masterCategories ?? []) {
      for (const category of master?.categories ?? []) {
        for (const ev of category?.masterEvents ?? []) {
          const names = splitV(ev?.masterEventName);
          if (!names || ev?.masterEventId == null) continue;
          out.push({ id: String(ev.masterEventId), ...names, startsAt: ev.minAdvertisedStartTimeUtc ?? null });
        }
      }
    }
    return out;
  },
  async detail(event) {
    const data = await fetchSiteJson(`${BASE}/Sports/MasterEventEvents?masterEventId=${encodeURIComponent(event.id)}`, HEADERS);
    return Array.isArray(data?.events) ? betrightEventsToSource(data.events, event) : null;
  },
};
