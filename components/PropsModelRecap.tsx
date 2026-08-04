'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  formatAflTopPicksRoundLabel,
  gradeAflTopPickFromStored,
  summarizeAflTopPicksGrades,
  type AflTopPicksGradeResult,
} from '@/lib/aflTopPicksGrade';
import { sortAflTopPicksRoundKeys } from '@/lib/aflTopPicksRoundUtils';

type HistoryPick = {
  playerName?: string | null;
  recommendedSide?: 'OVER' | 'UNDER' | null;
  line?: number | null;
  actualDisposals?: number | null;
  bookmaker?: string | null;
};

type HistoryRecord = {
  roundKey?: string | null;
  homeTeam?: string | null;
  awayTeam?: string | null;
  commenceTime?: string | null;
  picks?: HistoryPick[] | null;
};

type GradedRow = {
  key: string;
  playerName: string;
  side: 'OVER' | 'UNDER';
  line: number;
  actual: number | null;
  result: AflTopPicksGradeResult;
  matchup: string;
};

type PropsModelRecapProps = {
  isDark?: boolean;
  onRetry?: () => void;
};

const MAX_ROWS = 12;

function resultMark(result: AflTopPicksGradeResult): string {
  if (result === 'Hit') return '✓';
  if (result === 'Miss') return '✗';
  return '—';
}

function pickLatestSettledRound(records: HistoryRecord[]): string | null {
  const byRound = new Map<string, HistoryRecord[]>();
  for (const record of records) {
    const key = String(record.roundKey || '').trim();
    if (!key) continue;
    const list = byRound.get(key) ?? [];
    list.push(record);
    byRound.set(key, list);
  }

  const ordered = sortAflTopPicksRoundKeys([...byRound.keys()]).reverse();
  for (const roundKey of ordered) {
    const roundRecords = byRound.get(roundKey) ?? [];
    let settled = 0;
    let total = 0;
    for (const record of roundRecords) {
      for (const pick of record.picks ?? []) {
        total += 1;
        if (typeof pick.actualDisposals === 'number' && Number.isFinite(pick.actualDisposals)) {
          settled += 1;
        }
      }
    }
    // Prefer a round with enough graded results (not just soft-locked upcoming).
    if (total > 0 && settled / total >= 0.4) return roundKey;
  }
  return ordered[0] ?? null;
}

export function PropsModelRecap({ isDark = true, onRetry }: PropsModelRecapProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [records, setRecords] = useState<HistoryRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(false);
      try {
        const res = await fetch('/api/afl/model/disposals/top-picks?history=1&limit=500', {
          cache: 'no-store',
        });
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setRecords([]);
          setError(true);
          return;
        }
        setRecords(Array.isArray(json.records) ? (json.records as HistoryRecord[]) : []);
      } catch {
        if (!cancelled) {
          setRecords([]);
          setError(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const { roundKey, rows, summary } = useMemo(() => {
    const latest = pickLatestSettledRound(records);
    if (!latest) {
      return {
        roundKey: null as string | null,
        rows: [] as GradedRow[],
        summary: { hits: 0, misses: 0, hitRate: 0, decided: 0 },
      };
    }

    const graded: GradedRow[] = [];
    for (const record of records) {
      if (String(record.roundKey || '').trim() !== latest) continue;
      const matchup = `${record.homeTeam || 'Home'} vs ${record.awayTeam || 'Away'}`;
      for (const raw of record.picks ?? []) {
        const pick = gradeAflTopPickFromStored(raw);
        if (pick.recommendedSide !== 'OVER' && pick.recommendedSide !== 'UNDER') continue;
        if (pick.line == null || !Number.isFinite(pick.line)) continue;
        graded.push({
          key: `${record.roundKey}-${record.homeTeam}-${record.awayTeam}-${pick.playerName}-${pick.recommendedSide}-${pick.line}`,
          playerName: String(pick.playerName || 'Unknown').trim() || 'Unknown',
          side: pick.recommendedSide,
          line: pick.line,
          actual: pick.actualDisposals,
          result: pick.result,
          matchup,
        });
      }
    }

    return {
      roundKey: latest,
      rows: graded.slice(0, MAX_ROWS),
      summary: summarizeAflTopPicksGrades(graded),
    };
  }, [records]);

  const shell = isDark ? 'text-gray-300' : 'text-gray-600';
  const card = isDark
    ? 'bg-[#0a1929] border-gray-700'
    : 'bg-white border-gray-200';
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const title = isDark ? 'text-white' : 'text-gray-900';

  return (
    <div className={`flex flex-col items-stretch py-10 px-4 ${shell}`}>
      <div className="text-center mb-6">
        <p className={`text-lg font-medium ${title}`}>No lines available yet</p>
        <p className={`text-sm mt-1 max-w-lg mx-auto ${muted}`}>
          Bookmakers have not posted next-round overs/unders. Check back soon — or review last
          round&apos;s model Top Picks below.
        </p>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className={`mt-4 px-4 py-2 rounded-lg font-medium ${
              isDark
                ? 'bg-gray-700 hover:bg-gray-600 text-white'
                : 'bg-gray-200 hover:bg-gray-300 text-gray-800'
            }`}
          >
            Try again
          </button>
        ) : null}
      </div>

      {loading ? (
        <div className={`mx-auto w-full max-w-2xl rounded-xl border p-4 space-y-3 ${card}`}>
          <div className={`h-5 w-40 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          <div className={`h-4 w-28 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          {[...Array(5)].map((_, i) => (
            <div
              key={i}
              className={`h-10 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}
              style={{ animationDelay: `${i * 0.05}s` }}
            />
          ))}
        </div>
      ) : error || !roundKey || rows.length === 0 ? null : (
        <div className={`mx-auto w-full max-w-2xl rounded-xl border p-4 ${card}`}>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <div>
              <h3 className={`text-base font-semibold ${title}`}>Last round model recap</h3>
              <p className={`text-sm ${muted}`}>{formatAflTopPicksRoundLabel(roundKey)}</p>
            </div>
            {summary.decided > 0 ? (
              <p className={`text-sm font-semibold tabular-nums ${title}`}>
                Hit rate{' '}
                <span className="text-emerald-500">{summary.hitRate.toFixed(1)}%</span>
                <span className={`font-normal ${muted}`}>
                  {' '}
                  ({summary.hits}/{summary.decided})
                </span>
              </p>
            ) : null}
          </div>

          <div className="max-h-80 overflow-y-auto -mx-1 px-1">
            <ul className="divide-y divide-gray-200 dark:divide-gray-700">
              {rows.map((row) => (
                <li
                  key={row.key}
                  className="py-2.5 flex items-center justify-between gap-3 text-sm"
                >
                  <div className="min-w-0">
                    <p className={`font-medium truncate ${title}`}>{row.playerName}</p>
                    <p className={`text-xs truncate ${muted}`}>
                      {row.side === 'OVER' ? 'Over' : 'Under'} {row.line.toFixed(1)} · {row.matchup}
                    </p>
                  </div>
                  <div className="shrink-0 text-right tabular-nums">
                    <p className={title}>
                      {row.actual != null ? row.actual : '—'}
                      <span
                        className={`ml-2 font-semibold ${
                          row.result === 'Hit'
                            ? 'text-emerald-500'
                            : row.result === 'Miss'
                              ? 'text-red-400'
                              : muted
                        }`}
                      >
                        {resultMark(row.result)}
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-4 flex justify-center">
            <Link
              href="/afl"
              className={`text-sm font-semibold underline-offset-2 hover:underline ${
                isDark ? 'text-violet-300' : 'text-violet-700'
              }`}
            >
              View full Top Picks
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
