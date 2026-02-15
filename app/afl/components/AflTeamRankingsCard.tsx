'use client';

import { useState, useEffect } from 'react';

const DISPLAY_STATS = ['D', 'K', 'HB', 'M', 'G', 'T', 'CL', 'I50', 'R50'] as const;
const STAT_LABELS: Record<string, string> = {
  D: 'Disposals', K: 'Kicks', HB: 'Handballs', M: 'Marks', G: 'Goals',
  T: 'Tackles', CL: 'Clearances', I50: 'Inside 50s', R50: 'Rebound 50s',
};

type TeamRow = {
  rank: number | null;
  team: string;
  stats: Record<string, number | string | null>;
};

type RankingsData = {
  season: number;
  teams: TeamRow[];
  statLabels?: Record<string, string>;
};

export function AflTeamRankingsCard({ isDark, season }: { isDark: boolean; season: number }) {
  const [data, setData] = useState<RankingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/afl/team-rankings?season=${season}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData({
          season: json.season ?? season,
          teams: json.teams ?? [],
          statLabels: json.statLabels ?? STAT_LABELS,
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError('Failed to load team rankings');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [season]);

  const fmt = (v: number | string | null | undefined): string => {
    if (v == null) return '—';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '—';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-sm text-gray-500 dark:text-gray-400">
        Loading team rankings…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  const teams = data.teams;
  if (!teams.length) {
    return (
      <div className="flex items-center justify-center min-h-[200px] text-sm text-gray-500 dark:text-gray-400">
        No team rankings available
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Rankings</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">{data.season} season</span>
      </div>
      <div
        className={`rounded-lg border overflow-x-auto overflow-y-auto max-h-[320px] custom-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <table className="w-full text-xs min-w-[400px]">
          <thead className="sticky top-0 z-10">
            <tr className={isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}>
              <th className="px-2 py-1.5 text-left font-semibold w-8">Rk</th>
              <th className="px-2 py-1.5 text-left font-semibold">Team</th>
              {DISPLAY_STATS.map((k) => (
                <th key={k} className="px-1.5 py-1.5 text-center font-semibold" title={STAT_LABELS[k] ?? k}>
                  {k}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {teams.map((row, idx) => (
              <tr
                key={row.team + idx}
                className={
                  idx % 2 === 0
                    ? isDark
                      ? 'bg-[#0a1929]'
                      : 'bg-white'
                    : isDark
                      ? 'bg-[#0f172a]/50'
                      : 'bg-gray-50'
                }
              >
                <td className="px-2 py-1.5 text-gray-500 dark:text-gray-400 font-medium">
                  {row.rank ?? '—'}
                </td>
                <td className="px-2 py-1.5 font-medium text-gray-900 dark:text-white whitespace-nowrap">
                  {row.team}
                </td>
                {DISPLAY_STATS.map((k) => (
                  <td key={k} className="px-1.5 py-1.5 text-center text-gray-700 dark:text-gray-300">
                    {fmt(row.stats?.[k])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
