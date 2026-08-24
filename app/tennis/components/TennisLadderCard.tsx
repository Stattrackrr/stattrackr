'use client';

import { useEffect, useState } from 'react';
import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';
import { tennisLastName } from '@/lib/tennis/chartStats';

type RankingRow = {
  pos: number | null;
  team: string;
  teamCode?: string | null;
  points_for: number | null;
  tour?: string;
};

type RankingsData = {
  year?: number;
  seasonLabel?: string;
  teams: RankingRow[];
};

function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  return String(Math.round(v));
}

export function TennisLadderCard({
  isDark = false,
  tour = 'ATP',
}: {
  isDark?: boolean;
  tour?: 'ATP' | 'WTA';
}) {
  const [data, setData] = useState<RankingsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchJsonDeduped<{
      error?: string;
      year?: number;
      seasonLabel?: string;
      teams?: RankingRow[];
    }>(`/api/tennis/rankings?tour=${tour}`)
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData({
          year: json.year,
          seasonLabel: json.seasonLabel,
          teams: json.teams ?? [],
        });
        setError(null);
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load rankings');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tour]);

  const teams = data?.teams ?? [];

  if (loading && teams.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        Loading rankings…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  if (!teams.length) {
    return (
      <div className="flex items-center justify-center min-h-[160px] text-sm text-gray-500 dark:text-gray-400">
        No rankings data
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Rankings</h3>
        {data.seasonLabel ? (
          <span className={`text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            {data.seasonLabel}
          </span>
        ) : null}
      </div>
      <div
        className={`rounded-lg border overflow-x-hidden overflow-y-auto max-h-[520px] min-h-[320px] pb-3 custom-scrollbar ${
          isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'
        }`}
      >
        <table className="w-full text-xs min-w-[220px] table-fixed">
          <thead className="sticky top-0 z-10">
            <tr className={`min-h-[40px] ${isDark ? 'bg-[#0f172a] text-gray-300' : 'bg-gray-100 text-gray-700'}`}>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-8">#</th>
              <th className="px-2 py-2.5 text-left align-middle font-semibold">Player</th>
              <th className="px-1.5 py-2.5 text-center align-middle font-semibold w-16" title="Ranking points">
                Pts
              </th>
            </tr>
          </thead>
          <tbody>
            {teams.map((row, idx) => (
              <tr
                key={`${row.team}-${row.pos}`}
                className={`h-9 ${
                  idx % 2 === 0
                    ? isDark
                      ? 'bg-[#0a1929]'
                      : 'bg-white'
                    : isDark
                      ? 'bg-[#0f172a]/50'
                      : 'bg-gray-50'
                }`}
              >
                <td className="px-1.5 py-0 text-center align-middle text-gray-500 dark:text-gray-400 font-medium h-9">
                  {row.pos ?? idx + 1}
                </td>
                <td className="px-2 py-0 align-middle font-medium text-gray-900 dark:text-white whitespace-nowrap h-9">
                  <div className="flex items-center gap-1.5 h-7 overflow-hidden">
                    <span className="leading-none truncate">{tennisLastName(row.team)}</span>
                    {row.teamCode ? (
                      <span className={`text-[10px] font-semibold ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                        {row.teamCode}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="px-1.5 py-0 text-center align-middle text-gray-700 dark:text-gray-300 h-9">
                  {fmtInt(row.points_for)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
