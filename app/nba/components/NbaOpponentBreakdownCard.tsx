'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  NBA_STE_STAT_KEYS,
  NBA_STE_STAT_LABELS,
  resolveNbaSteTeamCode,
  type NbaSteStatKey,
  type NbaSteStatsPayload,
} from '@/lib/nba/dash/teamSteStatsShared';

const SEASON_OPTIONS = [2026, 2025] as const;

export interface NbaOpponentBreakdownCardProps {
  isDark?: boolean;
  playerName?: string | null;
  /** Next-game / selected opponent club name */
  lastOpponent?: string | null;
}

/**
 * Opponent Breakdown — AFL card layout 1:1, NBA STE allowed metrics.
 * Rank #1 = hardest (allow least), #30 = easiest (allow most).
 */
export default function NbaOpponentBreakdownCard({
  isDark = false,
  playerName = null,
  lastOpponent = null,
}: NbaOpponentBreakdownCardProps) {
  const [selectedSeason, setSelectedSeason] = useState<2025 | 2026>(2026);
  const [payload, setPayload] = useState<NbaSteStatsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const opponentCode = useMemo(
    () => resolveNbaSteTeamCode(lastOpponent),
    [lastOpponent]
  );

  const teamSlice = useMemo(() => {
    if (!payload || !opponentCode) return null;
    return payload.teams.find((t) => t.code === opponentCode) ?? null;
  }, [payload, opponentCode]);

  const opponentLabel =
    teamSlice?.name ||
    payload?.names?.[opponentCode || ''] ||
    lastOpponent ||
    'TBD';

  useEffect(() => {
    if (!opponentCode) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/nba/dash/team-ste-stats?year=${selectedSeason}&window=0`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load opponent averages');
        return json as NbaSteStatsPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load opponent averages');
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeason, opponentCode]);

  /** Defence rank colours scaled for a 30-team league. */
  const getRankColor = (rank: number | null): string => {
    if (!rank || rank <= 0) {
      return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
    }
    if (rank <= 6) return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
    if (rank <= 12) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
    if (rank <= 18) return 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200';
    if (rank <= 24) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
    return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
  };

  const fmt = (key: NbaSteStatKey, v: number | null | undefined): string => {
    if (v == null || !Number.isFinite(v)) return '—';
    if (key === 'fg_pct' || key === 'fg3_pct') return `${v.toFixed(1)}%`;
    return v.toFixed(1);
  };

  const showCard = Boolean(playerName || lastOpponent || opponentCode);

  if (!showCard) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
        Select a player to see Opponent Breakdown (based on next opponent).
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {SEASON_OPTIONS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedSeason(y)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedSeason === y
                  ? 'bg-purple-600 text-white'
                  : isDark
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
        className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'
        }`}
      >
        <div className="flex items-center gap-2 mb-3">
          <div
            className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`}
          />
          <h4
            className={`text-sm font-mono font-bold uppercase tracking-wider ${
              isDark ? 'text-white' : 'text-slate-900'
            }`}
          >
            {opponentLabel} allowed averages
          </h4>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
        ) : selectedSeason === 2026 && (error || !payload?.teams?.length) ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            2026/27 stats will show once the season tips off.
          </div>
        ) : error ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">{error}</div>
        ) : !opponentCode ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No opponent selected for breakdown.
          </div>
        ) : !teamSlice ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No opponent averages for {lastOpponent ?? 'this team'}
          </div>
        ) : (
          <>
            {payload && payload.year !== selectedSeason ? (
              <div className={`text-xs mb-2 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                Showing {payload.seasonLabel} until {selectedSeason}/{String(selectedSeason + 1).slice(-2)} tips off.
              </div>
            ) : null}
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {NBA_STE_STAT_KEYS.map((statKey) => {
                const val = teamSlice.allowed[statKey];
                const r = payload?.metrics?.[statKey]?.ranks?.[opponentCode] ?? null;
                const label = NBA_STE_STAT_LABELS[statKey];
                return (
                  <div
                    key={statKey}
                    className={`flex items-center justify-between rounded border px-3 py-2 ${
                      isDark ? 'border-gray-600/60' : 'border-gray-200/80'
                    }`}
                  >
                    <span
                      className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}
                    >
                      {label} Allowed
                    </span>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-base font-bold font-mono ${
                          isDark ? 'text-white' : 'text-black'
                        }`}
                      >
                        {fmt(statKey, val)}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${getRankColor(r)}`}
                      >
                        #{r ?? '—'}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              className={`flex items-center justify-center gap-4 mt-2 pt-2 flex-shrink-0 text-xs font-medium ${
                isDark ? 'text-gray-400' : 'text-gray-500'
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
