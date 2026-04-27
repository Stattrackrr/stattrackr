'use client';

import { useEffect, useState } from 'react';
import type { TeamMatchupApiResponse } from '@/app/api/soccer/team-matchup/route';

type SoccerTeamMatchupCardProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  emptyTextClass: string;
};

function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function getTeamRankColor(rank: number | null, isDark: boolean): string {
  if (!rank || rank <= 0) return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
  if (rank <= 7) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
  if (rank <= 14) return 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
}

function getOpponentRankColor(rank: number | null, isDark: boolean): string {
  if (!rank || rank <= 0) return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
  if (rank <= 7) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
  if (rank <= 14) return 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200';
  return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
}

export function SoccerTeamMatchupCard({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  nextCompetitionName,
  nextCompetitionCountry,
  emptyTextClass,
}: SoccerTeamMatchupCardProps) {
  const [data, setData] = useState<TeamMatchupApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canFetch = Boolean(nextCompetitionName && (teamName?.trim() || teamHref) && (opponentName?.trim() || opponentHref));

  useEffect(() => {
    if (!canFetch || !nextCompetitionName) {
      setData(null);
      setError(null);
      return;
    }

    const params = new URLSearchParams();
    params.set('competitionName', nextCompetitionName);
    if (nextCompetitionCountry?.trim()) params.set('competitionCountry', nextCompetitionCountry.trim());
    if (teamName?.trim()) params.set('teamName', teamName.trim());
    if (teamHref?.trim()) params.set('teamHref', teamHref.trim());
    if (opponentName?.trim()) params.set('opponentName', opponentName.trim());
    if (opponentHref?.trim()) params.set('opponentHref', opponentHref.trim());

    let cancelled = false;
    setLoading(true);
    setError(null);

    void fetch(`/api/soccer/team-matchup?${params.toString()}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = (await response.json().catch(() => null)) as TeamMatchupApiResponse | { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload && 'error' in payload ? String(payload.error) : 'Failed to load team matchup');
        }
        return payload as TeamMatchupApiResponse;
      })
      .then((payload) => {
        if (cancelled) return;
        setData(payload);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Failed to load team matchup');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [canFetch, nextCompetitionCountry, nextCompetitionName, opponentHref, opponentName, teamHref, teamName]);

  if (!canFetch) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-center gap-2 mt-1 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-center gap-2 mt-1 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="flex items-center justify-center gap-2 mb-3">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
            <div className={`h-4 w-36 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          </div>
          <div className="space-y-2">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className={`h-16 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="flex items-center justify-center gap-2 mt-1 mb-3 flex-shrink-0">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        </div>
        <div className={`rounded-lg border p-3 flex-1 min-h-0 flex items-center ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  const rows = data?.rows ?? [];

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-center gap-2 mt-1 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
      </div>
      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center justify-center gap-2 mb-1 text-center">
          <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
          <h4 className={`text-sm font-mono font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {data?.team?.name ?? teamName} vs {data?.opponent?.name ?? opponentName}
          </h4>
        </div>
        <div className={`mb-3 text-center text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {data?.competitionLabel ?? nextCompetitionName}
        </div>

        {rows.length === 0 ? (
          <div className={`text-sm py-4 ${emptyTextClass}`}>No data available come back later</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 custom-scrollbar">
            {rows.map((row: TeamMatchupApiResponse['rows'][number]) => (
              <div
                key={row.id}
                className={`rounded border px-3 py-2 ${isDark ? 'border-gray-600/60' : 'border-gray-200/80'}`}
              >
                <div className={`mb-2 text-[11px] font-semibold uppercase tracking-wide ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                  {row.label}
                </div>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                  <div className="min-w-0">
                    <div className={`truncate text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {data?.team?.name ?? teamName}
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatValue(row.teamValue)} per match
                    </div>
                  </div>
                  <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${getTeamRankColor(row.teamRank, isDark)}`}>
                    #{row.teamRank ?? '—'}
                  </span>
                  <div className="min-w-0 text-right">
                    <div className={`truncate text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                      {data?.opponent?.name ?? opponentName}
                    </div>
                    <div className={`text-xs ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {formatValue(row.opponentValue)} conceded
                    </div>
                  </div>
                </div>
                <div className="mt-2 flex justify-end">
                  <span className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${getOpponentRankColor(row.opponentRank, isDark)}`}>
                    #{row.opponentRank ?? '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
