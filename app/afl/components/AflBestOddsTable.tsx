'use client';

import { useState, useEffect, useMemo } from 'react';
import { americanToDecimal } from '@/lib/currencyUtils';

export type AflPropLine = { line: string; over: string; under: string };
export type AflPropOverOnly = { line: string; over: string };
export type AflPropYesNo = { yes: string; no: string };

export interface AflBookRow {
  name: string;
  H2H: { home: string; away: string };
  Spread: { line: string; over: string; under: string };
  Total: { line: string; over: string; under: string };
  /** Player props (optional); used when propsMode === 'player' */
  Disposals?: AflPropLine;
  DisposalsOver?: AflPropOverOnly;
  AnytimeGoalScorer?: AflPropYesNo;
  GoalsOver?: AflPropOverOnly;
  MarksOver?: AflPropOverOnly;
  TacklesOver?: AflPropOverOnly;
}

function parseAmerican(s: string): number {
  if (s === 'N/A' || s == null) return NaN;
  const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

function fmtOdds(americanStr: string, format: 'american' | 'decimal'): string {
  const am = parseAmerican(americanStr);
  if (Number.isNaN(am)) return 'N/A';
  if (format === 'decimal') {
    const dec = americanToDecimal(am);
    return dec.toFixed(2);
  }
  return am > 0 ? `+${am}` : String(am);
}

function displayHalfLine(s: string): string {
  if (s === 'N/A') return 'N/A';
  const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  if (Number.isNaN(v)) return s;
  const frac = Math.abs(v * 10) % 10;
  if (frac === 0) {
    const adj = v > 0 ? v - 0.5 : v + 0.5;
    return adj.toFixed(1);
  }
  return Number.isFinite(v) ? v.toFixed(1) : s;
}

const GAME_MARKETS = ['H2H', 'Spread', 'Total'] as const;

type PlayerPropCol = {
  key: keyof AflBookRow;
  label: string;
  type: 'ou' | 'over' | 'yesno';
};
const PLAYER_PROP_COLUMNS: PlayerPropCol[] = [
  { key: 'Disposals', label: 'Disposals (O/U)', type: 'ou' },
  { key: 'DisposalsOver', label: 'Disposals (Over)', type: 'over' },
  { key: 'AnytimeGoalScorer', label: 'Anytime Goal Scorer', type: 'yesno' },
  { key: 'GoalsOver', label: 'Goals (Over)', type: 'over' },
  { key: 'MarksOver', label: 'Marks (Over)', type: 'over' },
  { key: 'TacklesOver', label: 'Tackles (Over)', type: 'over' },
];

/** For Goals market: include Anytime Goal Scorer as line 0.5 (Yes = Over). Exported for use in AflLineSelector. */
export function getGoalsMarketLineOver(b: AflBookRow): { line: string; over: string } | null {
  if (b.GoalsOver?.line && b.GoalsOver.line !== 'N/A' && b.GoalsOver?.over && b.GoalsOver.over !== 'N/A') {
    return { line: b.GoalsOver.line, over: b.GoalsOver.over };
  }
  const ags = b.AnytimeGoalScorer;
  const hasYes = ags?.yes != null && ags.yes !== '' && ags.yes !== 'N/A';
  const hasNo = ags?.no != null && ags.no !== '' && ags.no !== 'N/A';
  if (hasYes || hasNo) {
    return { line: '0.5', over: hasYes ? ags!.yes! : ags!.no! };
  }
  return null;
}

/** All Goals lines for a book: Goals Over (if any) and Anytime 0.5 (if any). Used so dropdown can show both per book. */
export function getGoalsMarketLines(b: AflBookRow): { line: string; over: string }[] {
  const out: { line: string; over: string }[] = [];
  if (b.GoalsOver?.line && b.GoalsOver.line !== 'N/A' && b.GoalsOver?.over && b.GoalsOver.over !== 'N/A') {
    out.push({ line: b.GoalsOver.line, over: b.GoalsOver.over });
  }
  const ags = b.AnytimeGoalScorer;
  const hasYes = ags?.yes != null && ags.yes !== '' && ags.yes !== 'N/A';
  const hasNo = ags?.no != null && ags.no !== '' && ags.no !== 'N/A';
  if (hasYes || hasNo) {
    const line = '0.5';
    if (!out.some((x) => x.line === line)) {
      out.push({ line, over: hasYes ? ags!.yes! : ags!.no! });
    }
  }
  return out;
}

interface AflBestOddsTableProps {
  books: AflBookRow[];
  homeTeam: string;
  awayTeam: string;
  oddsFormat: 'american' | 'decimal';
  isDark: boolean;
  oddsLoading: boolean;
  oddsError: string | null;
  /** When 'player', show player prop columns (Goals, Disposals, etc.); when 'team', show game markets (H2H, Spread, Total). */
  propsMode?: 'player' | 'team';
}

export function AflBestOddsTable({
  books,
  homeTeam,
  awayTeam,
  oddsFormat,
  isDark,
  oddsLoading,
  oddsError,
  propsMode = 'team',
}: AflBestOddsTableProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isPlayerMode = propsMode === 'player';
  const markets = isPlayerMode ? PLAYER_PROP_COLUMNS.map((c) => c.label) : [...GAME_MARKETS];

  const bestH2H = useMemo(() => {
    let homeIdx = 0;
    let awayIdx = 0;
    for (let i = 1; i < books.length; i++) {
      const h = parseAmerican(books[i].H2H?.home);
      const a = parseAmerican(books[i].H2H?.away);
      if (!Number.isNaN(h) && h > parseAmerican(books[homeIdx].H2H?.home)) homeIdx = i;
      if (!Number.isNaN(a) && a > parseAmerican(books[awayIdx].H2H?.away)) awayIdx = i;
    }
    return { home: homeIdx, away: awayIdx };
  }, [books]);

  const pickBest = (getLine: (b: AflBookRow) => string, getOdds: (b: AflBookRow) => string, preferLow: boolean) => {
    const vals = books.map((b) => parseFloat(String(getLine(b)).replace(/[^0-9.+-]/g, '')));
    let bestLine = preferLow ? Infinity : -Infinity;
    vals.forEach((v) => {
      if (!Number.isNaN(v) && (preferLow ? v < bestLine : v > bestLine)) bestLine = v;
    });
    const eps = 1e-6;
    const cands: number[] = [];
    books.forEach((b, i) => {
      const v = vals[i];
      if (!Number.isNaN(v) && Math.abs(v - bestLine) < eps) cands.push(i);
    });
    if (cands.length <= 1) return new Set(cands);
    let maxOdds = -Infinity;
    let bestIdx = cands[0];
    cands.forEach((i) => {
      const o = parseAmerican(getOdds(books[i]));
      if (!Number.isNaN(o) && o > maxOdds) {
        maxOdds = o;
        bestIdx = i;
      }
    });
    return new Set([bestIdx]);
  };

  const bestSpreadPos = pickBest((b) => b.Spread?.line ?? 'N/A', (b) => b.Spread?.over ?? 'N/A', true);
  const bestSpreadNeg = pickBest((b) => b.Spread?.line ?? 'N/A', (b) => b.Spread?.under ?? 'N/A', false);
  const bestTotalOver = pickBest((b) => b.Total?.line ?? 'N/A', (b) => b.Total?.over ?? 'N/A', true);
  const bestTotalUnder = pickBest((b) => b.Total?.line ?? 'N/A', (b) => b.Total?.under ?? 'N/A', false);

  const bestPlayerProp = useMemo(() => {
    const out: Record<string, { over?: Set<number>; under?: Set<number>; yes?: Set<number>; no?: Set<number> }> = {};
    for (const col of PLAYER_PROP_COLUMNS) {
      const key = col.key;
      const isGoalsOver = key === 'GoalsOver';
      const getLine = (b: AflBookRow) => {
        if (isGoalsOver) {
          const g = getGoalsMarketLineOver(b);
          return g ? g.line : 'N/A';
        }
        const p = b[key];
        return p && typeof p === 'object' && 'line' in p ? (p as { line?: string }).line ?? 'N/A' : 'N/A';
      };
      const getOver = (b: AflBookRow) => {
        if (isGoalsOver) {
          const g = getGoalsMarketLineOver(b);
          return g ? g.over : 'N/A';
        }
        const prop = key as keyof AflBookRow;
        return (b[prop] as AflPropOverOnly)?.over ?? 'N/A';
      };
      if (col.type === 'ou') {
        const prop = key as keyof AflBookRow;
        out[key] = {
          over: pickBest(getLine, (b) => ((b[prop] as AflPropLine)?.over ?? 'N/A'), true),
          under: pickBest(getLine, (b) => ((b[prop] as AflPropLine)?.under ?? 'N/A'), false),
        };
      } else if (col.type === 'over') {
        out[key] = {
          over: pickBest(getLine, getOver, true),
        };
      } else if (col.type === 'yesno') {
        const prop = key as keyof AflBookRow;
        const getYes = (b: AflBookRow) => ((b[prop] as AflPropYesNo)?.yes ?? 'N/A');
        const getNo = (b: AflBookRow) => ((b[prop] as AflPropYesNo)?.no ?? 'N/A');
        let bestYesIdx = 0;
        let bestNoIdx = 0;
        for (let i = 1; i < books.length; i++) {
          if (parseAmerican(getYes(books[i])) > parseAmerican(getYes(books[bestYesIdx]))) bestYesIdx = i;
          if (parseAmerican(getNo(books[i])) > parseAmerican(getNo(books[bestNoIdx]))) bestNoIdx = i;
        }
        out[key] = {
          yes: new Set([bestYesIdx]),
          no: new Set([bestNoIdx]),
        };
      }
    }
    return out;
  }, [books]);

  const green = mounted && isDark ? 'text-green-400' : 'text-green-600';
  const grey = mounted && isDark ? 'text-slate-300' : 'text-slate-600';

  return (
    <div className="hidden lg:block bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 sm:p-4 md:p-6 border border-gray-200 dark:border-gray-700 w-full flex-shrink-0">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Best Odds</h3>
      </div>
      {oddsError && (
        <div className="text-xs text-red-500 dark:text-red-400 mb-2">Error: {oddsError}</div>
      )}
      {oddsLoading ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className={(mounted && isDark ? 'bg-[#0a1929]' : 'bg-slate-100') + ' sticky top-0'}>
                <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
                {markets.map((m) => (
                  <th key={m} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(4)].map((_, idx) => (
                <tr key={idx} className={(mounted && isDark ? 'border-slate-700' : 'border-slate-200') + ' border-b'}>
                  <td className="py-2 pr-3">
                    <div className={`h-4 w-20 rounded animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }} />
                  </td>
                  {markets.map((_, mi) => (
                    <td key={mi} className="py-2 px-3">
                      <div className={`h-4 w-16 rounded animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + mi * 0.05}s` }} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : books.length === 0 ? (
        <div className="px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-500 dark:text-gray-400 inline-block">
          No odds available
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className={(mounted && isDark ? 'bg-[#0a1929]' : 'bg-slate-100') + ' sticky top-0'}>
                <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
                {markets.map((m) => (
                  <th key={m} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{m}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {books.map((row, i) => (
                <tr key={`${row.name}-${i}`} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
                  <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
                  {isPlayerMode ? (
                    PLAYER_PROP_COLUMNS.map((col) => {
                      const key = col.key;
                      const prop = row[key];
                      if (!prop || typeof prop !== 'object') {
                        return (
                          <td key={key} className="py-2 px-3" data-column={key}>
                            <span className={grey}>N/A</span>
                          </td>
                        );
                      }
                      if (col.type === 'ou') {
                        const p = prop as AflPropLine;
                        const line = p.line ?? 'N/A';
                        const over = p.over ?? 'N/A';
                        const under = p.under ?? 'N/A';
                        const bestOver = bestPlayerProp[key]?.over?.has(i);
                        const bestUnder = bestPlayerProp[key]?.under?.has(i);
                        return (
                          <td key={key} className="py-2 px-3" data-column={key}>
                            {line === 'N/A' ? (
                              <span className={grey}>N/A</span>
                            ) : (
                              <>
                                <div className={`font-mono whitespace-nowrap ${bestOver ? green : grey}`}>O {displayHalfLine(line)} ({fmtOdds(over, oddsFormat)})</div>
                                <div className={`font-mono whitespace-nowrap ${bestUnder ? green : grey}`}>U {displayHalfLine(line)} ({fmtOdds(under, oddsFormat)})</div>
                              </>
                            )}
                          </td>
                        );
                      }
                      if (col.type === 'over') {
                        const goalsData = key === 'GoalsOver' ? getGoalsMarketLineOver(row) : null;
                        const p = prop as AflPropOverOnly;
                        const line = (key === 'GoalsOver' ? goalsData?.line : p?.line) ?? 'N/A';
                        const over = (key === 'GoalsOver' ? goalsData?.over : p?.over) ?? 'N/A';
                        const bestOver = bestPlayerProp[key]?.over?.has(i);
                        return (
                          <td key={key} className="py-2 px-3" data-column={key}>
                            {line === 'N/A' ? (
                              <span className={grey}>N/A</span>
                            ) : (
                              <div className={`font-mono whitespace-nowrap ${bestOver ? green : grey}`}>O {displayHalfLine(line)} ({fmtOdds(over, oddsFormat)})</div>
                            )}
                          </td>
                        );
                      }
                      if (col.type === 'yesno') {
                        const p = prop as AflPropYesNo;
                        const yes = p.yes ?? 'N/A';
                        const no = p.no ?? 'N/A';
                        const bestYes = bestPlayerProp[key]?.yes?.has(i);
                        const bestNo = bestPlayerProp[key]?.no?.has(i);
                        return (
                          <td key={key} className="py-2 px-3" data-column={key}>
                            <div className={`font-mono whitespace-nowrap ${bestYes ? green : grey}`}>Yes {fmtOdds(yes, oddsFormat)}</div>
                            <div className={`font-mono whitespace-nowrap ${bestNo ? green : grey}`}>No {fmtOdds(no, oddsFormat)}</div>
                          </td>
                        );
                      }
                      return (
                        <td key={key} className="py-2 px-3" data-column={key}>
                          <span className={grey}>N/A</span>
                        </td>
                      );
                    })
                  ) : (
                    <>
                      <td className="py-2 px-3">
                        <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
                          {homeTeam} <span className={i === bestH2H.home ? green : grey}>{fmtOdds(row.H2H?.home ?? 'N/A', oddsFormat)}</span>
                        </div>
                        <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
                          {awayTeam} <span className={i === bestH2H.away ? green : grey}>{fmtOdds(row.H2H?.away ?? 'N/A', oddsFormat)}</span>
                        </div>
                      </td>
                      <td className="py-2 px-3">
                        {row.Spread?.line === 'N/A' || !row.Spread ? (
                          <span className={grey}>N/A</span>
                        ) : (
                          <>
                            <div className={`font-mono whitespace-nowrap ${bestSpreadPos.has(i) ? green : grey}`}>
                              + {displayHalfLine(row.Spread.line)} ({fmtOdds(row.Spread.over, oddsFormat)})
                            </div>
                            <div className={`font-mono whitespace-nowrap ${bestSpreadNeg.has(i) ? green : grey}`}>
                              - {displayHalfLine(row.Spread.line)} ({fmtOdds(row.Spread.under, oddsFormat)})
                            </div>
                          </>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {row.Total?.line === 'N/A' || !row.Total ? (
                          <span className={grey}>N/A</span>
                        ) : (
                          <>
                            <div className={`font-mono whitespace-nowrap ${bestTotalOver.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.over, oddsFormat)})</div>
                            <div className={`font-mono whitespace-nowrap ${bestTotalUnder.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.under, oddsFormat)})</div>
                          </>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
