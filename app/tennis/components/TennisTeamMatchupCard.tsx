'use client';

import { useEffect, useState } from 'react';
import { tennisLastName, tennisOpponentCode } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import type {
  TennisMatchupBestOf,
  TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';

const SEASON_WINDOW = 0;
const WINDOWS = [
  { id: 5, label: 'L5' },
  { id: 10, label: 'L10' },
  { id: SEASON_WINDOW, label: String(TENNIS_CURRENT_YEAR) },
] as const;
const BEST_OF: Array<{ id: TennisMatchupBestOf; label: string }> = [
  { id: 3, label: 'BO3' },
  { id: 5, label: 'BO5' },
];

export default function TennisTeamMatchupCard({
  isDark = false,
  teamName = null,
  opponentName = null,
  tour = 'ATP',
}: {
  isDark?: boolean;
  teamName?: string | null;
  opponentName?: string | null;
  resolveTeamLogo?: (teamName: string) => string | null;
  tour?: 'ATP' | 'WTA' | null;
}) {
  const [windowN, setWindowN] = useState<number>(SEASON_WINDOW);
  const [bestOf, setBestOf] = useState<TennisMatchupBestOf>(3);
  const [payload, setPayload] = useState<TennisPlayerMatchupPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const player = String(teamName || '').trim();
  const opponent = String(opponentName || '').trim();
  const tourKey = tour === 'WTA' ? 'WTA' : 'ATP';

  useEffect(() => {
    if (!player || !opponent) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({
      player,
      opponent,
      tour: tourKey,
      year: String(TENNIS_CURRENT_YEAR),
      window: String(windowN),
      bestOf: String(bestOf),
    });
    fetch(`/api/tennis/player-matchup?${qs.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load player matchup');
        return json as TennisPlayerMatchupPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPayload(null);
        setError(err.message || 'Failed to load player matchup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player, opponent, tourKey, windowN, bestOf]);

  const playerLabel = payload?.player.name || player || 'Selected player';
  const opponentLabel = payload?.opponent.name || opponent || 'Opponent';
  const playerAbbr = tennisOpponentCode(playerLabel);
  const oppAbbr = tennisOpponentCode(opponentLabel);
  const playerFlag = tennisFlagUrl(payload?.player.ioc);
  const oppFlag = tennisFlagUrl(payload?.opponent.ioc);
  const rankedSize = payload ? Math.max(payload.fieldSize || 0, 10) : 10;
  const playerMatches = payload?.player.matches || 0;
  const oppMatches = payload?.opponent.matches || 0;
  const playerTotal = payload?.player.totalMatches || 0;
  const oppTotal = payload?.opponent.totalMatches || 0;

  const formatValue = (value: number | null, pct: boolean) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return pct ? value.toFixed(1) : value.toFixed(1);
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

  const hasPlayers = Boolean(player && opponent);
  const noData =
    Boolean(payload) &&
    hasPlayers &&
    payload.rows.every((r) => r.playerValue == null && r.opponentValue == null);

  const renderSide = (opts: {
    label: string;
    abbr: string;
    flag: string | null;
    sideLabel: string;
    value: number | null;
    rank: number | null;
    pct: boolean;
    tone: 'attack' | 'defense';
  }) => (
    <div className="flex items-center gap-1.5">
      {opts.flag ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={opts.flag}
          alt={opts.label}
          className="h-3.5 w-3.5 flex-shrink-0 rounded-full object-cover ring-1 ring-black/10"
        />
      ) : (
        <span
          className={`flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center rounded-full text-[6px] font-bold ${
            isDark ? 'bg-gray-700 text-gray-300' : 'bg-gray-300 text-gray-700'
          }`}
        >
          {opts.abbr.slice(0, 1)}
        </span>
      )}
      <div className="w-[52px] flex-shrink-0 leading-tight">
        <div className={`text-[10px] font-bold uppercase ${isDark ? 'text-gray-200' : 'text-gray-700'}`}>
          {opts.abbr}
        </div>
        <div className={`text-[10px] font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
          {opts.sideLabel}
        </div>
      </div>
      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-800">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${opts.tone === 'attack' ? attackBarPct(opts.rank) : defenseBarPct(opts.rank)}%`,
            backgroundColor:
              opts.tone === 'attack' ? attackRankBarColor(opts.rank) : defenseRankBarColor(opts.rank),
          }}
        />
      </div>
      <span className="w-10 flex-shrink-0 text-right text-xs font-bold tabular-nums text-gray-900 dark:text-white">
        {formatValue(opts.value, opts.pct)}
      </span>
      {opts.rank ? (
        <span
          className={`w-7 flex-shrink-0 rounded-md px-1 py-0.5 text-center text-[9px] font-bold tabular-nums ${
            opts.tone === 'attack' ? attackRankPillClass(opts.rank) : defenseRankPillClass(opts.rank)
          }`}
        >
          #{opts.rank}
        </span>
      ) : (
        <span className="w-7 flex-shrink-0" />
      )}
    </div>
  );

  return (
    <div className="w-full min-w-0 h-full flex flex-col px-1.5 py-1">
      <div className="mb-2 grid flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Player Matchup</h3>
        <div className="flex items-center justify-center gap-0.5">
          {BEST_OF.map((option, idx) => {
            const active = bestOf === option.id;
            return (
              <span key={option.id} className="flex items-center">
                {idx > 0 ? (
                  <span className={`px-0.5 text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setBestOf(option.id)}
                  className={`px-0.5 text-[10px] font-medium tracking-wide transition-colors ${
                    active
                      ? isDark
                        ? 'text-gray-300 underline decoration-gray-500 underline-offset-2'
                        : 'text-gray-700 underline decoration-gray-400 underline-offset-2'
                      : isDark
                        ? 'text-gray-600 hover:text-gray-400'
                        : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {option.label}
                </button>
              </span>
            );
          })}
        </div>
        <div className="flex items-center justify-end gap-0.5">
          {WINDOWS.map((option, idx) => {
            const isSeasonOption = option.id === SEASON_WINDOW;
            const minTotal = Math.min(playerTotal || 0, oppTotal || 0);
            const disabled = !isSeasonOption && minTotal > 0 && minTotal < option.id;
            const active = windowN === option.id;
            return (
              <span key={option.id} className="flex items-center">
                {idx > 0 ? (
                  <span className={`px-0.5 text-[10px] ${isDark ? 'text-gray-600' : 'text-gray-300'}`}>
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => setWindowN(option.id)}
                  className={`px-0.5 text-[10px] font-medium tracking-wide transition-colors ${
                    disabled
                      ? isDark
                        ? 'text-gray-700 cursor-not-allowed'
                        : 'text-gray-300 cursor-not-allowed'
                      : active
                        ? isDark
                          ? 'text-gray-300 underline decoration-gray-500 underline-offset-2'
                          : 'text-gray-700 underline decoration-gray-400 underline-offset-2'
                        : isDark
                          ? 'text-gray-600 hover:text-gray-400'
                          : 'text-gray-400 hover:text-gray-600'
                  }`}
                >
                  {option.label}
                </button>
              </span>
            );
          })}
        </div>
      </div>

      <div
        className={`mb-2 grid flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg px-2.5 py-2 ${
          isDark ? 'bg-white/[0.035]' : 'bg-gray-50'
        }`}
      >
        <div className="flex min-w-0 items-center justify-end gap-2">
          {playerFlag ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={playerFlag}
              alt=""
              className="h-4 w-[22px] flex-shrink-0 rounded-sm object-cover ring-1 ring-black/15"
            />
          ) : null}
          <div className="min-w-0 text-right">
            <div
              className={`truncate text-sm font-bold leading-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {tennisLastName(playerLabel)}
            </div>
            <div className={`text-[10px] tabular-nums ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {playerMatches || playerTotal || 0} matches
            </div>
          </div>
        </div>
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wider ${
            isDark ? 'bg-white/5 text-gray-400' : 'bg-white text-gray-500'
          }`}
        >
          vs
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div
              className={`truncate text-sm font-bold leading-tight ${
                isDark ? 'text-white' : 'text-slate-900'
              }`}
            >
              {tennisLastName(opponentLabel)}
            </div>
            <div className={`text-[10px] tabular-nums ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
              {oppMatches || oppTotal || 0} matches
            </div>
          </div>
          {oppFlag ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={oppFlag}
              alt=""
              className="h-4 w-[22px] flex-shrink-0 rounded-sm object-cover ring-1 ring-black/15"
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 custom-scrollbar">
        {!player ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Select a player to see the matchup.
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
        ) : !hasPlayers ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Pick an opponent to compare.
          </div>
        ) : noData ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No best-of-{bestOf} matches available yet.
          </div>
        ) : (
          <div className="space-y-2">
            {(payload?.rows || []).map((row) => (
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
                <div className="mb-1">
                  {renderSide({
                    label: playerLabel,
                    abbr: playerAbbr,
                    flag: playerFlag,
                    sideLabel: row.playerSideLabel,
                    value: row.playerValue,
                    rank: row.playerRank,
                    pct: row.pct,
                    tone: 'attack',
                  })}
                </div>
                {renderSide({
                  label: opponentLabel,
                  abbr: oppAbbr,
                  flag: oppFlag,
                  sideLabel: row.opponentSideLabel,
                  value: row.opponentValue,
                  rank: row.opponentRank,
                  pct: row.pct,
                  tone: 'defense',
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
