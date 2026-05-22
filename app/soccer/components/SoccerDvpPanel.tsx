'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { SoccerDvpApiResponse } from '@/app/api/soccer/dvp/route';
import type { SoccerDvpRoleId } from '@/lib/soccerDvp';

type SoccerDvpPanelProps = {
  isDark: boolean;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  statKey?: string | null;
  playerPosition?: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
  hideTitle?: boolean;
};

const SOCCER_DVP_SESSION_PREFIX = 'soccer-dvp:v2:';
const FALLBACK_ROLES: Array<{ id: SoccerDvpRoleId; label: string }> = [
  { id: 'fullback', label: 'Fullback' },
  { id: 'cb', label: 'CB' },
  { id: 'midfield', label: 'Midfield' },
  { id: 'winger', label: 'Winger' },
  { id: 'striker', label: 'Striker' },
];

function getDvpSessionKey(key: string): string {
  return `${SOCCER_DVP_SESSION_PREFIX}${key}`;
}

function readCachedDvp(key: string): SoccerDvpApiResponse | null {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = window.sessionStorage.getItem(getDvpSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: SoccerDvpApiResponse } | null;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeCachedDvp(key: string, data: SoccerDvpApiResponse): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.sessionStorage.setItem(getDvpSessionKey(key), JSON.stringify({ data, cachedAt: Date.now() }));
  } catch {
    /* ignore */
  }
}

function formatNumber(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return value.toFixed(0);
  return value >= 10 ? value.toFixed(1) : value.toFixed(2);
}

function roleFromPosition(value: string | null | undefined): SoccerDvpRoleId | null {
  const code = String(value || '').trim().toUpperCase();
  if (!code) return null;
  if (code === 'LW' || code === 'RW' || code === 'W') return 'winger';
  if (code === 'ST' || code === 'FWD' || code === 'FW') return 'striker';
  if (code === 'CAM' || code === 'AM' || code === 'CDM' || code === 'DM' || code === 'CM' || code === 'MID' || code === 'M') return 'midfield';
  if (code === 'LB' || code === 'LWB' || code === 'RB' || code === 'RWB' || code === 'FB' || code === 'WB') return 'fullback';
  if (code === 'CB' || code === 'DEF' || code === 'D') return 'cb';
  return null;
}

function getRankColor(rank: number | null, isDark: boolean): string {
  if (!rank || rank <= 0) return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
  if (rank <= 3) return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
  if (rank <= 8) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
  if (rank <= 12) return 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
  if (rank <= 17) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
  return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
}

function getRankBorderColor(rank: number | null, isDark: boolean): string {
  if (!rank || rank <= 0) return isDark ? 'border-slate-700' : 'border-slate-300';
  if (rank <= 3) return isDark ? 'border-red-900' : 'border-red-800';
  if (rank <= 8) return isDark ? 'border-red-800' : 'border-red-600';
  if (rank <= 12) return isDark ? 'border-orange-900' : 'border-orange-700';
  if (rank <= 17) return isDark ? 'border-green-800' : 'border-green-600';
  return isDark ? 'border-green-900' : 'border-green-800';
}

function SoccerDvpTimeframeToggle({
  isDark,
  timeframe,
  onChange,
}: {
  isDark: boolean;
  timeframe: 'season' | 'last5';
  onChange: (value: 'season' | 'last5') => void;
}) {
  return (
    <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
      {(['season', 'last5'] as const).map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`px-2.5 py-1 text-xs font-medium transition-colors ${
            timeframe === value
              ? 'bg-purple-600 text-white'
              : isDark
                ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                : 'bg-gray-100 text-gray-600 hover:text-gray-900'
          }`}
        >
          {value === 'season' ? 'Season' : 'Last 5'}
        </button>
      ))}
    </div>
  );
}

export function SoccerDvpPanel({
  isDark,
  nextCompetitionName,
  nextCompetitionCountry,
  opponentName,
  opponentHref,
  playerPosition,
  emptyTextClass,
  showSkeleton = false,
  hideTitle = false,
}: SoccerDvpPanelProps) {
  const [data, setData] = useState<SoccerDvpApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timeframe, setTimeframe] = useState<'season' | 'last5'>('season');
  const [selectedRole, setSelectedRole] = useState<SoccerDvpRoleId>('fullback');
  const [selectedOpponent, setSelectedOpponent] = useState<string>('');
  const [posOpen, setPosOpen] = useState(false);
  const [oppOpen, setOppOpen] = useState(false);
  const latestDataRef = useRef<SoccerDvpApiResponse | null>(null);
  const userChangedRoleRef = useRef(false);
  const userChangedOpponentRef = useRef(false);

  useEffect(() => {
    latestDataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (userChangedRoleRef.current) return;
    const role = roleFromPosition(playerPosition);
    if (role) setSelectedRole(role);
  }, [playerPosition]);

  useEffect(() => {
    userChangedOpponentRef.current = false;
    setSelectedOpponent('');
  }, [opponentName, opponentHref]);

  const canFetch = Boolean(nextCompetitionName && ((selectedOpponent || opponentName)?.trim() || opponentHref));
  const requestedOpponentName = selectedOpponent || opponentName || '';
  const cacheKey = [
    String(nextCompetitionName || '').trim(),
    String(nextCompetitionCountry || '').trim(),
    String(requestedOpponentName || '').trim(),
    String(opponentHref || '').trim(),
    timeframe,
  ].join('|');

  useEffect(() => {
    if (!canFetch || !nextCompetitionName) {
      setError(null);
      setLoading(false);
      return;
    }

    const params = new URLSearchParams();
    params.set('competitionName', nextCompetitionName);
    params.set('timeframe', timeframe);
    if (nextCompetitionCountry?.trim()) params.set('competitionCountry', nextCompetitionCountry.trim());
    if (requestedOpponentName.trim()) params.set('opponentName', requestedOpponentName.trim());
    if (opponentHref?.trim()) params.set('opponentHref', opponentHref.trim().startsWith('/') ? opponentHref.trim() : `/${opponentHref.trim()}`);

    let cancelled = false;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    const cachedData = readCachedDvp(cacheKey);
    setData(cachedData ?? null);
    setLoading(!cachedData);
    setError(null);

    void fetch(`/api/soccer/dvp?${params.toString()}`, { cache: 'no-store', signal: controller.signal })
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as SoccerDvpApiResponse | { error?: string } | null;
        if (!res.ok) {
          const msg = json && 'error' in json ? String(json.error) : 'Request failed';
          throw new Error(msg);
        }
        return json as SoccerDvpApiResponse;
      })
      .then((json) => {
        if (!cancelled) {
          setData(json);
          writeCachedDvp(cacheKey, json);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled && !cachedData) {
          const isAbort = err instanceof Error && err.name === 'AbortError';
          setError(isAbort ? 'Soccer DVP is still loading cached player data. Try again in a few seconds.' : err instanceof Error ? err.message : 'Failed to load');
          setData(null);
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
  }, [cacheKey, canFetch, nextCompetitionCountry, nextCompetitionName, opponentHref, requestedOpponentName, timeframe]);

  const roleOptions = data?.roles?.length ? data.roles : FALLBACK_ROLES;
  const selectedRoleLabel = roleOptions.find((role) => role.id === selectedRole)?.label ?? 'Wingers';
  const opponentOptions = useMemo(() => data?.opponents ?? [], [data?.opponents]);
  const displayOpponent = data?.opponent?.name || requestedOpponentName || 'Opponent';
  const metricRows = data?.opponent?.rowsByRole?.[selectedRole] ?? [];
  const visibleRows = metricRows.filter((row) => row.perGame != null || row.rank != null);

  const header = !hideTitle ? (
    <div className="mb-2 flex flex-shrink-0 items-center justify-between gap-2 px-1 sm:px-0">
      <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">Defense vs Position</h3>
      <SoccerDvpTimeframeToggle isDark={isDark} timeframe={timeframe} onChange={setTimeframe} />
    </div>
  ) : null;

  if ((showSkeleton || loading) && !data) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {header}
        <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0 flex-1 min-h-0`}>
          <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={idx} className={`rounded-lg border ${isDark ? 'border-gray-600' : 'border-gray-300'} p-2`}>
                <div className={`h-3 w-20 rounded animate-pulse mb-2 ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
                <div className={`h-9 w-full rounded-md animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
              </div>
            ))}
          </div>
          <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2">
            {Array.from({ length: 8 }).map((_, idx) => (
              <div key={idx} className={`mx-3 my-2 rounded-lg border-2 ${isDark ? 'border-slate-700' : 'border-slate-300'} px-3 py-2.5`}>
                <div className={`h-4 w-40 rounded animate-pulse ${isDark ? 'bg-gray-700' : 'bg-gray-200'}`} />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!canFetch && !data) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {header}
        <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0 flex-1 min-h-0 flex items-center px-3 py-3`}>
          <p className={`text-sm ${emptyTextClass}`}>No data available come back later</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {header}
        <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0 flex-1 min-h-0 flex items-center px-3 py-3`}>
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!data || data.mode !== 'league' || !data.opponent) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {header}
        <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0 flex-1 min-h-0 flex items-center px-3 py-3`}>
          <div className={`text-sm ${emptyTextClass}`}>{data?.note || 'No data available come back later'}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      {header}
      <div className={`rounded-lg border ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0 flex-1 min-h-0`}>
        <div className="px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          <div className={`rounded-lg border ${isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Position</div>
            <button
              type="button"
              onClick={() => setPosOpen((open) => !open)}
              className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold bg-purple-600 border-purple-600 text-white"
            >
              <span>{selectedRoleLabel}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {posOpen ? (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${isDark ? 'bg-[#0a1929] border-gray-600' : 'bg-white border-gray-300'}`}>
                  {roleOptions.map((role) => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => {
                        userChangedRoleRef.current = true;
                        setSelectedRole(role.id);
                        setPosOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-sm font-bold text-left ${selectedRole === role.id ? 'bg-purple-600 text-white' : isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setPosOpen(false)} />
              </>
            ) : null}
          </div>

          <div className={`rounded-lg border ${isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${isDark ? 'text-slate-200' : 'text-slate-800'}`}>Opponent Team</div>
            <button
              type="button"
              onClick={() => setOppOpen((open) => !open)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-md border text-sm ${isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <span className="font-semibold truncate">{displayOpponent}</span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
            </button>
            {oppOpen ? (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                  <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain" onWheel={(e) => e.stopPropagation()}>
                    {opponentOptions.map((name) => (
                      <button
                        key={name}
                        type="button"
                        onClick={() => {
                          userChangedOpponentRef.current = true;
                          setSelectedOpponent(name);
                          setOppOpen(false);
                        }}
                        className={`w-full px-2 py-2 text-sm font-medium text-left ${isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            ) : null}
          </div>
        </div>

        {visibleRows.length === 0 ? (
          <div className={`px-3 py-3 text-sm ${emptyTextClass}`}>No DVP rows for {selectedRoleLabel} yet.</div>
        ) : (
          <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {visibleRows.map((row) => (
              <div
                key={row.statKey}
                className={`mx-3 my-2 rounded-lg border-2 ${getRankBorderColor(row.rank, isDark)} px-3 py-2.5`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={`truncate text-sm font-medium ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {row.statLabel} vs {selectedRoleLabel}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`font-bold ${isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                      {formatNumber(row.perGame)}
                    </span>
                    <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${getRankColor(row.rank, isDark)}`}>
                      {row.rank ? `#${row.rank}` : 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
