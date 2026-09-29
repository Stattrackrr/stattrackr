import { evaluateMarket, type BacktestReport } from '@/lib/tennisAi/backtest';

let report: BacktestReport = evaluateMarket([]);

export function currentBacktestReport(): BacktestReport {
  return report;
}

export function publishBacktestReport(next: BacktestReport): BacktestReport {
  if (next.approved && report.approved && (next.clvPct ?? 0) < (report.clvPct ?? 0)) return report;
  report = next;
  return report;
}

/** Demote a market when live closing-line value turns negative. */
export function applyDrift(liveClvPct: number | null): BacktestReport {
  if (liveClvPct == null || liveClvPct >= 0) return report;
  report = {
    ...report,
    approved: false,
    clvPct: liveClvPct,
    reasons: [...report.reasons, 'Live closing-line value turned negative, so the market is no longer approved.'],
  };
  return report;
}
