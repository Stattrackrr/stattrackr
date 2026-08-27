'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { TENNIS_DVP_METRICS } from '@/lib/tennis/dvpShared';

const SEASON_OPTIONS = [2026, 2025] as const;

type DvpOpponent = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
};

type DvpMetricRow = {
  key: string;
  label: string;
  pct: boolean;
  value: number | null;
  rank: number | null;
  matches: number;
  fieldSize: number;
};

type DvpPayload = {
  success?: boolean;
  tour: 'ATP' | 'WTA';
  year: number;
  fieldSize: number;
  opponent: DvpOpponent | null;
  opponents: DvpOpponent[];
  metrics: DvpMetricRow[];
};

function fmt(value: number | null | undefined, pct: boolean): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return pct ? `${value.toFixed(1)}%` : value.toFixed(1);
}

function rankStyles(rank: number | null | undefined, fieldSize: number, isDark: boolean) {
  if (rank == null || rank <= 0) {
    return {
      borderColor: isDark ? 'border-slate-700' : 'border-slate-300',
      badgeColor: isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600',
    };
  }
  const n = Math.max(fieldSize, 1);
  const p = rank / n;
  if (p >= 0.84) {
    return {
      borderColor: isDark ? 'border-green-900' : 'border-green-800',
      badgeColor: 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100',
    };
  }
  if (p >= 0.67) {
    return {
      borderColor: isDark ? 'border-green-800' : 'border-green-600',
      badgeColor: 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100',
    };
  }
  if (p >= 0.5) {
    return {
      borderColor: isDark ? 'border-orange-800' : 'border-orange-600',
      badgeColor: 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100',
    };
  }
  if (p >= 0.34) {
    return {
      borderColor: isDark ? 'border-orange-900' : 'border-orange-700',
      badgeColor: 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-amber-200',
    };
  }
  if (p >= 0.17) {
    return {
      borderColor: isDark ? 'border-red-800' : 'border-red-600',
      badgeColor: 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100',
    };
  }
  return {
    borderColor: isDark ? 'border-red-900' : 'border-red-800',
    badgeColor: 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100',
  };
}

export default function TennisDvpCard({
  isDark = false,
  playerName = null,
  opponentName = null,
  tour = 'ATP',
}: {
  isDark?: boolean;
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  resolveTeamLogo?: (teamName: string) => string | null;
  tour?: 'ATP' | 'WTA';
}) {
  const [mounted, setMounted] = useState(false);
  const [selectedSeason, setSelectedSeason] = useState<(typeof SEASON_OPTIONS)[number]>(
    SEASON_OPTIONS[0]
  );
  const [oppSel, setOppSel] = useState(String(opponentName || ''));
  const [oppOpen, setOppOpen] = useState(false);
  const [payload, setPayload] = useState<DvpPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const userChangedOpponentRef = useRef(false);
  const opponentNameRef = useRef(opponentName);
  opponentNameRef.current = opponentName;

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!userChangedOpponentRef.current) setOppSel(String(opponentName || ''));
  }, [opponentName]);

  useEffect(() => {
    userChangedOpponentRef.current = false;
    setOppSel(String(opponentNameRef.current || ''));
  }, [playerName]);

  useEffect(() => {
    if (!playerName) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      tour,
      year: String(selectedSeason),
    });
    if (oppSel) params.set('opponent', oppSel);
    fetch(`/api/tennis/dvp?${params}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load DVP');
        return json as DvpPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(null);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setPayload(null);
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerName, tour, selectedSeason, oppSel]);

  const opponents = payload?.opponents || [];
  const metrics = payload?.metrics?.length ? payload.metrics : TENNIS_DVP_METRICS.map((m) => ({
    key: m.key,
    label: m.label,
    pct: m.pct,
    value: null,
    rank: null,
    matches: 0,
    fieldSize: payload?.fieldSize || 0,
  }));
  const selected = payload?.opponent;
  const selectedLabel = selected?.name || oppSel || 'Opponent';
  const flagUrl = tennisFlagUrl(selected?.ioc);
  const fieldSize = payload?.fieldSize || 0;
  const hasData = metrics.some((m) => m.value != null);
  const dark = mounted && isDark;

  const oppOptions = useMemo(() => {
    if (!oppSel) return opponents;
    const key = oppSel.trim().toLowerCase();
    if (opponents.some((p) => p.name.toLowerCase() === key)) return opponents;
    return [
      { id: 'selected', name: oppSel, ioc: selected?.ioc ?? null, rankPos: selected?.rankPos ?? null },
      ...opponents,
    ];
  }, [opponents, oppSel, selected]);

  if (!playerName) {
    return (
      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        Select a player to view DvP.
      </div>
    );
  }

  return (
    <div className="mb-1 w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">
          Defense vs Player
        </h3>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {SEASON_OPTIONS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedSeason(y)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedSeason === y
                  ? 'bg-purple-600 text-white'
                  : dark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div
        className={`rounded-lg border flex-1 min-h-0 flex flex-col ${
          dark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        } w-full`}
      >
        <div className="px-3 py-3 flex-shrink-0">
          <div className={`rounded-lg border p-2 relative ${dark ? 'border-gray-600' : 'border-gray-300'}`}>
            <div className={`text-[11px] font-semibold mb-2 ${dark ? 'text-slate-200' : 'text-slate-800'}`}>
              Opponent
            </div>
            <button
              type="button"
              onClick={() => setOppOpen((o) => !o)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${
                dark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
              }`}
            >
              <span className="flex items-center gap-2 min-w-0">
                {flagUrl ? (
                  <img src={flagUrl} alt="" className="w-5 h-3.5 object-cover rounded-[1px] flex-shrink-0" />
                ) : null}
                <span className="font-semibold truncate">{tennisLastName(selectedLabel) || 'Select opponent'}</span>
              </span>
              <svg className="w-4 h-4 opacity-70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {oppOpen && (
              <>
                <div
                  className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${
                    dark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'
                  }`}
                >
                  <div
                    className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain"
                    onWheel={(e) => e.stopPropagation()}
                  >
                    {oppOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          userChangedOpponentRef.current = true;
                          setOppSel(p.name);
                          setOppOpen(false);
                        }}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm text-left ${
                          dark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'
                        }`}
                      >
                        {tennisFlagUrl(p.ioc) ? (
                          <img
                            src={tennisFlagUrl(p.ioc) || ''}
                            alt=""
                            className="w-5 h-3.5 object-cover rounded-[1px] flex-shrink-0"
                          />
                        ) : (
                          <span className="w-5 flex-shrink-0" />
                        )}
                        <span className="font-medium truncate">{p.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            )}
          </div>
        </div>

        {error ? (
          <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">Error loading DvP stats: {error}</div>
        ) : loading && !hasData ? (
          <div
            className="overflow-y-scroll overscroll-contain custom-scrollbar flex-1 min-h-0 pr-1 pb-2"
            onWheel={(e) => e.stopPropagation()}
          >
            {TENNIS_DVP_METRICS.map((m, index) => (
              <div
                key={m.key}
                className={`mx-3 my-2 rounded-lg border-2 ${dark ? 'border-slate-700' : 'border-slate-300'} px-3 py-2.5`}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={`h-4 w-32 rounded animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                    style={{ animationDelay: `${index * 0.08}s` }}
                  />
                  <div className="flex items-center gap-3">
                    <div
                      className={`h-5 w-16 rounded animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                      style={{ animationDelay: `${index * 0.08 + 0.04}s` }}
                    />
                    <div
                      className={`h-5 w-10 rounded-full animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`}
                      style={{ animationDelay: `${index * 0.08 + 0.08}s` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : !oppSel ? (
          <div className={`px-3 py-3 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Select an opponent above to view DvP stats.
          </div>
        ) : !hasData ? (
          <div className={`px-3 py-3 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            No DvP sample yet for {tennisLastName(selectedLabel)} in {selectedSeason}.
          </div>
        ) : (
          <>
            <div
              className="overflow-y-scroll overscroll-contain custom-scrollbar flex-1 min-h-0 pr-1 pb-2"
              onWheel={(e) => e.stopPropagation()}
            >
              {metrics.map((m) => {
                const styles = rankStyles(m.rank, m.fieldSize || fieldSize, dark);
                return (
                  <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${styles.borderColor} px-3 py-2.5`}>
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>{m.label}</span>
                      <div className="flex items-center gap-3">
                        <span className={`font-bold ${dark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                          {fmt(m.value, m.pct)}
                        </span>
                        <span
                          className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${styles.badgeColor}`}
                        >
                          {typeof m.rank === 'number' && m.rank > 0 ? `#${m.rank}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className={`flex items-center justify-center gap-4 py-2 flex-shrink-0 text-xs font-medium ${
                dark ? 'text-gray-400' : 'text-gray-500'
              }`}
            >
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
                Hardest
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded bg-green-600 dark:bg-green-500" aria-hidden />
                Easiest
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
