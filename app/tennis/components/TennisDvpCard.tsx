'use client';

import { useEffect, useState } from 'react';
import { tennisLastName, TENNIS_STAT_LABELS } from '@/lib/tennis/chartStats';

type DvpRow = {
  rank: number;
  opponent: string;
  value: number;
  matches: number;
};

export default function TennisDvpCard({
  isDark = false,
  opponentName = null,
  selectedStat = 'aces',
  tour = 'ATP',
}: {
  isDark?: boolean;
  season?: number;
  playerId?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  resolveTeamLogo?: (teamName: string) => string | null;
  tour?: 'ATP' | 'WTA';
}) {
  const [rows, setRows] = useState<DvpRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const stat = selectedStat && TENNIS_STAT_LABELS[selectedStat] ? selectedStat : 'aces';
  const highlight = String(opponentName || '').trim().toLowerCase();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/tennis/dvp?tour=${tour}&stat=${encodeURIComponent(stat)}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load DVP');
        return json as { rows?: DvpRow[] };
      })
      .then((json) => {
        if (!cancelled) {
          setRows(Array.isArray(json.rows) ? json.rows : []);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
          setRows([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tour, stat]);

  const label = TENNIS_STAT_LABELS[stat] || stat.toUpperCase();

  if (loading && !rows.length) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Loading DVP…
      </div>
    );
  }

  if (error) {
    return (
      <div className={`flex-1 flex items-center justify-center text-sm ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>
        {error}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between mb-2 flex-shrink-0">
        <h3 className={`text-sm font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
          DVP · {label}
        </h3>
        <span className={`text-[11px] ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{tour}</span>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
        <table className="w-full text-xs">
          <thead className="sticky top-0">
            <tr className={isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}>
              <th className="px-2 py-2 text-left font-semibold">#</th>
              <th className="px-2 py-2 text-left font-semibold">Opponent</th>
              <th className="px-2 py-2 text-center font-semibold">{label}</th>
              <th className="px-2 py-2 text-center font-semibold">M</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isOpp =
                highlight &&
                (row.opponent.toLowerCase() === highlight ||
                  tennisLastName(row.opponent).toLowerCase() === highlight);
              return (
                <tr
                  key={`${row.rank}-${row.opponent}`}
                  className={`${
                    isOpp
                      ? 'bg-purple-100 dark:bg-purple-900/40'
                      : isDark
                        ? 'odd:bg-[#0a1929] even:bg-[#0f172a]/40'
                        : 'odd:bg-white even:bg-gray-50'
                  }`}
                >
                  <td className="px-2 py-1.5 text-gray-500">{row.rank}</td>
                  <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white">
                    {tennisLastName(row.opponent)}
                  </td>
                  <td className="px-2 py-1.5 text-center">{row.value}</td>
                  <td className="px-2 py-1.5 text-center text-gray-500">{row.matches}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className={`mt-2 text-[10px] leading-snug ${isDark ? 'text-slate-500' : 'text-slate-500'}`}>
        Rank #1 = stingiest (opponents post the fewest {label.toLowerCase()} when losing to them).
      </p>
    </div>
  );
}
