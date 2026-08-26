'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { NBL_PLAY_TYPE_STAT_LABELS } from '@/lib/nbl/playTypesShared';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';
import type { NblPlayTypeCell, NblPlayTypesPayload } from '@/lib/nbl/playTypesShared';

const STAT_HELP = Object.values(NBL_PLAY_TYPE_STAT_LABELS).join(', ');

function fmtBoost(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function sampleAlpha(cell: NblPlayTypeCell | undefined): number {
  if (!cell || cell.boost == null) return 0.16;
  const gamePart = Math.min(1, cell.games / 14);
  const playerPart = Math.min(1, cell.players / 5);
  const confidence = 0.35 + 0.65 * Math.min(gamePart, playerPart);
  return cell.significant ? Math.max(0.58, confidence) : Math.min(0.38, confidence);
}

function cellBackground(cell: NblPlayTypeCell | undefined, isDark: boolean, emphasize: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'rgba(148,163,184,0.08)' : 'rgba(148,163,184,0.12)';
  }
  const mag = Math.min(1, Math.abs(boost) / 2.8);
  const alpha = sampleAlpha(cell) * (0.34 + 0.66 * mag) * (emphasize ? 1.12 : 0.9);
  if (boost > 0.15) return `rgba(16, 185, 129, ${Math.min(0.88, alpha)})`;
  if (boost < -0.15) return `rgba(239, 68, 68, ${Math.min(0.88, alpha)})`;
  return isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.14)';
}

function cellTextClass(cell: NblPlayTypeCell | undefined, isDark: boolean, emphasize: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'text-slate-500' : 'text-slate-400';
  }
  if (!cell?.significant && !emphasize) return isDark ? 'text-slate-400' : 'text-slate-500';
  if (boost > 0.15) return isDark ? 'text-emerald-100' : 'text-emerald-900';
  if (boost < -0.15) return isDark ? 'text-red-100' : 'text-red-900';
  return isDark ? 'text-slate-200' : 'text-slate-700';
}

function cellTitle(rowLabel: string, teamName: string, cell: NblPlayTypeCell | undefined): string {
  if (!cell || cell.boost == null) return `${rowLabel} vs ${teamName}: no sample`;
  const names = cell.names.length ? ` · ${cell.names.join(', ')}` : '';
  return `${rowLabel} vs ${teamName}: ${fmtBoost(cell.boost)} (${cell.games} g, ${cell.players} players, ${Math.round(cell.minutes)} min)${names}`;
}

export function PlayTypesInfoButton({
  isDark,
  onAccent = false,
}: {
  isDark: boolean;
  onAccent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);

  useEffect(() => {
    if (!onAccent) {
      hovering.current = false;
      setOpen(false);
    }
  }, [onAccent]);

  return (
    <span
      className={`relative inline-flex w-4 h-4 shrink-0 items-center justify-center ${
        onAccent ? '' : 'pointer-events-none'
      }`}
      onMouseEnter={() => {
        if (!onAccent) return;
        hovering.current = true;
        setOpen(true);
      }}
      onMouseLeave={() => {
        hovering.current = false;
        setOpen(false);
      }}
      onClick={(e) => {
        if (!onAccent) return;
        e.preventDefault();
        e.stopPropagation();
        if (!hovering.current) setOpen((prev) => !prev);
      }}
    >
      <span
        aria-hidden="true"
        className={`w-4 h-4 rounded-full text-[10px] font-bold leading-none flex items-center justify-center transition-colors ${
          onAccent
            ? 'bg-white/25 text-white'
            : isDark
              ? 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
        }`}
      >
        ?
      </span>
      <span className="sr-only">How play types work</span>
      {open ? (
        <span
          role="tooltip"
          aria-hidden="true"
          className={`absolute z-[80] left-0 top-full mt-1.5 w-72 px-3 py-2 text-xs font-normal leading-relaxed text-left rounded-lg border shadow-lg pointer-events-none ${
            isDark
              ? 'bg-[#0a1929] border-gray-600 text-gray-100'
              : 'bg-white border-gray-300 text-gray-900'
          }`}
        >
          <strong>How Play Types work</strong>
          <br />
          Last completed season (NBL26). Each rotation player is tagged as one attacking type:
          Primary Ball Handler, Secondary Ball Handler, 3-Point Shooter, Slasher, Interior, or
          Stretch.
          <br />
          <br />
          Each cell is how that type performed against that team compared with their own average on
          the selected stat. Green means they beat their usual line. Red means they came in under
          it.
          <br />
          <br />
          The purple column is the current opponent. This player&apos;s type sits on the top row.
        </span>
      ) : null}
    </span>
  );
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

  const teams = useMemo(() => {
    const list = payload?.teams ?? [];
    if (!opponentCode) return list;
    return [...list].sort((a, b) => {
      if (a.code === opponentCode) return -1;
      if (b.code === opponentCode) return 1;
      return 0;
    });
  }, [payload?.teams, opponentCode]);

  const rows = useMemo(() => {
    const list = payload?.rows ?? [];
    if (!playerType) return list;
    return [...list].sort((a, b) => {
      if (a.type === playerType) return -1;
      if (b.type === playerType) return 1;
      return 0;
    });
  }, [payload?.rows, playerType]);

  if (loading && !payload) {
    const pulse = isDark ? 'bg-slate-800' : 'bg-slate-200';
    return <div className={`h-40 w-full rounded-lg animate-pulse ${pulse}`} />;
  }

  if (error) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{error}</div>
    );
  }

  if (!payload) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Play type matrix unavailable.
      </div>
    );
  }

  if (!payload.statSupported) {
    return (
      <p className={`text-[11px] leading-snug py-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        This matrix tracks {STAT_HELP}. Switch the chart to one of those stats to see type-vs-team
        boosts
        {payload.player ? ` for ${payload.player.typeLabel}s` : ''}.
      </p>
    );
  }

  return (
    <table className={`w-full table-fixed border-collapse ${loading ? 'opacity-70' : ''}`}>
      <thead>
        <tr>
          <th className="w-[72px] p-0" />
          {teams.map((team) => {
            const logo = resolveTeamLogo?.(team.name);
            const isOpp = team.code === opponentCode;
            return (
              <th
                key={team.code}
                title={team.name}
                className={`p-1 align-bottom ${
                  isOpp ? 'border-x-2 border-t-2 border-violet-400 bg-violet-500/10' : ''
                }`}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex h-6 w-6 items-center justify-center">
                    {logo ? (
                      <img src={logo} alt={team.shortName} className="h-6 w-6 object-contain" />
                    ) : (
                      <span className={`text-[9px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {team.code}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[10px] leading-none font-semibold ${
                      isOpp
                        ? isDark
                          ? 'text-violet-200'
                          : 'text-violet-700'
                        : isDark
                          ? 'text-slate-400'
                          : 'text-slate-500'
                    }`}
                  >
                    {team.code}
                  </span>
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => {
          const isPlayerType = row.type === playerType;
          const isLast = rowIdx === rows.length - 1;
          return (
            <tr key={row.type}>
              <td className="pr-3 py-0.5 align-middle text-right">
                <span
                  className={`text-[11px] leading-tight font-semibold ${
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
                </span>
              </td>
              {teams.map((team) => {
                const cell = row.cells[team.code];
                const isOpp = team.code === opponentCode;
                const emphasize = isPlayerType && isOpp;
                return (
                  <td
                    key={team.code}
                    className={`p-0.5 ${
                      isOpp
                        ? `border-x-2 border-violet-400 bg-violet-500/10 ${isLast ? 'border-b-2' : ''}`
                        : ''
                    }`}
                  >
                    <div
                      title={cellTitle(row.label, team.shortName, cell)}
                      className={`h-9 w-full rounded-md flex items-center justify-center text-xs font-semibold tabular-nums ${cellTextClass(
                        cell,
                        isDark,
                        emphasize
                      )}`}
                      style={{ backgroundColor: cellBackground(cell, isDark, emphasize || isPlayerType) }}
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
  );
}
