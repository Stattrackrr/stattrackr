import { bookKey } from '@/lib/aiPicks/books';
import { legCandidateKey, type AiCandidate } from '@/lib/aiPicks/candidates/types';
import { round } from '@/lib/aiPicks/model/math';
import type { AiPickLeg } from '@/lib/aiPicks/types';

type Rung = { line: number; fair: number; price: number };

export type ClosingIndex = { byKey: Map<string, AiCandidate>; byLadder: Map<string, AiCandidate[]> };

/** The key without its trailing line, shared by every line of one selection. */
const ladderKey = (key: string) => key.slice(0, key.lastIndexOf('|'));

/** Only prices from matches that have not started count toward a close. */
export function closingIndex(candidates: AiCandidate[], nowMs: number): ClosingIndex {
  const byKey = new Map<string, AiCandidate>();
  const byLadder = new Map<string, AiCandidate[]>();
  for (const c of candidates) {
    if (!(Date.parse(c.startsAt) > nowMs)) continue;
    byKey.set(c.key, c);
    if (c.line == null) continue;
    const k = ladderKey(c.key);
    byLadder.set(k, [...(byLadder.get(k) ?? []), c]);
  }
  return { byKey, byLadder };
}

/** Price at `line` from the nearest lines either side: fair chance interpolated, at their average margin. */
export function priceBetweenLines(line: number, rungs: Rung[]): number | null {
  const below = rungs.filter((r) => r.line < line).sort((a, b) => b.line - a.line)[0];
  const above = rungs.filter((r) => r.line > line).sort((a, b) => a.line - b.line)[0];
  if (!below || !above) return null;
  const t = (line - below.line) / (above.line - below.line);
  const fair = below.fair + t * (above.fair - below.fair);
  const payout = (below.price * below.fair + above.price * above.fair) / 2;
  return fair > 0 && fair < 1 ? round(payout / fair, 3) : null;
}

/**
 * The leg's price in this scan: its book (else the best price) at its line, or, once books have
 * moved off the line, the price the lines either side imply for it.
 */
export function closingPrice(leg: AiPickLeg, index: ClosingIndex): number | null {
  const book = bookKey(leg.bookmaker);
  const priceOf = (c: AiCandidate) => c.quotes.find((q) => bookKey(q.book) === book)?.price ?? c.bestPrice;
  const key = legCandidateKey(leg);
  const exact = index.byKey.get(key);
  if (exact) return priceOf(exact);
  if (leg.line == null) return null;
  const rungs = (index.byLadder.get(ladderKey(key)) ?? [])
    .filter((c): c is AiCandidate & { line: number; marketProb: number } => c.line != null && c.marketProb != null)
    .map((c) => ({ line: c.line, fair: c.marketProb, price: priceOf(c) }));
  return priceBetweenLines(leg.line, rungs);
}
