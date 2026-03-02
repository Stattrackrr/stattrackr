'use client';

import { memo, useState, useEffect } from 'react';

function toNum(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatDate(dateStr: string | undefined, fallbackRound?: string, fallbackSeason?: number): string {
  if (dateStr) {
    const d = new Date(dateStr);
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  if (fallbackRound && fallbackRound !== '—') {
    return fallbackSeason ? `${fallbackRound} · ${fallbackSeason}` : fallbackRound;
  }
  return '—';
}

const GAMES_PER_PAGE = 10;

export const AflBoxScore = memo(function AflBoxScore({
  gameLogs,
  isDark,
  selectedPlayer = null,
  isLoading = false,
  resolveTeamLogo,
}: {
  gameLogs: Array<Record<string, unknown>>;
  isDark: boolean;
  selectedPlayer?: { name?: string } | null;
  isLoading?: boolean;
  /** Resolve team name to logo URL for display next to opponent in game log */
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [currentPage, setCurrentPage] = useState(0);

  useEffect(() => {
    setCurrentPage(0);
  }, [gameLogs]);

  const sorted = [...(gameLogs || [])].sort((a, b) => {
    const dateA = (a.date as string) || '';
    const dateB = (b.date as string) || '';
    if (dateA && dateB) return new Date(dateB).getTime() - new Date(dateA).getTime();
    return 0;
  });
  const displayGames = sorted.slice(0, 50);
  const totalGames = displayGames.length;
  const totalPages = Math.ceil(totalGames / GAMES_PER_PAGE);
  const startIndex = currentPage * GAMES_PER_PAGE;
  const endIndex = Math.min(startIndex + GAMES_PER_PAGE, totalGames);
  const currentGames = displayGames.slice(startIndex, endIndex);
  const canGoPrevious = currentPage > 0;
  const canGoNext = currentPage < totalPages - 1;
  const rangeStart = totalGames ? startIndex + 1 : 0;
  const rangeEnd = totalGames ? endIndex : 0;

  // No player selected: prompt to select
  if (!selectedPlayer) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 pb-4 xl:pb-5 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="flex items-center justify-center py-6">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            Select a player to view their game log
          </div>
        </div>
      </div>
    );
  }

  // Player selected, data loading: skeleton (same pattern as NBA PlayerBoxScore)
  if (isLoading) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 pb-4 xl:pb-5 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="overflow-x-auto">
          <div className="min-w-full">
            <div className="animate-pulse">
              <div className={`${isDark ? 'bg-[#0a1929]' : 'bg-slate-100'} h-10 mb-2 rounded`} />
              {[...Array(5)].map((_, idx) => (
                <div key={idx} className={`${isDark ? 'border-slate-700' : 'border-slate-200'} border-b h-12 mb-1`}>
                  <div className="flex gap-2 h-full items-center px-2">
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded flex-1`} />
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`} />
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`} />
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`} />
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`} />
                    <div className={`h-4 ${isDark ? 'bg-gray-700' : 'bg-gray-200'} rounded w-12`} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Player selected, loaded but no games
  if (!gameLogs?.length) {
    return (
      <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 pb-4 xl:pb-5 border border-gray-200 dark:border-gray-700">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Game Log</h3>
        <div className="flex items-center justify-center py-6">
          <div className="text-center text-gray-500 dark:text-gray-400 text-sm">
            No game logs found for this player
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-2 xl:p-3 pb-4 xl:pb-5 border border-gray-200 dark:border-gray-700">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Game Log</h3>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 dark:text-gray-400">
            Games {rangeStart}-{rangeEnd} of {totalGames}
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
              <th className="text-left py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">DATE</th>
              <th className="text-left py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">OPP</th>
              <th className="text-left py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">RND</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">RESULT</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">D</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">K</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">HB</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">M</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">G</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">B</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">T</th>
              <th className="text-center py-1.5 px-2 font-semibold text-gray-700 dark:text-gray-300">CL</th>
            </tr>
          </thead>
          <tbody>
            {currentGames.map((game, index) => {
              const opp = String(game.opponent ?? '').trim() || '—';
              const round = String(game.round ?? '').trim() || '—';
              const result = String(game.result ?? '').trim() || '—';
              const date = game.date as string | undefined;
              return (
                <tr
                  key={`${date ?? index}-${opp}`}
                  className={isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}
                >
                  <td className="py-1.5 px-2 text-gray-900 dark:text-white font-medium">{formatDate(date, round, toNum(game.season) ?? undefined)}</td>
                  <td className="py-1.5 px-2 text-gray-900 dark:text-white">
                    <div className="flex items-center gap-1.5">
                      {resolveTeamLogo?.(opp) ? (
                        <img
                          src={resolveTeamLogo(opp)!}
                          alt=""
                          className="w-5 h-5 object-contain flex-shrink-0"
                        />
                      ) : null}
                      <span>{opp}</span>
                    </div>
                  </td>
                  <td className="py-1.5 px-2 text-gray-700 dark:text-gray-300">{round}</td>
                  <td className="py-1.5 px-2 text-center text-gray-700 dark:text-gray-300">{result}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white font-medium">{toNum(game.disposals) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.kicks) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.handballs) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.marks) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white font-medium">{toNum(game.goals) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.behinds) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.tackles) ?? '—'}</td>
                  <td className="py-1.5 px-2 text-center text-gray-900 dark:text-white">{toNum(game.clearances) ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
});
