import { AI_PICK_MIN_PRICE, type AiPickMarketKind, type AiPickSide } from '@/lib/aiPicks/types';

/** `milestone`: the book lists it one way only ("4+"), the same bet as over 3.5. */
export type CandidateQuote = { book: string; price: number; milestone?: boolean };

/** A record the side would have hit, e.g. "Last 10: 7/10". */
export type SupportRecord = { label: string; hits: number; games: number };

/** One bettable selection, priced, with the evidence behind it. */
export type AiCandidate = {
  /** sport|event|market|player-or-team|side|line */
  key: string;
  sport: 'nbl' | 'nba' | 'tennis';
  eventKey: string;
  eventLabel: string;
  startsAt: string;
  market: string;
  marketKind: AiPickMarketKind;
  player: string | null;
  playerId: string | null;
  /** NBL / NBA: player's team or the selected team. Tennis: the opponent. */
  team: string | null;
  side: AiPickSide;
  line: number | null;
  bestPrice: number;
  bestBook: string;
  quotes: CandidateQuote[];
  modelProb: number | null;
  marketProb: number | null;
  /**
   * Model alone for this side with game context switched off (base) and at full strength (full),
   * so the learning loop can tune how hard context moves the model.
   */
  contextProbs?: { base: number; full: number } | null;
  /** Blend of model and market, the number EV uses. */
  prob: number;
  pushProb: number;
  ev: number;
  /** Projected stat / margin / total, when the model has one. */
  projection: number | null;
  support: SupportRecord[];
  /** Weighted share of support records the side hit (null when none). */
  supportScore: number | null;
  singleEligible: boolean;
  multiEligible: boolean;
  /** Reasons this would be skipped or treated carefully. */
  flags: string[];
  context: Record<string, unknown>;
};

export function candidateKey(c: Pick<AiCandidate, 'eventKey' | 'market' | 'player' | 'team' | 'side' | 'line'> & { sport: string }): string {
  const who = (c.player || c.team || '').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return [c.sport, c.eventKey, c.market, who, c.side, c.line ?? ''].join('|');
}

/**
 * The key the scan gave a stored leg. Tennis match-level markets (totals) have no player and
 * store the away player as `team`, but the scan keys them under the home player.
 */
export function legCandidateKey(
  leg: Pick<AiCandidate, 'eventKey' | 'eventLabel' | 'market' | 'player' | 'team' | 'side' | 'line'> & { sport: string }
): string {
  const home = leg.sport === 'tennis' && !leg.player ? leg.eventLabel.split(' vs ')[0]?.trim() : null;
  return candidateKey(home ? { ...leg, player: home } : leg);
}

/** Several books run the same feed and post identical prices; each distinct price counts once. */
export function distinctPrices(quotes: CandidateQuote[]): number[] {
  return [...new Set(quotes.map((q) => q.price))];
}

/** Flags that rule a candidate out: bad or missing data rather than a weak edge. */
export const BLOCKING_FLAG =
  /Fewer than|Has not played|Not enough|retired|Only one side|differ by|far apart|too big to trust|Listed out|Longer than the main line|No two-way price at this line|Alternate line/;

export function edgeFlag(ev: number, maxTrustedEv: number): string | null {
  return ev > maxTrustedEv ? `Edge of ${Math.round(ev * 100)}% is too big to trust` : null;
}

/**
 * The bet as the posting book lists it: its "4+" is a milestone even where other books run 3.5 as an
 * over/under. The line's kind across books (main / alternate / milestone) still decides singles.
 */
export function betKind(lineKind: AiPickMarketKind, best: CandidateQuote): AiPickMarketKind {
  return best.milestone ? 'milestone' : lineKind;
}

/** Legs shorter than this barely move a multi's price. */
const MIN_LEG_PRICE = 1.15;

/**
 * Singles: main lines and milestones priced 1.65 up to the long-shot cap.
 * Multi legs: any line (alternates included) up to the leg cap; the combined 1.65 floor is checked later.
 */
export function eligibility(
  price: number,
  marketKind: AiPickMarketKind,
  blocked: boolean,
  caps: { maxPriceSingle: number; maxPriceLeg: number }
): { singleEligible: boolean; multiEligible: boolean } {
  return {
    singleEligible: !blocked && marketKind !== 'alternate' && price >= AI_PICK_MIN_PRICE && price <= caps.maxPriceSingle,
    multiEligible: !blocked && price >= MIN_LEG_PRICE && price <= caps.maxPriceLeg,
  };
}

/**
 * Best price per selection, ignoring a lone price far above everyone else at the same line
 * (usually a stale or mis-keyed quote).
 */
export function bestQuote(quotes: CandidateQuote[]): { best: CandidateQuote; flags: string[] } | null {
  const valid = quotes.filter((q) => q.price > 1 && Number.isFinite(q.price)).sort((a, b) => b.price - a.price);
  if (!valid.length) return null;
  const flags: string[] = [];
  if (valid.length >= 3) {
    const prices = distinctPrices(valid).sort((a, b) => a - b);
    const mid = prices[Math.floor(prices.length / 2)]!;
    const kept = valid.filter((q) => q.price <= mid * 1.15);
    const dropped = valid.length - kept.length;
    if (dropped) flags.push(`Ignored outlier price ${valid[0]!.price} at ${valid[0]!.book}${dropped > 1 ? ` and ${dropped - 1} more` : ''}`);
    return { best: kept[0]!, flags };
  }
  if (valid.length === 2 && valid[0]!.price > valid[1]!.price * 1.3) flags.push('Two books far apart on price');
  if (valid.length === 1) flags.push('Only one bookmaker prices this');
  return { best: valid[0]!, flags };
}

/** Bookmakers licensed in Australia, where our users can actually bet. */
const AUSSIE_BOOKS = new Set([
  'sportsbet',
  'tab',
  'tabtouch',
  'ladbrokes',
  'neds',
  'bet365',
  'unibet',
  'pointsbet',
  'betright',
  'dabble',
  'playup',
  'betr',
  'palmerbet',
  'picklebet',
  'bluebet',
  'topsport',
  'boombet',
  'betdeluxe',
]);

export function isAussieBook(book: string): boolean {
  const k = book.toLowerCase().replace(/[^a-z0-9]/g, '');
  return AUSSIE_BOOKS.has(k) || (k.endsWith('au') && AUSSIE_BOOKS.has(k.slice(0, -2)));
}

/**
 * The price we post: the best Australian book's, ignoring one far above the middle of every
 * book's prices (usually stale). Offshore books still count toward that middle and the fair price,
 * but are never the price we post.
 */
export function bettableQuote(quotes: CandidateQuote[]): { best: CandidateQuote; quotes: CandidateQuote[]; flags: string[] } | null {
  const all = quotes.filter((q) => q.price > 1 && Number.isFinite(q.price)).sort((a, b) => b.price - a.price);
  const aussie = all.filter((q) => isAussieBook(q.book));
  if (!aussie.length) return null;
  if (all.length < 3) {
    const small = bestQuote(aussie);
    return small && { best: small.best, quotes: aussie, flags: [...(bestQuote(all)?.flags ?? [])] };
  }
  const prices = distinctPrices(all).sort((a, b) => a - b);
  const mid = prices[Math.floor(prices.length / 2)]!;
  const kept = aussie.filter((q) => q.price <= mid * 1.15);
  if (!kept.length) return null;
  const flags: string[] = [];
  const dropped = aussie.length - kept.length;
  if (dropped) flags.push(`Ignored outlier price ${aussie[0]!.price} at ${aussie[0]!.book}${dropped > 1 ? ` and ${dropped - 1} more` : ''}`);
  if (kept.length === 1) flags.push('Only one Australian bookmaker prices this');
  return { best: kept[0]!, quotes: aussie, flags };
}
