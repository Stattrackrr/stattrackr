'use client';

import { useEffect, useState } from 'react';
import type { OpponentBreakdownApiResponse } from '@/app/api/soccer/opponent-breakdown/route';

type SoccerOpponentBreakdownPanelProps = {
  isDark: boolean;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
};

const HIDDEN_OPPONENT_BREAKDOWN_STATS = new Set(['xg_on_target_xgot', 'crosses']);
const OPPONENT_BREAKDOWN_SESSION_PREFIX = 'soccer-opponent-breakdown:v1:';

function getOpponentBreakdownSessionKey(key: string): string {
  return `${OPPONENT_BREAKDOWN_SESSION_PREFIX}${key}`;
}

function readCachedOpponentBreakdown(key: string): OpponentBreakdownApiResponse | null {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = window.sessionStorage.getItem(getOpponentBreakdownSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: OpponentBreakdownApiResponse } | null;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeCachedOpponentBreakdown(key: string, data: OpponentBreakdownApiResponse): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.sessionStorage.setItem(
      getOpponentBreakdownSessionKey(key),
      JSON.stringify({ data, cachedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

function formatNumber(v: number | null, isPercent = false): string {
  if (v == null) return '—';
  if (!Number.isFinite(v)) return '—';
  return `${v.toFixed(2)}${isPercent ? '%' : ''}`;
}

function getRankColor(rank: number | null, isDark: boolean): string {
  if (!rank || rank <= 0) return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
  if (rank <= 7) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
  if (rank <= 14) return 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
}

function OpponentBreakdownTimeframeToggle({
  isDark,
  timeframe,
  onChange,
}: {
  isDark: boolean;
  timeframe: 'season' | 'last5';
  onChange: (value: 'season' | 'last5') => void;
}) {
  return (
    <div className={`inline-flex items-center rounded-xl border p-1 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
      <button
        type="button"
        onClick={() => onChange('season')}
        className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
          timeframe === 'season'
            ? 'bg-purple-600 text-white shadow-sm'
            : isDark
              ? 'text-gray-300 hover:bg-gray-800'
              : 'text-gray-600 hover:bg-white'
        }`}
      >
        Season
      </button>
      <button
        type="button"
        onClick={() => onChange('last5')}
        className={`rounded-lg px-2 py-1 text-[10px] font-semibold transition-colors ${
          timeframe === 'last5'
            ? 'bg-purple-600 text-white shadow-sm'
            : isDark
              ? 'text-gray-300 hover:bg-gray-800'
              : 'text-gray-600 hover:bg-white'
        }`}
      >
        Last 5
      </button>
    </div>
  );
}

export function SoccerOpponentBreakdownPanel({
  isDark,
  nextCompetitionName,
  nextCompetitionCountry,
  opponentName,
  opponentHref,
  emptyTextClass,
  showSkeleton = false,
}: SoccerOpponentBreakdownPanelProps) {
  const [data, setData] = useState<OpponentBreakdownApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<'season' | 'last5'>('season');

  const canFetch = Boolean(nextCompetitionName && (opponentName?.trim() || opponentHref));
  const cacheKey = [
    String(nextCompetitionName || '').trim(),
    String(nextCompetitionCountry || '').trim(),
    String(opponentName || '').trim(),
    String(opponentHref || '').trim(),
    timeframe,
  ].join('|');

  useEffect(() => {
    if (!canFetch || !nextCompetitionName) {
      setData(null);
      setError(null);
      return;
    }

    const on = (opponentName && opponentName.trim()) || '';
    const oh = (opponentHref && opponentHref.trim()) || '';
    if (!on && !oh) {
      setData(null);
      return;
    }

    const p = new URLSearchParams();
    p.set('competitionName', nextCompetitionName);
    p.set('timeframe', timeframe);
    if (nextCompetitionCountry?.trim()) p.set('competitionCountry', nextCompetitionCountry.trim());
    if (on) p.set('opponentName', on);
    if (oh) p.set('opponentHref', oh.startsWith('/') ? oh : `/${oh}`);

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    const cachedData = readCachedOpponentBreakdown(cacheKey);
    if (cachedData) setData(cachedData);
    setLoading(!cachedData);
    setError(null);

    void fetch(`/api/soccer/opponent-breakdown?${p.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as OpponentBreakdownApiResponse | { error?: string } | null;
        if (!res.ok) {
          const msg = json && 'error' in json ? String((json as { error: string }).error) : 'Request failed';
          throw new Error(msg);
        }
        return json as OpponentBreakdownApiResponse;
      })
      .then((j) => {
        if (!cancelled) {
          setData(j);
          writeCachedOpponentBreakdown(cacheKey, j);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          const isAbort = e instanceof Error && e.name === 'AbortError';
          if (!cachedData) {
            setError(isAbort ? 'Opponent breakdown is still warming data. Try again in a few seconds.' : e instanceof Error ? e.message : 'Failed to load');
            setData(null);
          }
        }
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [cacheKey, canFetch, nextCompetitionCountry, nextCompetitionName, opponentName, opponentHref, timeframe]);

  if (showSkeleton || loading) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 px-3 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
          <OpponentBreakdownTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
            <div className={`h-4 w-40 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          </div>
          <div className="space-y-2">
            <div className={`h-10 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            <div className={`h-10 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            <div className={`h-10 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            <div className={`h-10 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          </div>
        </div>
      </div>
    );
  }

  if (!canFetch) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <p className={`text-sm ${emptyTextClass}`}>No data available come back later</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 px-3 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
          <OpponentBreakdownTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 px-3 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
          <OpponentBreakdownTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (data.mode === 'league' && data.opponent) {
    const visibleStats = data.opponent.stats
      .filter((stat) => !HIDDEN_OPPONENT_BREAKDOWN_STATS.has(stat.id))
      .filter((stat) => stat.perGame != null || stat.rank != null)
      .sort((a, b) => Number(a.niche) - Number(b.niche));

    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-between gap-2 px-3 mt-1 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
          <OpponentBreakdownTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
        </div>

        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center justify-center gap-2 mb-1 text-center">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
            <h4 className={`text-sm font-mono font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
              {data.opponent.name} allowed averages
            </h4>
          </div>
          <div className={`mb-3 text-center text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {data.competitionLabel} · {data.opponent.leagueGames} matches · {data.timeframe === 'last5' ? 'Last 5' : 'Season'}
          </div>

          {visibleStats.length === 0 ? (
            <div className={`text-sm py-4 ${emptyTextClass}`}>No data available come back later</div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2 custom-scrollbar">
              {visibleStats.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center justify-between rounded border px-3 py-2 ${
                    isDark ? 'border-gray-600/60' : 'border-gray-200/80'
                  }`}
                >
                  <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {s.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-base font-bold font-mono ${isDark ? 'text-white' : 'text-black'}`}>
                      {formatNumber(s.perGame, s.isPercent)}
                    </span>
                    <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${getRankColor(s.rank, isDark)}`}>
                      #{s.rank ?? '—'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className={`flex items-center justify-center gap-4 mt-2 pt-2 flex-shrink-0 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
              Hardest
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-green-600 dark:bg-green-500" aria-hidden />
              Easiest
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 px-3 mt-1 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
        <OpponentBreakdownTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
      </div>
      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{data.note || 'No data available come back later'}</div>
      </div>
    </div>
  );
}
