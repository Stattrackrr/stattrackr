'use client';

import { useEffect, useState } from 'react';
import { tennisLastName } from '@/lib/tennis/chartStats';
import { TENNIS_CURRENT_YEAR } from '@/lib/tennis/constants';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import type { TennisDvpStage } from '@/lib/tennis/dvpShared';
import { TENNIS_MATCHUP_STATS } from '@/lib/tennis/playerMatchupShared';
import { tennisDashboardFetch } from '@/lib/tennisDashboardFetch';
import type {
  TennisMatchupBestOf,
  TennisPlayerMatchupPayload,
} from '@/lib/tennis/playerMatchupShared';
import { tennisMatchupBoardKey } from '@/lib/tennis/playerMatchupShared';

const SEASON_WINDOW = 0;
const WINDOWS = [
  { id: 5, label: 'L5' },
  { id: 10, label: 'L10' },
  { id: SEASON_WINDOW, label: String(TENNIS_CURRENT_YEAR) },
] as const;
const BEST_OF: Array<{ id: 3 | 5; label: string }> = [
  { id: 3, label: 'BO3' },
  { id: 5, label: 'BO5' },
];

/** playerInvert === true means "lower is better" for that matchup row. */
const HIGHER_IS_BETTER = new Map(
  TENNIS_MATCHUP_STATS.map((stat) => [stat.key, !stat.playerInvert])
);

/**
 * Green = selected player pull from the left; red = opponent from the right.
 * Always a two-colour split that sums to 100% (clamped 2–98 so both colours show).
 */
function greenPercent(
  left: number | null,
  right: number | null,
  higherIsBetter: boolean
): number {
  if (
    left == null ||
    right == null ||
    !Number.isFinite(left) ||
    !Number.isFinite(right)
  ) {
    return 50;
  }
  const l = Math.abs(left);
  const r = Math.abs(right);
  const total = l + r;
  if (!total || total <= 0) return 50;
  const share = (higherIsBetter ? l / total : r / total) * 100;
  return Math.min(98, Math.max(2, share));
}

type Lead = 'player' | 'opponent' | 'even';

function matchupLead(
  left: number | null,
  right: number | null,
  higherIsBetter: boolean
): { lead: Lead; delta: number | null } {
  if (
    left == null ||
    right == null ||
    !Number.isFinite(left) ||
    !Number.isFinite(right)
  ) {
    return { lead: 'even', delta: null };
  }
  const advantage = higherIsBetter ? left - right : right - left;
  if (Math.abs(advantage) < 0.05) return { lead: 'even', delta: 0 };
  return {
    lead: advantage > 0 ? 'player' : 'opponent',
    delta: advantage,
  };
}

function formatDelta(delta: number | null, lead: Lead): string {
  if (lead === 'even' || delta == null) return '=';
  const abs = Math.abs(delta);
  const n = abs >= 10 ? abs.toFixed(1) : abs.toFixed(1);
  return `${delta > 0 ? '+' : '−'}${n}`;
}

export default function TennisTeamMatchupCard({
  isDark = false,
  teamName = null,
  opponentName = null,
  playerId = null,
  opponentId = null,
  tournamentName = null,
  tournamentKey = null,
  stage = 'main',
  tour = 'ATP',
}: {
  isDark?: boolean;
  teamName?: string | null;
  opponentName?: string | null;
  playerId?: string | null;
  opponentId?: string | null;
  tournamentName?: string | null;
  tournamentKey?: string | null;
  stage?: TennisDvpStage;
  resolveTeamLogo?: (teamName: string) => string | null;
  tour?: 'ATP' | 'WTA' | null;
}) {
  const [windowN, setWindowN] = useState<number>(SEASON_WINDOW);
  const [bestOf, setBestOf] = useState<TennisMatchupBestOf>('all');
  const [bundle, setBundle] = useState<TennisPlayerMatchupPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [barsReady, setBarsReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  const player = String(teamName || '').trim();
  const opponentRaw = String(opponentName || '').trim();
  const opponent = /^\d+$/.test(opponentRaw) ? '' : opponentRaw;
  const resolvedOpponentId = String(opponentId || ( /^\d+$/.test(opponentRaw) ? opponentRaw : '') || '').trim();
  const tourKey = tour === 'WTA' ? 'WTA' : 'ATP';
  const wtaTour = tourKey === 'WTA';
  const matchupBestOf: TennisMatchupBestOf = wtaTour ? 'all' : bestOf;

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduceMotion(mq.matches);
    sync();
    mq.addEventListener?.('change', sync);
    return () => mq.removeEventListener?.('change', sync);
  }, []);

  useEffect(() => {
    if (!player || (!opponent && !resolvedOpponentId)) {
      setBundle(null);
      setError(null);
      setLoading(false);
      setBarsReady(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setBarsReady(false);
    const qs = new URLSearchParams({
      player,
      tour: tourKey,
      year: String(TENNIS_CURRENT_YEAR),
      window: '0',
      bestOf: 'all',
    });
    if (opponent) qs.set('opponent', opponent);
    if (playerId) qs.set('playerId', playerId);
    if (resolvedOpponentId) qs.set('opponentId', resolvedOpponentId);
    if (tournamentName) qs.set('tournament', tournamentName);
    if (tournamentKey) qs.set('tournamentKey', tournamentKey);
    if (stage) qs.set('stage', stage);
    tennisDashboardFetch(`/api/tennis/player-matchup?${qs.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load player matchup');
        return json as TennisPlayerMatchupPayload;
      })
      .then((data) => {
        if (!cancelled) setBundle(data);
      })
      .catch(() => {
        if (cancelled) return;
        setBundle(null);
        setError('Error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player, opponent, resolvedOpponentId, playerId, tournamentName, tournamentKey, stage, tourKey]);

  const payload =
    bundle?.boards?.[tennisMatchupBoardKey(matchupBestOf, windowN)] ||
    bundle;

  // Grow bars out from centre on first paint / player change (skipped if reduce-motion).
  useEffect(() => {
    if (!payload?.rows?.length) {
      setBarsReady(false);
      return;
    }
    if (reduceMotion) {
      setBarsReady(true);
      return;
    }
    setBarsReady(false);
    const id = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => setBarsReady(true));
    });
    return () => window.cancelAnimationFrame(id);
  }, [payload, playerId, player, opponent, resolvedOpponentId, matchupBestOf, windowN, reduceMotion]);

  const playerLabel = payload?.player.name && !/^\d+$/.test(payload.player.name)
    ? payload.player.name
    : player || 'Selected player';
  const opponentLabel =
    payload?.opponent.name && !/^\d+$/.test(payload.opponent.name)
      ? payload.opponent.name
      : opponent || String(opponentName || '').trim() || 'Opponent';
  const playerFlag = tennisFlagUrl(payload?.player.ioc);
  const oppFlag = tennisFlagUrl(payload?.opponent.ioc);
  const playerMatches = payload?.player.matches || 0;
  const oppMatches = payload?.opponent.matches || 0;
  const playerTotal = payload?.player.totalMatches || 0;
  const oppTotal = payload?.opponent.totalMatches || 0;

  const formatValue = (value: number | null, pct: boolean) => {
    if (value == null || !Number.isFinite(value)) return '—';
    return pct ? value.toFixed(1) : value.toFixed(1);
  };

  const hasPlayers = Boolean(player && (opponent || resolvedOpponentId));
  const noData =
    Boolean(payload) &&
    hasPlayers &&
    (payload?.rows.every((r) => r.playerValue == null && r.opponentValue == null) ?? false);

  const muted = isDark ? 'text-[#8fa0b8]' : 'text-slate-500';
  const titleColor = isDark ? 'text-[#f2f6fb]' : 'text-slate-900';

  return (
    <div className="w-full min-w-0 h-full min-h-0 flex flex-col px-1.5 py-1">
      <div className="relative z-20 mb-2.5 grid flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className={`text-sm font-semibold tracking-wide ${titleColor}`}>Player Matchup</h3>
        </div>
        <div className="flex items-center justify-center gap-0.5">
          {wtaTour
            ? null
            : BEST_OF.map((option, idx) => {
                const active = bestOf === option.id;
                return (
                  <span key={option.id} className="flex items-center">
                    {idx > 0 ? (
                      <span className={`px-0.5 text-[10px] ${isDark ? 'text-white/20' : 'text-gray-300'}`}>
                        /
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setBestOf((prev) => (prev === option.id ? 'all' : option.id))}
                      className={`px-0.5 text-[10px] font-medium tracking-wide transition-colors ${
                        active
                          ? isDark
                            ? 'text-[#d7e3f4] underline decoration-white/30 underline-offset-2'
                            : 'text-gray-700 underline decoration-gray-400 underline-offset-2'
                          : isDark
                            ? 'text-white/35 hover:text-white/60'
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
            const active = windowN === option.id;
            return (
              <span key={option.id} className="flex items-center">
                {idx > 0 ? (
                  <span className={`px-0.5 text-[10px] ${isDark ? 'text-white/20' : 'text-gray-300'}`}>
                    /
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => setWindowN(option.id)}
                  className={`px-0.5 text-[10px] font-medium tracking-wide transition-colors touch-manipulation ${
                    active
                      ? isDark
                        ? 'text-[#d7e3f4] underline decoration-white/30 underline-offset-2'
                        : 'text-gray-700 underline decoration-gray-400 underline-offset-2'
                      : isDark
                        ? 'text-white/35 hover:text-white/60'
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
        className={`mb-3 grid flex-shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-2xl px-3 py-2.5 ${
          isDark
            ? 'border border-white/[0.08] bg-gradient-to-b from-[#13233a] to-[#0b1626] shadow-[0_8px_24px_rgba(0,0,0,0.35)]'
            : 'border border-slate-200 bg-white shadow-sm'
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
            <div className={`truncate text-sm font-bold leading-tight ${titleColor}`}>
              {tennisLastName(playerLabel)}
            </div>
            <div className={`text-[10px] tabular-nums ${muted}`}>
              {playerMatches || playerTotal || 0} matches
            </div>
          </div>
        </div>
        <span
          className={`flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-bold uppercase tracking-wider ${
            isDark ? 'bg-white/[0.06] text-[#9eb0c8]' : 'bg-slate-100 text-slate-500'
          }`}
        >
          vs
        </span>
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0">
            <div className={`truncate text-sm font-bold leading-tight ${titleColor}`}>
              {tennisLastName(opponentLabel)}
            </div>
            <div className={`text-[10px] tabular-nums ${muted}`}>
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

      <div
        className="pr-0.5 flex-1 min-h-0 overflow-y-auto overscroll-contain custom-scrollbar"
        onWheel={(e) => e.stopPropagation()}
      >
        {!player ? (
          <div className={`text-sm py-4 ${muted}`}>Select a player to see the matchup.</div>
        ) : loading && !bundle ? (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4].map((idx) => (
              <div
                key={idx}
                className={`h-14 w-full rounded-xl animate-pulse ${
                  isDark ? 'bg-[#122033]' : 'bg-gray-200'
                }`}
              />
            ))}
          </div>
        ) : error ? (
          <div className="text-sm text-red-600 dark:text-red-400 py-4">Error</div>
        ) : !hasPlayers ? (
          <div className={`text-sm py-4 ${muted}`}>Pick an opponent to compare.</div>
        ) : noData ? (
          <div className={`text-sm py-4 ${muted}`}>
            {wtaTour || matchupBestOf === 'all'
              ? 'No matches available yet.'
              : `No best-of-${matchupBestOf} matches available yet.`}
          </div>
        ) : (
          <div className="space-y-1.5 pb-1">
            {(payload?.rows || []).map((row) => {
              const higherIsBetter = HIGHER_IS_BETTER.get(row.key) !== false;
              const targetG = greenPercent(row.playerValue, row.opponentValue, higherIsBetter);
              const g = barsReady || reduceMotion ? targetG : 50;
              const r = 100 - g;
              const { lead, delta } = matchupLead(
                row.playerValue,
                row.opponentValue,
                higherIsBetter
              );
              const playerWin = lead === 'player';
              const oppWin = lead === 'opponent';
              const motion = reduceMotion
                ? 'none'
                : 'width .55s ease-out, flex-basis .55s ease-out';

              return (
                <div
                  key={row.key}
                  className={`rounded-xl border px-2.5 py-1.5 ${
                    isDark
                      ? 'border-white/[0.07] bg-[#101c2e]'
                      : 'border-slate-200 bg-white'
                  }`}
                >
                  <div
                    className={`mb-1 text-center text-[9px] font-bold uppercase tracking-[0.14em] ${
                      isDark ? 'text-[#d5deea]' : 'text-slate-700'
                    }`}
                  >
                    {row.label}
                  </div>

                  <div className="mb-1.5 grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                    <div className="min-w-0 text-left">
                      <div
                        className={`text-[8px] font-semibold uppercase tracking-[0.12em] ${
                          isDark ? 'text-[#7f91a8]' : 'text-slate-500'
                        }`}
                      >
                        {row.playerSideLabel}
                      </div>
                      <div
                        className={`text-[15px] font-bold tabular-nums leading-tight transition-colors duration-300 ${
                          playerWin
                            ? 'text-[#4a9d4f]'
                            : isDark
                              ? 'text-[#e8eef7]'
                              : 'text-slate-900'
                        }`}
                      >
                        {formatValue(row.playerValue, row.pct)}
                      </div>
                    </div>

                    <div
                      className={`inline-flex min-w-[2.25rem] items-center justify-center rounded-md px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${
                        playerWin
                          ? 'bg-emerald-500/12 text-[#4a9d4f]'
                          : oppWin
                            ? 'bg-rose-500/12 text-[#d0384a]'
                            : isDark
                              ? 'bg-white/[0.05] text-[#8fa0b8]'
                              : 'bg-slate-100 text-slate-500'
                      }`}
                    >
                      {formatDelta(delta, lead)}
                    </div>

                    <div className="min-w-0 text-right">
                      <div
                        className={`text-[8px] font-semibold uppercase tracking-[0.12em] ${
                          isDark ? 'text-[#7f91a8]' : 'text-slate-500'
                        }`}
                      >
                        {row.opponentSideLabel}
                      </div>
                      <div
                        className={`text-[15px] font-bold tabular-nums leading-tight transition-colors duration-300 ${
                          oppWin
                            ? 'text-[#d0384a]'
                            : isDark
                              ? 'text-[#e8eef7]'
                              : 'text-slate-900'
                        }`}
                      >
                        {formatValue(row.opponentValue, row.pct)}
                      </div>
                    </div>
                  </div>

                  <div
                    className={`rounded-full p-px ${
                      isDark ? 'bg-[#060d18]' : 'bg-slate-200'
                    }`}
                  >
                    <div className="relative flex h-2 overflow-hidden rounded-full" aria-hidden>
                      <div
                        className="h-full rounded-l-full"
                        style={{
                          flex: `0 0 ${g}%`,
                          width: `${g}%`,
                          backgroundColor: '#4a9d4f',
                          transition: motion,
                        }}
                      />
                      <div
                        className="h-full rounded-r-full"
                        style={{
                          flex: `0 0 ${r}%`,
                          width: `${r}%`,
                          backgroundColor: '#d0384a',
                          transition: motion,
                        }}
                      />
                      <div className="pointer-events-none absolute left-1/2 top-[-2px] bottom-[-2px] w-px -translate-x-1/2 bg-white/70" />
                    </div>
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
