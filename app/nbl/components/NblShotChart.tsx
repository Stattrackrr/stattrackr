'use client';

import React, { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { NblShotZoneId, NblZoneStat } from '@/lib/nbl/nblShotZones';
import { NBL_SHOT_ZONE_IDS } from '@/lib/nbl/nblShotZones';
import {
  NBL_SHOT_CHART_CACHE_YEARS,
  NBL_SHOT_CHART_SEASON_YEAR,
  nblSeasonLabel,
} from '@/lib/nblTeamCanonical';

const SHOT_CHART_SEASON_LABEL = nblSeasonLabel(NBL_SHOT_CHART_SEASON_YEAR);

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
  pointsAllowed?: number;
  ftDefense?: {
    ftm: number;
    fta: number;
    ftPct: number;
    games: number;
    rank: number | null;
    teamsCompared: number;
  };
};

const NBL_RANK_SCALE = 10;

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

function defenseRankPillClass(rank: number): string {
  if (rank <= 2) return 'bg-rose-500/15 text-rose-500 dark:text-rose-400';
  if (rank <= 4) return 'bg-orange-500/15 text-orange-500 dark:text-orange-400';
  if (rank <= 7) return 'bg-amber-500/15 text-amber-600 dark:text-amber-400';
  return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
}

const THREE_ZONES = new Set<NblShotZoneId>(['leftCorner3', 'rightCorner3', 'aboveBreak3']);

const BREAKDOWN_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  zones: readonly NblShotZoneId[];
}> = [
  { id: 'restricted', label: 'Restricted', zones: ['restricted'] },
  { id: 'paint', label: 'Paint', zones: ['paint'] },
  { id: 'midRange', label: 'Mid-Range', zones: ['midRange'] },
  { id: 'leftCorner3', label: 'Left Corner 3', zones: ['leftCorner3'] },
  { id: 'rightCorner3', label: 'Right Corner 3', zones: ['rightCorner3'] },
  { id: 'aboveBreak3', label: 'Beyond the Arc', zones: ['aboveBreak3'] },
];

function zonePointValue(zone: NblShotZoneId): 2 | 3 {
  return THREE_ZONES.has(zone) ? 3 : 2;
}

function formatPerGame(total: number, games: number): string {
  if (!games || !Number.isFinite(total)) return '—';
  const per = total / games;
  return Number.isInteger(per) ? String(per) : per.toFixed(1);
}

function formatPct(fgm: number, fga: number): string {
  if (!fga) return '—';
  return `${((fgm / fga) * 100).toFixed(0)}%`;
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
  const [breakdownOpen, setBreakdownOpen] = useState(false);
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
        if (!res.ok) {
          setError("Couldn't load shot chart. Try again.");
          setPlayerData(null);
          return;
        }
        if (!json?.success || json.empty || !json.shotCount) {
          setError(null);
          setPlayerData({
            success: true,
            mode: 'player',
            playerName,
            shotCount: 0,
            gamesUsed: Number(json?.gamesUsed || 0),
            zones: Array.isArray(json?.zones) ? json.zones : [],
          });
          return;
        }
        setPlayerData(json as PlayerPayload);
      } catch {
        if (!cancelled) {
          setError("Couldn't load shot chart. Try again.");
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
    if (!opponentTeam || opponentTeam === 'N/A') {
      setDefenseData(null);
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
  }, [opponentTeam]);

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
  const canShowBreakdown = Boolean(opponentTeam && opponentTeam !== 'N/A');
  const defenseZones = useMemo(() => zoneLookup(defenseData?.zones || []), [defenseData]);
  const defenseGames = Math.max(0, Number(defenseData?.gamesUsed || 0));
  const pointsAllowed = Number(defenseData?.pointsAllowed);
  const hasBoxScorePoints = Number.isFinite(pointsAllowed) && pointsAllowed > 0;
  const ftDefense = defenseData?.ftDefense;

  const breakdownRows = useMemo(() => {
    const rows = BREAKDOWN_GROUPS.map((group) => {
      let fga = 0;
      let fgm = 0;
      let pts = 0;
      const ranks: number[] = [];
      for (const zone of group.zones) {
        const row = defenseZones[zone];
        fga += row.fga;
        fgm += row.fgm;
        pts += row.fgm * zonePointValue(zone);
        const rank = rankings[zone]?.rank;
        if (rank != null && rank > 0) ranks.push(rank);
      }
      const rankPills = group.zones
        .map((zone) => {
          const rank = rankings[zone]?.rank;
          if (rank == null || rank <= 0) return null;
          const side = zone === 'leftCorner3' ? 'L' : zone === 'rightCorner3' ? 'R' : '';
          return {
            rank,
            label: group.zones.length > 1 && side ? `${side}#${rank}` : `#${rank}`,
          };
        })
        .filter((p): p is { rank: number; label: string } => Boolean(p));
      return {
        id: group.id,
        label: group.label,
        rankPills,
        rank: ranks.length ? Math.min(...ranks) : 0,
        ptsPerGame: formatPerGame(pts, defenseGames),
        rateLabel: `${formatPct(fgm, fga)} FG · ${formatPerGame(fga, defenseGames)} FGA/g`,
      };
    });
    const ftGames = Math.max(0, Number(ftDefense?.games || defenseGames));
    const ftRank = Number(ftDefense?.rank || 0);
    const ftm = Number(ftDefense?.ftm || 0);
    const fta = Number(ftDefense?.fta || 0);
    rows.push({
      id: 'freeThrows',
      label: 'Free Throws',
      rankPills: ftRank > 0 ? [{ rank: ftRank, label: `#${ftRank}` }] : [],
      rank: ftRank > 0 ? ftRank : 0,
      ptsPerGame: formatPerGame(ftm, ftGames || defenseGames),
      rateLabel: `${fta > 0 ? `${ftDefense?.ftPct.toFixed(0)}%` : '—'} FT · ${formatPerGame(fta, ftGames || defenseGames)} FTA/g`,
    });
    return rows;
  }, [defenseZones, rankings, defenseGames, ftDefense]);
  const showSkeleton = Boolean(playerName) && loading;
  const showEmpty = Boolean(playerName) && !loading && !error && playerData && playerData.shotCount <= 0;

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
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{SHOT_CHART_SEASON_LABEL}</span>
          <div className="h-5 w-5 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
          <div className="h-7 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse" />
        </div>
      </div>

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

  const renderMessage = (message: string, isError = false) => (
    <>
      <div className="flex items-center gap-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{SHOT_CHART_SEASON_LABEL}</span>
      </div>
      <div className="w-full flex items-center justify-center p-6" style={{ minHeight: '280px' }}>
        <p
          className={`text-sm text-center max-w-sm ${
            isError
              ? 'text-red-500 dark:text-red-400'
              : isDark
                ? 'text-gray-400'
                : 'text-gray-500'
          }`}
        >
          {message}
        </p>
      </div>
    </>
  );

  if (!playerName) {
    return (
      <div className="w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-3 border border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{SHOT_CHART_SEASON_LABEL}</span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400">Select a player to load shot locations.</p>
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-4 gap-3 border border-gray-200 dark:border-gray-700">
      {showSkeleton ? (
        renderSkeleton()
      ) : error ? (
        renderMessage(error, true)
      ) : showEmpty ? (
        renderMessage('No shot chart available for this player.')
      ) : (
        <>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center gap-2 relative">
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Shot Chart</h2>
              <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">{SHOT_CHART_SEASON_LABEL}</span>
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
                  Current season ({SHOT_CHART_SEASON_LABEL}).
                  <br />
                  <span className="text-blue-600 dark:text-blue-400">Attempts</span> - Player&apos;s
                  shot distribution
                  <br />
                  <span className="text-green-600 dark:text-green-400">Makes</span> - Player&apos;s
                  make distribution
                  <br />
                  <span className="text-purple-600 dark:text-purple-400">Opp Def Rank</span> - Team
                  defense rankings by zone (lower % = better rank). Thin-sample zones stay blank.
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

          {canShowBreakdown ? (
            <div className="w-full border-t border-gray-200 dark:border-[#463e6b]/70 pt-2">
              <button
                type="button"
                onClick={() => setBreakdownOpen((open) => !open)}
                aria-expanded={breakdownOpen}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-2 text-left transition-colors ${
                  breakdownOpen
                    ? 'bg-violet-500/10 text-violet-200'
                    : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-white/5'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-[11px] font-bold uppercase tracking-[0.14em]">
                    In Depth Breakdown
                  </span>
                  <span className="block text-[10px] font-medium text-gray-500 dark:text-gray-400">
                    {hasBoxScorePoints
                      ? `${formatPerGame(pointsAllowed, defenseGames)} pts allowed · ${defenseGames} ${defenseGames === 1 ? 'game' : 'games'}`
                      : defenseGames > 0
                        ? `Pts allowed / game · ${defenseGames} ${defenseGames === 1 ? 'game' : 'games'}`
                        : 'Pts allowed / game'}
                  </span>
                </span>
                <ChevronDown
                  className={`h-4 w-4 shrink-0 transition-transform ${
                    breakdownOpen ? 'rotate-180 text-violet-300' : 'text-gray-500'
                  }`}
                />
              </button>
              <div
                className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                  breakdownOpen ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
                }`}
              >
                <div className="overflow-hidden">
                  {defenseLoading && !defenseData ? (
                    <div className="mt-1 h-28 rounded-xl bg-gray-100 dark:bg-white/5 animate-pulse" />
                  ) : (
                    <div className="mt-1.5 space-y-1.5 pb-0.5">
                      {breakdownRows.map((row) => {
                        const rank = row.rank > 0 ? row.rank : 0;
                        const barPct = rank > 0 ? (rank / NBL_RANK_SCALE) * 100 : 0;
                        const barColor = rank > 0 ? getColorForRank(rank) : '#6b7280';
                        return (
                          <div
                            key={row.id}
                            className="rounded-xl border border-gray-200/80 bg-gray-50/80 px-2.5 py-2 dark:border-gray-700/60 dark:bg-white/[0.03]"
                          >
                            <div className="mb-1 flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 dark:text-gray-400">
                                  {row.label}
                                </div>
                                <div className="mt-0.5 flex items-baseline gap-1">
                                  <span className="text-lg font-bold tabular-nums leading-none text-gray-900 dark:text-white">
                                    {row.ptsPerGame}
                                  </span>
                                  <span className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">
                                    pts/g
                                  </span>
                                </div>
                              </div>
                              <div className="flex shrink-0 flex-wrap justify-end gap-1">
                                {row.rankPills.length ? (
                                  row.rankPills.map((pill) => (
                                    <span
                                      key={pill.label}
                                      className={`rounded-md px-1.5 py-0.5 text-[9px] font-bold tabular-nums ${defenseRankPillClass(pill.rank)}`}
                                    >
                                      {pill.label}
                                    </span>
                                  ))
                                ) : (
                                  <span className="rounded-md bg-gray-200 px-1.5 py-0.5 text-[9px] font-bold text-gray-500 dark:bg-gray-800 dark:text-gray-500">
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                            <div className="relative mb-1.5 h-1.5 overflow-hidden rounded-full bg-gray-200/80 dark:bg-gray-800">
                              <div
                                className="absolute inset-y-0 left-0 rounded-full"
                                style={{ width: `${barPct}%`, backgroundColor: barColor }}
                              />
                            </div>
                            <div className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
                              {row.rateLabel}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
