import { simulateMatch, type SimPoint, type SimSummary } from '@/lib/tennisAi/simulate';

const MAX_SHIFT = 0.15;
const SEARCH_SIMS = 4000;
const SEARCH_STEPS = 9;

/**
 * Re-simulates with the two serve-point rates pushed apart (or together) until player A wins
 * `target` of matches. Their average, which drives how many games and sets get played, is kept,
 * so totals carry the model's serve read on top of the agreed strength gap.
 */
export function anchorSimulation(
  input: SimPoint,
  target: number,
  opts: { sims: number; seed: number }
): { sim: SimSummary; shift: number } {
  const at = (shift: number, sims: number) =>
    simulateMatch({ ...input, pA: input.pA + shift, pB: input.pB - shift }, sims, opts.seed);
  let lo = -MAX_SHIFT;
  let hi = MAX_SHIFT;
  for (let i = 0; i < SEARCH_STEPS; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(mid, SEARCH_SIMS).matchWinA < target) lo = mid;
    else hi = mid;
  }
  const shift = (lo + hi) / 2;
  return { sim: at(shift, opts.sims), shift };
}
