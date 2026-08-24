'use client';

import { tennisLastName, tennisTourLabel } from '@/lib/tennis/chartStats';

export function TennisTeamSelectionsCard({
  isDark = false,
  playerTeam = null,
  opponentTeam = null,
  selectedPlayerName = null,
  gameLogs = [],
}: {
  isDark?: boolean;
  playerTeam?: string | null;
  opponentTeam?: string | null;
  selectedPlayerName?: string | null;
  resolveTeamLogo?: (name: string) => string | null;
  gameLogs?: Array<Record<string, unknown>>;
}) {
  const last = gameLogs.length ? gameLogs[gameLogs.length - 1] : null;
  const opponent = String(last?.opponent || opponentTeam || '').trim();
  const score = last?.score ? String(last.score) : '—';
  const result = String(last?.result || '');
  const tourney = last?.tourneyName ? String(last.tourneyName) : '';
  const round = last?.round ? String(last.round) : '';
  const tour = tennisTourLabel({
    tour: last?.tour ? String(last.tour) : playerTeam,
    isGrandSlam: Boolean(last?.isGrandSlam),
  });

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-3">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>Last match</h3>
        {tourney ? (
          <span className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {tour} · {tourney}
            {round ? ` · ${round}` : ''}
          </span>
        ) : null}
      </div>
      {!selectedPlayerName?.trim() ? (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          Select a player to see their most recent completed match.
        </p>
      ) : !last ? (
        <p className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>No completed matches yet.</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 items-start">
          <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-[#0f172a]/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`text-[11px] mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Player</div>
            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {tennisLastName(selectedPlayerName)}
            </div>
            <div
              className={`mt-1 text-xs font-semibold ${
                result.toUpperCase().startsWith('W')
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-red-600 dark:text-red-400'
              }`}
            >
              {result || '—'}
            </div>
          </div>
          <div className={`rounded-lg border px-3 py-3 ${isDark ? 'border-gray-700 bg-[#0f172a]/50' : 'border-gray-200 bg-gray-50'}`}>
            <div className={`text-[11px] mb-1 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Opponent</div>
            <div className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {tennisLastName(opponent || '—')}
            </div>
            <div className={`mt-1 text-xs ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>{score}</div>
          </div>
        </div>
      )}
    </div>
  );
}
