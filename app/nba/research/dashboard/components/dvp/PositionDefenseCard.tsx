'use client';

import { useState, useEffect, useMemo, memo } from 'react';
import { ABBR_TO_TEAM_ID } from '@/lib/nbaConstants';
import { normalizeAbbr, getEspnLogoUrl } from '@/lib/nbaAbbr';
import { cachedFetch } from '@/lib/requestCache';

// Defense vs Position metrics (static, defined once)
const DVP_METRICS = [
  { key: 'pts' as const, label: 'Points vs ', isPercentage: false },
  { key: 'reb' as const, label: 'Rebounds vs ', isPercentage: false },
  { key: 'ast' as const, label: 'Assists vs ', isPercentage: false },
  { key: 'fg3m' as const, label: 'Three Points Made vs ', isPercentage: false },
  { key: 'fg_pct' as const, label: 'Field Goal % vs ', isPercentage: true },
  { key: 'stl' as const, label: 'Steals vs ', isPercentage: false },
  { key: 'blk' as const, label: 'Blocks vs ', isPercentage: false },
  { key: 'to' as const, label: 'Turnovers vs ', isPercentage: false },
] as const;

// Global cache shared between all PositionDefenseCard instances (mobile + desktop)
// Split into two caches: team DVP data (position-independent) and rank data (position-specific)
const dvpTeamCache = new Map<string, { metrics: any, sample: number, timestamp: number }>();
const dvpRankCache = new Map<string, { metrics: any, timestamp: number }>();

// Auto-clear caches older than 2 minutes to ensure fresh data after ingest
const DVP_CACHE_TTL = 2 * 60 * 1000; // 2 minutes instead of 5
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of dvpTeamCache.entries()) {
    if (value.timestamp && (now - value.timestamp) > DVP_CACHE_TTL) {
      dvpTeamCache.delete(key);
    }
  }
  for (const [key, value] of dvpRankCache.entries()) {
    if (value.timestamp && (now - value.timestamp) > DVP_CACHE_TTL) {
      dvpRankCache.delete(key);
    }
  }
}, 60000); // Check every minute

export interface PositionDefenseCardProps {
  isDark: boolean;
  opponentTeam: string;
  selectedPosition: 'PG' | 'SG' | 'SF' | 'PF' | 'C' | null;
  currentTeam: string;
}

const PositionDefenseCard = memo(function PositionDefenseCard({ 
  isDark, 
  opponentTeam, 
  selectedPosition, 
  currentTeam 
}: PositionDefenseCardProps) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [perStat, setPerStat] = useState<Record<string, number | null>>({});
  const [perRank, setPerRank] = useState<Record<string, number | null>>({});
  const [sample, setSample] = useState<number>(0);

  // Local selectors (team and opponent), defaulted from props
  const ALL_TEAMS = useMemo(() => Object.keys(ABBR_TO_TEAM_ID), []);
  const [oppSel, setOppSel] = useState<string>(opponentTeam || '');
  const [posSel, setPosSel] = useState<'PG'|'SG'|'SF'|'PF'|'C' | null>(selectedPosition || null);
  const [oppOpen, setOppOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  useEffect(() => { setOppSel(opponentTeam || ''); }, [opponentTeam]);
  useEffect(() => { if (selectedPosition) setPosSel(selectedPosition); }, [selectedPosition]);

  useEffect(() => {
    let abort = false;
    const run = async () => {
      setError(null);
      const targetOpp = oppSel || opponentTeam;
      const targetPos = posSel || selectedPosition;
      // Allow manual position selection even if selectedPosition is null
      if (!targetOpp || !targetPos) {
        // If we have an opponent but no position, clear stats but don't return early
        // This allows the user to manually select a position
        if (!targetOpp) return;
        if (!targetPos) {
          setPerStat({});
          setPerRank({});
          setSample(0);
          setLoading(false);
          return;
        }
        return;
      }

      // Check if we have both team DVP and rank data cached
      const teamCacheKey = `${targetOpp}:82`;
      const rankCacheKey = `${targetPos}:82`;
      
      // Check cache first - only refresh if needed
      const teamCached = dvpTeamCache.get(teamCacheKey);
      const rankCached = dvpRankCache.get(rankCacheKey);
      
      // Show team stats immediately if available, ranks can load in background
      if (teamCached && rankCached) {
        const map: Record<string, number | null> = {};
        for (const m of DVP_METRICS) {
          const perGame = teamCached.metrics?.[m.key];
          const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
          map[m.key] = typeof value === 'number' ? value : null;
        }
        setPerStat(map);
        setSample(teamCached.sample);
        
        // If we have ranks too, show them
        if (rankCached) {
          const rmap: Record<string, number | null> = {};
          const normalizedOpp = normalizeAbbr(targetOpp);
          for (const m of DVP_METRICS) {
            const ranks = rankCached.metrics?.[m.key] || {};
            const rank = ranks?.[normalizedOpp] as number | undefined;
            rmap[m.key] = Number.isFinite(rank as any) ? (rank as number) : null;
          }
          setPerRank(rmap);
          setLoading(false);
        } else {
          // Ranks still loading
          setPerRank({});
          setLoading(true);
        }
      } else {
        setPerStat({});
        setPerRank({});
        setSample(0);
        setLoading(true);
      }

      try {
        const metricsStr = DVP_METRICS.map(m => m.key).join(',');
        
        // Fetch only what we don't have cached
        const promises: Promise<any>[] = [];
        
        // Only fetch if not cached
        if (!teamCached) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82`,
              undefined,
              60 * 60 * 1000 // Cache for 60 minutes (in milliseconds)
            )
            .then(data => ({ type: 'team', data }))
            .catch((error: any) => {
              console.error('[DVP Frontend] Team fetch error:', error);
              return { type: 'team', data: { error: error.message || 'Failed to fetch team data' } };
            })
          );
        }
        
        if (!rankCached) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${targetPos}&metrics=${metricsStr}&games=82`,
              undefined,
              60 * 60 * 1000 // Cache for 60 minutes (in milliseconds)
            )
            .then(data => ({ type: 'rank', data }))
            .catch((error: any) => {
              console.error('[DVP Frontend] Rank fetch error:', error);
              return { type: 'rank', data: { error: error.message || 'Failed to fetch rank data' } };
            })
          );
        }
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          
          let dvpData = teamCached;
          let rankData = rankCached;
          
          results.forEach(result => {
            if (result.type === 'team') {
              // Handle rate limit (null) gracefully - skip update but don't show error
              if (result.data === null) {
                console.warn('[DVP Frontend] Team data rate limited, using cached data if available');
                return; // Skip this result, continue with cached data
              }
              if (!result.data || result.data?.error) {
                console.error('[DVP Frontend] Team data error:', result.data?.error || 'No data returned');
                // Don't set error if we have cached data - allow fallback to cached data
                if (!teamCached) {
                  setError('Unable to load data. Please try again.');
                }
                return;
              }
              dvpData = { metrics: result.data?.metrics, sample: result.data?.sample_games || 0, timestamp: Date.now() };
              dvpTeamCache.set(teamCacheKey, dvpData);
            } else if (result.type === 'rank') {
              // Handle rate limit (null) gracefully - skip update but don't show error
              if (result.data === null) {
                console.warn('[DVP Frontend] Rank data rate limited, using cached data if available');
                return; // Skip this result, continue with cached data
              }
              if (!result.data || result.data?.error) {
                console.error('[DVP Frontend] Rank data error:', result.data?.error || 'No data returned');
                // Don't set error if we have cached data - allow fallback to cached data
                if (!rankCached) {
                  setError('Unable to load data. Please try again.');
                }
                return;
              }
              // Debug: log rank data structure
              console.log('[DVP Frontend] Rank data received:', {
                hasData: !!result.data,
                hasMetrics: !!result.data?.metrics,
                metricKeys: result.data?.metrics ? Object.keys(result.data.metrics) : [],
                sampleMetric: result.data?.metrics?.pts ? {
                  teamCount: Object.keys(result.data.metrics.pts).length,
                  sampleTeams: Object.keys(result.data.metrics.pts).slice(0, 5)
                } : null
              });
              rankData = { metrics: result.data?.metrics, timestamp: Date.now() };
              dvpRankCache.set(rankCacheKey, rankData);
            }
          });
          
          // Use data if we have both, OR if we have cached data (even if one fetch failed)
          if (!abort && dvpData && rankData) {
            const map: Record<string, number | null> = {};
            const rmap: Record<string, number | null> = {};
            const normalizedOpp = normalizeAbbr(targetOpp);
            
            // Debug: log rank data structure before extraction
            console.log('[DVP Frontend] Extracting ranks:', {
              hasRankData: !!rankData,
              hasMetrics: !!rankData.metrics,
              metricKeys: rankData.metrics ? Object.keys(rankData.metrics) : [],
              normalizedOpp,
              targetPos,
              sampleRankData: rankData.metrics?.pts ? {
                teamKeys: Object.keys(rankData.metrics.pts).slice(0, 10),
                oppRank: rankData.metrics.pts[normalizedOpp],
                oppRankType: typeof rankData.metrics.pts[normalizedOpp]
              } : null
            });
            // Also log the actual rank values for each metric
            if (rankData.metrics) {
              console.log('[DVP Frontend] Rank values for', normalizedOpp, ':', 
                Object.entries(rankData.metrics).map(([metric, ranks]: [string, any]) => {
                  const rank = ranks?.[normalizedOpp];
                  return `${metric}: ${rank !== undefined ? rank : 'undefined'}`;
                }).join(', ')
              );
            }
            
            for (const m of DVP_METRICS) {
              const perGame = dvpData.metrics?.[m.key];
              const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
              map[m.key] = typeof value === 'number' ? value : null;
              
              const ranks = rankData.metrics?.[m.key] || {};
              const rank = ranks?.[normalizedOpp] as number | undefined;
              
              // Accept 0 as a valid rank (means team has null value)
              rmap[m.key] = (typeof rank === 'number' && Number.isFinite(rank)) ? rank : null;
            }
            
            // Debug: log extracted ranks
            const nonNullRanks = Object.entries(rmap).filter(([_, v]) => v !== null);
            console.log('[DVP Frontend] Extracted ranks result:', {
              normalizedOpp,
              targetPos,
              nonNullRanksCount: nonNullRanks.length,
              ranks: nonNullRanks,
              allRanks: rmap
            });
            // Log each rank value explicitly
            console.log('[DVP Frontend] Rank values:', 
              Object.entries(rmap).map(([metric, rank]) => `${metric}=${rank}`).join(', ')
            );
            
            setPerStat(map);
            setPerRank(rmap);
            setSample(dvpData.sample);
            setError(null); // Clear any previous errors
            setLoading(false);
          } else if (!abort) {
            // If we have cached data but new fetch failed, try to use what we have
            // Check if we have at least one data source (team or rank)
            if (dvpData || rankData) {
              const map: Record<string, number | null> = {};
              const rmap: Record<string, number | null> = {};
              const normalizedOpp = normalizeAbbr(targetOpp);
              
              if (dvpData) {
                for (const m of DVP_METRICS) {
                  const perGame = dvpData.metrics?.[m.key];
                  const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
                  map[m.key] = typeof value === 'number' ? value : null;
                }
                setPerStat(map);
                setSample(dvpData.sample);
              }
              
              if (rankData) {
                for (const m of DVP_METRICS) {
                  const ranks = rankData.metrics?.[m.key] || {};
                  const rank = ranks?.[normalizedOpp] as number | undefined;
                  rmap[m.key] = (typeof rank === 'number' && Number.isFinite(rank)) ? rank : null;
                }
                setPerRank(rmap);
              }
              
              setLoading(false);
            } else if (promises.length > 0) {
              // No data at all - show error only if we tried to fetch
            }
          }
        } else if (!abort && (teamCached || rankCached)) {
          // We have some cached data, use it even if incomplete
          const map: Record<string, number | null> = {};
          const rmap: Record<string, number | null> = {};
          const normalizedOpp = normalizeAbbr(targetOpp);
          
          if (teamCached) {
            for (const m of DVP_METRICS) {
              const perGame = teamCached.metrics?.[m.key];
              const value = perGame ? (perGame?.[targetPos as any] as number | undefined) : undefined;
              map[m.key] = typeof value === 'number' ? value : null;
            }
            setPerStat(map);
            setSample(teamCached.sample);
          }
          
          if (rankCached) {
            for (const m of DVP_METRICS) {
              const ranks = rankCached.metrics?.[m.key] || {};
              const rank = ranks?.[normalizedOpp] as number | undefined;
              rmap[m.key] = Number.isFinite(rank as any) ? (rank as number) : null;
            }
            setPerRank(rmap);
          }
          
          setLoading(false);
        }
      } catch (e: any) {
        console.error('[DVP Frontend] Error:', e);
        if (!abort) setError('Unable to load data. Please try again.');
      } finally {
        if (!abort) setLoading(false);
      }
    };
    run();

    // Background prefetch for other positions - now using batched endpoints
    const targetOpp = oppSel || opponentTeam;
    const positions: Array<'PG'|'SG'|'SF'|'PF'|'C'> = ['PG','SG','SF','PF','C'];
    const other = positions.filter(p => p !== (posSel || selectedPosition));
    
    const prefetchOne = async (p: 'PG'|'SG'|'SF'|'PF'|'C') => {
      const teamCacheKey = `${targetOpp}:82`;
      const rankCacheKey = `${p}:82`;
      
      // Skip if already cached and not stale
      if (!targetOpp) return;
      const teamCached = dvpTeamCache.get(teamCacheKey);
      const rankCached = dvpRankCache.get(rankCacheKey);
      const now = Date.now();
      if (teamCached && rankCached && 
          teamCached.timestamp && rankCached.timestamp &&
          (now - teamCached.timestamp) < DVP_CACHE_TTL &&
          (now - rankCached.timestamp) < DVP_CACHE_TTL) return;
      
      try {
        const metricsStr = DVP_METRICS.map(m => m.key).join(',');
        const promises: Promise<any>[] = [];
        
        // Only fetch what's not cached or is stale
        if (!teamCached || (teamCached.timestamp && (now - teamCached.timestamp) >= DVP_CACHE_TTL)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/batch?team=${targetOpp}&metrics=${metricsStr}&games=82`,
              undefined,
              60 * 60 * 1000 // Cache for 60 minutes (in milliseconds)
            ).then(data => ({ type: 'team', data }))
          );
        }
        
        if (!rankCached || (rankCached.timestamp && (now - rankCached.timestamp) >= DVP_CACHE_TTL)) {
          promises.push(
            cachedFetch<any>(
              `/api/dvp/rank/batch?pos=${p}&metrics=${metricsStr}&games=10`,
              undefined,
              60 * 60 * 1000 // Cache for 60 minutes (in milliseconds)
            ).then(data => ({ type: 'rank', data }))
          );
        }
        
        if (promises.length > 0) {
          const results = await Promise.all(promises);
          results.forEach(result => {
            if (result.type === 'team') {
              // Skip if rate limited (null) - don't overwrite cache with null
              if (result.data === null) {
                console.warn('[DVP Frontend] Team data rate limited, keeping existing cache');
                return;
              }
              if (result.data?.metrics) {
                dvpTeamCache.set(teamCacheKey, { metrics: result.data?.metrics, sample: result.data?.sample_games || 0, timestamp: Date.now() });
              }
            } else if (result.type === 'rank') {
              // Skip if rate limited (null) - don't overwrite cache with null
              if (result.data === null) {
                console.warn('[DVP Frontend] Rank data rate limited, keeping existing cache');
                return;
              }
              if (result.data?.metrics) {
                dvpRankCache.set(rankCacheKey, { metrics: result.data?.metrics, timestamp: Date.now() });
              }
            }
          });
        }
      } catch {}
    };
    
    // Prefetch with delay to avoid blocking UI - but only if the browser is idle
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => {
        other.forEach(p => { prefetchOne(p); });
      });
    } else {
      setTimeout(() => { other.forEach(p => { prefetchOne(p); }); }, 1000);
    }

    return () => { abort = true; };
  }, [oppSel, posSel, opponentTeam, selectedPosition]);

  const fmt = (v?: number | null, isPercentage?: boolean) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return '';
    return isPercentage ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  const posLabel = posSel || selectedPosition || 'Select Position';

  return (
    <div className="mb-4 sm:mb-6 w-full min-w-0">
      <div className="flex items-center justify-between mb-2 sm:mb-2">
        <h3 className="text-base sm:text-base md:text-lg font-semibold text-gray-900 dark:text-white">Defense vs Position</h3>
        <span className="text-xs sm:text-[10px] text-gray-500 dark:text-gray-400">Current season stats</span>
      </div>
      <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-white'} w-full min-w-0`}>
        {/* Controls row */}
        <div className="px-3 sm:px-3 py-3 sm:py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-2">
          {/* Position switcher */}
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Position</div>
            
            {/* Dropdown for all screen sizes to prevent overflow */}
            <div>
              <button
                onClick={() => setPosOpen(o => !o)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-md border text-sm font-bold ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'} ${posLabel === (posSel || selectedPosition) ? 'bg-purple-600 border-purple-600 text-white' : ''}`}
              >
                <span>{posLabel}</span>
                <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
              </button>
              
              {posOpen && (
                <>
                  <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-[#0a1929] border-gray-600' : 'bg-white border-gray-300'}`}>
                    {(['PG','SG','SF','PF','C'] as const).map(p => (
                      <button
                        key={p}
                        onClick={() => { setPosSel(p); setPosOpen(false); }}
                        className={`w-full px-3 py-2 text-sm font-bold text-left ${posLabel === p ? 'bg-purple-600 text-white' : (mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900')}`}
                      >{p}</button>
                    ))}
                  </div>
                  <div className="fixed inset-0 z-10" onClick={() => setPosOpen(false)} />
                </>
              )}
            </div>
          </div>
          {/* Opponent selector with logo (custom dropdown) */}
          <div className={`rounded-lg border ${mounted && isDark ? 'border-gray-600' : 'border-gray-300'} p-2 relative`}>
            <div className={`text-[11px] font-semibold mb-2 ${mounted && isDark ? 'text-slate-200' : 'text-slate-800'}`}>Opponent Team</div>
            <button
              onClick={() => setOppOpen(o => !o)}
              className={`w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md border text-sm ${mounted && isDark ? 'bg-gray-700 border-gray-600 text-white' : 'bg-white border-gray-300 text-gray-900'}`}
            >
              <span className="flex items-center gap-2">
                {(oppSel || opponentTeam) && <img src={getEspnLogoUrl(oppSel || opponentTeam || '')} alt={oppSel || opponentTeam || 'OPP'} className="w-6 h-6 object-contain" />}
                <span className="font-semibold">{oppSel || opponentTeam || ''}</span>
              </span>
              <svg className="w-4 h-4 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"/></svg>
            </button>

            {oppOpen && (
              <>
                <div className={`absolute z-20 mt-1 left-2 right-2 rounded-md border shadow-lg overflow-hidden ${mounted && isDark ? 'bg-slate-800 border-gray-600' : 'bg-white border-gray-300'}`}>
                  <div className="max-h-56 overflow-y-auto custom-scrollbar overscroll-contain" onWheel={(e)=> e.stopPropagation()}>
                    {ALL_TEAMS.map(t => (
                      <button
                        key={t}
                        onClick={() => { setOppSel(t); setOppOpen(false); }}
                        className={`w-full flex items-center gap-2 px-2 py-2 text-sm text-left ${mounted && isDark ? 'hover:bg-gray-600 text-white' : 'hover:bg-gray-100 text-gray-900'}`}
                      >
                        <img src={getEspnLogoUrl(t)} alt={t} className="w-5 h-5 object-contain" />
                        <span className="font-medium">{t}</span>
                      </button>
                    ))}
                  </div>
                </div>
                {/* click-away overlay */}
                <div className="fixed inset-0 z-10" onClick={() => setOppOpen(false)} />
              </>
            )}
          </div>
        </div>
        {error ? (
          <div className="px-3 py-3 text-xs text-red-500 dark:text-red-400">
            Error loading DvP stats: {error}
          </div>
        ) : !posSel && !selectedPosition ? (
          <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">Select a position above to view DvP stats.</div>
        ) : loading && Object.keys(perStat).length === 0 ? (
          // Skeleton loader - show placeholder metrics while loading
          <div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-48 sm:max-h-56 md:max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m, index) => (
              <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${mounted && isDark ? 'border-slate-700' : 'border-slate-300'} px-3 py-2.5`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={`h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse`} style={{ animationDelay: `${index * 0.1}s` }}></div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className={`h-5 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse`} style={{ animationDelay: `${index * 0.1 + 0.05}s` }}></div>
                    <div className={`h-5 w-10 bg-gray-200 dark:bg-gray-700 rounded-full animate-pulse`} style={{ animationDelay: `${index * 0.1 + 0.1}s` }}></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
<div className="overflow-y-scroll overscroll-contain custom-scrollbar max-h-48 sm:max-h-56 md:max-h-64 pr-1 pb-2" onWheel={(e) => e.stopPropagation()}>
            {DVP_METRICS.map((m) => {
              const rank = perRank[m.key];
              
              // Removed debug logging to prevent spam during re-renders
              
              let borderColor: string;
              let badgeColor: string;
              
              if (rank == null || rank === 0) {
                borderColor = mounted && isDark ? 'border-slate-700' : 'border-slate-300';
                badgeColor = mounted && isDark ? 'bg-slate-700 text-slate-300' : 'bg-slate-100 text-slate-600';
              } else if (rank >= 26) {
                borderColor = mounted && isDark ? 'border-green-900' : 'border-green-800';
                badgeColor = 'bg-green-800 text-green-50 dark:bg-green-900 dark:text-green-100';
              } else if (rank >= 21) {
                borderColor = mounted && isDark ? 'border-green-800' : 'border-green-600';
                badgeColor = 'bg-green-100 text-green-800 dark:bg-green-800 dark:text-green-100';
              } else if (rank >= 16) {
                borderColor = mounted && isDark ? 'border-orange-800' : 'border-orange-600';
                badgeColor = 'bg-orange-100 text-orange-800 dark:bg-orange-800 dark:text-orange-100';
              } else if (rank >= 11) {
                borderColor = mounted && isDark ? 'border-orange-900' : 'border-orange-700';
                badgeColor = 'bg-orange-200 text-orange-900 dark:bg-orange-900 dark:text-orange-200';
              } else if (rank >= 6) {
                borderColor = mounted && isDark ? 'border-red-800' : 'border-red-600';
                badgeColor = 'bg-red-100 text-red-800 dark:bg-red-800 dark:text-red-100';
              } else {
                borderColor = mounted && isDark ? 'border-red-900' : 'border-red-800';
                badgeColor = 'bg-red-800 text-red-50 dark:bg-red-900 dark:text-red-100';
              }
              
              return (
                <div key={m.key} className={`mx-3 my-2 rounded-lg border-2 ${borderColor} px-3 py-2.5`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`text-sm font-medium ${mounted && isDark ? 'text-white' : 'text-gray-900'}`}>{m.label}{posLabel}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={`font-bold ${mounted && isDark ? 'text-slate-100' : 'text-slate-900'} text-base sm:text-lg`}>
                        {fmt(perStat[m.key], m.isPercentage)}
                      </span>
                      <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded-full text-[10px] font-bold ${badgeColor}`} title="Rank (30 better for overs, 1 for unders)">
                        {typeof rank === 'number' && rank > 0 ? `#${rank}` : rank === 0 ? 'N/A' : ''}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => prev.isDark === next.isDark && prev.opponentTeam === next.opponentTeam && prev.selectedPosition === next.selectedPosition);

export default PositionDefenseCard;

