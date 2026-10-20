import { median } from '@/lib/aiPicks/model/math';

/**
 * NBA fair prices lean on the books that set the market: Pinnacle (the sharpest) and DraftKings and
 * FanDuel (US books post NBA lines first; Australian books often follow late). When any of them
 * prices a line, their de-vigged consensus gets half the say and every other book the other half.
 */
const SHARP_WEIGHT: Record<string, number> = { pinnacle: 2, draftkings: 1, fanduel: 1 };
export const SHARP_SHARE = 0.5;

const bookKey = (book: string) => book.toLowerCase().replace(/[^a-z]/g, '');

export function isSharpBook(book: string): boolean {
  return bookKey(book) in SHARP_WEIGHT;
}

export type BookFair = { book: string; p: number };

/** Fair probability from each book's de-vigged price: sharp consensus, everyone else's median, and the mix. */
export function sharpSplit(fairs: BookFair[]): { fair: number | null; sharp: number | null; rest: number | null } {
  let w = 0;
  let sum = 0;
  for (const f of fairs) {
    const k = SHARP_WEIGHT[bookKey(f.book)];
    if (!k || !Number.isFinite(f.p)) continue;
    w += k;
    sum += k * f.p;
  }
  const sharp = w > 0 ? sum / w : null;
  const rest = median(fairs.filter((f) => !isSharpBook(f.book) && Number.isFinite(f.p)).map((f) => f.p));
  const fair = sharp == null ? rest : rest == null ? sharp : SHARP_SHARE * sharp + (1 - SHARP_SHARE) * rest;
  return { fair, sharp, rest };
}

export function sharpFair(fairs: BookFair[]): number | null {
  return sharpSplit(fairs).fair;
}
