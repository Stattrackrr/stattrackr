/** Poisson P(X = k). */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0 || !Number.isFinite(lambda) || lambda <= 0) return k === 0 ? 1 : 0;
  let p = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) p *= lambda / i;
  return p;
}

export function countOverUnder(lambda: number, line: number): { over: number; under: number; push: number } {
  const whole = Math.abs(line - Math.round(line)) < 1e-6;
  let over = 0;
  let under = 0;
  let push = 0;
  const cap = Math.max(80, Math.ceil(lambda + 12 * Math.sqrt(lambda)));
  for (let k = 0; k <= cap; k += 1) {
    const p = poissonPmf(k, lambda);
    if (whole) {
      if (k > line) over += p;
      else if (k < line) under += p;
      else push += p;
    } else if (k > line) over += p;
    else under += p;
  }
  const total = over + under + push;
  if (total > 0 && Math.abs(total - 1) > 1e-6) {
    over /= total;
    under /= total;
    push /= total;
  }
  return { over, under, push };
}

export function expectedCount(serviceGames: number, ratePerGame: number): number {
  if (!(serviceGames > 0) || !(ratePerGame >= 0)) return 0;
  return serviceGames * ratePerGame;
}
