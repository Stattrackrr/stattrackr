'use client';

import { useEffect, useMemo, useState } from 'react';
import { NBL_PLAY_TYPE_YEAR } from '@/lib/nbl/playTypesShared';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
import type { NblPlayTypeCell, NblPlayTypesPayload } from '@/lib/nbl/playTypesShared';

function fmtBoost(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function cellBackground(cell: NblPlayTypeCell | undefined, isDark: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)';
  }
  const mag = Math.min(1, Math.abs(boost) / 3.2);
  const alpha = (cell?.significant ? 0.62 : 0.24) * (0.28 + 0.72 * mag);
  if (boost > 0.12) return `rgba(16, 185, 129, ${alpha})`;
  if (boost < -0.12) return `rgba(239, 68, 68, ${alpha})`;
  return isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.14)';
}

function rowGameCount(row: { gameCount?: number; cells: Record<string, NblPlayTypeCell> }): number {
  if (typeof row.gameCount === 'number' && Number.isFinite(row.gameCount)) return row.gameCount;
  return Object.values(row.cells).reduce((sum, cell) => sum + (cell?.games ?? 0), 0);
}

function cellTextClass(cell: NblPlayTypeCell | undefined, isDark: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'text-slate-500' : 'text-slate-400';
  }
  if (!cell?.significant) return isDark ? 'text-slate-300' : 'text-slate-600';
  if (boost > 0.12) return isDark ? 'text-emerald-100' : 'text-emerald-900';
  if (boost < -0.12) return isDark ? 'text-red-100' : 'text-red-900';
  return isDark ? 'text-slate-200' : 'text-slate-700';
}

export default function NblDvpCard({
  isDark = false,
  playerId = null,
  opponentName = null,
  selectedStat = 'points',
  resolveTeamLogo,
}: {
  isDark?: boolean;
  season?: number;
  playerId?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [payload, setPayload] = useState<NblPlayTypesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      year: String(NBL_PLAY_TYPE_YEAR),
      stat: selectedStat || 'points',
    });
    if (playerId) params.set('playerId', playerId);

    fetch(`/api/nbl/play-types?${params.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load play types');
        return json as NblPlayTypesPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load play types');
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedStat, playerId]);

  const opponentCode = useMemo(
    () => resolveNblSteTeamCode(opponentName),
    [opponentName]
  );

  const playerType = payload?.player?.type ?? null;

  if (loading && !payload) {
    const pulse = isDark ? 'bg-slate-800' : 'bg-slate-200';
    return (
      <div className="flex-1 min-h-0 w-full flex flex-col gap-2 p-1">
        <div className={`h-4 w-40 rounded animate-pulse ${pulse}`} />
        <div className={`flex-1 rounded-lg animate-pulse ${pulse}`} />
      </div>
    );
  }

  if (error) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{error}</div>
    );
  }

  if (!payload) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Play type edge matrix unavailable.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full min-h-0 flex flex-col">
      <div className="flex items-baseline justify-between gap-2 mb-1.5 flex-shrink-0">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          Play Type Edge
        </h3>
        <p className={`text-[10px] ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          {payload.seasonLabel} only · {payload.statLabel} vs own avg
          {payload.player ? ` · ${payload.player.typeLabel}` : ''}
        </p>
      </div>
      <div className="flex-1 min-h-0 overflow-auto">
        <table className="w-full border-separate border-spacing-0.5 table-fixed">
          <thead>
            <tr>
              <th className="w-[118px] text-left text-[10px] font-medium text-transparent">Type</th>
              {payload.teams.map((team) => {
                const logo = resolveTeamLogo?.(team.name);
                const isOpp = team.code === opponentCode;
                return (
                  <th key={team.code} className="p-0">
                    <div
                      className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full ${
                        isOpp ? 'ring-2 ring-white shadow-sm' : ''
                      }`}
                      title={team.name}
                    >
                      {logo ? (
                        <img src={logo} alt={team.code} className="h-5 w-5 object-contain" />
                      ) : (
                        <span className={`text-[9px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                          {team.code}
                        </span>
                      )}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {payload.rows.map((row) => {
              const isPlayerType = row.type === playerType;
              const games = rowGameCount(row);
              return (
                <tr key={row.type}>
                  <td className="pr-1.5 align-middle">
                    <div
                      className={`text-[10px] leading-tight font-semibold ${
                        isPlayerType
                          ? isDark
                            ? 'text-violet-200'
                            : 'text-violet-700'
                          : isDark
                            ? 'text-slate-300'
                            : 'text-slate-600'
                      }`}
                    >
                      {row.label}
                    </div>
                    <div className={`text-[9px] leading-tight tabular-nums ${isDark ? 'text-slate-500' : 'text-slate-400'}`}>
                      {games} games · {row.playerCount} players
                    </div>
                  </td>
                  {payload.teams.map((team) => {
                    const cell = row.cells[team.code];
                    const isOpp = team.code === opponentCode;
                    return (
                      <td key={team.code} className="p-0">
                        <div
                          title={`${row.label} vs ${team.shortName}: ${fmtBoost(cell?.boost ?? null)} (${cell?.games ?? 0} g)`}
                          className={`h-7 w-full rounded-md flex items-center justify-center text-[10px] font-semibold tabular-nums ${cellTextClass(
                            cell,
                            isDark
                          )} ${cell?.significant ? 'ring-1 ring-white/90' : ''} ${
                            isOpp ? 'outline outline-1 outline-violet-400/80' : ''
                          } ${isPlayerType ? 'brightness-110' : ''}`}
                          style={{ backgroundColor: cellBackground(cell, isDark) }}
                        >
                          {fmtBoost(cell?.boost ?? null)}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={`mt-2 flex-shrink-0 text-[10px] leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
        NBL26 (2025) only. {payload.taggedCount} of {payload.rosterCount} rostered players are tagged
        — the rest did not play. Each cell is the boost vs that type’s own {payload.statLabel.toLowerCase()} average against that team.
        Games are appearances (same player can count more than once); players are unique. White ring = enough sample; faded = thin.
      </p>
    </div>
  );
}
