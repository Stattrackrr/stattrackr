'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import { getPlayerHeadshotUrl } from '@/lib/nbaLogos';
import { getEspnLogoUrl } from '@/lib/nbaAbbr';
import { convertBdlToNbaId } from '@/lib/playerIdMapping';
import { getBookmakerInfo } from '@/lib/bookmakers';

interface ModelPrediction {
  modelName: string;
  category: string;
  prediction: number;
  confidence: number;
  reasoning?: string;
}

interface DailyPick {
  type: 'player';
  prop: {
    playerId?: number;
    playerName: string;
    team: string;
    opponent: string;
    statType: string;
    line: number;
    bookmaker?: string;
    bookmakerCount?: number;
    bookmakerLines?: Array<{ bookmaker: string; line: number; overOdds: string; underOdds: string }>;
    overOdds?: string;
    underOdds?: string;
  };
  result: {
    prediction: number;
    confidence: number;
    edge: number;
    recommendation: string;
    modelAgreement?: number;
    modelPredictions?: ModelPrediction[];
  };
  readScore: number;
  direction: 'OVER' | 'UNDER';
  scanned: number;
  successful: number;
}

const STORAGE_KEY = 'stattrackr_daily_pick';
const DASHBOARD_SESSION_KEY = 'nba_dashboard_session_v1';

function getToday() {
  return new Date().toISOString().slice(0, 10);
}

function loadCachedPick(): DailyPick | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const { date, pick } = JSON.parse(raw) as { date: string; pick: DailyPick };
    if (date !== getToday()) return null;
    return pick;
  } catch {
    return null;
  }
}

function americanToDecimal(american: string | number): number {
  const n = typeof american === 'string' ? parseInt(american.replace(/[^0-9+-]/g, ''), 10) || -110 : american;
  if (n >= 0) return 1 + n / 100;
  return 1 + 100 / Math.abs(n);
}

function saveCachedPick(pick: DailyPick) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ date: getToday(), pick }));
  } catch {
    // ignore
  }
}

interface DailyPickModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function normalizeStatForDashboard(stat: string): string {
  const upper = (stat || '').toUpperCase().trim();
  if (upper === 'THREES' || upper === '3PM' || upper === '3PM/A' || upper === 'FG3M') return 'fg3m';
  if (upper === 'PTS' || upper === 'POINTS') return 'pts';
  if (upper === 'REB' || upper === 'REBOUNDS') return 'reb';
  if (upper === 'AST' || upper === 'ASSISTS') return 'ast';
  if (upper === 'PRA') return 'pra';
  if (upper === 'PR') return 'pr';
  if (upper === 'PA') return 'pa';
  if (upper === 'RA') return 'ra';
  if (upper === 'STL' || upper === 'STEALS') return 'stl';
  if (upper === 'BLK' || upper === 'BLOCKS') return 'blk';
  return upper.toLowerCase();
}

export function DailyPickModal({ isOpen, onClose }: DailyPickModalProps) {
  const [dailyPick, setDailyPick] = useState<DailyPick | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loadingStep, setLoadingStep] = useState<'idle' | 'odds' | 'scan'>('idle');

  useEffect(() => {
    if (isOpen && !dailyPick && !loading) {
      const cached = loadCachedPick();
      if (cached) setDailyPick(cached);
    }
  }, [isOpen, dailyPick, loading]);

  const fetchDailyPick = async () => {
    setLoading(true);
    setError(null);
    const previousPick = dailyPick;
    setDailyPick(null);
    try {
      setLoadingStep('odds');
      await fetch('/api/odds/refresh');

      setLoadingStep('scan');
      const res = await fetch('/api/prediction-engine/daily-pick');
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Failed to fetch');
      setDailyPick(data.dailyPick);
      saveCachedPick(data.dailyPick);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      const cached = loadCachedPick();
      setDailyPick(cached ?? previousPick);
    } finally {
      setLoading(false);
      setLoadingStep('idle');
    }
  };

  const getRecommendationColor = (rec: string) => {
    switch (rec) {
      case 'STRONG BET': return 'bg-green-500 text-white';
      case 'MODERATE BET': return 'bg-blue-500 text-white';
      case 'LEAN': return 'bg-yellow-500 text-black';
      default: return 'bg-gray-500 text-white';
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-[140] bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 pointer-events-none overflow-y-auto">
        <div
          className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-md w-full max-h-[90vh] flex flex-col border border-gray-200 dark:border-gray-700 pointer-events-auto my-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-5 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
                Today&apos;s Best Pick
              </h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                AI-scans today&apos;s props for the strongest signal
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="px-5 py-4 space-y-4 overflow-y-auto flex-1 min-h-0">
            {!dailyPick && (
              <button
                onClick={fetchDailyPick}
                disabled={loading}
                className="w-full px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white font-semibold rounded-lg transition-colors"
              >
                {loading
                  ? loadingStep === 'odds'
                    ? 'Refreshing odds...'
                    : 'Scanning props...'
                  : 'Find Best Pick'}
              </button>
            )}

            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
            )}

            {dailyPick && (
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg relative">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    {dailyPick.result.recommendation && (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${getRecommendationColor(dailyPick.result.recommendation)}`}>
                        {dailyPick.result.recommendation}
                      </span>
                    )}
                  </div>
                  {(() => {
                    const oddsStr = dailyPick.direction === 'OVER'
                      ? (dailyPick.prop.overOdds ?? dailyPick.prop.bookmakerLines?.[0]?.overOdds)
                      : (dailyPick.prop.underOdds ?? dailyPick.prop.bookmakerLines?.[0]?.underOdds);
                    if (!oddsStr) return null;
                    const num = parseInt(oddsStr.replace(/[^0-9-]/g, ''), 10);
                    const american = isNaN(num) ? oddsStr : (num >= 0 ? `+${num}` : `${num}`);
                    const decimal = americanToDecimal(oddsStr);
                    return (
                      <div className="text-right shrink-0">
                        <div className="text-sm font-bold text-gray-900 dark:text-white">
                          {american}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {decimal.toFixed(2)}
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {/* Bookmaker logos - above player */}
                {(() => {
                  const lines = dailyPick.prop.bookmakerLines || [];
                  const bookmakers = lines.length > 0
                    ? [...new Set(lines.map((l) => l.bookmaker).filter(Boolean))]
                    : dailyPick.prop.bookmaker ? [dailyPick.prop.bookmaker] : [];
                  if (bookmakers.length === 0) return null;
                  return (
                    <div className="flex items-center justify-center gap-2 mb-2">
                      {bookmakers.map((bm) => {
                        const info = getBookmakerInfo(bm);
                        const logoUrl = info?.logoUrl;
                        return logoUrl ? (
                          <Image
                            key={bm}
                            src={logoUrl}
                            alt={info?.name || bm}
                            width={24}
                            height={24}
                            className="rounded object-contain"
                            unoptimized={logoUrl.startsWith('https://www.google.com')}
                          />
                        ) : (
                          <span key={bm} className="text-[10px] font-semibold text-gray-600 dark:text-gray-400 px-1.5 py-0.5 bg-gray-200 dark:bg-gray-700 rounded" title={info?.name || bm}>
                            {info?.logo || bm.slice(0, 2).toUpperCase()}
                          </span>
                        );
                      })}
                    </div>
                  );
                })()}

                {/* Line | Photo | Stat - middle row */}
                <div className="flex items-center justify-center gap-6 mb-4">
                  <div className="flex flex-col items-center min-w-[3rem]">
                    <span className="text-2xl font-bold text-purple-700 dark:text-purple-400">
                      {dailyPick.prop.line}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Line</span>
                  </div>
                  <div className="relative w-20 h-20 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 shrink-0 ring-2 ring-purple-500/50">
                    {dailyPick.prop.playerId ? (() => {
                      const nbaId = convertBdlToNbaId(dailyPick.prop.playerId);
                      const headshotUrl = nbaId ? getPlayerHeadshotUrl(nbaId) : null;
                      return headshotUrl ? (
                        <Image
                          src={headshotUrl}
                          alt={dailyPick.prop.playerName}
                          fill
                          sizes="80px"
                          className="object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-purple-600 dark:text-purple-400">
                          {dailyPick.prop.playerName.charAt(0)}
                        </div>
                      );
                    })() : (
                      <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-purple-600 dark:text-purple-400">
                        {dailyPick.prop.playerName.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col items-center min-w-[3rem]">
                    <span className="text-2xl font-bold text-gray-900 dark:text-white">
                      {dailyPick.prop.statType}
                    </span>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Stat</span>
                  </div>
                </div>

                <p className="text-center text-lg font-bold text-gray-900 dark:text-white">
                  {dailyPick.prop.playerName} — {dailyPick.direction}
                </p>
                <div className="flex items-center justify-center gap-2 mt-1">
                  <Image
                    src={getEspnLogoUrl(dailyPick.prop.team)}
                    alt={dailyPick.prop.team}
                    width={28}
                    height={28}
                    className="object-contain"
                  />
                  <span className="text-xs text-gray-500 dark:text-gray-500">vs</span>
                  <Image
                    src={getEspnLogoUrl(dailyPick.prop.opponent)}
                    alt={dailyPick.prop.opponent}
                    width={28}
                    height={28}
                    className="object-contain"
                  />
                </div>
                <div className="mt-3 flex flex-wrap justify-center gap-3 text-sm">
                  <span className="text-green-600 dark:text-green-400 font-medium">
                    Edge: {dailyPick.result.edge > 0 ? '+' : ''}{dailyPick.result.edge.toFixed(1)}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const playerName = dailyPick.prop.playerName;
                    if (!playerName) return;
                    const normalizedStat = normalizeStatForDashboard(dailyPick.prop.statType);
                    const base = `player=${encodeURIComponent(playerName)}&stat=${normalizedStat}&line=${dailyPick.prop.line}&tf=last10`;
                    const extra: string[] = [];
                    if (dailyPick.prop.playerId) extra.push(`pid=${dailyPick.prop.playerId}`);
                    if (dailyPick.prop.team) extra.push(`team=${encodeURIComponent(dailyPick.prop.team)}`);
                    extra.push('mode=player');
                    const url = `/nba/research/dashboard?${base}${extra.length ? '&' + extra.join('&') : ''}`;
                    if (typeof window !== 'undefined') {
                      try {
                        window.sessionStorage.removeItem(DASHBOARD_SESSION_KEY);
                        sessionStorage.setItem('from_props_page', 'true');
                      } catch {}
                      onClose();
                      window.location.href = url;
                    }
                  }}
                  onMouseEnter={() => {
                    if (dailyPick.prop.playerId && typeof window !== 'undefined') {
                      const currentSeason = new Date().getFullYear();
                      const prefetchUrls = [
                        `/api/stats?player_id=${dailyPick.prop.playerId}&season=${currentSeason}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                        `/api/stats?player_id=${dailyPick.prop.playerId}&season=${currentSeason - 1}&per_page=100&max_pages=5&postseason=false&skip_dvp=1`,
                      ];
                      prefetchUrls.forEach((u) => fetch(u, { cache: 'default' }).catch(() => {}));
                    }
                  }}
                  className="mt-3 inline-block text-sm font-medium text-purple-700 dark:text-purple-400 hover:underline cursor-pointer bg-transparent border-0 p-0 font-inherit"
                >
                  View on dashboard →
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
