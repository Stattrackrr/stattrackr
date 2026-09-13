'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { tennisLastName, tennisMatchesPlayed } from '@/lib/tennis/chartStats';
import { tennisFlagUrl } from '@/lib/tennis/flags';

const GAMES_PER_PAGE = 10;

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatDate(dateStr: string | null | undefined, fallbackRound?: string | number | null): string {
  const raw = String(dateStr || '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  if (raw) {
    const d = new Date(raw);
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  if (fallbackRound != null && String(fallbackRound).trim() !== '' && String(fallbackRound) !== '—') {
    return String(fallbackRound);
  }
  return '—';
}

function formatStat(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

function formatPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const pct = v <= 1 ? v * 100 : v;
  return `${pct.toFixed(0)}%`;
}

function rate(v: number | null): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v <= 1 ? v : v / 100;
}

function bpReturnChances(game: Record<string, unknown>): number | null {
  const won = toNum(game.breakPointsConverted);
  const pct = rate(toNum(game.breakPointsConvertedPct));
  if (won == null || pct == null || pct <= 0) return null;
  return Math.round(won / pct);
}

function bpGivenUp(game: Record<string, unknown>): number | null {
  const faced = toNum(game.breakPointsFaced);
  const saved = toNum(game.breakPointsSaved);
  if (faced == null || saved == null) return null;
  return Math.max(0, faced - saved);
}

const COLUMNS: Array<{
  key: string;
  label: string;
  title?: string;
  group: string;
  align?: 'left' | 'center';
  sticky?: 'date' | 'opp';
  emphasize?: boolean;
  value: (game: Record<string, unknown>) => string;
}> = [
  {
    key: 'date',
    label: 'Date',
    group: 'match',
    align: 'left',
    sticky: 'date',
    value: (game) => formatDate(game.date ? String(game.date) : null, game.round ? String(game.round) : null),
  },
  {
    key: 'opponent',
    label: 'Opponent',
    group: 'match',
    align: 'left',
    sticky: 'opp',
    value: (game) => tennisLastName(String(game.opponent ?? '')) || '—',
  },
  { key: 'games', label: 'Games', group: 'games', value: (game) => formatStat(toNum(game.totalGames)) },
  { key: 'gamesWon', label: 'Games Won', group: 'games', value: (game) => formatStat(toNum(game.gamesWon)) },
  { key: 'gamesLost', label: 'Games Lost', group: 'games', value: (game) => formatStat(toNum(game.gamesLost)) },
  {
    key: 'fp',
    label: 'FP',
    title: 'First serve points won',
    group: 'games',
    value: (game) => formatStat(toNum(game.firstServesWon)),
  },
  { key: 'bpWon', label: 'BP Won', group: 'break', value: (game) => formatStat(toNum(game.breakPointsConverted)) },
  {
    key: 'bpRet',
    label: 'BP Ret',
    title: 'Break-point chances on return',
    group: 'break',
    value: (game) => formatStat(bpReturnChances(game)),
  },
  { key: 'bpWpct', label: 'BP W%', group: 'break', value: (game) => formatPct(toNum(game.breakPointsConvertedPct)) },
  { key: 'aces', label: 'Aces', group: 'attack', value: (game) => formatStat(toNum(game.aces)) },
  { key: 'df', label: 'DF', group: 'attack', value: (game) => formatStat(toNum(game.doubleFaults)) },
  {
    key: 'points',
    label: 'POINTS',
    group: 'attack',
    emphasize: true,
    value: (game) => formatStat(toNum(game.pointsWon)),
  },
  { key: 'dr', label: 'DR', group: 'attack', value: (game) => formatStat(toNum(game.dominanceRatio), 2) },
  { key: 'setsWon', label: 'Sets Won', group: 'sets', value: (game) => formatStat(toNum(game.setsWon)) },
  { key: 'setsLost', label: 'Sets Lost', group: 'sets', value: (game) => formatStat(toNum(game.setsLost)) },
  { key: 'totalSets', label: 'Total Sets', group: 'sets', value: (game) => formatStat(toNum(game.totalSets)) },
  { key: 'acesAllowed', label: 'Aces Allowed', group: 'defend', value: (game) => formatStat(toNum(game.opponentAces)) },
  {
    key: 'bpServed',
    label: 'BP Served',
    title: 'Break points faced on serve',
    group: 'defend',
    value: (game) => formatStat(toNum(game.breakPointsFaced)),
  },
  { key: 'bpSaved', label: 'BP Saved', group: 'defend', value: (game) => formatStat(toNum(game.breakPointsSaved)) },
  { key: 'bpGivenUp', label: 'BP Given Up', group: 'defend', value: (game) => formatStat(bpGivenUp(game)) },
  { key: 'firstPct', label: '1st Srv %', group: 'pct', value: (game) => formatPct(toNum(game.firstServePct)) },
  { key: 'secondPct', label: '2nd Srv %', group: 'pct', value: (game) => formatPct(toNum(game.secondServeWonPct)) },
  { key: 'retPts', label: 'Ret Pts Won', group: 'pct', value: (game) => formatStat(toNum(game.returnPointsWon)) },
  { key: 'retPtsPct', label: 'Ret Pts W%', group: 'pct', value: (game) => formatPct(toNum(game.returnPointsWonPct)) },
];

const GROUPS: Array<{ id: string; label: string }> = [
  { id: 'match', label: '' },
  { id: 'games', label: 'Games' },
  { id: 'break', label: 'Break points' },
  { id: 'attack', label: 'Attack' },
  { id: 'sets', label: 'Sets' },
  { id: 'defend', label: 'On serve' },
  { id: 'pct', label: 'Percentages' },
];

function stickyClass(sticky?: 'date' | 'opp'): string {
  if (sticky === 'date') return 'sticky left-0 z-20 min-w-[4.5rem]';
  if (sticky === 'opp') return 'sticky left-[4.5rem] z-20 min-w-[7.5rem]';
  return '';
}

function groupStart(key: string): boolean {
  const idx = COLUMNS.findIndex((col) => col.key === key);
  if (idx <= 0) return false;
  return COLUMNS[idx].group !== COLUMNS[idx - 1].group;
}

export const TennisBoxScore = memo(function TennisBoxScore({
  gameLogs,
  isDark,
  selectedPlayer = null,
  isLoading = false,
}: {
  gameLogs: Array<Record<string, unknown>>;
  isDark: boolean;
  selectedPlayer?: { name?: string } | null;
  isLoading?: boolean;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    setCurrentPage(0);
  }, [selectedPlayer?.name, gameLogs]);

  const displayGames = useMemo(() => {
    const rows = tennisMatchesPlayed([...(gameLogs || [])]);
    rows.sort((a, b) => {
      const dateA = a.date ? new Date(String(a.date)).getTime() : 0;
      const dateB = b.date ? new Date(String(b.date)).getTime() : 0;
      return dateB - dateA;
    });
    return rows.slice(0, 50);
  }, [gameLogs]);

  const totalGames = displayGames.length;
  const totalPages = Math.max(1, Math.ceil(totalGames / GAMES_PER_PAGE));
  const startIndex = currentPage * GAMES_PER_PAGE;
  const endIndex = Math.min(startIndex + GAMES_PER_PAGE, totalGames);
  const currentGames = displayGames.slice(startIndex, endIndex);
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1 && totalGames > 0;
  const rangeStart = totalGames ? startIndex + 1 : 0;
  const rangeEnd = totalGames ? endIndex : 0;

  const headBg = isDark ? 'bg-[#0a1929]' : 'bg-white';
  const rowBg = (odd: boolean, win: boolean) => {
    if (win && odd) return isDark ? 'bg-emerald-950/25' : 'bg-emerald-50/70';
    if (win) return isDark ? 'bg-emerald-950/15' : 'bg-emerald-50/40';
    if (odd) return isDark ? 'bg-[#0f1e2d]' : 'bg-slate-50';
    return isDark ? 'bg-[#0a1929]' : 'bg-white';
  };
  const split = isDark ? 'border-l border-white/10' : 'border-l border-gray-200';

  const header = (
    <div className="mb-2 flex items-center justify-between gap-3 px-0.5">
      <h3 className={`text-sm font-semibold ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>Game Log</h3>
      {totalGames > 0 ? (
        <div className="flex items-center gap-2">
          <span className={`text-[11px] tabular-nums ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
            {rangeStart}–{rangeEnd} of {totalGames}
          </span>
          <div className={`flex overflow-hidden rounded-md border ${isDark ? 'border-gray-700' : 'border-gray-200'}`}>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={!canGoPrevious}
              className={`px-1.5 py-1 transition-colors ${
                !canGoPrevious
                  ? 'cursor-not-allowed opacity-35'
                  : isDark
                    ? 'hover:bg-white/5'
                    : 'hover:bg-gray-100'
              }`}
              aria-label="Previous page"
            >
              <svg className="h-3.5 w-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={!canGoNext}
              className={`border-l px-1.5 py-1 transition-colors ${
                isDark ? 'border-gray-700' : 'border-gray-200'
              } ${
                !canGoNext
                  ? 'cursor-not-allowed opacity-35'
                  : isDark
                    ? 'hover:bg-white/5'
                    : 'hover:bg-gray-100'
              }`}
              aria-label="Next page"
            >
              <svg className="h-3.5 w-3.5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );

  if (!selectedPlayer) {
    return (
      <div>
        {header}
        <div className={`py-8 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Select a player to view their recent match logs
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        {header}
        <div className="animate-pulse space-y-1.5">
          <div className={`h-8 rounded ${isDark ? 'bg-white/5' : 'bg-gray-100'}`} />
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className={`h-8 rounded ${isDark ? 'bg-white/[0.04]' : 'bg-gray-50'}`} />
          ))}
        </div>
      </div>
    );
  }

  if (!displayGames.length) {
    return (
      <div>
        {header}
        <div className={`py-8 text-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          No match logs found for this player
        </div>
      </div>
    );
  }

  return (
    <div>
      {header}
      <div className={`relative overflow-hidden rounded-lg border ${isDark ? 'border-white/10' : 'border-gray-200'}`}>
        <div className="overflow-x-auto custom-scrollbar">
          <table className="min-w-max w-full border-separate border-spacing-0 text-[11px]">
            <thead>
              <tr>
                {GROUPS.map((group) => {
                  const span = COLUMNS.filter((col) => col.group === group.id).length;
                  const first = COLUMNS.find((col) => col.group === group.id);
                  return (
                    <th
                      key={group.id}
                      colSpan={span}
                      className={`sticky top-0 z-30 px-2 py-1 text-left text-[9px] font-semibold uppercase tracking-[0.14em] ${
                        isDark ? 'bg-[#10233a] text-gray-500' : 'bg-gray-50 text-gray-400'
                      } ${first && groupStart(first.key) ? split : ''}`}
                    >
                      {group.label || '\u00a0'}
                    </th>
                  );
                })}
              </tr>
              <tr className={headBg}>
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    title={col.title}
                    className={`whitespace-nowrap px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide ${
                      isDark ? 'text-gray-400' : 'text-gray-500'
                    } ${col.align === 'left' ? 'text-left' : 'text-center'} ${stickyClass(col.sticky)} ${
                      col.sticky ? `shadow-[1px_0_3px_-2px_rgba(0,0,0,0.28)] ${headBg}` : ''
                    } ${groupStart(col.key) ? split : ''}`}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentGames.map((game, index) => {
                const win = String(game.result ?? '').toUpperCase().startsWith('W');
                const bg = rowBg(index % 2 === 1, win);
                const flag = tennisFlagUrl(typeof game.opponentIoc === 'string' ? game.opponentIoc : null);
                return (
                  <tr key={`${String(game.matchId ?? '')}-${String(game.date ?? index)}`}>
                    {COLUMNS.map((col) => (
                      <td
                        key={col.key}
                        className={`whitespace-nowrap px-2 py-1.5 ${
                          col.align === 'left' ? 'text-left' : 'text-center tabular-nums'
                        } ${
                          col.emphasize
                            ? isDark
                              ? 'font-semibold text-white'
                              : 'font-semibold text-gray-900'
                            : isDark
                              ? 'text-gray-200'
                              : 'text-gray-800'
                        } ${stickyClass(col.sticky)} ${
                          col.sticky ? `shadow-[1px_0_3px_-2px_rgba(0,0,0,0.28)] ${bg}` : bg
                        } ${groupStart(col.key) ? split : ''}`}
                      >
                        {col.key === 'opponent' ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className={`inline-flex h-4 min-w-[1.1rem] items-center justify-center rounded px-1 text-[9px] font-bold ${
                                win
                                  ? 'bg-emerald-500/15 text-emerald-500'
                                  : 'bg-rose-500/15 text-rose-500'
                              }`}
                            >
                              {win ? 'W' : 'L'}
                            </span>
                            {flag ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={flag}
                                alt=""
                                className="h-3 w-[16px] rounded-[2px] object-cover ring-1 ring-black/15"
                              />
                            ) : null}
                            <span className="font-medium">{col.value(game)}</span>
                          </span>
                        ) : (
                          col.value(game)
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div
          className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l ${
            isDark ? 'from-[#0a1929]' : 'from-white'
          }`}
        />
      </div>
    </div>
  );
});
