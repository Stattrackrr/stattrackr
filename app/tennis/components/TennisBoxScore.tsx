'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import { isUnplayedTennisMatch, tennisLastName, tennisTourLabel } from '@/lib/tennis/chartStats';

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
    const rows = [...(gameLogs || [])].filter((g) => !isUnplayedTennisMatch(g.score));
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

  const shellClass =
    'bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 pb-4 xl:pb-5 border border-gray-200 dark:border-gray-700';

  if (!selectedPlayer) {
    return (
      <div className={shellClass}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="flex items-center justify-center py-6">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            Select a player to view their recent match logs
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className={shellClass}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="overflow-x-auto">
          <div className="min-w-full animate-pulse">
            <div className={`${isDark ? 'bg-[#0a1929]' : 'bg-slate-100'} h-10 mb-2 rounded`} />
            {[...Array(5)].map((_, idx) => (
              <div
                key={idx}
                className={`${isDark ? 'border-slate-700' : 'border-slate-200'} border-b h-12 mb-1`}
              >
                <div className="flex gap-2 h-full items-center px-2">
                  <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded flex-1`} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!displayGames.length) {
    return (
      <div className={shellClass}>
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="flex items-center justify-center py-6">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            No match logs found for this player
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClass}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Game Log</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Matches {rangeStart}-{rangeEnd} of {totalGames}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((p) => p - 1)}
              disabled={!canGoPrevious}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoPrevious ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              aria-label="Previous page"
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setCurrentPage((p) => p + 1)}
              disabled={!canGoNext}
              className={`p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors ${
                !canGoNext ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'
              }`}
              aria-label="Next page"
            >
              <svg className="w-4 h-4 text-gray-600 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-xs">
          <thead>
            <tr className={isDark ? 'bg-[#0a1929]' : 'bg-slate-100'}>
              {['DATE', 'TOUR', 'OPP', 'RES', 'SCORE', 'ACE', 'DF', 'GMS', 'PTS', 'RETURN', '1ST SV%', 'BP'].map(
                (label) => (
                  <th
                    key={label}
                    className={`py-2 px-2 font-semibold text-gray-700 dark:text-gray-300 ${
                      label === 'DATE' || label === 'TOUR' || label === 'OPP' || label === 'SCORE'
                        ? 'text-left'
                        : 'text-center'
                    }`}
                  >
                    {label}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {currentGames.map((game, index) => {
              const result = String(game.result ?? '');
              const win = result.toUpperCase().startsWith('W');
              return (
                <tr
                  key={`${String(game.matchId ?? '')}-${String(game.date ?? index)}`}
                  className={`border-b ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
                >
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {formatDate(game.date ? String(game.date) : null, game.round ? String(game.round) : null)}
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {tennisTourLabel({
                      tour: game.tour ? String(game.tour) : null,
                      isGrandSlam: Boolean(game.isGrandSlam),
                    })}
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {tennisLastName(String(game.opponent ?? ''))}
                  </td>
                  <td
                    className={`py-2 px-2 text-center font-semibold ${
                      win ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
                    }`}
                  >
                    {result || '—'}
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {String(game.score ?? '—')}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(toNum(game.aces))}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(toNum(game.doubleFaults))}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(toNum(game.gamesWon))}
                  </td>
                  <td className="py-2 px-2 text-center font-semibold text-gray-900 dark:text-white">
                    {formatStat(toNum(game.pointsWon))}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(toNum(game.returnPointsWon))}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatPct(toNum(game.firstServePct))}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(toNum(game.breakPointsConverted))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
