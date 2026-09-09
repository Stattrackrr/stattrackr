'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  formatTennisSetScore,
  parseTennisSetsFromPlayerView,
  tennisLastName,
  tennisScoreIsRetired,
  tennisTourLabel,
} from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';
import {
  PLAYER_FORM_WINDOWS,
  type PlayerFormTone,
  type PlayerFormWindow,
  type TennisPlayerFormPayload,
} from '@/lib/tennis/playerFormShared';

function formatMatchDate(raw: unknown, fallback?: unknown): string {
  const s = String(raw || '').trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  if (s) {
    const d = new Date(s);
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  const fb = String(fallback || '').trim();
  return fb || '—';
}

function formatMatchScore(score: string, isWin: boolean): string {
  const sets = parseTennisSetsFromPlayerView(score, isWin);
  if (!sets.length) return score.trim() || '—';
  const text = sets.map(formatTennisSetScore).join(' ');
  return tennisScoreIsRetired(score) ? `${text} RET` : text;
}

function surfaceLabel(raw: string | null | undefined): string {
  const s = String(raw || '').trim();
  if (!s) return '—';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function fmtPct(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${value.toFixed(digits)}%`;
}

function fmtNum(value: number | null | undefined, digits = 1): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

function toneText(tone: PlayerFormTone, isDark: boolean): string {
  if (tone === 'good') return 'text-emerald-600 dark:text-emerald-400';
  if (tone === 'bad') return 'text-rose-600 dark:text-rose-400';
  if (tone === 'ok') return 'text-amber-600 dark:text-amber-400';
  return isDark ? 'text-gray-300' : 'text-gray-700';
}

function winBarClass(winPct: number | null): string {
  if (winPct == null) return 'bg-gray-500';
  if (winPct >= 58) return 'bg-emerald-500';
  if (winPct >= 45) return 'bg-amber-500';
  return 'bg-rose-500';
}

export function TennisPlayerFormCard({
  isDark = false,
  layout = 'desktop',
  playerName = null,
  opponentName = null,
  tour = 'ATP',
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  playerName?: string | null;
  opponentName?: string | null;
  tour?: 'ATP' | 'WTA' | null;
}) {
  const [windowN, setWindowN] = useState<PlayerFormWindow>(10);
  const [payload, setPayload] = useState<TennisPlayerFormPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const compact = layout === 'mobile';
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const strong = isDark ? 'text-white' : 'text-gray-900';
  const rowBorder = isDark ? 'border-gray-800' : 'border-gray-100';
  const headBorder = isDark ? 'border-gray-700' : 'border-gray-200';
  const panel = isDark ? 'bg-[#071422]/80 border-gray-800' : 'bg-gray-50 border-gray-200';

  const player = String(playerName || '').trim();
  const opponent = String(opponentName || '').trim();
  const tourKey = tour === 'WTA' ? 'WTA' : 'ATP';

  useEffect(() => {
    if (!player) {
      setPayload(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const qs = new URLSearchParams({ player, tour: tourKey });
    if (opponent) qs.set('opponent', opponent);
    fetch(`/api/tennis/player-form?${qs.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load form');
        return json as TennisPlayerFormPayload;
      })
      .then((data) => {
        if (!cancelled) setPayload(data);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setPayload(null);
        setError(err.message || 'Failed to load form');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [player, opponent, tourKey]);

  const recent = useMemo(() => (payload?.recent || []).slice(0, windowN), [payload?.recent, windowN]);
  const formWins = recent.filter((row) => row.isWin).length;
  const formLosses = recent.length - formWins;
  const streak = useMemo(() => {
    if (!recent.length) return null;
    const first = recent[0].isWin;
    let count = 0;
    for (const row of recent) {
      if (row.isWin !== first) break;
      count += 1;
    }
    return { wins: first, count };
  }, [recent]);

  if (!player) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${muted}`}>
        Select a player to see recent form.
      </div>
    );
  }

  if (loading && !payload) {
    return (
      <div className="space-y-1.5 min-h-[160px]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className={`h-9 rounded-md animate-pulse ${isDark ? 'bg-gray-800/50' : 'bg-gray-100'}`}
          />
        ))}
      </div>
    );
  }

  if (error) {
    return <div className="py-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }

  if (!payload || !payload.recent.length) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${muted}`}>
        No recent matches found.
      </div>
    );
  }

  const baseline = payload.baseline;
  const rankBands = payload.rankBands;
  const isPinnedSplit = (id: string) =>
    (payload.opponent?.returnLabel === 'weak' && id === 'weak_return') ||
    (payload.opponent?.returnLabel === 'strong' && id === 'strong_return') ||
    (payload.opponent?.serveLabel === 'weak' && id === 'weak_serve') ||
    (payload.opponent?.serveLabel === 'strong' && id === 'big_serve') ||
    Boolean(payload.opponent?.surface && id === payload.opponent.surface);
  const styleSplits = [...payload.styleSplits]
    .sort((a, b) => Number(isPinnedSplit(b.id)) - Number(isPinnedSplit(a.id)))
    .slice(0, compact ? 6 : 8);
  const insights = compact ? payload.insights.slice(0, 3) : payload.insights;
  const matchGrid = compact
    ? 'grid grid-cols-[3.4rem_minmax(0,1fr)_minmax(4.2rem,auto)_1.6rem] gap-x-2'
    : 'grid grid-cols-[3.5rem_minmax(0,1fr)_2.5rem_minmax(0,0.9fr)_minmax(4.8rem,auto)_2.4rem_2.2rem_1.5rem] gap-x-2';

  return (
    <div className="w-full min-h-[160px] space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5">
        <div className="min-w-0 flex flex-wrap items-center gap-2">
          <span className={`text-sm font-semibold tabular-nums ${strong}`}>
            {formWins}-{formLosses}
          </span>
          {streak ? (
            <span
              className={`text-[11px] font-medium ${
                streak.wins
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              {streak.wins ? 'W' : 'L'}
              {streak.count}
            </span>
          ) : null}
          <div className="flex items-center gap-0.5">
            {[...recent].reverse().map((game, idx) => (
              <span
                key={`${game.matchId}-chip-${idx}`}
                title={`${game.isWin ? 'W' : 'L'} vs ${tennisLastName(game.opponent)}`}
                className={`inline-flex h-4 w-4 items-center justify-center rounded-[3px] text-[8px] font-bold leading-none ${
                  game.isWin
                    ? 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                    : 'bg-rose-500/20 text-rose-600 dark:text-rose-400'
                }`}
              >
                {game.isWin ? 'W' : 'L'}
              </span>
            ))}
          </div>
          <span className={`text-[10px] ${muted}`}>
            L{payload.splitWindow} {fmtPct(baseline.winPct, 0)} · {fmtNum(baseline.aces)} aces ·{' '}
            {fmtNum(baseline.totalGames)} games
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {PLAYER_FORM_WINDOWS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setWindowN(n)}
              className={`rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
                windowN === n
                  ? 'border-purple-600 bg-purple-600 text-white'
                  : isDark
                    ? 'border-gray-700 bg-[#071422] text-gray-300 hover:text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:text-gray-900'
              }`}
            >
              L{n}
            </button>
          ))}
        </div>
      </div>

      {insights.length ? (
        <div className={`grid gap-1.5 ${compact ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {insights.map((insight) => (
            <div
              key={insight.id}
              className={`rounded-md border px-2 py-1.5 ${panel} ${
                insight.pinned ? 'border-purple-500/40' : ''
              }`}
            >
              <div className={`text-[10px] font-semibold uppercase tracking-wide ${toneText(insight.tone, isDark)}`}>
                {insight.title}
              </div>
              <div className={`mt-0.5 text-[11px] leading-snug ${strong}`}>{insight.body}</div>
            </div>
          ))}
        </div>
      ) : null}

      <div>
        <div className={`mb-1 flex items-baseline justify-between px-0.5`}>
          <div className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`}>
            Win rate vs rank
          </div>
          <div className={`text-[10px] ${muted}`}>Last {payload.splitWindow}</div>
        </div>
        <div className="space-y-1">
          {rankBands.map((band) => {
            const pct = band.winPct;
            const upcoming =
              payload.opponent?.rank != null &&
              ((band.id === 'top10' && payload.opponent.rank <= 10) ||
                (band.id === 'r11_20' && payload.opponent.rank >= 11 && payload.opponent.rank <= 20) ||
                (band.id === 'r21_50' && payload.opponent.rank >= 21 && payload.opponent.rank <= 50) ||
                (band.id === 'r51_100' && payload.opponent.rank >= 51 && payload.opponent.rank <= 100) ||
                (band.id === 'r100p' && payload.opponent.rank >= 101));
            return (
              <div
                key={band.id}
                className={`grid grid-cols-[4.4rem_minmax(0,1fr)_2.6rem_2.8rem] items-center gap-x-2 px-1 py-0.5 rounded ${
                  upcoming ? 'bg-purple-500/10' : ''
                }`}
              >
                <span className={`text-[11px] font-medium truncate ${upcoming ? strong : muted}`}>
                  {band.label}
                </span>
                <div className={`h-1.5 rounded-full overflow-hidden ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}>
                  <div
                    className={`h-full rounded-full ${winBarClass(pct)}`}
                    style={{
                      width:
                        band.matches && pct != null
                          ? `${Math.max(4, Math.min(100, pct))}%`
                          : '0%',
                    }}
                  />
                </div>
                <span className={`text-[11px] tabular-nums text-right ${strong}`}>
                  {band.matches ? fmtPct(pct, 0) : '—'}
                </span>
                <span className={`text-[10px] tabular-nums text-right ${muted}`}>
                  {band.matches ? `${band.wins}-${band.losses}` : '0'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {styleSplits.length ? (
        <div>
          <div className={`mb-1 text-[10px] font-semibold uppercase tracking-wide px-0.5 ${muted}`}>
            Vs opponent style
          </div>
          <div
            className={`grid ${
              compact
                ? 'grid-cols-[minmax(0,1.3fr)_2.7rem_2.4rem_2.6rem]'
                : 'grid-cols-[minmax(0,1.2fr)_2.8rem_2.6rem_2.6rem_2.8rem_2.8rem]'
            } gap-x-2 px-1 pb-1 border-b ${headBorder}`}
          >
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Split</span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>W-L</span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>Aces</span>
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Games
            </span>
            {compact ? null : (
              <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
                Hold
              </span>
            )}
            {compact ? null : (
              <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
                O22.5
              </span>
            )}
          </div>
          {styleSplits.map((split) => {
            const aceDelta =
              split.aces != null && baseline.aces != null ? split.aces - baseline.aces : null;
            const pinned = isPinnedSplit(split.id);
            return (
              <div
                key={split.id}
                title={split.hint}
                className={`grid ${
                  compact
                    ? 'grid-cols-[minmax(0,1.3fr)_2.7rem_2.4rem_2.6rem]'
                    : 'grid-cols-[minmax(0,1.2fr)_2.8rem_2.6rem_2.6rem_2.8rem_2.8rem]'
                } gap-x-2 items-center px-1 py-1 border-b last:border-0 ${rowBorder} ${
                  pinned ? 'bg-purple-500/10' : ''
                }`}
              >
                <div className="min-w-0">
                  <div className={`text-[11px] font-medium truncate ${strong}`}>{split.label}</div>
                  <div className={`text-[10px] truncate ${muted}`}>{split.hint}</div>
                </div>
                <span className={`text-[11px] tabular-nums text-right ${strong}`}>
                  {split.wins}-{split.losses}
                </span>
                <span className={`text-[11px] tabular-nums text-right ${strong}`}>
                  {fmtNum(split.aces)}
                  {aceDelta != null && Math.abs(aceDelta) >= 0.8 ? (
                    <span
                      className={`ml-0.5 text-[9px] ${
                        aceDelta > 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400'
                      }`}
                    >
                      ({aceDelta > 0 ? '+' : ''}
                      {aceDelta.toFixed(1)})
                    </span>
                  ) : null}
                </span>
                <span className={`text-[11px] tabular-nums text-right ${strong}`}>
                  {fmtNum(split.totalGames)}
                </span>
                {compact ? null : (
                  <span className={`text-[11px] tabular-nums text-right ${muted}`}>
                    {fmtPct(split.holdPct, 0)}
                  </span>
                )}
                {compact ? null : (
                  <span className={`text-[11px] tabular-nums text-right ${muted}`}>
                    {fmtPct(split.over225, 0)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      <div>
        <div className={`${matchGrid} px-1 pb-1.5 mb-0.5 border-b ${headBorder}`}>
          <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Date</span>
          <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Opp</span>
          {compact ? null : (
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Sfc</span>
          )}
          {compact ? null : (
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Event</span>
          )}
          <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted}`}>Score</span>
          {compact ? null : (
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Aces
            </span>
          )}
          {compact ? null : (
            <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
              Gms
            </span>
          )}
          <span className={`text-[10px] uppercase tracking-wide font-semibold ${muted} text-right`}>
            Res
          </span>
        </div>
        {recent.map((game) => {
          const flagUrl = tennisFlagUrl(game.opponentIoc);
          const event =
            game.tourneyName ||
            tennisTourLabel({ tour: game.tour, isGrandSlam: game.isGrandSlam });
          return (
            <div
              key={game.matchId}
              className={`${matchGrid} items-center px-1 py-1.5 border-b last:border-0 ${rowBorder}`}
            >
              <span className={`text-[11px] tabular-nums whitespace-nowrap ${muted}`}>
                {formatMatchDate(game.date, game.round)}
              </span>
              <span className="flex items-center gap-1.5 min-w-0">
                {flagUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={flagUrl}
                    alt=""
                    className="h-[9px] w-[13px] object-cover rounded-[1px] shrink-0"
                  />
                ) : null}
                <span className={`text-xs font-semibold truncate leading-tight ${strong}`}>
                  {tennisLastName(game.opponent)}
                </span>
                {game.opponentRank ? (
                  <span className={`text-[10px] shrink-0 ${muted}`}>#{game.opponentRank}</span>
                ) : null}
              </span>
              {compact ? null : (
                <span className={`text-[11px] truncate ${muted}`}>{surfaceLabel(game.surface)}</span>
              )}
              {compact ? null : <span className={`text-[11px] truncate ${muted}`}>{event}</span>}
              <span className={`text-[11px] tabular-nums whitespace-nowrap ${strong}`}>
                {formatMatchScore(game.score, game.isWin)}
              </span>
              {compact ? null : (
                <span className={`text-[11px] tabular-nums text-right ${muted}`}>
                  {game.aces == null ? '—' : Math.round(game.aces)}
                </span>
              )}
              {compact ? null : (
                <span className={`text-[11px] tabular-nums text-right ${muted}`}>
                  {game.totalGames == null ? '—' : Math.round(game.totalGames)}
                </span>
              )}
              <span
                className={`text-[11px] font-semibold text-right ${
                  game.isWin
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400'
                }`}
              >
                {game.isWin ? 'W' : 'L'}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
