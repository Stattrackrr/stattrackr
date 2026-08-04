'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import type { NblShotZoneId, NblZoneStat } from '@/lib/nbl/nblShotZones';
import { NBL_SHOT_ZONE_IDS } from '@/lib/nbl/nblShotZones';
import { NBL_SHOT_CHART_CACHE_YEARS } from '@/lib/nblTeamCanonical';

type ZoneRank = NblZoneStat & { rank: number | null; teamsCompared: number };

type PlayerPayload = {
  success: boolean;
  mode: 'player';
  playerName: string;
  shotCount: number;
  gamesUsed: number;
  zones: NblZoneStat[];
};

type DefensePayload = {
  success: boolean;
  mode: 'defense';
  team: string;
  shotCount: number;
  gamesUsed: number;
  zones: NblZoneStat[];
  ranks: ZoneRank[];
};

type NblShotChartProps = {
  isDark?: boolean;
  playerName?: string | null;
  playerTeam?: string | null;
  opponentTeam?: string | null;
};

const scale = 10;
const courtWidth = 50 * scale; // 500
const courtHeight = 38 * scale; // 380
const paintWidth = 16 * scale; // 160
const centerX = courtWidth / 2;
const baseline = courtHeight;
const paintLeft = centerX - paintWidth / 2;
const paintRight = centerX + paintWidth / 2;
const freeThrowLine = baseline - 21 * scale;
const midRangeWidth = 80;
/** Inside edge of the 3pt line — also the corner/mid-range hard boundary. */
const midRangeLeft = paintLeft - midRangeWidth; // 90
const midRangeRight = paintRight + midRangeWidth; // 410
/**
 * Mid-range = inside 3pt arc, paint notched out, down to baseline.
 * Shared edge with corners is exactly midRangeLeft / midRangeRight.
 */
const midRangeZonePath = [
  `M ${midRangeLeft} ${baseline}`,
  `L ${midRangeLeft} ${freeThrowLine - 50}`,
  `Q ${centerX} ${freeThrowLine - 120} ${midRangeRight} ${freeThrowLine - 50}`,
  `L ${midRangeRight} ${baseline}`,
  `L ${paintRight} ${baseline}`,
  `L ${paintRight} ${freeThrowLine}`,
  `L ${paintLeft} ${freeThrowLine}`,
  `L ${paintLeft} ${baseline}`,
  'Z',
].join(' ');
/** Corners sit outside the 3pt line only (never into mid-range). */
const leftCornerZonePath = `M 0 270 L ${midRangeLeft} 270 L ${midRangeLeft} ${baseline} L 15 ${baseline} Q 0 ${baseline} 0 ${baseline - 15} Z`;
const rightCornerZonePath = `M ${midRangeRight} 270 L ${courtWidth} 270 L ${courtWidth} ${baseline - 15} Q ${courtWidth} ${baseline} ${courtWidth - 15} ${baseline} L ${midRangeRight} ${baseline} Z`;
const aboveBreakZonePath = [
  `M 15 0`,
  `L ${courtWidth - 15} 0`,
  `Q ${courtWidth} 0 ${courtWidth} 15`,
  `L ${courtWidth} 270`,
  `L ${midRangeRight} 270`,
  `L ${midRangeRight} ${freeThrowLine - 50}`,
  `Q ${centerX} ${freeThrowLine - 120} ${midRangeLeft} ${freeThrowLine - 50}`,
  `L ${midRangeLeft} 270`,
  `L 0 270`,
  `L 0 15`,
  `Q 0 0 15 0`,
  'Z',
].join(' ');

function getColorForDistribution(pct: number): string {
  if (pct >= 30) return '#10b981';
  if (pct >= 25) return '#22c55e';
  if (pct >= 10) return '#f97316';
  return '#ef4444';
}

function getColorForRank(rank: number, fgPct?: number): string {
  if (rank > 0) {
    if (rank <= 2) return '#ef4444';
    if (rank <= 4) return '#f97316';
    if (rank <= 7) return '#fbbf24';
    return '#10b981';
  }
  if (fgPct !== undefined) {
    if (fgPct < 50) return '#ef4444';
    if (fgPct < 55) return '#f97316';
    if (fgPct < 60) return '#fbbf24';
    return '#10b981';
  }
  return '#6b7280';
}

function zoneLookup(zones: NblZoneStat[]): Record<NblShotZoneId, NblZoneStat> {
  const out = {} as Record<NblShotZoneId, NblZoneStat>;
  for (const id of NBL_SHOT_ZONE_IDS) {
    out[id] =
      zones.find((z) => z.zone === id) ||
      ({
        zone: id,
        label: id,
        fga: 0,
        fgm: 0,
        fgPct: 0,
        share: 0,
      } as NblZoneStat);
  }
  return out;
}

export function NblShotChart({
  isDark = true,
  playerName,
  playerTeam,
  opponentTeam,
}: NblShotChartProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const [showMakes, setShowMakes] = useState(false);
  const [showOppDef, setShowOppDef] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerData, setPlayerData] = useState<PlayerPayload | null>(null);
  const [defenseData, setDefenseData] = useState<DefensePayload | null>(null);
  const [defenseLoading, setDefenseLoading] = useState(false);
  const clipId = `nblRoundedCourt-${useId().replace(/:/g, '')}`;

  useEffect(() => {
    if (!playerName) {
      setPlayerData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setPlayerData(null);
      try {
        const params = new URLSearchParams({
          mode: 'player',
          playerName,
          years: NBL_SHOT_CHART_CACHE_YEARS.join(','),
        });
        if (playerTeam) params.set('team', playerTeam);
        const res = await fetch(`/api/nbl/shot-chart?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setError(json?.error || 'Failed to load shot chart data');
          setPlayerData(null);
          return;
        }
        setPlayerData(json as PlayerPayload);
      } catch {
        if (!cancelled) {
          setError('Failed to fetch shot chart data. Please try again.');
          setPlayerData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [playerName, playerTeam]);

  useEffect(() => {
    if (!showOppDef || !opponentTeam || opponentTeam === 'N/A') {
      return;
    }
    let cancelled = false;
    (async () => {
      setDefenseLoading(true);
      try {
        const params = new URLSearchParams({
          mode: 'defense',
          team: opponentTeam,
          years: NBL_SHOT_CHART_CACHE_YEARS.join(','),
          ranks: '1',
        });
        const res = await fetch(`/api/nbl/shot-chart?${params.toString()}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok || !json?.success) {
          setDefenseData(null);
          return;
        }
        setDefenseData(json as DefensePayload);
      } catch {
        if (!cancelled) setDefenseData(null);
      } finally {
        if (!cancelled) setDefenseLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showOppDef, opponentTeam]);

  const z = useMemo(() => zoneLookup(playerData?.zones || []), [playerData]);

  /** Distribution % keyed by zone id (avoids index mix-ups). */
  const distByZone = useMemo(() => {
    const totalFga = NBL_SHOT_ZONE_IDS.reduce((s, id) => s + z[id].fga, 0);
    const totalFgm = NBL_SHOT_ZONE_IDS.reduce((s, id) => s + z[id].fgm, 0);
    const out = {} as Record<NblShotZoneId, number>;
    for (const id of NBL_SHOT_ZONE_IDS) {
      if (showMakes) out[id] = totalFgm > 0 ? (z[id].fgm / totalFgm) * 100 : 0;
      else out[id] = totalFga > 0 ? (z[id].fga / totalFga) * 100 : 0;
    }
    return out;
  }, [z, showMakes]);

  const rankings = useMemo(() => {
    const map = {} as Partial<Record<NblShotZoneId, ZoneRank>>;
    for (const row of defenseData?.ranks || []) map[row.zone] = row;
    return map;
  }, [defenseData]);

  const hasOppRanks = Boolean(defenseData?.ranks?.some((r) => r.rank != null));
  const showSkeleton = Boolean(playerName) && (loading || (!playerData && !error));

  const distLabel = (zone: NblShotZoneId) => {
    const val = distByZone[zone];
    return `${(Number.isFinite(val) ? val : 0).toFixed(0)}%`;
  };

  // Explicit corner values — avoid any chance of left/right label mix-ups.
  const leftCornerPct = Number.isFinite(distByZone.leftCorner3) ? distByZone.leftCorner3 : 0;
  const rightCornerPct = Number.isFinite(distByZone.rightCorner3) ? distByZone.rightCorner3 : 0;
  const leftCornerFga = z.leftCorner3.fga;
  const rightCornerFga = z.rightCorner3.fga;

  const rankLabel = (zone: NblShotZoneId) => {
    const r = rankings[zone]?.rank;
    return r != null && r > 0 ? `#${r}` : '-';
  };

  const fillDist = (zone: NblShotZoneId) => getColorForDistribution(distByZone[zone] || 0);
  const fillRank = (zone: NblShotZoneId) => {
    const r = rankings[zone];
    return getColorForRank(r?.rank ?? 0, r?.fgPct);
  };

  const renderSkeleton = () => (
    <>
      <div className="flex items-center justify-between w-full">
        <div className="flex items-center gap-2 relative">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">NBL26</span>
          <div className="h-5 w-5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      </div>

      {error ? (
        <div className="w-full flex items-center justify-center p-6" style={{ minHeight: '380px' }}>
          <div className="text-center max-w-md">
            <div className="text-red-500 dark:text-red-400 font-semibold mb-2 text-sm">
              ⚠️ Error Loading Shot Chart
            </div>
            <div className="text-xs text-gray-600 dark:text-gray-400">{error}</div>
          </div>
        </div>
      ) : (
        <svg
          viewBox="0 0 500 380"
          className="w-full"
          style={{ height: 'auto', width: '100%' }}
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <clipPath id={`${clipId}-skel`}>
              <rect x="0" y="0" width="500" height="380" rx="15" ry="15" />
            </clipPath>
          </defs>
          <rect
            x="0"
            y="0"
            width="500"
            height="380"
            rx="15"
            ry="15"
            fill={isDark ? '#1e293b' : '#d4a574'}
          />
          <g clipPath={`url(#${clipId}-skel)`}>
            <path
              d={aboveBreakZonePath}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
            />
            <path
              d={leftCornerZonePath}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
            />
            <path
              d={rightCornerZonePath}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
            />
            <path
              d={midRangeZonePath}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
            />
            <rect
              x={paintLeft}
              y={freeThrowLine}
              width={paintWidth}
              height={baseline - freeThrowLine}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
            />
            <path
              d={`M ${centerX - 60} ${baseline} L ${centerX - 60} ${baseline - 60} Q ${centerX} ${baseline - 90} ${centerX + 60} ${baseline - 60} L ${centerX + 60} ${baseline} Z`}
              fill="#d1d5db"
              className="dark:fill-gray-700 animate-pulse"
              opacity="0.6"
              stroke="#000"
              strokeWidth="3"
            />
            <rect
              x="0"
              y="0"
              width={courtWidth}
              height={courtHeight}
              rx="15"
              ry="15"
              fill="none"
              stroke="#000"
              strokeWidth="3"
            />
            <rect
              x={paintLeft}
              y={freeThrowLine}
              width={paintWidth}
              height={baseline - freeThrowLine}
              fill="none"
              stroke="#000"
              strokeWidth="3"
            />
            <path
              d={`M ${midRangeLeft} ${baseline} L ${midRangeLeft} ${freeThrowLine - 50} Q ${centerX} ${freeThrowLine - 120} ${midRangeRight} ${freeThrowLine - 50} L ${midRangeRight} ${baseline}`}
              fill="none"
              stroke="#000"
              strokeWidth="3"
            />
            <circle cx={centerX} cy={freeThrowLine} r="3" fill="#000" />
            <line x1="0" y1="270" x2={midRangeLeft} y2="270" stroke="#000" strokeWidth="3" />
            <line
              x1={midRangeRight}
              y1="270"
              x2={courtWidth}
              y2="270"
              stroke="#000"
              strokeWidth="3"
            />
            <text
              x={centerX}
              y="60"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="32"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate attributeName="opacity" values="0.3;0.6;0.3" dur="1.5s" repeatCount="indefinite" />
              --
            </text>
            <text
              x={centerX}
              y={freeThrowLine - 30}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="28"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.6;0.3"
                dur="1.5s"
                begin="0.2s"
                repeatCount="indefinite"
              />
              --
            </text>
            <text
              x={centerX}
              y={baseline - 25}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="28"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.6;0.3"
                dur="1.5s"
                begin="0.4s"
                repeatCount="indefinite"
              />
              --
            </text>
            <text
              x={centerX}
              y={freeThrowLine + (baseline - freeThrowLine) / 2}
              textAnchor="middle"
              fill="#ffffff"
              fontSize="28"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.6;0.3"
                dur="1.5s"
                begin="0.6s"
                repeatCount="indefinite"
              />
              --
            </text>
            <text
              x="45"
              y="330"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="24"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.6;0.3"
                dur="1.5s"
                begin="0.8s"
                repeatCount="indefinite"
              />
              --
            </text>
            <text
              x="455"
              y="330"
              textAnchor="middle"
              fill="#ffffff"
              fontSize="24"
              fontWeight="bold"
              stroke="#000"
              strokeWidth="0.5"
              opacity="0.5"
            >
              <animate
                attributeName="opacity"
                values="0.3;0.6;0.3"
                dur="1.5s"
                begin="1s"
                repeatCount="indefinite"
              />
              --
            </text>
          </g>
        </svg>
      )}

      <div className="flex items-center gap-3 text-sm font-medium flex-wrap justify-center">
        <div className="h-4 w-32 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
        <div className="flex items-center gap-1">
          <div className="w-5 h-5 rounded bg-gray-200 dark:bg-gray-700 animate-pulse" />
          <div className="h-4 w-16 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      </div>
    </>
  );

  if (!playerName) {
    return (
      <div className="w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-3 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">NBL26</span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a player to load shot locations.</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-3 border border-gray-200 dark:border-gray-700">
      {showSkeleton || (error && !playerData) ? (
        renderSkeleton()
      ) : (
        <>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 relative">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">NBL26</span>
              <button
                type="button"
                onMouseEnter={() => setShowTooltip(true)}
                onMouseLeave={() => setShowTooltip(false)}
                className="w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-400 dark:hover:bg-gray-500 transition-colors"
              >
                ?
              </button>
              {showTooltip && (
                <div className="absolute z-50 left-0 top-8 w-64 px-3 py-2 text-xs leading-relaxed rounded border shadow-lg bg-white dark:bg-[#0a1929] border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100">
                  <strong>Shot Chart Views</strong>
                  <br />
                  Last completed season (NBL26). Cache only.
                  <br />
                  <span className="text-blue-600 dark:text-blue-400">Attempts</span> - Player&apos;s
                  shot distribution
                  <br />
                  <span className="text-green-600 dark:text-green-400">Makes</span> - Player&apos;s
                  make distribution
                  <br />
                  <span className="text-purple-600 dark:text-purple-400">Opp Def Rank</span> - Team
                  defense rankings by zone (lower % = better rank)
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowMakes(false);
                  setShowOppDef(false);
                }}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                  !showMakes && !showOppDef
                    ? 'bg-blue-600 text-white hover:bg-blue-700'
                    : 'bg-gray-200 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Attempts
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowMakes(true);
                  setShowOppDef(false);
                }}
                className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                  showMakes && !showOppDef
                    ? 'bg-green-600 text-white hover:bg-green-700'
                    : 'bg-gray-200 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
              >
                Makes
              </button>
              {opponentTeam && opponentTeam !== 'N/A' ? (
                <button
                  type="button"
                  onClick={() => {
                    setShowOppDef(true);
                    setShowMakes(false);
                  }}
                  className={`px-2 py-1 text-xs font-medium rounded-md transition-colors ${
                    showOppDef
                      ? 'bg-purple-600 text-white hover:bg-purple-700'
                      : 'bg-gray-200 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                  }`}
                >
                  {defenseLoading ? 'Opp Def…' : 'Opp Def Rank'}
                </button>
              ) : null}
            </div>
          </div>

          <svg
            viewBox="0 0 500 380"
            className="w-full"
            style={{ height: 'auto', width: '100%' }}
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <clipPath id={clipId}>
                <rect x="0" y="0" width="500" height="380" rx="15" ry="15" />
              </clipPath>
            </defs>

            <rect
              x="0"
              y="0"
              width="500"
              height="380"
              rx="15"
              ry="15"
              fill={isDark ? '#1e293b' : '#d4a574'}
            />

            <g clipPath={`url(#${clipId})`}>
              {/* Zone fills — crispEdges kills subpixel green/red fringe at seams */}
              <g style={{ shapeRendering: 'crispEdges' }}>
                <path
                  d={aboveBreakZonePath}
                  fill={
                    showOppDef && hasOppRanks ? fillRank('aboveBreak3') : fillDist('aboveBreak3')
                  }
                />
                {/* Corners first — clipped to outside the 3pt line only */}
                <path
                  d={leftCornerZonePath}
                  fill={
                    showOppDef && hasOppRanks ? fillRank('leftCorner3') : fillDist('leftCorner3')
                  }
                  stroke="none"
                />
                <path
                  d={rightCornerZonePath}
                  fill={
                    showOppDef && hasOppRanks ? fillRank('rightCorner3') : fillDist('rightCorner3')
                  }
                  stroke="none"
                />
                {/* Mid-range last among wings — owns everything inside the 3pt line */}
                <path
                  d={midRangeZonePath}
                  fill={
                    showOppDef && hasOppRanks ? fillRank('midRange') : fillDist('midRange')
                  }
                  stroke="none"
                />
                <rect
                  x={paintLeft}
                  y={freeThrowLine}
                  width={paintWidth}
                  height={baseline - freeThrowLine}
                  fill={showOppDef && hasOppRanks ? fillRank('paint') : fillDist('paint')}
                  stroke="none"
                />
                <path
                  d={`M ${centerX - 60} ${baseline} L ${centerX - 60} ${baseline - 60} Q ${centerX} ${baseline - 90} ${centerX + 60} ${baseline - 60} L ${centerX + 60} ${baseline} Z`}
                  fill={
                    showOppDef && hasOppRanks ? fillRank('restricted') : fillDist('restricted')
                  }
                  stroke="none"
                />
              </g>

              {/* Restricted outline + court lines (smooth strokes) */}
              <path
                d={`M ${centerX - 60} ${baseline} L ${centerX - 60} ${baseline - 60} Q ${centerX} ${baseline - 90} ${centerX + 60} ${baseline - 60} L ${centerX + 60} ${baseline} Z`}
                fill="none"
                stroke="#000"
                strokeWidth="3"
              />
              <rect
                x="0"
                y="0"
                width={courtWidth}
                height={courtHeight}
                rx="15"
                ry="15"
                fill="none"
                stroke="#000"
                strokeWidth="3"
              />
              <rect
                x={paintLeft}
                y={freeThrowLine}
                width={paintWidth}
                height={baseline - freeThrowLine}
                fill="none"
                stroke="#000"
                strokeWidth="3"
              />
              <path
                d={`M ${midRangeLeft} ${baseline} L ${midRangeLeft} ${freeThrowLine - 50} Q ${centerX} ${freeThrowLine - 120} ${midRangeRight} ${freeThrowLine - 50} L ${midRangeRight} ${baseline}`}
                fill="none"
                stroke="#000"
                strokeWidth="3"
              />
              <circle cx={centerX} cy={freeThrowLine} r="3" fill="#000" />
              <line x1="0" y1="270" x2={midRangeLeft} y2="270" stroke="#000" strokeWidth="3" />
              <line
                x1={midRangeRight}
                y1="270"
                x2={courtWidth}
                y2="270"
                stroke="#000"
                strokeWidth="3"
              />

              {showOppDef && hasOppRanks ? (
                <>
                  <text
                    x={centerX}
                    y="60"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="32"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('aboveBreak3')}
                  </text>
                  <text
                    x={centerX}
                    y={freeThrowLine - 30}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('midRange')}
                  </text>
                  <text
                    x={centerX}
                    y={baseline - 25}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('restricted')}
                  </text>
                  <text
                    x={centerX}
                    y={freeThrowLine + (baseline - freeThrowLine) / 2}
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('paint')}
                  </text>
                  <text
                    x="45"
                    y="330"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="24"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('leftCorner3')}
                  </text>
                  <text
                    x="455"
                    y="330"
                    textAnchor="middle"
                    fill="#ffffff"
                    fontSize="24"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {rankLabel('rightCorner3')}
                  </text>
                </>
              ) : (
                <>
                  <text
                    x={centerX}
                    y="60"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="32"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {distLabel('aboveBreak3')}
                  </text>
                  <text
                    x={centerX}
                    y={freeThrowLine - 30}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {distLabel('midRange')}
                  </text>
                  <text
                    x={centerX}
                    y={baseline - 25}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {distLabel('restricted')}
                  </text>
                  <text
                    x={centerX}
                    y={freeThrowLine + (baseline - freeThrowLine) / 2}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="28"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {distLabel('paint')}
                  </text>
                  <text
                    key={`left-corner-${leftCornerFga}-${leftCornerPct.toFixed(2)}`}
                    x="45"
                    y="330"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="24"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {`${leftCornerPct.toFixed(0)}%`}
                  </text>
                  <text
                    key={`right-corner-${rightCornerFga}-${rightCornerPct.toFixed(2)}`}
                    x="455"
                    y="330"
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="24"
                    fontWeight="bold"
                    stroke="#000"
                    strokeWidth="0.5"
                  >
                    {`${rightCornerPct.toFixed(0)}%`}
                  </text>
                </>
              )}
            </g>
          </svg>

          {showOppDef && hasOppRanks ? (
            <div className="flex items-center gap-3 text-sm font-medium flex-wrap justify-center">
              <span className="text-gray-700 dark:text-gray-300">Defense Ranking:</span>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#ef4444' }} />
                <span className="text-gray-600 dark:text-gray-400">#1-2 (Elite)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#f97316' }} />
                <span className="text-gray-600 dark:text-gray-400">#3-4 (Good)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#fbbf24' }} />
                <span className="text-gray-600 dark:text-gray-400">#5-7 (Avg)</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#10b981' }} />
                <span className="text-gray-600 dark:text-gray-400">#8-10 (Weak)</span>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm font-medium flex-wrap justify-center">
              <span className="text-gray-700 dark:text-gray-300">
                {showMakes ? 'Make Distribution:' : 'Shot Distribution:'}
              </span>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#10b981' }} />
                <span className="text-gray-600 dark:text-gray-400">≥30%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#22c55e' }} />
                <span className="text-gray-600 dark:text-gray-400">25-29%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#f97316' }} />
                <span className="text-gray-600 dark:text-gray-400">10-24%</span>
              </div>
              <div className="flex items-center gap-1">
                <div className="w-5 h-5 rounded" style={{ backgroundColor: '#ef4444' }} />
                <span className="text-gray-600 dark:text-gray-400">&lt;10%</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
