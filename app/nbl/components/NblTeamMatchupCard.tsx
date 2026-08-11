'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  NBL_STE_STAT_KEYS,
  NBL_STE_STAT_LABELS,
  nblSteMatchupSideLabels,
  resolveNblSteTeamCode,
  type NblSteStatsPayload,
} from '@/lib/nbl/teamSteStatsShared';
import { NBL_SHOT_CHART_SEASON_YEAR } from '@/lib/nblTeamCanonical';

/** window=0 → full season averages for the active STE season year. */
const SEASON_WINDOW = 0;
/** Prefer last completed season until NBL27 (2026) game logs exist. */
const MATCHUP_SEASON_YEAR = NBL_SHOT_CHART_SEASON_YEAR;
const WINDOWS = [
  { id: 5, label: 'L5' },
  { id: 10, label: 'L10' },
  { id: SEASON_WINDOW, label: String(MATCHUP_SEASON_YEAR) },
] as const;

export interface NblTeamMatchupCardProps {
  isDark?: boolean;
  teamName?: string | null;
  opponentName?: string | null;
  resolveTeamLogo?: (teamName: string) => string | null;
}

/**
 * Team Matchup — World Cup card layout 1:1.
 * Selected team offense (going forward) vs opponent allowed (defense).
 * Uses the same STE metrics as Opponent Breakdown.
 */
export default function NblTeamMatchupCard({
  isDark = false,
  teamName = null,
  opponentName = null,
  resolveTeamLogo,
}: NblTeamMatchupCardProps) {
  const [windowN, setWindowN] = useState<number>(SEASON_WINDOW);
  const [payload, setPayload] = useState<NblSteStatsPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const teamCode = useMemo(() => resolveNblSteTeamCode(teamName), [teamName]);
  const oppCode = useMemo(() => resolveNblSteTeamCode(opponentName), [opponentName]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/nbl/team-ste-stats?year=${MATCHUP_SEASON_YEAR}&window=${windowN}`
    )
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load team matchup');
        return json as NblSteStatsPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPayload(null);
        setError(err.message || 'Failed to load team matchup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [windowN]);

  const teamLabel =
    (teamCode && payload?.names?.[teamCode]) || teamName || 'Selected team';
  const opponentLabel =
    (oppCode && payload?.names?.[oppCode]) || opponentName || 'Opponent';
  const teamAbbr = (teamCode || teamName || '').slice(0, 3).toUpperCase();
  const oppAbbr = (oppCode || opponentName || '').slice(0, 3).toUpperCase();

  const teamLogo = teamName ? resolveTeamLogo?.(teamName) ?? null : null;
  const oppLogo = opponentName ? resolveTeamLogo?.(opponentName) ?? null : null;

  const rankedSize = payload ? Math.max(payload.teamCount || 0, 10) : 10;

  const rows = useMemo(() => {
    if (!payload?.forMetrics || !payload?.metrics) return [];
    return NBL_STE_STAT_KEYS.map((key) => {
      const forEntry = payload.forMetrics[key];
      const allowedEntry = payload.metrics[key];
      const sideLabels = nblSteMatchupSideLabels(key);
      return {
        key,
        label: NBL_STE_STAT_LABELS[key],
        teamSideLabel: sideLabels.team,
        opponentSideLabel: sideLabels.opponent,
        attackValue: teamCode ? forEntry?.values[teamCode] ?? null : null,
        attackRank: teamCode ? forEntry?.ranks[teamCode] ?? null : null,
        defenseValue: oppCode ? allowedEntry?.values[oppCode] ?? null : null,
        defenseRank: oppCode ? allowedEntry?.ranks[oppCode] ?? null : null,
      };
    });
  }, [payload, teamCode, oppCode]);

  const teamGames = teamCode ? payload?.games?.[teamCode] ?? 0 : 0;
  const oppGames = oppCode ? payload?.games?.[oppCode] ?? 0 : 0;
  const teamTotal = teamCode ? payload?.totalGames?.[teamCode] ?? 0 : 0;
  const oppTotal = oppCode ? payload?.totalGames?.[oppCode] ?? 0 : 0;

  const formatValue = (key: (typeof NBL_STE_STAT_KEYS)[number], value: number | null) => {
    if (value == null || !Number.isFinite(value)) return '—';
    if (key === 'fg_pct' || key === 'fg3_pct') return value.toFixed(1);
    return value.toFixed(1);
  };

  const attackRankPillClass = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) {
      return isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500';
    }
    const third = rankedSize / 3;
    if (rank <= third) return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (rank <= third * 2) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
  };

  const defenseRankPillClass = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) {
      return isDark ? 'bg-gray-800 text-gray-500' : 'bg-gray-200 text-gray-500';
    }
    const third = rankedSize / 3;
    if (rank <= third) return 'bg-rose-500/15 text-rose-600 dark:text-rose-400';
    if (rank <= third * 2) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
    return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
  };

  const attackRankBarColor = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return isDark ? '#4b5563' : '#9ca3af';
    const third = rankedSize / 3;
    if (rank <= third) return '#16a34a';
    if (rank <= third * 2) return '#f59e0b';
    return '#e11d48';
  };

  const defenseRankBarColor = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return isDark ? '#4b5563' : '#9ca3af';
    const third = rankedSize / 3;
    if (rank <= third) return '#e11d48';
    if (rank <= third * 2) return '#f59e0b';
    return '#16a34a';
  };

  const attackBarPct = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return 0;
    return Math.max(6, ((rankedSize + 1 - rank) / rankedSize) * 100);
  };

  const defenseBarPct = (rank: number | null) => {
    if (!rank || !Number.isFinite(rank)) return 0;
    return Math.max(6, (rank / rankedSize) * 100);
  };

  const hasTeams = Boolean(teamCode && oppCode);
  const noData =
    Boolean(payload) &&
    hasTeams &&
    rows.every((r) => r.attackValue == null && r.defenseValue == null);

  return (
    <div className="w-full min-w-0 h-full flex flex-col px-1.5 py-1">
      <div className="flex items-center justify-between gap-2 mb-2 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        <div
          className={`flex rounded-lg border overflow-hidden ${
            isDark ? 'border-gray-600' : 'border-gray-300'
          }`}
        >
          {WINDOWS.map((option) => {
            const isSeasonOption = option.id === SEASON_WINDOW;
            const minTotal = Math.min(teamTotal || 0, oppTotal || 0);
            const disabled = !isSeasonOption && minTotal > 0 && minTotal < option.id;
            const active = windowN === option.id;
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                onClick={() => setWindowN(option.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? 'bg-purple-600 text-white'
                    : disabled
                      ? isDark
                        ? 'bg-[#0a1929] text-gray-700 cursor-not-allowed'
                        : 'bg-gray-100 text-gray-300 cursor-not-allowed'
                      : isDark
                        ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                        : 'bg-gray-100 text-gray-600 hover:text-gray-900'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-2 flex flex-shrink-0 items-center gap-2">
        <span
          className={`h-2 w-2 flex-shrink-0 rounded-full ${
            isDark ? 'bg-cyan-400' : 'bg-cyan-500'
          } animate-pulse`}
        />
        <h4
          className={`truncate text-sm font-bold uppercase tracking-wider ${
            isDark ? 'text-white' : 'text-slate-900'
          }`}
        >
          {teamLabel}{' '}
          <span className={isDark ? 'text-gray-500' : 'text-gray-400'}>vs</span> {opponentLabel}
        </h4>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 custom-scrollbar">
        {!teamName ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Select a team to see the matchup.
          </div>
        ) : loading && !payload ? (
          <div className="space-y-2">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className={`h-12 w-full rounded-lg animate-pulse ${
                  isDark ? 'bg-gray-800' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 dark:text-red-400 py-4">{error}</div>
        ) : !hasTeams ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Pick an opponent to compare.
          </div>
        ) : noData ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No data available yet.
          </div>
        ) : (
          <div className="space-y-2">
            <div
              className={`flex items-center justify-center gap-2 text-[10px] font-medium ${
                isDark ? 'text-gray-500' : 'text-gray-400'
              }`}
            >
              <span className="tabular-nums">
                <span className="font-bold uppercase">{teamAbbr}</span> {teamGames || teamTotal}{' '}
                games
              </span>
              <span className="opacity-40">·</span>
              <span className="tabular-nums">
                <span className="font-bold uppercase">{oppAbbr}</span> {oppGames || oppTotal} games
              </span>
            </div>

            {rows.map((row) => {
              const teamPct = attackBarPct(row.attackRank);
              const oppPct = defenseBarPct(row.defenseRank);
              return (
                <div
                  key={row.key}
                  className={`rounded-xl border px-2.5 py-2 transition-colors ${
                    isDark
                      ? 'border-gray-700/60 bg-white/[0.02] hover:border-gray-600'
                      : 'border-gray-200 bg-gray-50/70 hover:border-gray-300'
                  }`}
                >
                  <div
                    className={`mb-1.5 text-center text-[10px] font-bold uppercase tracking-wider ${
                      isDark ? 'text-gray-300' : 'text-gray-600'
                    }`}
                  >
                    {row.label}
                  </div>

                  <div className="mb-1 flex items-center gap-1.5">
                    {teamLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={teamLogo}
                        alt={teamLabel}
                        className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-contain ring-1 ring-black/10"
                      />
                    ) : (
                      <span
                        className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[6px] font-bold ${
                          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'
                        }`}
                      >
                        {teamAbbr.slice(0, 1)}
                      </span>
                    )}
                    <div className="w-[52px] flex-shrink-0 leading-tight">
                      <div
                        className={`text-[10px] font-bold uppercase ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        {teamAbbr}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          isDark ? 'text-gray-300' : 'text-gray-600'
                        }`}
                      >
                        {row.teamSideLabel}
                      </div>
                    </div>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${teamPct}%`,
                          backgroundColor: attackRankBarColor(row.attackRank),
                        }}
                      />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {formatValue(row.key, row.attackValue)}
                    </span>
                    {row.attackRank ? (
                      <span
                        className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${attackRankPillClass(row.attackRank)}`}
                      >
                        #{row.attackRank}
                      </span>
                    ) : (
                      <span className="w-7 flex-shrink-0" />
                    )}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {oppLogo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={oppLogo}
                        alt={opponentLabel}
                        className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-contain ring-1 ring-black/10"
                      />
                    ) : (
                      <span
                        className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[6px] font-bold ${
                          isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'
                        }`}
                      >
                        {oppAbbr.slice(0, 1)}
                      </span>
                    )}
                    <div className="w-[52px] flex-shrink-0 leading-tight">
                      <div
                        className={`text-[10px] font-bold uppercase ${
                          isDark ? 'text-gray-200' : 'text-gray-700'
                        }`}
                      >
                        {oppAbbr}
                      </div>
                      <div
                        className={`text-[10px] font-semibold ${
                          isDark ? 'text-gray-300' : 'text-gray-600'
                        }`}
                      >
                        {row.opponentSideLabel}
                      </div>
                    </div>
                    <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full"
                        style={{
                          width: `${oppPct}%`,
                          backgroundColor: defenseRankBarColor(row.defenseRank),
                        }}
                      />
                    </div>
                    <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">
                      {formatValue(row.key, row.defenseValue)}
                    </span>
                    {row.defenseRank ? (
                      <span
                        className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${defenseRankPillClass(row.defenseRank)}`}
                      >
                        #{row.defenseRank}
                      </span>
                    ) : (
                      <span className="w-7 flex-shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
