'use client';

import { useState, useEffect, memo } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { cachedFetch } from '@/lib/requestCache';

// DVP cache TTL constant (shared with PositionDefenseCard)
const DVP_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

export interface OpponentAnalysisCardProps {
  isDark: boolean;
  opponentTeam: string;
  selectedTimeFilter: string;
  propsMode?: 'player' | 'team';
  playerId?: string | number | null;
  selectedStat?: string;
}

const OpponentAnalysisCard = memo(function OpponentAnalysisCard({ 
  isDark, 
  opponentTeam, 
  selectedTimeFilter,
  propsMode,
  playerId,
  selectedStat
}: OpponentAnalysisCardProps) {
  const [mounted, setMounted] = useState(false);
  const [activeView, setActiveView] = useState<'breakdown'>('breakdown');
  const [teamStats, setTeamStats] = useState<any>(null);
  const [teamRanks, setTeamRanks] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset to "Opponent Breakdown" when player changes or opponent changes
  useEffect(() => {
    setActiveView('breakdown');
  }, [playerId, opponentTeam]);

  useEffect(() => {
    // Don't fetch if opponent team is not set or is invalid
    if (!opponentTeam || opponentTeam === 'N/A' || opponentTeam === '' || opponentTeam === 'ALL') {
      setTeamStats(null);
      setTeamRanks({});
      setError(null);
      setLoading(false);
      return;
    }

    let abort = false;
    const LOCAL_CACHE_KEY = 'opponentAnalysisCacheV1';
    const LOCAL_CACHE_TTL = 1000 * 60 * 60 * 6; // 6 hours

    const fetchData = async () => {
      setLoading(true);
      setError(null);

      const targetOpp = opponentTeam;

      try {
        // Fetch team defensive stats from Basketball Reference (faster and more reliable)
        let defensiveStatsResponse: any;
        try {
          defensiveStatsResponse = await cachedFetch<any>(
            `/api/team-defensive-stats/bballref?team=${targetOpp}`,
            undefined,
            DVP_CACHE_TTL * 10 // Cache for 20 minutes (Basketball Reference updates daily)
          );
        } catch (fetchError: any) {
          // Handle HTTP errors (like 500, 400, etc.) and timeouts
          console.error('[OpponentAnalysisCard] Error fetching defensive stats:', fetchError);
          if (!abort) {
            setError('Unable to load data. Please try again.');
            setTeamStats(null);
            setTeamRanks({});
            setLoading(false);
          }
          return;
        }

        // Check if response is valid
        if (!defensiveStatsResponse) {
          console.error('[OpponentAnalysisCard] No response from defensive stats API for', targetOpp);
          if (!abort) {
            setError('Unable to load data. Please try again.');
            setTeamStats(null);
            setTeamRanks({});
            setLoading(false);
          }
          return;
        }


        if (defensiveStatsResponse.success === true) {
          const perGame = defensiveStatsResponse.perGame || {};
          
          // Map BDL stats to our format (already per-game from API)
          const stats: any = {
            pts: perGame.pts || 0,
            reb: perGame.reb || 0,
            ast: perGame.ast || 0,
            fg_pct: perGame.fg_pct || 0,
            fg3_pct: perGame.fg3_pct || 0,
            stl: perGame.stl || 0,
            blk: perGame.blk || 0,
          };

          // Initialize ranks to 0 - will be fetched separately to avoid blocking
          const ranks: Record<string, number> = {
            pts: 0,
            reb: 0,
            ast: 0,
            fg_pct: 0,
            fg3_pct: 0,
            stl: 0,
            blk: 0,
          };

          // Fetch rankings asynchronously from Basketball Reference (much faster)
          (async () => {
            try {
              const rankingsResponse = await cachedFetch<any>(
                `/api/team-defensive-stats/bballref?all=1`, // Get all teams with rankings
                undefined,
                DVP_CACHE_TTL * 30 // Cache rankings for 1 hour
              );

              if (rankingsResponse?.success && rankingsResponse.rankings && !abort) {
                const normalizedOpp = normalizeAbbr(targetOpp);
                const teamRankings = rankingsResponse.rankings[normalizedOpp];
                if (teamRankings) {
                  setTeamRanks(teamRankings);
                }
              }
            } catch (rankError: any) {
              console.warn('[OpponentAnalysisCard] Failed to fetch rankings:', rankError);
              // Continue without ranks if ranking fetch fails
            }
          })();

          if (!abort) {
            setTeamStats(stats);
            setTeamRanks(ranks);
            setError(null);
          }
        } else {
          console.error('Failed to fetch defensive stats:', defensiveStatsResponse);
          if (!abort) {
            setTeamStats(null);
            setTeamRanks({});
            setError('Unable to load data. Please try again.');
          }
        }
      } catch (error: any) {
        console.error('Failed to fetch opponent analysis data:', error);
        if (!abort) {
          setTeamStats(null);
          setTeamRanks({});
          setError('Unable to load data. Please try again.');
        }
      } finally {
        if (!abort) setLoading(false);
      }
    };

    fetchData();

    return () => {
      abort = true;
    };
  }, [opponentTeam]);
  
  const getRankColor = (rank: number): string => {
    if (!rank || rank <= 0) return mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
    if (rank >= 25) return 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
    if (rank >= 20) return 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
    if (rank >= 15) return 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
    if (rank >= 10) return 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
    return 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
  };

  const formatRankLabel = (rank: number): string => {
    if (!rank || rank <= 0) return '';
    return `#${rank}`;
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Opponent Analysis</h3>
        <span className="text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      
      <div className="space-y-4">
        {activeView === 'breakdown' ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${mounted && isDark ? "bg-cyan-400" : "bg-cyan-500"} animate-pulse`} />
              <h4 className={`text-sm font-semibold font-mono tracking-wider ${mounted && isDark ? "text-white" : "text-slate-900"}`}>
                OPPONENT BREAKDOWN
              </h4>
            </div>
          
          <div className="bg-gray-50 dark:bg-[#0a1929] rounded-lg p-3">
            <div className="space-y-2">
              <div className={`text-xs font-mono font-bold uppercase tracking-wider`}>
                <span className={`${mounted && isDark ? "text-green-400" : "text-green-600"}`}>{opponentTeam || 'TBD'}</span>
                <span className={`${mounted && isDark ? "text-slate-400" : "text-slate-500"}`}> DEFENSIVE RANKS</span>
              </div>
              <div className="space-y-0">
                {!opponentTeam || opponentTeam === 'N/A' || opponentTeam === '' || opponentTeam === 'ALL' ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Select an opponent to view defensive ranks</div>
                ) : loading ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">Loading...</div>
                ) : error ? (
                  <div className="text-sm text-red-500 dark:text-red-400">{error}</div>
                ) : !teamStats ? (
                  <div className="text-sm text-gray-500 dark:text-gray-400">No data available</div>
                ) : (
                  <>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Points Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.pts ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.pts || 0)}`}>
                          {formatRankLabel(teamRanks.pts || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Rebounds Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.reb ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.reb || 0)}`}>
                          {formatRankLabel(teamRanks.reb || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Assists Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.ast ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.ast || 0)}`}>
                          {formatRankLabel(teamRanks.ast || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Field Goal % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.fg_pct ?? 0).toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg_pct || 0)}`}>
                          {formatRankLabel(teamRanks.fg_pct || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>3-Point % Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.fg3_pct ?? 0).toFixed(1)}%
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.fg3_pct || 0)}`}>
                          {formatRankLabel(teamRanks.fg3_pct || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Steals Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.stl ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.stl || 0)}`}>
                          {formatRankLabel(teamRanks.stl || 0)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-3 py-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? "text-white" : "text-black"}`}>Blocks Allowed</span>
                      <div className="flex items-center gap-3">
                        <span className={`text-lg font-bold font-mono ${mounted && isDark ? "text-white" : "text-black"}`}>
                          {(teamStats?.blk ?? 0).toFixed(1)}
                        </span>
                        <span className={`inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-bold ${getRankColor(teamRanks.blk || 0)}`}>
                          {formatRankLabel(teamRanks.blk || 0)}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        ) : null}
      </div>
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.opponentTeam === next.opponentTeam &&
  prev.selectedTimeFilter === next.selectedTimeFilter &&
  prev.propsMode === next.propsMode &&
  prev.playerId === next.playerId &&
  prev.selectedStat === next.selectedStat
));

export default OpponentAnalysisCard;

