'use client';

import { useState, useEffect, useMemo } from 'react';
import { rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';

type InjuryRow = {
  team: string;
  player: string;
  injury: string;
  returning: string;
};

type InjuriesData = {
  injuries: InjuryRow[];
  generatedAt?: string;
};

type ImpactInfo = {
  gamesWithoutCount: number;
  noGamesTogether?: boolean;
};

const SEASON = 2025;

export function AflInjuriesCard({
  isDark,
  season = SEASON,
  playerTeam,
  playerName,
  gameLogs = [],
  teammateFilterName,
  setTeammateFilterName,
  withWithoutMode,
  setWithWithoutMode,
  clearTeammateFilter,
}: {
  isDark: boolean;
  season?: number;
  playerTeam?: string | null;
  playerName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
  teammateFilterName?: string | null;
  setTeammateFilterName?: (name: string | null) => void;
  withWithoutMode?: 'with' | 'without';
  setWithWithoutMode?: (mode: 'with' | 'without') => void;
  clearTeammateFilter?: () => void;
}) {
  const [data, setData] = useState<InjuriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllAfl, setShowAllAfl] = useState(false);
  const [impactData, setImpactData] = useState<Record<string, ImpactInfo>>({});
  const [loadingImpacts, setLoadingImpacts] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch('/api/afl/injuries')
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return;
        if (json?.error) {
          setError(json.error);
          setData(null);
          return;
        }
        setData({
          injuries: json.injuries ?? [],
          generatedAt: json.generatedAt,
        });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load injuries');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const injuryTeamName = playerTeam ? rosterTeamToInjuryTeam(playerTeam) : null;
  const useTeamFilter = !showAllAfl && injuryTeamName;
  const teamInjuries = useMemo(() => {
    if (!data?.injuries?.length) return [];
    const list = useTeamFilter
      ? data.injuries.filter((i) => (i.team || '').toLowerCase() === (injuryTeamName ?? '').toLowerCase())
      : data.injuries;
    return list;
  }, [data?.injuries, useTeamFilter, injuryTeamName]);

  const teamInjuryKeys = useMemo(
    () => teamInjuries.map((i) => i.player).sort().join(','),
    [teamInjuries]
  );

  useEffect(() => {
    if (!playerName || !gameLogs?.length || teamInjuries.length === 0) {
      setImpactData({});
      setLoadingImpacts(new Set());
      return;
    }
    const selectedRounds = new Set(
      gameLogs.map((g) => String(g.round ?? '').trim()).filter(Boolean)
    );
    setLoadingImpacts(new Set(teamInjuries.map((i) => i.player)));
    let cancelled = false;

    const fetchImpacts = async () => {
      const next: Record<string, ImpactInfo> = {};
      for (const injury of teamInjuries) {
        if (cancelled) return;
        try {
          const res = await fetch(
            `/api/afl/player-game-logs?season=${season}&player_name=${encodeURIComponent(injury.player)}`
          );
          const json = await res.json();
          const games = Array.isArray(json?.games) ? json.games : [];
          const injuredRounds = new Set(
            games.map((g: Record<string, unknown>) => String(g.round ?? '').trim()).filter(Boolean)
          );
          const overlap = [...selectedRounds].filter((r) => injuredRounds.has(r));
          if (overlap.length === 0 && games.length === 0) {
            next[injury.player] = { gamesWithoutCount: gameLogs.length, noGamesTogether: true };
          } else if (overlap.length === 0) {
            next[injury.player] = { gamesWithoutCount: gameLogs.length, noGamesTogether: true };
          } else {
            const gamesWithout = gameLogs.filter((g) => {
              const r = String(g.round ?? '').trim();
              return !injuredRounds.has(r);
            });
            next[injury.player] = { gamesWithoutCount: gamesWithout.length };
          }
        } catch {
          next[injury.player] = { gamesWithoutCount: 0 };
        }
      }
      if (!cancelled) {
        setImpactData(next);
        setLoadingImpacts(new Set());
      }
    };
    fetchImpacts();
    return () => { cancelled = true; };
  }, [playerName, season, teamInjuryKeys, gameLogs]);

  const getStatusDotColor = (returning: string): string => {
    const r = (returning || '').toLowerCase();
    if (r.includes('season')) return 'bg-red-500';
    if (r.includes('test') || r.includes('protocols')) return 'bg-orange-500';
    return 'bg-gray-500';
  };

  if (loading) {
    return (
      <div className="w-full min-w-0 h-full flex items-center justify-center min-h-[320px] text-sm text-gray-500 dark:text-gray-400">
        Loading injury list…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="w-full min-w-0 h-full flex items-center justify-center min-h-[320px] text-sm text-amber-600 dark:text-amber-400">
        {error ?? 'No data'}
      </div>
    );
  }

  const byTeam = new Map<string, InjuryRow[]>();
  for (const i of teamInjuries) {
    const t = i.team || 'Unknown';
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t)!.push(i);
  }
  const teams = [...byTeam.keys()].sort();
  const hasTeamToggle = !!playerTeam;
  const showWithWithout = !!playerName && gameLogs.length > 0;

  if (!teamInjuries.length) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col min-h-[320px]">
        <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AFL Injury List</h3>
          {hasTeamToggle && (
            <button
              type="button"
              onClick={() => setShowAllAfl((v) => !v)}
              className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                showAllAfl
                  ? isDark ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'bg-purple-100 border-purple-400 text-purple-700'
                  : isDark ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {showAllAfl ? 'Team only' : 'Season wide'}
            </button>
          )}
        </div>
        <div className="flex-1 flex items-center justify-center min-h-[120px] text-sm text-gray-500 dark:text-gray-400">
          {useTeamFilter ? `No injuries listed for ${injuryTeamName}` : 'No injuries listed'}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col min-h-0">
      <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0 flex-wrap">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">AFL Injury List</h3>
        {hasTeamToggle && (
          <button
            type="button"
            onClick={() => setShowAllAfl((v) => !v)}
            className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
              showAllAfl
                ? isDark ? 'bg-purple-600/20 border-purple-500 text-purple-300' : 'bg-purple-100 border-purple-400 text-purple-700'
                : isDark ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600' : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {showAllAfl ? 'Team only' : 'Season wide'}
          </button>
        )}
      </div>
      <div
        className={`rounded-lg border overflow-y-auto flex-1 min-h-0 custom-scrollbar ${
          showAllAfl ? 'divide-y divide-gray-200 dark:divide-gray-700' : 'space-y-2 p-2'
        } ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'}`}
      >
        {showAllAfl ? (
          teams.map((team) => (
            <div key={team} className="p-2">
              <div
                className={`text-xs font-semibold mb-1.5 text-left ${
                  isDark ? 'text-purple-300' : 'text-purple-700'
                }`}
              >
                {team}
              </div>
              <table className="w-full text-xs border-collapse table-fixed">
                <colgroup>
                  <col className="w-[45%]" />
                  <col className="w-[30%]" />
                  <col className="w-[25%]" />
                </colgroup>
                <tbody>
                  {byTeam.get(team)!.map((row, idx) => (
                    <tr
                      key={`${row.player}-${idx}`}
                      className={isDark ? 'bg-[#0f172a]/50' : 'bg-gray-50'}
                    >
                      <td className="py-1 px-2 font-medium text-gray-900 dark:text-white whitespace-nowrap text-left">
                        {row.player}
                      </td>
                      <td className="py-1 px-2 text-gray-500 dark:text-gray-400 whitespace-nowrap text-center">
                        {row.injury || '—'}
                      </td>
                      <td
                        className={`py-1 px-2 text-right whitespace-nowrap ${
                          row.returning?.toLowerCase().includes('season')
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        {row.returning || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))
        ) : (
          teams.map((team) => (
            <div key={team}>
              <div
                className={`text-xs font-semibold mb-1.5 text-left ${
                  isDark ? 'text-purple-300' : 'text-purple-700'
                }`}
              >
                {team}
              </div>
              <div className="space-y-2">
                {byTeam.get(team)!.map((row) => {
                  const impact = impactData[row.player];
                  const isLoadingImpact = loadingImpacts.has(row.player);
                  const isActiveWith = teammateFilterName === row.player && withWithoutMode === 'with';
                  const isActiveWithout = teammateFilterName === row.player && withWithoutMode === 'without';

                  return (
                    <div
                      key={`${row.player}-${row.team}`}
                      className={`rounded-lg border p-3 ${
                        isDark ? 'border-gray-700 bg-[#0f1e2e]' : 'border-gray-200 bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <div
                          className={`w-2.5 h-2.5 rounded-full mt-0.5 flex-shrink-0 ${getStatusDotColor(row.returning)}`}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap mb-1">
                            <span className="font-medium text-sm text-gray-900 dark:text-white">
                              {row.player}
                            </span>
                            <span className="text-xs text-gray-500 dark:text-gray-400">
                              {row.injury || '—'}
                            </span>
                            <span
                              className={`text-xs ${
                                row.returning?.toLowerCase().includes('season')
                                  ? 'text-amber-600 dark:text-amber-400'
                                  : 'text-gray-500 dark:text-gray-400'
                              }`}
                            >
                              {row.returning || '—'}
                            </span>
                          </div>
                          {showWithWithout && (
                            <>
                              {isLoadingImpact ? (
                                <div className="text-xs text-gray-500 dark:text-gray-400 mb-2">
                                  Calculating…
                                </div>
                              ) : impact ? (
                                <div className="text-xs text-gray-600 dark:text-gray-300 mb-2">
                                  {impact.noGamesTogether ? (
                                    <span>No with/without sample this season</span>
                                  ) : (
                                    <span>
                                      {playerName} has played {impact.gamesWithoutCount} game
                                      {impact.gamesWithoutCount === 1 ? '' : 's'} without {row.player}{' '}
                                      this season.
                                    </span>
                                  )}
                                </div>
                              ) : null}
                              {showWithWithout && !impact?.noGamesTogether && (
                                <div className="flex items-center gap-2 justify-end">
                                  {isActiveWith ? (
                                    <button
                                      type="button"
                                      onClick={clearTeammateFilter}
                                      className="px-2.5 py-1 text-xs font-medium rounded bg-purple-600 dark:bg-purple-500 text-white hover:bg-purple-700"
                                    >
                                      ✕
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTeammateFilterName?.(row.player);
                                        setWithWithoutMode?.('with');
                                      }}
                                      className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                    >
                                      With
                                    </button>
                                  )}
                                  {isActiveWithout ? (
                                    <button
                                      type="button"
                                      onClick={clearTeammateFilter}
                                      className="px-2.5 py-1 text-xs font-medium rounded bg-purple-600 dark:bg-purple-500 text-white hover:bg-purple-700"
                                    >
                                      ✕
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTeammateFilterName?.(row.player);
                                        setWithWithoutMode?.('without');
                                      }}
                                      className="px-2.5 py-1 text-xs font-medium rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
                                    >
                                      Without
                                    </button>
                                  )}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
