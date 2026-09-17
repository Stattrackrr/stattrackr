'use client';

import { useEffect, useRef, useState } from 'react';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import { tennisComAvatarImgStyle } from '@/lib/tennis/headshotDisplay';
import { tennisDashboardFetch, isTennisDashboardAbortError } from '@/lib/tennisDashboardFetch';
import type {
  TennisSimilarMatchStats,
  TennisSimilarPlayersPayload,
} from '@/lib/tennis/similarPlayersShared';

const STAT_CHIPS: Array<{
  key: keyof TennisSimilarMatchStats;
  label: string;
  highlight: string[];
  format: 'int' | 'pct' | 'dr';
}> = [
  { key: 'aces', label: 'Aces', highlight: ['aces', 'totalAces'], format: 'int' },
  { key: 'totalGames', label: 'Games', highlight: ['totalGames'], format: 'int' },
  { key: 'gamesWon', label: 'Won', highlight: ['gamesWon', 'moneyline'], format: 'int' },
  { key: 'gamesLost', label: 'Lost', highlight: ['gamesLost', 'spread'], format: 'int' },
  { key: 'firstServePct', label: '1st', highlight: ['firstServePct', 'firstServeWonPct'], format: 'pct' },
  { key: 'doubleFaults', label: 'DF', highlight: ['doubleFaults'], format: 'int' },
  { key: 'dominanceRatio', label: 'DR', highlight: ['dominanceRatio'], format: 'dr' },
  { key: 'breakPointsConverted', label: 'BP', highlight: ['breakPointsConverted', 'breakPointsConvertedPct'], format: 'int' },
];

function fmtDate(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    const s = String(raw);
    return s.length >= 10 ? s.slice(5, 10) : s;
  }
  return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
}

function fmtChip(value: number | null | undefined, format: 'int' | 'pct' | 'dr'): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (format === 'pct') return `${Math.round(value)}%`;
  if (format === 'dr') return value.toFixed(2);
  return String(Math.round(value));
}

export function TennisSimilarPlayersCard({
  isDark = false,
  layout = 'desktop',
  playerId = null,
  playerName = null,
  opponentName = null,
  opponentId = null,
  selectedStat = 'moneyline',
  tour = 'ATP',
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  opponentId?: string | null;
  selectedStat?: string;
  tour?: 'ATP' | 'WTA';
  players?: Array<{ name?: string | null; imageUrl?: string | null; ioc?: string | null }>;
}) {
  const [payload, setPayload] = useState<TennisSimilarPlayersPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const strong = isDark ? 'text-white' : 'text-gray-900';
  const chipBg = isDark ? 'bg-white/[0.04]' : 'bg-gray-50';
  const chipOn = isDark
    ? 'bg-purple-600/25 text-purple-200 border-purple-500/40'
    : 'bg-purple-100 text-purple-800 border-purple-200';
  const compact = layout === 'mobile';
  const frameClass = compact ? 'h-[420px] max-h-[50vh]' : 'h-[380px]';
  const loadedKeyRef = useRef('');

  useEffect(() => {
    if (!playerName || !opponentName) {
      setPayload(null);
      setLoading(false);
      loadedKeyRef.current = '';
      return;
    }
    const fetchKey = [playerName, playerId || '', opponentName, opponentId || '', tour, selectedStat].join('|');
    if (loadedKeyRef.current === fetchKey) return;
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams({
      player: playerName,
      opponent: opponentName,
      stat: selectedStat || 'moneyline',
      tour,
      limit: '8',
    });
    if (playerId) params.set('playerId', playerId);
    if (opponentId) params.set('opponentId', opponentId);
    tennisDashboardFetch(`/api/tennis/similar-players?${params.toString()}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json() as Promise<TennisSimilarPlayersPayload>;
      })
      .then((json) => {
        if (cancelled) return;
        if ((json as { success?: boolean })?.success === false) {
          throw new Error((json as { error?: string })?.error || 'Failed to load');
        }
        setPayload(json);
        loadedKeyRef.current = fetchKey;
      })
      .catch((err) => {
        if (cancelled || isTennisDashboardAbortError(err)) return;
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [playerId, playerName, opponentName, opponentId, selectedStat, tour]);

  const playerLabel = tennisLastName(payload?.player?.name || playerName);
  const oppLabel = tennisLastName(payload?.opponent?.name || opponentName);
  const statKey = payload?.stat || selectedStat || 'moneyline';
  const rows = payload?.similar || [];

  if (!playerName) {
    return (
      <div className={`w-full ${frameClass} flex items-center justify-center text-sm ${muted}`}>
        Select a player to see similar matchups.
      </div>
    );
  }

  if (!opponentName) {
    return (
      <div className={`w-full ${frameClass} flex items-center justify-center text-sm ${muted}`}>
        Need an opponent to compare similar players.
      </div>
    );
  }

  if (loading && !rows.length) {
    return (
      <div className={`w-full ${frameClass} space-y-2 overflow-hidden`}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`h-[88px] rounded-lg animate-pulse ${isDark ? 'bg-gray-800/50' : 'bg-gray-100'}`}
          />
        ))}
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className={`w-full ${frameClass} flex items-center justify-center text-sm ${muted}`}>
        No similar players have faced {oppLabel || 'this opponent'}.
      </div>
    );
  }

  return (
    <div className={`w-full ${frameClass} flex flex-col min-h-0`}>
      <div className={`px-0.5 pb-1.5 text-[11px] shrink-0 ${muted}`}>
        Like {playerLabel} vs {oppLabel}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden space-y-2 pr-0.5 fade-scrollbar custom-scrollbar">
      {rows.map((row) => {
        const flagUrl = tennisFlagUrl(row.ioc);
        return (
          <div
            key={`${row.playerId}-${row.matchId}`}
            className={`rounded-lg border px-2 py-2 ${
              row.isWin
                ? isDark
                  ? 'border-emerald-500/20 bg-emerald-500/[0.06]'
                  : 'border-emerald-200 bg-emerald-50/70'
                : isDark
                  ? 'border-white/10 bg-white/[0.02]'
                  : 'border-gray-200 bg-white'
            }`}
          >
            <div className="flex items-start gap-2 min-w-0">
              {row.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <span className="w-8 h-8 rounded-full overflow-hidden shrink-0 bg-gray-200 dark:bg-gray-700">
                  <img
                    src={row.imageUrl}
                    alt=""
                    className="w-8 h-8 object-cover"
                    style={tennisComAvatarImgStyle(row.imageUrl)}
                    referrerPolicy="no-referrer"
                  />
                </span>
              ) : (
                <div className="w-8 h-8 rounded-full shrink-0 bg-gray-200 dark:bg-gray-700" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 min-w-0">
                  {flagUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={flagUrl}
                      alt=""
                      className="h-[9px] w-[13px] object-cover rounded-[1px] shrink-0"
                    />
                  ) : null}
                  <span className={`text-xs font-semibold truncate ${strong}`}>
                    {tennisLastName(row.name)}
                    {row.hand ? ` (${row.hand})` : ''}
                  </span>
                  {row.rank != null ? <span className={`text-[10px] ${muted}`}>#{row.rank}</span> : null}
                </div>
                <div className={`mt-0.5 text-[10px] ${muted} truncate`}>
                  {row.h2hWins}-{row.h2hLosses} H2H
                  {row.surface ? ` · ${row.surface}` : ''}
                  {` · ${fmtDate(row.date)}`}
                </div>
              </div>
              <div className="text-right shrink-0">
                <span
                  className={`inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] px-1 text-[9px] font-bold ${
                    row.isWin
                      ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                      : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  }`}
                >
                  {row.isWin ? 'W' : 'L'}
                </span>
                <div className={`mt-0.5 text-[11px] font-semibold tabular-nums ${strong}`}>
                  {row.score}
                </div>
              </div>
            </div>

            <div className="mt-2 grid grid-cols-4 gap-1">
              {STAT_CHIPS.map((chip) => {
                const active = chip.highlight.includes(statKey);
                return (
                  <div
                    key={chip.key}
                    className={`rounded-md border px-1.5 py-1 text-center ${
                      active ? chipOn : `${chipBg} border-transparent`
                    }`}
                  >
                    <div className={`text-[12px] font-bold tabular-nums leading-none ${active ? '' : strong}`}>
                      {fmtChip(row.stats?.[chip.key], chip.format)}
                    </div>
                    <div className={`mt-0.5 text-[9px] uppercase tracking-wide ${active ? 'opacity-80' : muted}`}>
                      {chip.label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
