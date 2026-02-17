'use client';

import { useState, useEffect } from 'react';
import { opponentToFootywireTeam } from '@/lib/aflTeamMapping';

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

type OAData = {
  season: number;
  teams: TeamRow[];
};

export interface AflOpponentBreakdownCardProps {
  isDark: boolean;
  season: number;
  playerName: string | null;
  /** Opponent from game logs (e.g. "Essendon", "Geelong") */
  lastOpponent: string | null;
}

/**
 * Opponent Breakdown: "Bailey Smith vs Bombers" with Bombers' Opponent Averages
 * (what they allow - disposals against, kicks against, etc.).
 * Higher OA rank = allow more = easier matchup (green). Lower rank = tougher (red).
 */
export function AflOpponentBreakdownCard({
  isDark,
  season,
  playerName,
  lastOpponent,
}: AflOpponentBreakdownCardProps) {
  const [oaData, setOaData] = useState<OAData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const footywireTeam = lastOpponent ? opponentToFootywireTeam(lastOpponent) : null;
  const teamRow = (footywireTeam && oaData?.teams?.find((t) => t.team === footywireTeam)) ?? null;

  /** Defence rank: 1 = hardest (allow least), 18 = easiest (allow most). */
  const getRankForStat = (statKey: string): number | null => {
    if (!teamRow || !oaData?.teams?.length || !footywireTeam) return null;
    const sorted = [...oaData.teams].sort((a, b) => {
      const va = typeof a.stats?.[statKey] === 'number' ? (a.stats[statKey] as number) : -Infinity;
      const vb = typeof b.stats?.[statKey] === 'number' ? (b.stats[statKey] as number) : -Infinity;
      return vb - va; // highest first (allow most = rank 1 in raw)
    });
    const idx = sorted.findIndex((t) => t.team === footywireTeam);
    if (idx < 0) return null;
    const rawRank = idx + 1; // 1 = allow most, 18 = allow least
    return 19 - rawRank; // invert: 1 = hardest, 18 = easiest
  };

  useEffect(() => {
    if (!footywireTeam) {
      setOaData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/afl/team-rankings?season=${season}&type=oa`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setOaData(null);
          return;
        }
        setOaData({ season: json.season ?? season, teams: json.teams ?? [] });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load opponent averages');
          setOaData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [season, footywireTeam]);

  /** Defence rank: 1 = hardest (red), 18 = easiest (green) */
  const getRankColor = (rank: number | null): string => {
    if (!rank || rank <= 0) return isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
    if (rank <= 3) return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';  // 1st–3rd dark red
    if (rank <= 8) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';  // 4th–8th light red
    if (rank <= 12) return 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200';  // 9th–12th orange
    if (rank <= 16) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';  // 13th–16th light green
    return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';  // 17th–18th dark green
  };

  const fmt = (v: number | string | null | undefined): string => {
    if (v == null) return '—';
    const n = typeof v === 'number' ? v : parseFloat(String(v));
    return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '—';
  };

  const showCard = playerName && (lastOpponent || footywireTeam);

  if (!showCard) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
        Select a player to see Opponent Breakdown (based on last game).
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Opponent Breakdown</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">
          {oaData?.season ?? season} opponent averages
        </span>
      </div>

      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
          <h4 className={`text-sm font-mono font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {footywireTeam ?? lastOpponent ?? 'TBD'} allowed averages
          </h4>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
        ) : error ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">{error}</div>
        ) : !teamRow ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No opponent averages for {lastOpponent ?? 'this team'}
          </div>
        ) : (
          <>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {DISPLAY_STATS.map((statKey) => {
              const val = teamRow.stats?.[statKey];
              const r = getRankForStat(statKey);
              const label = STAT_LABELS[statKey] ?? statKey;
              return (
                <div
                  key={statKey}
                  className={`flex items-center justify-between rounded border px-3 py-2 ${
                    isDark ? 'border-gray-600/60' : 'border-gray-200/80'
                  }`}
                >
                  <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>
                    {label} Allowed
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`text-base font-bold font-mono ${isDark ? 'text-white' : 'text-black'}`}>
                      {fmt(val)}
                    </span>
                    <span
                      className={`inline-flex items-center justify-center px-2.5 py-1 rounded text-xs font-bold ${getRankColor(r)}`}
                    >
                      #{r ?? '—'}
                    </span>
                  </div>
                </div>
              );
            })}
            </div>
            <div className={`flex items-center justify-center gap-4 mt-2 pt-2 flex-shrink-0 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
              Hardest
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded bg-green-600 dark:bg-green-500" aria-hidden />
              Easiest
            </span>
          </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AflOpponentBreakdownCard;
