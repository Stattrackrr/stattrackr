'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import { tennisEventPlaceLabel, tennisLastName } from '@/lib/tennis/chartStats';
import { TENNIS_DVP_METRICS, type TennisDvpStage, type TennisDvpWindow } from '@/lib/tennis/dvpShared';
import { tennisDashboardFetch, isTennisDashboardAbortError } from '@/lib/tennisDashboardFetch';
import { TennisTournamentRankInfoButton } from '@/app/tennis/components/TennisTournamentRankInfoButton';

const WINDOW_OPTIONS: Array<{ id: TennisDvpWindow; label: string }> = [
  { id: 'last5', label: 'L5' },
  { id: 'last10', label: 'L10' },
  { id: 'season', label: 'Season' },
];

type DvpOpponent = {
  id: string;
  name: string;
  ioc: string | null;
  rankPos: number | null;
  seed?: number | null;
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

type DvpFieldPlayer = DvpOpponent & {
  metrics: DvpMetricRow[];
};

type DvpPayload = {
  success?: boolean;
  tour: 'ATP' | 'WTA';
  year: number;
  window?: TennisDvpWindow;
  tournamentName?: string | null;
  fieldSize: number;
  stage?: TennisDvpStage;
  opponent: DvpOpponent | null;
  opponents: DvpOpponent[];
  topSeed?: DvpOpponent | null;
  metrics: DvpMetricRow[];
  windows?: Partial<Record<TennisDvpWindow, DvpFieldPlayer[]>>;
};

function isNumericTennisId(value: string | null | undefined): boolean {
  return /^\d+$/.test(String(value || '').trim());
}

function displayDvpName(...candidates: Array<string | null | undefined>): string {
  for (const candidate of candidates) {
    const name = String(candidate || '').trim();
    if (name && !isNumericTennisId(name)) return name;
  }
  return '';
}

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
  playerId = null,
  opponentName = null,
  opponentId = null,
  tournamentName = null,
  tournamentKey = null,
  stage = 'main',
  tour = 'ATP',
}: {
  isDark?: boolean;
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  opponentId?: string | null;
  tournamentName?: string | null;
  tournamentKey?: string | null;
  stage?: TennisDvpStage;
  selectedStat?: string;
  resolveTeamLogo?: (teamName: string) => string | null;
  tour?: 'ATP' | 'WTA';
}) {
  const [mounted, setMounted] = useState(false);
  const [selectedWindow, setSelectedWindow] = useState<TennisDvpWindow>('last10');
  const [oppSel, setOppSel] = useState(displayDvpName(opponentName));
  const [oppSelId, setOppSelId] = useState(String(opponentId || ''));
  const [oppOpen, setOppOpen] = useState(false);
  const [viewAll, setViewAll] = useState(false);
  const [viewMetric, setViewMetric] = useState<string>(TENNIS_DVP_METRICS[0].key);
  const [metricOpen, setMetricOpen] = useState(false);
  const [payload, setPayload] = useState<DvpPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opponentNameRef = useRef(opponentName);
  opponentNameRef.current = opponentName;
  const loadedKeyRef = useRef('');

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    loadedKeyRef.current = '';
    setViewAll(false);
    setPayload(null);
    setError(null);
  }, [playerName, tournamentKey, tournamentName, stage, tour]);

  useEffect(() => {
    setOppSel(displayDvpName(opponentName));
    if (opponentId) setOppSelId(String(opponentId));
  }, [opponentName, opponentId]);

  useEffect(() => {
    if (!playerName) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    const fetchKey = [
      playerName,
      playerId,
      tour,
      tournamentName,
      tournamentKey,
      stage,
      String(opponentName || ''),
      String(opponentId || ''),
    ].join('|');
    if (loadedKeyRef.current === fetchKey) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      tour,
      window: 'last10',
    });
    const queryName = displayDvpName(oppSel, opponentName);
    const queryId =
      String(oppSelId || opponentId || '').trim() ||
      (isNumericTennisId(oppSel) ? String(oppSel).trim() : '');
    if (queryName) params.set('opponent', queryName);
    if (queryId) params.set('opponentId', queryId);
    if (playerName) params.set('player', playerName);
    if (playerId) params.set('playerId', playerId);
    if (tournamentName) params.set('tournament', tournamentName);
    if (tournamentKey) params.set('tournamentKey', tournamentKey);
    if (stage === 'qualifying') params.set('stage', 'qualifying');
    tennisDashboardFetch(`/api/tennis/dvp?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<DvpPayload>;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
        setError(null);
        loadedKeyRef.current = fetchKey;
        const human = displayDvpName(data.opponent?.name, opponentNameRef.current, oppSel);
        if (human) setOppSel(human);
        if (data.opponent?.id) setOppSelId(data.opponent.id);
      })
      .catch((err) => {
        if (cancelled || isTennisDashboardAbortError(err)) return;
        setPayload(null);
        setError('Error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerName, playerId, tour, tournamentName, tournamentKey, stage, opponentName, opponentId]);

  const fieldPlayers: DvpFieldPlayer[] = useMemo(() => {
    const fromWindow = payload?.windows?.[selectedWindow] || payload?.windows?.last10 || [];
    if (fromWindow.length) return fromWindow;
    if (payload?.opponents?.length) {
      return payload.opponents.map((row) => ({
        ...row,
        metrics: row.id === payload.opponent?.id ? payload.metrics || [] : [],
      }));
    }
    return [];
  }, [payload, selectedWindow]);

  const selected: DvpFieldPlayer | null = useMemo(() => {
    const id = String(oppSelId || opponentId || '').trim();
    const name = displayDvpName(oppSel, opponentName);
    const nameKey = name.toLowerCase();
    const last = name.split(/\s+/).filter(Boolean).pop()?.toLowerCase() || '';
    const lastHits = last.length >= 3
      ? fieldPlayers.filter((row) => {
          const label = displayDvpName(row.name);
          return Boolean(label) && label.toLowerCase().split(/\s+/).pop() === last;
        })
      : [];
    const fromField =
      fieldPlayers.find((row) => id && row.id === id) ||
      fieldPlayers.find((row) => displayDvpName(row.name).toLowerCase() === nameKey) ||
      (lastHits.length === 1 ? lastHits[0] : null);
    if (fromField) return fromField;
    if (!payload?.opponent) return null;
    return {
      ...payload.opponent,
      metrics: payload.metrics || [],
    };
  }, [fieldPlayers, oppSel, oppSelId, opponentName, opponentId, payload]);

  const opponents = fieldPlayers;
  const emptyMetrics: DvpMetricRow[] = TENNIS_DVP_METRICS.map((metric) => ({
    key: metric.key,
    label: metric.label,
    pct: metric.pct,
    value: null,
    rank: null,
    matches: 0,
    fieldSize: payload?.fieldSize || 0,
  }));
  const metrics: DvpMetricRow[] = selected?.metrics?.length ? selected.metrics : emptyMetrics;
  const selectedLabel = displayDvpName(selected?.name, oppSel, opponentName) || 'Opponent';
  const flagUrl = tennisFlagUrl(selected?.ioc);
  const fieldSize = payload?.fieldSize || 0;
  const eventLabel = tennisEventPlaceLabel(payload?.tournamentName || tournamentName);
  const stageLabel =
    (payload?.stage || stage) === 'qualifying' && !/qualif/i.test(eventLabel) ? 'Qualifying' : '';
  const hasData = metrics.some((m) => m.value != null);
  const dark = mounted && isDark;

  const oppOptions = useMemo(() => {
    const cleaned = opponents.filter((p) => displayDvpName(p.name));
    const label = displayDvpName(oppSel, selected?.name, opponentName);
    if (!label) return cleaned;
    const key = label.trim().toLowerCase();
    if (cleaned.some((p) => p.name.toLowerCase() === key)) return cleaned;
    return [
      {
        id: selected?.id || oppSelId || 'selected',
        name: label,
        ioc: selected?.ioc ?? null,
        rankPos: selected?.rankPos ?? null,
        seed: selected?.seed ?? null,
        metrics: selected?.metrics || [],
      },
      ...cleaned,
    ];
  }, [opponents, oppSel, oppSelId, selected, opponentName]);

  const viewMetricDef = TENNIS_DVP_METRICS.find((row) => row.key === viewMetric) || TENNIS_DVP_METRICS[0];
  const viewAllRows = useMemo(() => {
    return [...fieldPlayers]
      .map((player) => {
        const metric = player.metrics.find((row) => row.key === viewMetricDef.key) || null;
        return { player, metric };
      })
      .sort((a, b) => {
        const ar = a.metric?.rank && a.metric.rank > 0 ? a.metric.rank : 9999;
        const br = b.metric?.rank && b.metric.rank > 0 ? b.metric.rank : 9999;
        return ar - br || displayDvpName(a.player.name).localeCompare(displayDvpName(b.player.name));
      });
  }, [fieldPlayers, viewMetricDef.key]);

  if (!playerName) {
    return (
      <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
        Select a player to view DvP.
      </div>
    );
  }

  return (
    <div className="mb-1 w-full min-w-0 h-full flex flex-col">
      <div className="relative z-20 flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-1.5">
            <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">
              Defense vs Player
            </h3>
            <TennisTournamentRankInfoButton
              isDark={dark}
              label="How DVP ranks work"
              title="Tournament ranks"
              text={"DVP is calculated every tournament. Each stat is ranked against everyone in that event, not the whole ATP or WTA tour.\nLower ranked players and tournaments can be missing stats, which means these numbers could be less reliable.\nL5, L10, and Season change the averages for every player in that event, not just one player."}
            />
          </div>
          {eventLabel || fieldSize > 0 ? (
            <div className={`text-[11px] truncate ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
              {([
                stageLabel,
                eventLabel,
                fieldSize > 0 ? `${fieldSize}` : '',
              ]
                .filter(Boolean)
                .join(' · '))}
            </div>
          ) : null}
        </div>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelectedWindow(opt.id)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedWindow === opt.id
                  ? 'bg-purple-600 text-white'
                  : dark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {opt.label}
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
            <div className={`flex items-center justify-between gap-2 mb-2 ${dark ? 'text-slate-200' : 'text-slate-800'}`}>
              <div className="text-[11px] font-semibold">{viewAll ? 'Field rankings' : 'Opponent'}</div>
              <button
                type="button"
                onClick={() => {
                  setViewAll((on) => !on);
                  setOppOpen(false);
                  setMetricOpen(false);
                }}
                className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${
                  viewAll
                    ? 'bg-purple-600 text-white'
                    : dark
                      ? 'bg-gray-700 text-gray-200 hover:text-white'
                      : 'bg-gray-100 text-gray-700 hover:text-gray-900'
                }`}
              >
                {viewAll ? 'Back' : 'View all'}
              </button>
            </div>
            {viewAll ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setMetricOpen((open) => !open)}
                  className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${
                    dark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'
                  }`}
                >
                  <span className="font-semibold truncate">{viewMetricDef.label}</span>
                  <svg className="w-4 h-4 opacity-70 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {metricOpen ? (
                  <>
                    <div
                      className={`absolute z-20 mt-1 left-0 right-0 rounded-md border shadow-lg overflow-hidden ${
                        dark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'
                      }`}
                    >
                      <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain">
                        {TENNIS_DVP_METRICS.map((metric) => (
                          <button
                            key={metric.key}
                            type="button"
                            onClick={() => {
                              setViewMetric(metric.key);
                              setMetricOpen(false);
                            }}
                            className={`w-full px-2 py-2 text-sm text-left ${
                              metric.key === viewMetricDef.key
                                ? 'bg-purple-600 text-white'
                                : dark
                                  ? 'hover:bg-gray-600 text-white'
                                  : 'hover:bg-gray-100 text-gray-900'
                            }`}
                          >
                            {metric.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="fixed inset-0 z-10" onClick={() => setMetricOpen(false)} />
                  </>
                ) : null}
              </div>
            ) : (
              <>
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
                {selected?.seed ? (
                  <span className={`text-[11px] tabular-nums flex-shrink-0 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                    [{selected.seed}]
                  </span>
                ) : null}
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
                          setOppSel(displayDvpName(p.name) || p.name);
                          setOppSelId(p.id && p.id !== 'selected' ? p.id : '');
                          setOppOpen(false);
                          setViewAll(false);
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
                        {p.seed ? (
                          <span className={`ml-auto text-[11px] tabular-nums flex-shrink-0 ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                            [{p.seed}]
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            )}
              </>
            )}
          </div>
        </div>

        {error ? (
          <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">Error</div>
        ) : loading && !payload ? (
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
        ) : viewAll ? (
          <div
            className="overflow-y-scroll overscroll-contain custom-scrollbar flex-1 min-h-0 pr-1 pb-2"
            onWheel={(e) => e.stopPropagation()}
          >
            {viewAllRows.length ? (
              viewAllRows.map(({ player, metric }) => {
                const styles = rankStyles(metric?.rank, metric?.fieldSize || fieldSize, dark);
                const isSelected = Boolean(
                  (oppSelId && player.id === oppSelId) ||
                    displayDvpName(player.name).toLowerCase() === displayDvpName(selectedLabel).toLowerCase()
                );
                return (
                  <button
                    key={player.id}
                    type="button"
                    onClick={() => {
                      setOppSel(displayDvpName(player.name) || player.name);
                      setOppSelId(player.id);
                    }}
                    className={`mx-3 my-1.5 w-[calc(100%-1.5rem)] rounded-lg border-2 px-3 py-2 text-left ${styles.borderColor} ${
                      isSelected ? (dark ? 'bg-white/10' : 'bg-purple-50') : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {tennisFlagUrl(player.ioc) ? (
                        <img
                          src={tennisFlagUrl(player.ioc) || ''}
                          alt=""
                          className="w-5 h-3.5 object-cover rounded-[1px] flex-shrink-0"
                        />
                      ) : (
                        <span className="w-5 flex-shrink-0" />
                      )}
                      <span className={`min-w-0 flex-1 truncate text-sm font-medium ${dark ? 'text-white' : 'text-gray-900'}`}>
                        {displayDvpName(player.name) || player.name}
                        {player.seed ? (
                          <span className={`ml-1 text-[11px] tabular-nums ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
                            [{player.seed}]
                          </span>
                        ) : null}
                      </span>
                      <span className={`font-bold tabular-nums ${dark ? 'text-slate-100' : 'text-slate-900'}`}>
                        {fmt(metric?.value ?? null, viewMetricDef.pct)}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${styles.badgeColor}`}
                      >
                        {typeof metric?.rank === 'number' && metric.rank > 0
                          ? `#${metric.rank}/${metric.fieldSize || fieldSize || '?'}`
                          : ''}
                      </span>
                    </div>
                  </button>
                );
              })
            ) : (
              <div className={`px-3 py-3 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
                No field rankings yet{eventLabel ? ` at ${eventLabel}` : ''}.
              </div>
            )}
            <div
              className={`flex items-center justify-center gap-4 py-2 text-xs font-medium ${
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
          </div>
        ) : !oppSel ? (
          <div className={`px-3 py-3 text-xs ${dark ? 'text-slate-400' : 'text-slate-500'}`}>
            Select an opponent above to view DvP stats.
          </div>
        ) : fieldSize <= 0 ? (
          <div className={`px-3 py-3 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            DvP is only available for live or upcoming tournaments.
          </div>
        ) : !hasData ? (
          <div className={`px-3 py-3 text-sm ${dark ? 'text-gray-400' : 'text-gray-500'}`}>
            No DvP sample yet for {tennisLastName(selectedLabel)}
            {eventLabel ? ` at ${eventLabel}` : ''}
            {selectedWindow === 'last5' ? ' (L5)' : selectedWindow === 'season' ? ' (season)' : ' (L10)'}.
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
                          {typeof m.rank === 'number' && m.rank > 0
                            ? `#${m.rank}/${m.fieldSize || fieldSize || '?'}`
                            : ''}
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
