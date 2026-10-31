/**
 * The fair price for every candidate line at an arm (spec sections 5, 7, 8 and 10):
 *   sharp fairs   Pinnacle / Betfair de-vigged four ways (power used until a method is chosen), averaged;
 *   inversion     (pA, pB) from the sharp winner, a total and a handicap, with tau and rho in the model;
 *   candidates    every Australian book's two-way market, each side with its fair, fair_source, edge, EV.
 * Pure: the poller supplies the quotes and stores what comes back.
 */

import { invert, makeModel, NORMAL, priceIntegrated, quadratureOrder, withTau, type Cov2, type SetRule } from '@/lib/tennis/model/pricing';
import { DEFAULT_DEVIG, devigTwoWay, type Devig } from './devig';
import { partner, type LogMarket, type QuoteRow } from './quotes';

export const SHARP_BOOKS: ReadonlySet<string> = new Set(['pinnacle', 'betfair']);
/** Lines closer than this are the same line. Stored on every candidate row. */
export const SAME_LINE_TOL = 0.01;
/** Until tau and rho are fitted from history (spec section 17), the provisional values, flagged on every arm. */
export const PROVISIONAL_TAU = 0.2;
export const PROVISIONAL_RHO = 0;
/** sig seeds per market from measurable noise (spec section 7). */
const SIG: Record<string, number> = { win: 0.02, tot: 0.03, hcp: 0.04 };
export const MIN_EV = 0.03;
export const CODE_VERSION = 'tennis-v0-1';

const logit = (p: number) => Math.log(p / (1 - p));
const isHalf = (line: number | null) => line == null || Math.abs(Math.abs(line % 1) - 0.5) < 1e-9;

/** The tournament's set rules: final sets at the slams end in a 10-point tiebreak at 6-6. */
export function matchRules(bestOf: number, isGrandSlam: boolean): { ruleN: SetRule; ruleF: SetRule; version: string } {
  const ruleF: SetRule = isGrandSlam ? { kind: 'tb', at: 6, target: 10 } : NORMAL;
  return { ruleN: NORMAL, ruleF, version: `default-2026-unverified:${bestOf}${isGrandSlam ? '-slam' : ''}` };
}

/** The selection a pair is keyed on (home, over, "home over", "home yes"); its partner is the other side. */
const baseSide = (s: string) => (/(^|\s)(away|under|no)$/.test(s) ? partner(s) : s);

export type Pair = { book: string; market: LogMarket; line: number | null; base: string; prices: [number, number]; devig: Devig };

/** Every book's complete two-way markets. */
export function pairQuotes(quotes: QuoteRow[]): Pair[] {
  const by = new Map<string, { book: string; market: LogMarket; line: number | null; base: string; a?: number; b?: number }>();
  for (const q of quotes) {
    const base = baseSide(q.selection);
    const key = `${q.book}|${q.market}|${q.line ?? ''}|${base}`;
    const row = by.get(key) ?? { book: q.book, market: q.market, line: q.line, base };
    if (q.selection === base) row.a = q.price;
    else row.b = q.price;
    by.set(key, row);
  }
  const out: Pair[] = [];
  for (const r of by.values()) {
    if (r.a == null || r.b == null) continue;
    const devig = devigTwoWay(r.a, r.b);
    if (devig) out.push({ book: r.book, market: r.market, line: r.line, base: r.base, prices: [r.a, r.b], devig });
  }
  return out;
}

export type SharpFair = { market: LogMarket; line: number | null; base: string; p: number; byBook: Record<string, Devig> };

/** The sharp fair for the base side of each market line: Pinnacle and Betfair de-vigged, then averaged. */
export function sharpFairs(pairs: Pair[]): SharpFair[] {
  const by = new Map<string, SharpFair & { ps: number[] }>();
  for (const p of pairs) {
    if (!SHARP_BOOKS.has(p.book)) continue;
    const key = `${p.market}|${p.line ?? ''}|${p.base}`;
    const row = by.get(key) ?? { market: p.market, line: p.line, base: p.base, p: 0, byBook: {}, ps: [] };
    row.byBook[p.book] = p.devig;
    row.ps.push(p.devig[DEFAULT_DEVIG][0]);
    by.set(key, row);
  }
  return [...by.values()].map(({ ps, ...r }) => ({ ...r, p: ps.reduce((a, b) => a + b, 0) / ps.length }));
}

/** The DP key for a market line's base side ("tot:21.5", "hcp:-2.5", "gA:12.5", "setA", "win"). */
export function dpKey(market: LogMarket, line: number | null, base: string): string | null {
  switch (market) {
    case 'match_winner':
      return 'win';
    case 'game_handicap':
      return line == null ? null : `hcp:${line}`;
    case 'total_games':
      return line == null ? null : `tot:${line}`;
    case 'games_won':
      return line == null ? null : `${base.startsWith('home') ? 'gA' : 'gB'}:${line}`;
    case 'win_a_set':
      return base.startsWith('home') ? 'setA' : 'setB';
  }
}

export type ArmModel = {
  theta: [number, number];
  cov: Cov2;
  coherence: number;
  keys: string[];
  tau: number;
  rho: number;
  order: number;
  tauSource: 'provisional' | 'fitted';
};

/** The sharp line nearest a 50/50 fair for one market, among half lines. */
function mainLine(fairs: SharpFair[], market: LogMarket, base: string): SharpFair | null {
  return fairs.filter((f) => f.market === market && f.base === base && isHalf(f.line)).sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))[0] ?? null;
}

/** (pA, pB) from the sharp winner, main total and main handicap. Null with fewer than two prices. */
export function invertArm(fairs: SharpFair[], bestOf: number, rules: { ruleN: SetRule; ruleF: SetRule }, tau = PROVISIONAL_TAU, rho = PROVISIONAL_RHO): ArmModel | null {
  const prices: Record<string, number> = {};
  const sig: Record<string, number> = {};
  const win = fairs.find((f) => f.market === 'match_winner');
  if (win) {
    prices.win = win.p;
    sig.win = SIG.win!;
  }
  const tot = mainLine(fairs, 'total_games', 'over');
  if (tot) {
    prices[`tot:${tot.line}`] = tot.p;
    sig[`tot:${tot.line}`] = SIG.tot!;
  }
  const hcp = mainLine(fairs, 'game_handicap', 'home');
  if (hcp) {
    prices[`hcp:${hcp.line}`] = hcp.p;
    sig[`hcp:${hcp.line}`] = SIG.hcp!;
  }
  const keys = Object.keys(prices);
  if (keys.length < 2) return null;
  const order = quadratureOrder(bestOf);
  const inv = invert(prices, sig, withTau(makeModel(keys, bestOf, rules.ruleN, rules.ruleF), tau, order, rho));
  return { theta: inv.theta, cov: inv.cov, coherence: inv.coherence, keys, tau, rho, order, tauSource: 'provisional' };
}

export type FairSource = 'sharp_direct' | 'sharp_converted' | 'model';

export type Candidate = {
  book: string;
  market: LogMarket;
  line: number | null;
  selection: string;
  price: number;
  /** The book's own de-vigged probability for this side (power) and the market's overround. */
  q: number;
  overround: number;
  fair: number;
  fairSource: FairSource;
  /** For sharp_converted: distance to the nearest sharp line, and the sharp lines available. */
  lineDistance: number | null;
  halfLines: number | null;
  sharpLines: number[];
  edge: number;
  ev: number;
};

/**
 * Every Australian two-way market, both sides, with its fair. Same-line sharp markets give sharp_direct;
 * other lines are priced by the DP at the arm's (pA, pB) (sharp_converted if the sharp book prices the
 * market at another line, model if it doesn't price the market at all). Whole-number lines are left out.
 */
export function evaluateCandidates(pairs: Pair[], fairs: SharpFair[], arm: ArmModel | null, bestOf: number, rules: { ruleN: SetRule; ruleF: SetRule }): Candidate[] {
  const au = pairs.filter((p) => !SHARP_BOOKS.has(p.book) && isHalf(p.line));
  const sharpOf = (market: LogMarket, base: string) => fairs.filter((f) => f.market === market && (market === 'game_handicap' || market === 'total_games' ? true : f.base === base));
  const needed = new Set<string>();
  for (const p of au) {
    const key = dpKey(p.market, p.line, p.base);
    if (key) needed.add(key);
  }
  let model: Record<string, number> | null = null;
  if (arm && needed.size) {
    model = priceIntegrated(arm.theta, arm.cov, arm.tau, makeModel([...needed], bestOf, rules.ruleN, rules.ruleF), arm.order, arm.rho);
  }
  const out: Candidate[] = [];
  for (const p of au) {
    const same = fairs.find((f) => f.market === p.market && f.base === p.base && (p.line == null ? f.line == null : f.line != null && Math.abs(f.line - p.line) < SAME_LINE_TOL));
    let baseFair: number | null = null;
    let source: FairSource = 'model';
    let lineDistance: number | null = null;
    const sharpSame = sharpOf(p.market, p.base);
    const sharpLines = sharpSame.map((f) => f.line).filter((l): l is number => l != null && isHalf(l));
    if (same) {
      baseFair = same.p;
      source = 'sharp_direct';
    } else if (model) {
      const key = dpKey(p.market, p.line, p.base);
      if (key && model[key] != null) {
        baseFair = model[key]!;
        if (sharpLines.length && p.line != null) {
          source = 'sharp_converted';
          lineDistance = Math.min(...sharpLines.map((l) => Math.abs(l - p.line!)));
        }
      }
    }
    if (baseFair == null || !(baseFair > 0 && baseFair < 1)) continue;
    for (const side of [0, 1] as const) {
      const fair = side === 0 ? baseFair : 1 - baseFair;
      const q = p.devig[DEFAULT_DEVIG][side];
      const price = p.prices[side];
      out.push({
        book: p.book,
        market: p.market,
        line: p.line,
        selection: side === 0 ? p.base : partner(p.base),
        price,
        q,
        overround: p.devig.overround,
        fair,
        fairSource: source,
        lineDistance,
        halfLines: lineDistance == null ? null : Math.round(lineDistance * 2),
        sharpLines,
        edge: logit(fair) - logit(q),
        ev: fair * price - 1,
      });
    }
  }
  return out;
}

/**
 * The would-be bet at the main arm: one per match, the highest EV among eligible candidates.
 * Eligible: sharp_direct (calibration groups for converted and model lines start on the prior and can't
 * bet until fitted, spec section 8), a confirmed price, and EV at the raw price of at least 3%.
 */
export function chooseShadowBet(candidates: Candidate[], confirmed: (c: Candidate) => boolean): Candidate | null {
  const eligible = candidates.filter((c) => c.fairSource === 'sharp_direct' && c.ev >= MIN_EV && confirmed(c));
  return eligible.sort((a, b) => b.ev - a.ev)[0] ?? null;
}
