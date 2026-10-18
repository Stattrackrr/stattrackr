import { distinctPrices, type CandidateQuote } from '@/lib/aiPicks/candidates/types';

const BOOK_ALIASES: Record<string, string> = { pncl: 'pinnacle', betonlineag: 'betonline' };

export function bookKey(book: string): string {
  const k = book.toLowerCase().replace(/[^a-z0-9]/g, '');
  return BOOK_ALIASES[k] ?? k;
}

/** Each book's price for one selection, minus prices far above the rest (stale or mislabeled). */
export function bookPrices(quotes: CandidateQuote[]): Map<string, { book: string; price: number }> {
  const prices = distinctPrices(quotes).sort((a, b) => a - b);
  const mid = prices[Math.floor(prices.length / 2)] ?? 0;
  const out = new Map<string, { book: string; price: number }>();
  for (const q of quotes) {
    if (!(q.price > 1)) continue;
    if (prices.length >= 3 && q.price > mid * 1.15) continue;
    const k = bookKey(q.book);
    const prev = out.get(k);
    if (!prev || q.price > prev.price) out.set(k, { book: q.book, price: q.price });
  }
  return out;
}

/** Another book that prices every leg of a pick: its combined price and each leg's price there. */
export type AltBook = { book: string; price: number; legs: number[] };

/** Books other than `mainBook` that price every leg, best combined price first. */
export function alternateBooks(legQuotes: CandidateQuote[][], mainBook: string): AltBook[] {
  if (!legQuotes.length) return [];
  const perLeg = legQuotes.map(bookPrices);
  const main = bookKey(mainBook);
  const out: AltBook[] = [];
  for (const [k, first] of perLeg[0]!) {
    if (k === main) continue;
    const legs = perLeg.map((m) => m.get(k)?.price);
    if (legs.some((p) => p == null)) continue;
    const price = legs.reduce<number>((acc, p) => acc * p!, 1);
    out.push({ book: first.book, price: Math.round(price * 1000) / 1000, legs: legs as number[] });
  }
  return out.sort((a, b) => b.price - a.price);
}
