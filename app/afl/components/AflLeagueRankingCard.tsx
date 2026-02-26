'use client';

import { useState, useEffect, useMemo } from 'react';
import { opponentToFootywireTeam, rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';

const RANK_STATS = [
  { key: 'disposals', label: 'Disposals', playerKey: 'disposals_season_avg' },
  { key: 'kicks', label: 'Kicks', playerKey: 'kicks_season_avg' },
  { key: 'handballs', label: 'Handballs', playerKey: 'handballs_season_avg' },
  { key: 'marks', label: 'Marks', playerKey: 'marks_season_avg' },
  { key: 'goals', label: 'Goals', playerKey: 'goals_season_avg' },
  { key: 'tackles', label: 'Tackles', playerKey: 'tackles_season_avg' },
  { key: 'clearances', label: 'Clearances', playerKey: 'clearances_season_avg' },
  { key: 'inside_50s', label: 'Inside 50s', playerKey: 'inside_50s_season_avg' },
  { key: 'rebound_50s', label: 'Rebound 50s', playerKey: 'rebounds_season_avg' },
] as const;

type LeaguePlayerRow = {
  name: string;
  team: string;
  games: number;
  disposals: number;
  kicks: number;
  handballs: number;
  marks: number;
  goals: number;
  tackles: number;
  clearances: number;
  inside_50s: number;
  rebound_50s: number;
};

export interface AflLeagueRankingCardProps {
  isDark: boolean;
  season: number;
  playerName: string | null;
  playerTeam: string | null;
  /** Season averages from game logs: disposals_season_avg, kicks_season_avg, etc. */
  playerStats: Record<string, unknown> | null;
}

function normalizeForMatch(a: string): string {
  return String(a ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

/** Rank (1-based) when sorted descending by stat: count players with stat > value, then rank = count + 1. */
function getRank(players: LeaguePlayerRow[], statKey: keyof LeaguePlayerRow, value: number, minGames: number): { rank: number; total: number } | null {
  const key = statKey as string;
  const eligible = players.filter(
    (p) => p.games >= minGames && typeof (p as Record<string, unknown>)[key] === 'number'
  );
  const total = eligible.length;
  if (total === 0) return null;
  const above = eligible.filter((p) => (p as unknown as Record<string, number>)[key] > value).length;
  const rank = above + 1;
  return { rank, total };
}

export function AflLeagueRankingCard({
  isDark,
  season,
  playerName,
  playerTeam,
  playerStats,
}: AflLeagueRankingCardProps) {
  const [leagueData, setLeagueData] = useState<{ season: number; players: LeaguePlayerRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compareScope, setCompareScope] = useState<'league' | 'team'>('league');

  const effectiveSeason = Math.min(season, 2025);

  useEffect(() => {
    if (!playerName) {
      setLeagueData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/afl/league-player-stats?season=${effectiveSeason}`)
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 404 ? 'League stats not loaded. Run: npm run fetch:footywire-league-player-stats' : 'Failed to load');
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        setLeagueData({ season: json.season ?? effectiveSeason, players: json.players ?? [] });
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e?.message ?? 'Failed to load league stats');
          setLeagueData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [effectiveSeason, playerName]);

  const playerMatch = useMemo(() => {
    if (!leagueData?.players?.length || !playerName) return null;
    const nameNorm = normalizeForMatch(playerName);
    const teamNorm = playerTeam ? normalizeForMatch(playerTeam) : null;
    const byName = leagueData.players.filter(
      (p) => normalizeForMatch(p.name) === nameNorm || normalizeForMatch(p.name).includes(nameNorm) || nameNorm.includes(normalizeForMatch(p.name))
    );
    if (byName.length === 0) return null;
    if (byName.length === 1) return byName[0];
    if (teamNorm) {
      const byTeam = byName.find((p) => normalizeForMatch(p.team) === teamNorm || normalizeForMatch(p.team).includes(teamNorm));
      return byTeam ?? byName[0];
    }
    return byName[0];
  }, [leagueData, playerName, playerTeam]);

  const fullTeamName = playerTeam ? (rosterTeamToInjuryTeam(playerTeam) || playerTeam) : null;
  const footywireTeamNickname = fullTeamName ? opponentToFootywireTeam(fullTeamName) : null;

  const comparePool = useMemo(() => {
    if (!leagueData?.players?.length) return [];
    if (compareScope === 'team' && footywireTeamNickname) {
      const nickNorm = normalizeForMatch(footywireTeamNickname);
      return leagueData.players.filter((p) => normalizeForMatch(p.team) === nickNorm);
    }
    return leagueData.players;
  }, [leagueData?.players, compareScope, footywireTeamNickname]);

  const minGames = 5;

  const showCard = !!playerName;

  if (!showCard) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
        Select a player to compare their season averages to the league or their team.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Compare</h3>
        <div className="flex items-center gap-1.5">
          <div className={`flex rounded-lg border overflow-hidden ${isDark ? 'border-gray-600' : 'border-gray-300'}`}>
            <button
              type="button"
              onClick={() => setCompareScope('league')}
              className={`px-2 py-1 text-xs font-medium transition-colors ${
                compareScope === 'league'
                  ? 'bg-purple-600 text-white'
                  : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              League
            </button>
            <button
              type="button"
              onClick={() => setCompareScope('team')}
              className={`px-2 py-1 text-xs font-medium transition-colors ${
                compareScope === 'team'
                  ? 'bg-purple-600 text-white'
                  : isDark ? 'bg-transparent text-gray-400 hover:text-gray-200' : 'bg-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              Team
            </button>
          </div>
        </div>
      </div>

      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        {loading ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>Loading league stats…</div>
        ) : error ? (
          <div className={`text-sm py-4 ${isDark ? 'text-amber-400' : 'text-amber-600'}`}>{error}</div>
        ) : !leagueData?.players?.length ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No league data. Run: <code className="text-xs bg-black/10 dark:bg-white/10 px-1 rounded">npm run fetch:footywire-league-player-stats</code>
          </div>
        ) : !playerMatch ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            Could not find &quot;{playerName}&quot; in league list. Names must match the source data.
          </div>
        ) : compareScope === 'team' && comparePool.length === 0 ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            No teammates found in stats for {playerTeam ?? 'this team'}.
          </div>
        ) : (
          <>
            <div className={`text-xs font-medium mb-2 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>
              {playerName} vs {compareScope === 'league' ? 'league' : 'team'} (min {minGames} games)
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto space-y-2">
              {RANK_STATS.map(({ key, label, playerKey }) => {
                const rawVal = playerStats?.[playerKey];
                const value = typeof rawVal === 'number' && Number.isFinite(rawVal) ? rawVal : (playerMatch as unknown as Record<string, number>)[key];
                const rankResult = getRank(comparePool, key as keyof LeaguePlayerRow, value, minGames);
                if (!rankResult) return null;
                const { rank, total } = rankResult;
                const isTeamMode = compareScope === 'team';
                const topPct = !isTeamMode && total > 0 && rank <= Math.ceil(total * 0.1);
                const bottomPct = !isTeamMode && rank >= total - Math.ceil(total * 0.1);
                const top5 = isTeamMode && rank <= 5;
                const bottom5 = isTeamMode && total > 0 && rank >= total - 4;
                const middle = isTeamMode && !top5 && !bottom5;
                const rankBadgeClass =
                  top5 || topPct
                    ? isDark
                      ? 'bg-emerald-800 text-emerald-100'
                      : 'bg-emerald-100 text-emerald-800'
                    : bottom5 || bottomPct
                      ? isDark
                        ? 'bg-red-800 text-red-100'
                        : 'bg-red-100 text-red-800'
                      : middle
                        ? isDark
                          ? 'bg-amber-800 text-amber-100'
                          : 'bg-amber-100 text-amber-800'
                        : isDark
                          ? 'bg-amber-800 text-amber-100'
                          : 'bg-amber-100 text-amber-800';
                return (
                  <div
                    key={key}
                    className={`flex items-center justify-between rounded border px-3 py-2 ${isDark ? 'border-gray-600/60' : 'border-gray-200/80'}`}
                  >
                    <span className={`text-sm font-medium ${isDark ? 'text-gray-200' : 'text-gray-800'}`}>{label}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-base font-bold font-mono ${isDark ? 'text-white' : 'text-black'}`}>
                        {typeof value === 'number' && Number.isFinite(value) ? (Number.isInteger(value) ? value : value.toFixed(1)) : '—'}
                      </span>
                      <span
                        className={`inline-flex items-center justify-center px-2 py-0.5 rounded text-xs font-bold ${rankBadgeClass}`}
                      >
                        #{rank}
                      </span>
                      <span className={`text-xs ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>/ {total}</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className={`flex items-center justify-center gap-4 mt-2 pt-2 flex-shrink-0 text-xs font-medium ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
              {compareScope === 'team' ? (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-emerald-600 dark:bg-emerald-500" aria-hidden />
                    Top 5
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-amber-500 dark:bg-amber-600" aria-hidden />
                    Middle
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
                    Bottom 5
                  </span>
                </>
              ) : (
                <>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-emerald-600 dark:bg-emerald-500" aria-hidden />
                    Top 10%
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-amber-500 dark:bg-amber-600" aria-hidden />
                    Middle
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded bg-red-600 dark:bg-red-500" aria-hidden />
                    Bottom 10%
                  </span>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default AflLeagueRankingCard;
