/**
 * Unibet AU through its Kambi offering (`ub`, market AU; same prices as unibet.com.au). The tennis list
 * view has every match; the event endpoint returns every market, one bet offer per line. Lines and odds
 * are in thousandths, and handicap/winner outcomes name the player.
 */

import {
  emptySourceMatch,
  fetchSiteJson,
  sideOf,
  validPrice,
  type ExtraBookFeed,
  type ListedEvent,
  type SourceMatch,
} from '@/lib/tennis/extraBooks/shared';

const BASE = 'https://eu-offering-api.kambicdn.com/offering/v2018/ub';
const QUERY = 'lang=en_AU&market=AU';

type Outcome = { englishLabel?: string; label?: string; participant?: string; type?: string; line?: number; odds?: number; status?: string };
type BetOffer = { criterion?: { englishLabel?: string; label?: string }; outcomes?: Outcome[] };

const price = (o: Outcome | undefined) => (o && (o.status ?? 'OPEN') === 'OPEN' && typeof o.odds === 'number' ? o.odds / 1000 : undefined);
const lineOf = (o: Outcome | undefined) => (o && typeof o.line === 'number' ? o.line / 1000 : null);
const labelOf = (o: Outcome) => String(o.englishLabel ?? o.label ?? '');
const isOver = (o: Outcome) => o.type === 'OT_OVER' || /^over/i.test(labelOf(o));
const isUnder = (o: Outcome) => o.type === 'OT_UNDER' || /^under/i.test(labelOf(o));
const isYes = (o: Outcome) => o.type === 'OT_YES' || /^yes$/i.test(labelOf(o));
const isNo = (o: Outcome) => o.type === 'OT_NO' || /^no$/i.test(labelOf(o));

function bySide(src: SourceMatch, outcomes: Outcome[]): { home?: Outcome; away?: Outcome } {
  const out: { home?: Outcome; away?: Outcome } = {};
  for (const o of outcomes) {
    const side = sideOf(String(o.participant ?? labelOf(o)), src);
    if (side) out[side] = o;
  }
  return out;
}

function overUnder(outcomes: Outcome[]): { line: number; over: number; under: number } | null {
  const over = outcomes.find(isOver);
  const under = outcomes.find(isUnder);
  const line = lineOf(over) ?? lineOf(under);
  const o = price(over);
  const u = price(under);
  return line != null && validPrice(o) && validPrice(u) ? { line, over: o, under: u } : null;
}

function handicap(src: SourceMatch, outcomes: Outcome[]): { homeLine: number; home: number; away: number } | null {
  const { home, away } = bySide(src, outcomes);
  const homeLine = lineOf(home) ?? (lineOf(away) != null ? -lineOf(away)! : null);
  const h = price(home);
  const a = price(away);
  return homeLine != null && validPrice(h) && validPrice(a) ? { homeLine, home: h, away: a } : null;
}

export function unibetOffersToSource(offers: BetOffer[], names: { home: string; away: string }): SourceMatch {
  const src = emptySourceMatch('Unibet', names.home, names.away, 'au');
  for (const offer of offers) {
    const label = String(offer.criterion?.englishLabel ?? offer.criterion?.label ?? '').trim();
    const outcomes = offer.outcomes ?? [];
    if (label === 'Match Odds') {
      const { home, away } = bySide(src, outcomes);
      const h = price(home);
      const a = price(away);
      if (validPrice(h) && validPrice(a)) src.h2h = { home: h, away: a };
    } else if (label === 'Game Handicap') {
      const pair = handicap(src, outcomes);
      if (pair) src.handicaps.push(pair);
    } else if (label === 'Set Handicap') {
      const pair = handicap(src, outcomes);
      if (pair) src.setHandicaps.push(pair);
    } else if (label === 'Total Games') {
      const ou = overUnder(outcomes);
      if (ou) src.totals.push(ou);
    } else if (label === 'Total Sets') {
      const ou = overUnder(outcomes);
      if (ou) src.totalSets.push(ou);
    } else {
      const games = label.match(/^total games won by (.+)$/i);
      const winSet = label.match(/^(.+?) to win at least one set$/i);
      if (games) {
        const ou = overUnder(outcomes);
        const side = sideOf(games[1], src);
        if (ou && side === 'home') src.homeGames.push(ou);
        else if (ou && side === 'away') src.awayGames.push(ou);
      } else if (winSet) {
        const yes = price(outcomes.find(isYes));
        const no = price(outcomes.find(isNo));
        const side = sideOf(winSet[1], src);
        if (validPrice(yes) && validPrice(no)) {
          if (side === 'home') src.homeWinSet = { yes, no };
          else if (side === 'away') src.awayWinSet = { yes, no };
        }
      }
    }
  }
  return src;
}

export const unibetTennisFeed: ExtraBookFeed = {
  name: 'Unibet',
  async list(): Promise<ListedEvent[]> {
    const data = await fetchSiteJson(`${BASE}/listView/tennis.json?${QUERY}`);
    const out: ListedEvent[] = [];
    for (const row of data?.events ?? []) {
      const ev = row?.event;
      if (ev?.id == null || ev.state !== 'NOT_STARTED' || !ev.homeName || !ev.awayName) continue;
      out.push({ id: String(ev.id), home: String(ev.homeName), away: String(ev.awayName), startsAt: ev.start ?? null });
    }
    return out;
  },
  async detail(event) {
    const data = await fetchSiteJson(`${BASE}/betoffer/event/${encodeURIComponent(event.id)}.json?${QUERY}&includeParticipants=true`);
    return Array.isArray(data?.betOffers) ? unibetOffersToSource(data.betOffers, event) : null;
  },
};
