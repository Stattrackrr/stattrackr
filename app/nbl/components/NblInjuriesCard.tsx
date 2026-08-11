'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchJsonDeduped } from '@/lib/clientFetchDedupe';
import { normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

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

function injuryTeamMatches(injuryTeam: string, filterTeam: string): boolean {
  const a = resolveNblClubName(injuryTeam);
  const b = resolveNblClubName(filterTeam);
  if (a && b) return normalizeTeamKey(a) === normalizeTeamKey(b);
  return normalizeTeamKey(injuryTeam) === normalizeTeamKey(filterTeam);
}

function gameBelongsToSeason(game: Record<string, unknown>, season: number): boolean {
  const seasonRaw = Number(game.season);
  if (Number.isFinite(seasonRaw)) return seasonRaw === season;
  const dateRaw = String(game.date ?? game.game_date ?? '').trim();
  if (dateRaw.length >= 4) {
    const y = Number(dateRaw.slice(0, 4));
    // NBL season year is start year; games spanning calendar years still count for that season label.
    if (Number.isFinite(y)) return y === season || y === season + 1;
  }
  return false;
}

function gameKey(game: Record<string, unknown>): string {
  const matchId = String(game.matchId ?? game.id ?? '').trim();
  if (matchId) return `id:${matchId}`;
  const date = String(game.date ?? game.game_date ?? '').trim().slice(0, 10);
  const opp = normalizeTeamKey(String(game.opponent ?? ''));
  return date && opp ? `d:${date}|${opp}` : '';
}

export function NblInjuriesCard({
  isDark = false,
  season = 2025,
  playerTeam = null,
  playerName = null,
  gameLogs = [],
  rosterPlayers = [],
  teammateFilterName,
  setTeammateFilterName,
  withWithoutMode,
  setWithWithoutMode,
  clearTeammateFilter,
}: {
  isDark?: boolean;
  season?: number;
  playerTeam?: string | null;
  playerName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
  rosterPlayers?: Array<{ name: string; playerId: string | null; team: string }>;
  teammateFilterName?: string | null;
  setTeammateFilterName?: (name: string | null) => void;
  withWithoutMode?: 'with' | 'without';
  setWithWithoutMode?: (mode: 'with' | 'without') => void;
  clearTeammateFilter?: () => void;
}) {
  const [data, setData] = useState<InjuriesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllLeague, setShowAllLeague] = useState(false);
  const [impactData, setImpactData] = useState<Record<string, ImpactInfo>>({});
  const [loadingImpacts, setLoadingImpacts] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchJsonDeduped<{ error?: string; injuries?: InjuryRow[]; generatedAt?: string }>(
      '/api/nbl/injuries'
    )
      .then((json) => {
        if (cancelled) return;
        if (json?.error && !json.injuries?.length) {
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
    return () => {
      cancelled = true;
    };
  }, []);

  const injuryTeamName = playerTeam ? resolveNblClubName(playerTeam) || playerTeam : null;
  const useTeamFilter = !showAllLeague && injuryTeamName;
  const teamInjuries = useMemo(() => {
    if (!data?.injuries?.length) return [];
    return useTeamFilter
      ? data.injuries.filter((i) => injuryTeamMatches(i.team || '', injuryTeamName ?? ''))
      : data.injuries;
  }, [data?.injuries, useTeamFilter, injuryTeamName]);

  const teamInjuryKeys = useMemo(
    () => teamInjuries.map((i) => i.player).sort().join(','),
    [teamInjuries]
  );
  const seasonGameLogs = useMemo(
    () => (gameLogs ?? []).filter((g) => gameBelongsToSeason(g as Record<string, unknown>, season)),
    [gameLogs, season]
  );

  useEffect(() => {
    if (!playerName || !seasonGameLogs.length || teamInjuries.length === 0) {
      setImpactData({});
      setLoadingImpacts(new Set());
      return;
    }
    const selectedKeys = new Set(
      seasonGameLogs.map((g) => gameKey(g as Record<string, unknown>)).filter(Boolean)
    );
    setLoadingImpacts(new Set(teamInjuries.map((i) => i.player)));
    let cancelled = false;

    const fetchImpacts = async () => {
      const next: Record<string, ImpactInfo> = {};
      for (const injury of teamInjuries) {
        if (cancelled) return;
        try {
          const rosterHit =
            rosterPlayers.find(
              (p) =>
                normalizeTeamKey(p.name) === normalizeTeamKey(injury.player) &&
                (!injury.team || injuryTeamMatches(p.team, injury.team))
            ) ||
            rosterPlayers.find(
              (p) => normalizeTeamKey(p.name) === normalizeTeamKey(injury.player)
            );
          if (!rosterHit?.playerId) {
            next[injury.player] = { gamesWithoutCount: seasonGameLogs.length };
            continue;
          }
          const res = await fetch(
            `/api/nbl/player-game-logs?playerId=${encodeURIComponent(rosterHit.playerId)}&year=${season}`
          );
          const json = await res.json();
          const games = Array.isArray(json?.games) ? json.games : [];
          const seasonGames = games.filter((g: Record<string, unknown>) =>
            gameBelongsToSeason(g, season)
          );
          const injuredKeys = new Set(
            seasonGames.map((g: Record<string, unknown>) => gameKey(g)).filter(Boolean)
          );
          const overlap = [...selectedKeys].filter((k) => injuredKeys.has(k));
          if (overlap.length === 0) {
            next[injury.player] = { gamesWithoutCount: seasonGameLogs.length };
          } else {
            const gamesWithout = seasonGameLogs.filter((g) => {
              const k = gameKey(g as Record<string, unknown>);
              return !k || !injuredKeys.has(k);
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
    void fetchImpacts();
    return () => {
      cancelled = true;
    };
  }, [playerName, season, teamInjuryKeys, seasonGameLogs, rosterPlayers, teamInjuries]);

  const getStatusDotColor = (returning: string): string => {
    const r = (returning || '').toLowerCase();
    if (r.includes('season')) return 'bg-red-500';
    if (r.includes('test') || r.includes('protocols') || r.includes('round')) return 'bg-orange-500';
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
  const showWithWithout = !!playerName && seasonGameLogs.length > 0;

  if (!teamInjuries.length) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col min-h-[320px]">
        <div className="flex items-center justify-between mb-2 gap-2 flex-shrink-0 flex-wrap">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">NBL Injury List</h3>
          {hasTeamToggle && (
            <button
              type="button"
              onClick={() => setShowAllLeague((v) => !v)}
              className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
                showAllLeague
                  ? isDark
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-purple-100 border-purple-400 text-purple-700'
                  : isDark
                    ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                    : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {showAllLeague ? 'Team only' : 'Season wide'}
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
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">NBL Injury List</h3>
        {hasTeamToggle && (
          <button
            type="button"
            onClick={() => setShowAllLeague((v) => !v)}
            className={`flex-shrink-0 px-2 py-1 text-[10px] font-medium rounded border transition-colors ${
              showAllLeague
                ? isDark
                  ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                  : 'bg-purple-100 border-purple-400 text-purple-700'
                : isDark
                  ? 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                  : 'bg-gray-100 border-gray-300 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {showAllLeague ? 'Team only' : 'Season wide'}
          </button>
        )}
      </div>
      <div
        className={`rounded-lg border overflow-y-auto overflow-x-hidden flex-1 min-h-0 custom-scrollbar ${
          showAllLeague ? 'divide-y divide-gray-200 dark:divide-gray-700' : 'space-y-2 p-2'
        } ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'}`}
      >
        {showAllLeague ? (
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
                  <col className="w-[28%]" />
                  <col className="w-[42%]" />
                  <col className="w-[30%]" />
                </colgroup>
                <tbody>
                  {byTeam.get(team)!.map((row, idx) => (
                    <tr
                      key={`${row.player}-${idx}`}
                      className={isDark ? 'bg-[#0f172a]/50' : 'bg-gray-50'}
                    >
                      <td className="py-1.5 px-2 font-medium text-gray-900 dark:text-white text-left align-top">
                        <span className="block truncate" title={row.player}>
                          {row.player}
                        </span>
                      </td>
                      <td className="py-1.5 px-2 text-gray-500 dark:text-gray-400 text-left align-top overflow-hidden">
                        <span className="block truncate" title={row.injury || undefined}>
                          {row.injury || '—'}
                        </span>
                      </td>
                      <td
                        className={`py-1.5 px-2 text-right align-top overflow-hidden ${
                          row.returning?.toLowerCase().includes('season')
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-gray-500 dark:text-gray-400'
                        }`}
                      >
                        <span className="block truncate" title={row.returning || undefined}>
                          {row.returning || '—'}
                        </span>
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
                  const isActiveWith =
                    teammateFilterName === row.player && withWithoutMode === 'with';
                  const isActiveWithout =
                    teammateFilterName === row.player && withWithoutMode === 'without';

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

export default NblInjuriesCard;
