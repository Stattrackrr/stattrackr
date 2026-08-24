'use client';

import { useEffect, useState } from 'react';
import { tennisLastName } from '@/lib/tennis/chartStats';

type RankRow = { pos: number | null; team: string; teamCode?: string | null };

export function TennisSimilarPlayersCard({
  isDark = false,
  playerName = null,
  tour = 'ATP',
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerId?: string | null;
  playerName?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  tour?: 'ATP' | 'WTA';
}) {
  const [rows, setRows] = useState<RankRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tennis/rankings?tour=${tour}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        const teams: RankRow[] = Array.isArray(json?.teams) ? json.teams : [];
        const idx = teams.findIndex(
          (row) => String(row.team || '').toLowerCase() === String(playerName || '').toLowerCase()
        );
        const start = idx >= 0 ? Math.max(0, idx - 3) : 0;
        setRows(teams.slice(start, start + 8));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tour, playerName]);

  if (!playerName) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a player
      </div>
    );
  }

  if (loading && !rows.length) {
    return (
      <div className={`min-h-[160px] flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Loading similar players…
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <table className="w-full text-xs">
        <thead>
          <tr className={isDark ? 'text-gray-300' : 'text-gray-700'}>
            <th className="px-2 py-2 text-left font-semibold">#</th>
            <th className="px-2 py-2 text-left font-semibold">Player</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const active = String(row.team || '').toLowerCase() === String(playerName || '').toLowerCase();
            return (
              <tr
                key={`${row.pos}-${row.team}`}
                className={
                  active
                    ? 'bg-purple-100 dark:bg-purple-900/40'
                    : isDark
                      ? 'odd:bg-[#0a1929] even:bg-[#0f172a]/40'
                      : 'odd:bg-white even:bg-gray-50'
                }
              >
                <td className="px-2 py-1.5 text-gray-500">{row.pos ?? '—'}</td>
                <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white">
                  {tennisLastName(row.team)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
