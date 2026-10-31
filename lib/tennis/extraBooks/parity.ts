/**
 * The direct bookmaker scrapers run alongside odds-api.net until the two agree, then retire. Per book
 * and day: matches both priced, matches only one priced, how far apart their match-winner prices are,
 * and orientation flips (the classic swapped-player-order error).
 */

import type { TennisBookRow } from '@/lib/tennis/oddsTypes';

export type ParityTally = {
  both: number;
  onlyNet: number;
  onlyScraper: number;
  /** Sum and max of |home win probability (net) - (scraper)|, implied with the margin left in. */
  sumAbs: number;
  maxAbs: number;
  /** Within 1 probability point. */
  close: number;
  /** The scraper's home price matches odds-api.net's away price: players the other way round. */
  flipped: number;
};

export const emptyTally = (): ParityTally => ({ both: 0, onlyNet: 0, onlyScraper: 0, sumAbs: 0, maxAbs: 0, close: 0, flipped: 0 });

const bookKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "-189" / "+134" / "1.85" to the implied probability. */
export function impliedFromPrice(raw: string | undefined): number | null {
  const s = String(raw ?? '').trim();
  if (!s || s === 'N/A') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n === 0) return null;
  if (/^[+-]/.test(s) || Math.abs(n) >= 100) return n < 0 ? -n / (-n + 100) : 100 / (n + 100);
  return n > 1 ? 1 / n : null;
}

/** One book's odds-api.net rows against its scraper rows, by match id. */
export function tallyBook(net: Map<string, TennisBookRow[]>, scraper: Map<string, TennisBookRow>, book: string): ParityTally {
  const t = emptyTally();
  const key = bookKey(book);
  const netRow = (matchId: string) => net.get(matchId)?.find((r) => bookKey(r.name) === key) ?? null;
  const matches = new Set([...net.keys(), ...scraper.keys()]);
  for (const matchId of matches) {
    const a = netRow(matchId);
    const b = scraper.get(matchId) ?? null;
    const pa = impliedFromPrice(a?.H2H.home);
    const pb = impliedFromPrice(b?.H2H.home);
    if (pa == null && pb == null) continue;
    if (pa == null) {
      t.onlyScraper += 1;
      continue;
    }
    if (pb == null) {
      t.onlyNet += 1;
      continue;
    }
    const diff = Math.abs(pa - pb);
    const awayA = impliedFromPrice(a?.H2H.away);
    if (diff > 0.1 && awayA != null && Math.abs(awayA - pb) < 0.02) t.flipped += 1;
    t.both += 1;
    t.sumAbs += diff;
    t.maxAbs = Math.max(t.maxAbs, diff);
    if (diff <= 0.01) t.close += 1;
  }
  return t;
}

export type ParityDay = { runs: number; rowCapHits: number; books: Record<string, ParityTally> };

/** A refresh's tallies added to the day's running totals. */
export function addToDay(day: ParityDay, books: Record<string, ParityTally>, rowCapHits: number): ParityDay {
  const out: ParityDay = { runs: day.runs + 1, rowCapHits: day.rowCapHits + rowCapHits, books: { ...day.books } };
  for (const [book, t] of Object.entries(books)) {
    const d = { ...(out.books[book] ?? emptyTally()) };
    d.both += t.both;
    d.onlyNet += t.onlyNet;
    d.onlyScraper += t.onlyScraper;
    d.sumAbs += t.sumAbs;
    d.maxAbs = Math.max(d.maxAbs, t.maxAbs);
    d.close += t.close;
    d.flipped += t.flipped;
    out.books[book] = d;
  }
  return out;
}
