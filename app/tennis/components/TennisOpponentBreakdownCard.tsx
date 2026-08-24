'use client';

import { useMemo } from 'react';
import { tennisLastName, TENNIS_STAT_LABELS } from '@/lib/tennis/chartStats';

const STATS: Array<{ key: string; label: string; pct?: boolean }> = [
  { key: 'aces', label: TENNIS_STAT_LABELS.aces },
  { key: 'doubleFaults', label: TENNIS_STAT_LABELS.doubleFaults },
  { key: 'gamesWon', label: TENNIS_STAT_LABELS.gamesWon },
  { key: 'totalGames', label: TENNIS_STAT_LABELS.totalGames },
  { key: 'pointsWon', label: TENNIS_STAT_LABELS.pointsWon },
  { key: 'returnPointsWon', label: TENNIS_STAT_LABELS.returnPointsWon },
  { key: 'firstServePct', label: TENNIS_STAT_LABELS.firstServePct, pct: true },
  { key: 'breakPointsConverted', label: TENNIS_STAT_LABELS.breakPointsConverted },
];

function toNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

function avg(rows: Array<Record<string, unknown>>, key: string, pct?: boolean): string {
  const vals = rows.map((r) => toNum(r[key])).filter((n): n is number => n != null);
  if (!vals.length) return '—';
  const mean = vals.reduce((s, n) => s + n, 0) / vals.length;
  if (pct) {
    const scaled = mean <= 1 ? mean * 100 : mean;
    return `${scaled.toFixed(1)}%`;
  }
  return mean.toFixed(1);
}

export default function TennisOpponentBreakdownCard({
  isDark = false,
  playerName = null,
  lastOpponent = null,
  gameLogs = [],
}: {
  isDark?: boolean;
  playerName?: string | null;
  lastOpponent?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
}) {
  const opponent = String(lastOpponent || '').trim();
  const h2h = useMemo(() => {
    if (!opponent) return [];
    return (gameLogs || []).filter((g) => String(g.opponent || '').trim() === opponent);
  }, [gameLogs, opponent]);

  const wins = h2h.filter((g) => String(g.result || '').toUpperCase().startsWith('W')).length;

  if (!opponent) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a player to see opponent breakdown
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          vs {tennisLastName(opponent)}
        </h3>
        <span className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {h2h.length ? `${wins}-${h2h.length - wins} · ${h2h.length} matches` : 'No H2H'}
        </span>
      </div>
      {!h2h.length ? (
        <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          No completed matches vs {tennisLastName(opponent)}
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <table className="w-full text-xs">
            <thead className="sticky top-0">
              <tr className={isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}>
                <th className="px-2 py-2 text-left font-semibold">Stat</th>
                <th className="px-2 py-2 text-center font-semibold">
                  {playerName ? tennisLastName(playerName) : 'Avg'}
                </th>
              </tr>
            </thead>
            <tbody>
              {STATS.map((stat) => (
                <tr
                  key={stat.key}
                  className={isDark ? 'odd:bg-[#0a1929] even:bg-[#0f172a]/40' : 'odd:bg-white even:bg-gray-50'}
                >
                  <td className="px-2 py-1.5 text-gray-600 dark:text-gray-300">{stat.label}</td>
                  <td className="px-2 py-1.5 text-center font-medium text-gray-900 dark:text-white">
                    {avg(h2h, stat.key, stat.pct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
