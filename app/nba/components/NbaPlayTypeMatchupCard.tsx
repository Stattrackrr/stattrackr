'use client';

import { useEffect, useState } from 'react';
import type { NbaPlayTypeMatchupPayload } from '@/lib/nba/dash/playTypeMatchupShared';

export interface NbaPlayTypeMatchupCardProps {
  isDark?: boolean;
  playerId?: string | null;
  playerName?: string | null;
  /** Next-game / selected opponent club name */
  opponentTeam?: string | null;
}

/** Red = better defence (low rank, harder matchup); green = easier defence (high rank). */
function rankTextColor(rank: number | null) {
  if (rank == null) return 'text-gray-500 dark:text-gray-400';
  if (rank <= 5) return 'text-red-600 dark:text-red-400';
  if (rank <= 11) return 'text-orange-600 dark:text-orange-400';
  if (rank <= 21) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-green-600 dark:text-green-400';
}

function rankBgColor(rank: number | null) {
  if (rank == null) return 'bg-gray-100 dark:bg-gray-700';
  if (rank <= 5) return 'bg-red-50 dark:bg-red-900/20';
  if (rank <= 11) return 'bg-orange-50 dark:bg-orange-900/20';
  if (rank <= 21) return 'bg-yellow-50 dark:bg-yellow-900/20';
  return 'bg-green-50 dark:bg-green-900/20';
}

/**
 * Play Type Filter — the player's play-type scoring (points/game, share, own rank) and the
 * next opponent's defence rank against each play type.
 */
export default function NbaPlayTypeMatchupCard({
  isDark = false,
  playerId = null,
  playerName = null,
  opponentTeam = null,
}: NbaPlayTypeMatchupCardProps) {
  const [payload, setPayload] = useState<NbaPlayTypeMatchupPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ playerId });
    if (opponentTeam && opponentTeam !== 'N/A') params.set('opponent', opponentTeam);
    fetch(`/api/nba/dash/play-type-matchup?${params.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load play types');
        return json as NbaPlayTypeMatchupPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
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
  }, [playerId, opponentTeam]);

  if (!playerId) return null;

  const rows = payload?.rows ?? [];
  const hasOpponent = Boolean(payload?.opponentCode);

  const gridCols =
    'grid grid-cols-[minmax(0,1fr)_4.75rem_3.5rem] sm:grid-cols-[minmax(0,1fr)_6rem_4.5rem] items-center gap-x-2 sm:gap-x-3';

  return (
    <div className="w-full overflow-hidden">
      <div className="w-full flex items-center justify-between gap-3 px-3 sm:px-4 py-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-100 text-purple-600 dark:bg-purple-500/15 dark:text-purple-300">
            <svg
              className="w-[18px] h-[18px]"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
            </svg>
          </div>
          <div className="min-w-0 text-left">
            <h3 className="text-sm sm:text-base font-semibold leading-tight text-gray-900 dark:text-white">
              Play Type Filter
            </h3>
            <p className="mt-0.5 truncate text-[11px] sm:text-xs text-gray-500 dark:text-gray-400">
              {playerName ?? 'Player'}
              {payload?.seasonLabel ? ` · ${payload.seasonLabel}` : ''}
            </p>
          </div>
        </div>
        {payload?.opponentCode ? (
          <span className="shrink-0 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-[11px] font-bold tracking-wide text-gray-700 dark:border-gray-600 dark:bg-white/5 dark:text-gray-200">
            vs {payload.opponentCode}
          </span>
        ) : null}
      </div>

      <div className="px-3 sm:px-4 pb-3 sm:pb-4 pt-1 border-t border-gray-200 dark:border-gray-700/70">
        {loading && !payload && (
          <div className="space-y-1.5 pt-3">
            {Array.from({ length: 6 }, (_, idx) => (
              <div
                key={idx}
                className={`h-[52px] rounded-xl animate-pulse ${isDark ? 'bg-white/5' : 'bg-gray-100'}`}
                style={{ animationDelay: `${idx * 0.08}s` }}
              />
            ))}
          </div>
        )}

        {error && !loading && (
          <div className="mt-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3">
            <p className="text-sm text-yellow-800 dark:text-yellow-300">{error}</p>
          </div>
        )}

        {!error && rows.length > 0 && (
          <>
            <div
              className={`${gridCols} px-2.5 pt-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400`}
            >
              <span>Play Type</span>
              <span className="text-right">Pts/Game</span>
              <span className="text-right">Opp</span>
            </div>
            <div className="space-y-1.5">
              {rows.map((r, idx) => {
                const isTop = idx === 0;
                const share = r.pointsPct != null ? Math.max(0, Math.min(100, r.pointsPct)) : 0;
                return (
                  <div
                    key={r.type}
                    className={`${gridCols} rounded-xl border px-2.5 py-2 transition-colors ${
                      isTop
                        ? 'border-purple-300/70 bg-purple-50/70 dark:border-purple-500/40 dark:bg-purple-500/[0.08]'
                        : 'border-gray-200/80 bg-gray-50/80 hover:bg-gray-100/80 dark:border-gray-700/60 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <span
                          className={`inline-flex h-5 min-w-[1.75rem] shrink-0 items-center justify-center rounded-md px-1 text-[10px] font-bold tabular-nums ${
                            isTop
                              ? 'bg-purple-600 text-white'
                              : 'bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300'
                          }`}
                          title={`${playerName ?? 'Player'}'s #${idx + 1} play type by points per game`}
                        >
                          #{idx + 1}
                        </span>
                        <span className="truncate text-sm font-semibold text-gray-900 dark:text-white">{r.label}</span>
                      </div>
                      <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-white/10">
                        <div
                          className={`h-full rounded-full ${isTop ? 'bg-purple-600' : 'bg-purple-400/80 dark:bg-purple-400/70'}`}
                          style={{ width: `${share}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right whitespace-nowrap">
                      <span className="text-base font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                        {r.ppg.toFixed(1)}
                      </span>
                      {r.pointsPct != null ? (
                        <span className="ml-1 text-[11px] font-semibold tabular-nums text-gray-500 dark:text-gray-400">
                          ({r.pointsPct}%)
                        </span>
                      ) : null}
                    </div>
                    <div className="flex justify-end">
                      {r.oppRank != null ? (
                        <span
                          className={`inline-flex min-w-[2.75rem] items-center justify-center rounded-md px-1.5 py-1 text-xs font-bold tabular-nums ${rankTextColor(r.oppRank)} ${rankBgColor(r.oppRank)}`}
                          title={`Allows ${r.oppAllowed ?? '—'} ${r.label} pts/game (league avg ${r.leagueAvgAllowed ?? '—'})`}
                        >
                          #{r.oppRank}
                        </span>
                      ) : (
                        <span className="text-xs font-semibold text-gray-400 dark:text-gray-500">N/A</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {!loading && !error && payload && rows.length === 0 && (
          <div className="text-center py-10">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {payload.teamsRanked === 0
                ? `${payload.seasonLabel} play types aren't published yet. The NBA posts them a few games into the season.`
                : `No play type data for ${playerName ?? 'this player'} this season.`}
            </p>
          </div>
        )}

        {!error && rows.length > 0 && hasOpponent && (
          <div className="mt-3 rounded-xl border border-gray-200/80 bg-gray-50/60 px-3 py-2.5 dark:border-gray-700/60 dark:bg-white/[0.02]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider">
              <span className="text-red-600 dark:text-red-400">Tough D</span>
              <div className="flex-1 h-1.5 rounded-full bg-gradient-to-r from-red-500 via-yellow-500 to-green-500" />
              <span className="text-green-600 dark:text-green-400">Easy D</span>
            </div>
            <p className="mt-1.5 text-center text-[11px] text-gray-500 dark:text-gray-400">
              Opp rank #1 = fewest points allowed to that play type · #30 = most allowed
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
