export type BacktestBet = {
  date: string;
  tour: 'ATP' | 'WTA';
  surface: string;
  market: string;
  modelProb: number;
  /** Decimal odds that could have been bet before the start. */
  openOdds: number | null;
  /** Closing decimal odds, used only for CLV. */
  closeOdds: number | null;
  won: boolean | null;
  voided?: boolean;
};

export type BacktestReport = {
  market: string;
  tour: string;
  n: number;
  logLoss: number | null;
  marketLogLoss: number | null;
  brier: number | null;
  marketBrier: number | null;
  ece: number | null;
  clvPct: number | null;
  roi: number | null;
  roiLow: number | null;
  maxDrawdown: number | null;
  stable: boolean;
  approved: boolean;
  reasons: string[];
};

export type GateConfig = {
  minBets: number;
  maxEce: number;
};

export const DEFAULT_GATE: GateConfig = { minBets: 300, maxEce: 0.05 };

function mean(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function logLoss(prob: number, won: boolean): number {
  const p = Math.min(0.999, Math.max(0.001, prob));
  return -(won ? Math.log(p) : Math.log(1 - p));
}

export function brier(prob: number, won: boolean): number {
  const y = won ? 1 : 0;
  return (prob - y) ** 2;
}

export function expectedCalibrationError(rows: Array<{ prob: number; won: boolean }>, bins = 10): number | null {
  if (!rows.length) return null;
  let error = 0;
  for (let i = 0; i < bins; i += 1) {
    const lo = i / bins;
    const hi = (i + 1) / bins;
    const bucket = rows.filter((row) => row.prob >= lo && (i === bins - 1 ? row.prob <= hi : row.prob < hi));
    if (!bucket.length) continue;
    const avgP = bucket.reduce((total, row) => total + row.prob, 0) / bucket.length;
    const avgY = bucket.reduce((total, row) => total + (row.won ? 1 : 0), 0) / bucket.length;
    error += (bucket.length / rows.length) * Math.abs(avgP - avgY);
  }
  return error;
}

function clv(openOdds: number, closeOdds: number): number {
  return closeOdds / openOdds - 1;
}

function bootstrapRoiLow(profits: number[], seed: number): number | null {
  if (profits.length < 20) return null;
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const samples: number[] = [];
  for (let i = 0; i < 200; i += 1) {
    let total = 0;
    for (let j = 0; j < profits.length; j += 1) {
      total += profits[Math.floor(next() * profits.length)];
    }
    samples.push(total / profits.length);
  }
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.05)];
}

export function evaluateMarket(rows: BacktestBet[], config: GateConfig = DEFAULT_GATE, seed = 1): BacktestReport {
  const live = rows.filter((row) => !row.voided && row.won != null);
  const settled = live.filter((row) => row.openOdds != null && row.openOdds > 1);
  const probs = settled.map((row) => ({ prob: row.modelProb, won: Boolean(row.won) }));
  const marketProbs = settled
    .filter((row) => row.openOdds)
    .map((row) => ({ prob: 1 / (row.openOdds as number), won: Boolean(row.won) }));
  const log = mean(probs.map((row) => logLoss(row.prob, row.won)));
  const marketLog = mean(marketProbs.map((row) => logLoss(row.prob, row.won)));
  const br = mean(probs.map((row) => brier(row.prob, row.won)));
  const marketBr = mean(marketProbs.map((row) => brier(row.prob, row.won)));
  const ece = expectedCalibrationError(probs);
  const clvs = settled
    .filter((row) => row.closeOdds != null && row.closeOdds > 1 && row.openOdds)
    .map((row) => clv(row.openOdds as number, row.closeOdds as number));
  const clvPct = mean(clvs);
  const profits = settled.map((row) => (row.won ? (row.openOdds as number) - 1 : -1));
  const roi = mean(profits);
  let peak = 0;
  let equity = 0;
  let maxDrawdown = 0;
  for (const profit of profits) {
    equity += profit;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  const thirds = [0, 1, 2].map((part) => {
    const start = Math.floor((part * settled.length) / 3);
    const end = Math.floor(((part + 1) * settled.length) / 3);
    return mean(profits.slice(start, end));
  });
  const stable = thirds.every((part) => part == null || part > -0.05);
  const reasons: string[] = [];
  if (settled.length < config.minBets) reasons.push(`Only ${settled.length} bets, need ${config.minBets}.`);
  if (log == null || marketLog == null || log >= marketLog) reasons.push('Log loss does not beat the market baseline.');
  if (br == null || marketBr == null || br >= marketBr) reasons.push('Brier score does not beat the market baseline.');
  if (ece == null || ece > config.maxEce) reasons.push('Calibration error is too high.');
  if (clvPct == null || clvPct <= 0) reasons.push('Closing line value is not positive.');
  const roiLow = bootstrapRoiLow(profits, seed);
  if (roiLow != null && roiLow < -0.02) reasons.push('ROI lower bound is negative.');
  if (!stable) reasons.push('Results are not stable across sub-periods.');
  return {
    market: settled[0]?.market || rows[0]?.market || 'unknown',
    tour: settled[0]?.tour || rows[0]?.tour || 'ATP',
    n: settled.length,
    logLoss: log,
    marketLogLoss: marketLog,
    brier: br,
    marketBrier: marketBr,
    ece,
    clvPct: clvPct == null ? null : clvPct * 100,
    roi,
    roiLow,
    maxDrawdown: profits.length ? maxDrawdown : null,
    stable,
    approved: reasons.length === 0,
    reasons,
  };
}

export type WalkRow = {
  date: string;
  tour: 'ATP' | 'WTA';
  surface: string;
  market: string;
  modelProb: number;
  openOdds: number | null;
  closeOdds: number | null;
  won: boolean | null;
  voided?: boolean;
};

/** Walk-forward keeps prediction order. Training is "everything dated before this row". */
export function walkForward(rows: WalkRow[], predict: (history: WalkRow[], row: WalkRow) => number): BacktestBet[] {
  const ordered = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  return ordered.map((row, index) => {
    const history = ordered.slice(0, index).filter((past) => past.date < row.date);
    return {
      date: row.date,
      tour: row.tour,
      surface: row.surface,
      market: row.market,
      modelProb: predict(history, row),
      openOdds: row.openOdds,
      closeOdds: row.closeOdds,
      won: row.won,
      voided: row.voided,
    };
  });
}

export function sameReport(a: BacktestReport, b: BacktestReport): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
