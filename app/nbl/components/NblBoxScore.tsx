'use client';

import { memo, useEffect, useMemo, useState } from 'react';
import type { NblGameLogRow } from '@/lib/nbl/rosettaTypes';
import { NBL_CLUBS, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

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
  if (dateStr) {
    const d = new Date(dateStr);
    if (Number.isFinite(d.getTime())) {
      return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
    }
  }
  if (fallbackRound != null && String(fallbackRound).trim() !== '' && String(fallbackRound) !== '—') {
    return `R${fallbackRound}`;
  }
  return '—';
}

function formatPct(pct: number | null, made: number | null, attempted: number | null): string {
  if (pct != null && Number.isFinite(pct)) {
    const value = pct <= 1 ? pct * 100 : pct;
    return `${value.toFixed(1)}%`;
  }
  if (made != null && attempted != null && attempted > 0) {
    return `${((made / attempted) * 100).toFixed(1)}%`;
  }
  return '—';
}

function formatStat(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return digits > 0 ? v.toFixed(digits) : String(Math.round(v));
}

function teamAbbrev(teamName: string | null | undefined, teamCode?: string | null): string {
  if (teamCode && String(teamCode).trim()) return String(teamCode).trim().toUpperCase();
  if (!teamName) return '—';
  const club = NBL_CLUBS.find(
    (c) =>
      c.name === teamName ||
      normalizeTeamKey(c.name) === normalizeTeamKey(teamName) ||
      c.code === teamName.toUpperCase() ||
      normalizeTeamKey(c.shortName) === normalizeTeamKey(teamName)
  );
  return club?.code ?? resolveNblClubName(teamName)?.slice(0, 3).toUpperCase() ?? teamName.slice(0, 3).toUpperCase();
}

function TeamCell({
  name,
  code,
  logoUrl,
}: {
  name: string;
  code?: string | null;
  logoUrl: string | null;
}) {
  const abbr = teamAbbrev(name, code);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className="w-4 h-4 object-contain flex-shrink-0" />
      ) : null}
      <span className="truncate">{abbr}</span>
    </span>
  );
}

export const NblBoxScore = memo(function NblBoxScore({
  gameLogs,
  isDark,
  selectedPlayer = null,
  isLoading = false,
  resolveTeamLogo,
}: {
  gameLogs: NblGameLogRow[];
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
    const rows = [...(gameLogs || [])].filter((g) => (toNum(g.minutes) ?? 0) > 0);
    rows.sort((a, b) => {
      const dateA = a.date ? new Date(a.date).getTime() : 0;
      const dateB = b.date ? new Date(b.date).getTime() : 0;
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
            Select a player to view their recent game logs
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
    );
  }

  if (!displayGames.length) {
    return (
      <div className={shellClass}>
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
    <div className={shellClass}>
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
              {[
                'DATE',
                'TM',
                'OPP',
                'MIN',
                'PTS',
                'REB',
                'AST',
                'STL',
                'BLK',
                'FGM',
                'FGA',
                'FG%',
                '3PM',
                '3PA',
                '3P%',
                'FTM',
                'FTA',
                'TO',
                'PF',
              ].map((label) => (
                <th
                  key={label}
                  className={`py-2 px-2 font-semibold text-gray-700 dark:text-gray-300 ${
                    label === 'DATE' || label === 'TM' || label === 'OPP' ? 'text-left' : 'text-center'
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {currentGames.map((game, index) => {
              const teamLogo = resolveTeamLogo?.(game.team) ?? null;
              const oppLogo = resolveTeamLogo?.(game.opponent) ?? null;
              const ha = game.isHome ? 'vs' : '@';
              return (
                <tr
                  key={`${game.matchId}-${game.date ?? index}`}
                  className={`border-b ${isDark ? 'border-slate-700' : 'border-slate-200'}`}
                >
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100 whitespace-nowrap">
                    {formatDate(game.date, game.round)}
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100">
                    <TeamCell name={game.team} code={game.teamCode} logoUrl={teamLogo} />
                  </td>
                  <td className="py-2 px-2 text-gray-900 dark:text-gray-100">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-gray-500 dark:text-gray-400">{ha}</span>
                      <TeamCell name={game.opponent} code={game.opponentCode} logoUrl={oppLogo} />
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.minutes, 1)}
                  </td>
                  <td className="py-2 px-2 text-center font-semibold text-gray-900 dark:text-white">
                    {formatStat(game.points)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.rebounds)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.assists)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.steals)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.blocks)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.fgMade)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.fgAttempted)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatPct(game.fgPct, game.fgMade, game.fgAttempted)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.threeMade)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.threeAttempted)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatPct(game.threePct, game.threeMade, game.threeAttempted)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.ftMade)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.ftAttempted)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.turnovers)}
                  </td>
                  <td className="py-2 px-2 text-center text-gray-900 dark:text-gray-100">
                    {formatStat(game.fouls)}
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
