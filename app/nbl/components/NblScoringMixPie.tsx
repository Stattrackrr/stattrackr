'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NblChartTimeframe } from '@/app/nbl/components/NblStatsChart';
import { NBL_CURRENT_SEASON_YEAR } from '@/lib/nblTeamCanonical';

type TeamUsagePlayer = {
  playerId: string;
  name: string;
  usgPct: number;
  minutes: number;
  games: number;
  stats?: Record<string, number>;
};

type BuiltSlice = {
  playerId: string;
  name: string;
  value: number;
  fill: string;
  share: number;
  span: number;
  a0: number;
  a1: number;
  path: string;
  isSelected: boolean;
};

type PieStat = {
  key: string;
  short: string;
  full: string;
  pct: boolean;
  digits?: number;
};

const PIE_STATS: PieStat[] = [
  { key: 'usgPct', short: 'USG', full: 'Usage %', pct: true },
  { key: 'possUsed', short: 'POSS', full: 'Possessions used', pct: false },
  { key: 'ptsPerPoss', short: 'PPP', full: 'Points per possession', pct: false, digits: 2 },
  { key: 'astPerPoss', short: 'AST/P', full: 'Assists per possession', pct: false, digits: 2 },
  { key: 'trebPct', short: 'TREB', full: 'Rebound %', pct: true },
  { key: 'orebPct', short: 'OREB', full: 'Offensive rebound %', pct: true },
  { key: 'drebPct', short: 'DREB', full: 'Defensive rebound %', pct: true },
];

const CX = 160;
const CY = 160;
const R_OUT = 118;
const R_IN = 74;
const OVERLAP = 0;
const SELECTED_FILL = '#8b5cf6';
const TEAMMATE_FILLS = [
  '#38bdf8',
  '#f59e0b',
  '#34d399',
  '#f43f5e',
  '#22d3ee',
  '#a3e635',
  '#f97316',
  '#facc15',
  '#2dd4bf',
  '#fb7185',
];

function polar(cx: number, cy: number, r: number, a: number) {
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

function donutPath(rOut: number, rIn: number, a0: number, a1: number): string {
  const delta = a1 - a0;
  if (delta >= Math.PI * 2 - 1e-4) {
    return [
      `M ${CX - rOut} ${CY}`,
      `A ${rOut} ${rOut} 0 1 1 ${CX + rOut} ${CY}`,
      `A ${rOut} ${rOut} 0 1 1 ${CX - rOut} ${CY}`,
      `M ${CX - rIn} ${CY}`,
      `A ${rIn} ${rIn} 0 1 0 ${CX + rIn} ${CY}`,
      `A ${rIn} ${rIn} 0 1 0 ${CX - rIn} ${CY}`,
    ].join(' ');
  }
  const large = delta > Math.PI ? 1 : 0;
  const o0 = polar(CX, CY, rOut, a0);
  const o1 = polar(CX, CY, rOut, a1);
  const i1 = polar(CX, CY, rIn, a1);
  const i0 = polar(CX, CY, rIn, a0);
  return [
    `M ${o0.x.toFixed(2)} ${o0.y.toFixed(2)}`,
    `A ${rOut} ${rOut} 0 ${large} 1 ${o1.x.toFixed(2)} ${o1.y.toFixed(2)}`,
    `L ${i1.x.toFixed(2)} ${i1.y.toFixed(2)}`,
    `A ${rIn} ${rIn} 0 ${large} 0 ${i0.x.toFixed(2)} ${i0.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

function mixHex(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  if (!Number.isFinite(pa) || !Number.isFinite(pb)) return a;
  const chan = (shift: number, from: number, to: number) =>
    Math.round(((from >> shift) & 255) + (((to >> shift) & 255) - ((from >> shift) & 255)) * t);
  const r = chan(16, pa, pb);
  const g = chan(8, pa, pb);
  const bl = chan(0, pa, pb);
  return `#${((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1)}`;
}

function yearFromTimeframe(tf: NblChartTimeframe, fallback: number): number {
  const m = String(tf).match(/^season(\d{4})$/);
  return m ? Number(m[1]) : fallback;
}

function playerValue(p: TeamUsagePlayer, key: string): number {
  const fromStats = p.stats?.[key];
  if (typeof fromStats === 'number' && Number.isFinite(fromStats)) return fromStats;
  if (key === 'usgPct' && typeof p.usgPct === 'number') return p.usgPct;
  return 0;
}

function formatStatValue(value: number, pct: boolean, digits = 1): string {
  if (pct) return `${value}%`;
  if (digits <= 1 && Number.isInteger(value)) return String(value);
  return value.toFixed(digits);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

const SWITCH_MS = 900;

function interpolateSlices(from: BuiltSlice[], to: BuiltSlice[], t: number): BuiltSlice[] {
  const fromMap = new Map(from.map((s) => [s.playerId, s]));
  const toMap = new Map(to.map((s) => [s.playerId, s]));
  const ids = [...new Set([...to.map((s) => s.playerId), ...from.map((s) => s.playerId)])];
  const out: BuiltSlice[] = [];
  for (const id of ids) {
    const target = toMap.get(id);
    const prev = fromMap.get(id);
    if (!target) {
      if (!prev) continue;
      const span = lerp(prev.span, 0, t);
      if (span < 0.002) continue;
      const a0 = prev.a0;
      const a1 = a0 + span;
      out.push({
        ...prev,
        value: Math.round(lerp(prev.value, 0, t) * 100) / 100,
        span,
        a0,
        a1,
        path: donutPath(R_OUT, R_IN, a0, a1),
      });
      continue;
    }
    const a0 = lerpAngle(prev?.a0 ?? target.a0, target.a0, t);
    const span = lerp(prev?.span ?? 0, target.span, t);
    const a1 = a0 + span;
    out.push({
      ...target,
      value: Math.round(lerp(prev?.value ?? 0, target.value, t) * 100) / 100,
      span,
      a0,
      a1,
      path: donutPath(R_OUT, R_IN, a0, a1),
    });
  }
  return out;
}

export function NblScoringMixPie({
  team,
  playerId,
  playerName,
  timeframe,
  season = NBL_CURRENT_SEASON_YEAR,
  isDark,
}: {
  team?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  timeframe: NblChartTimeframe;
  season?: number;
  isDark: boolean;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [statKey, setStatKey] = useState('usgPct');
  const [players, setPlayers] = useState<TeamUsagePlayer[] | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'empty' | 'ready'>('idle');
  const [animSlices, setAnimSlices] = useState<BuiltSlice[]>([]);
  const [labelVisible, setLabelVisible] = useState(true);
  const [shownLabel, setShownLabel] = useState(PIE_STATS[0].full);
  const animFromRef = useRef<BuiltSlice[]>([]);
  const teammateFillRef = useRef(new Map<string, string>());

  const activeStat = PIE_STATS.find((s) => s.key === statKey) ?? PIE_STATS[0];

  useEffect(() => {
    const teamName = team?.trim();
    if (!teamName) {
      setPlayers(null);
      setLoadState('empty');
      return;
    }
    const ac = new AbortController();
    setLoadState('loading');
    const year = yearFromTimeframe(timeframe, season);
    const params = new URLSearchParams({
      team: teamName,
      year: String(year),
      tf: String(timeframe),
    });
    if (playerId) params.set('playerId', playerId);
    fetch(`/api/nbl/team-usage?${params}`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('usage'))))
      .then((data: { players?: TeamUsagePlayer[] }) => {
        const rows = Array.isArray(data.players) ? data.players : [];
        setPlayers(rows);
        setLoadState(rows.length ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setPlayers(null);
        setLoadState('empty');
      });
    return () => ac.abort();
  }, [team, playerId, timeframe, season]);

  const slices = useMemo(() => {
    if (!players?.length) return [] as BuiltSlice[];
    const selectedKey = (playerId || playerName || '').toLowerCase();
    const rows = players
      .map((p) => ({ ...p, value: Math.max(0, playerValue(p, activeStat.key)) }))
      .filter((p) => p.value > 0 || (playerId && p.playerId === playerId));
    const total = rows.reduce((s, p) => s + p.value, 0);
    if (total <= 0) return [] as BuiltSlice[];

    const ranked = rows.slice().sort((a, b) => b.value - a.value);
    const defs = ranked.map((p) => {
      const isSelected =
        (playerId && p.playerId === playerId) ||
        (!!playerName && p.name.toLowerCase() === playerName.toLowerCase()) ||
        (!!selectedKey && p.playerId.toLowerCase() === selectedKey);
      const fill = isSelected
        ? SELECTED_FILL
        : (() => {
            const map = teammateFillRef.current;
            if (!map.has(p.playerId)) {
              map.set(p.playerId, TEAMMATE_FILLS[map.size % TEAMMATE_FILLS.length]);
            }
            return map.get(p.playerId) as string;
          })();
      return { ...p, fill, isSelected, span: (p.value / total) * Math.PI * 2 };
    });

    let a0 = -Math.PI / 2;
    const placed: BuiltSlice[] = [];
    for (const item of defs) {
      const a1 = a0 + item.span;
      const overlap = defs.length === 1 ? 0 : OVERLAP;
      placed.push({
        playerId: item.playerId,
        name: item.name,
        value: item.value,
        fill: item.fill,
        share: total > 0 ? item.value / total : 0,
        span: item.span,
        a0,
        a1,
        path: donutPath(R_OUT, R_IN, a0 - overlap, a1 + overlap),
        isSelected: item.isSelected,
      });
      a0 = a1;
    }
    return placed;
  }, [players, playerId, playerName, activeStat.key]);

  useEffect(() => {
    const to = slices;
    const from = animFromRef.current;
    if (!to.length) {
      animFromRef.current = [];
      setAnimSlices([]);
      return;
    }
    if (!from.length) {
      animFromRef.current = to;
      setAnimSlices(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / SWITCH_MS);
      const next = interpolateSlices(from, to, easeInOutCubic(t));
      animFromRef.current = next;
      setAnimSlices(next);
      if (t < 1) raf = requestAnimationFrame(tick);
      else {
        animFromRef.current = to;
        setAnimSlices(to);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [slices]);

  useEffect(() => {
    if (shownLabel === activeStat.full) {
      setLabelVisible(true);
      return;
    }
    setLabelVisible(false);
    const t = window.setTimeout(() => {
      setShownLabel(activeStat.full);
      setLabelVisible(true);
    }, 280);
    return () => window.clearTimeout(t);
  }, [activeStat.full, shownLabel]);

  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const heading = isDark ? 'text-gray-100' : 'text-gray-800';
  const ring = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
  const hole = isDark ? '#0a1929' : '#ffffff';
  const painted = animSlices.length ? animSlices : slices;
  const paintedById = new Map(painted.map((s) => [s.playerId, s]));
  const maxVal = slices.reduce((m, s) => Math.max(m, s.value), 0) || 1;
  const activeIdx = Math.max(0, PIE_STATS.findIndex((s) => s.key === activeStat.key));

  const tabPct = 100 / PIE_STATS.length;
  const header = (
    <div className="flex flex-col gap-2.5 px-3 sm:px-4">
      <h3 className={`text-sm font-semibold ${heading}`}>Advanced averages</h3>
      <div
        role="tablist"
        aria-label="Advanced stat"
        className={`relative grid p-0.5 rounded-md ${
          isDark ? 'bg-white/[0.06]' : 'bg-black/[0.06]'
        }`}
        style={{ gridTemplateColumns: `repeat(${PIE_STATS.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 bottom-0.5 rounded-[5px] transition-[left] duration-700 ease-in-out ${
            isDark ? 'bg-white/12' : 'bg-white shadow-sm'
          }`}
          style={{
            left: `calc(${activeIdx} * ${tabPct}% + 2px)`,
            width: `calc(${tabPct}% - 4px)`,
          }}
        />
        {PIE_STATS.map((stat) => {
          const on = stat.key === activeStat.key;
          return (
            <button
              key={stat.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => {
                setStatKey(stat.key);
                setHoverId(null);
              }}
              className={`relative z-[1] px-1 py-1 text-[10px] sm:text-[11px] font-medium tracking-[0.02em] rounded-[5px] transition-colors duration-500 ${
                on
                  ? isDark
                    ? 'text-gray-100'
                    : 'text-gray-900'
                  : isDark
                    ? 'text-gray-500 hover:text-gray-300'
                    : 'text-gray-500 hover:text-gray-800'
              }`}
            >
              {stat.short}
            </button>
          );
        })}
      </div>
    </div>
  );

  if (loadState === 'loading' || loadState === 'idle') {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {header}
        <div className={`min-h-[280px] flex items-center justify-center text-sm ${muted}`}>Loading team stats</div>
      </div>
    );
  }

  if (!slices.length) {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {header}
        <div className={`min-h-[280px] flex items-center justify-center text-sm ${muted}`}>No team data for this stat</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {header}
      <div className="flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8 px-3 sm:px-4 min-w-0">
        <div className="relative w-full max-w-[320px] mx-auto sm:mx-0 flex-shrink-0">
          <svg viewBox="0 0 320 320" className="w-full h-auto" role="img" aria-label={activeStat.full}>
            <circle cx={CX} cy={CY} r={R_OUT + 3} fill="none" stroke={ring} strokeWidth="1" />
            {painted
              .slice()
              .sort((a, b) => Number(a.isSelected) - Number(b.isSelected))
              .map((slice) => {
                const dimmed = hoverId != null && hoverId !== slice.playerId;
                return (
                  <path
                    key={slice.playerId}
                    d={slice.path}
                    fill={dimmed ? mixHex(slice.fill, hole, 0.62) : slice.fill}
                    stroke="none"
                    className="cursor-pointer"
                    style={{ transition: 'fill 220ms ease' }}
                    onMouseEnter={() => setHoverId(slice.playerId)}
                    onMouseLeave={() => setHoverId(null)}
                  />
                );
              })}
            <circle cx={CX} cy={CY} r={R_IN - 1.5} fill={hole} className="pointer-events-none" />
            <foreignObject x={CX - 62} y={CY - 62} width={124} height={124} className="pointer-events-none">
              <div className="flex h-full w-full items-center justify-center px-2 text-center">
                <span
                  className="text-[12px] sm:text-[13px] font-bold leading-[1.2]"
                  style={{
                    color: isDark ? '#9ca3af' : '#6b7280',
                    opacity: labelVisible ? 1 : 0,
                    transform: labelVisible ? 'translateY(0)' : 'translateY(5px)',
                    transition: 'opacity 280ms ease, transform 280ms ease',
                  }}
                >
                  {shownLabel}
                </span>
              </div>
            </foreignObject>
          </svg>
        </div>

        <div className="flex flex-col gap-1.5 min-w-[200px] flex-1 max-h-[320px] overflow-y-auto pr-1">
          {slices
            .slice()
            .sort((a, b) => b.value - a.value)
            .map((slice) => {
              const live = paintedById.get(slice.playerId) ?? slice;
              const isHover = hoverId === slice.playerId;
              return (
                <button
                  key={slice.playerId}
                  type="button"
                  onMouseEnter={() => setHoverId(slice.playerId)}
                  onMouseLeave={() => setHoverId(null)}
                  className={`w-full text-left rounded-md px-2 py-1.5 transition-all duration-500 ${
                    isHover
                      ? isDark
                        ? 'bg-white/12'
                        : 'bg-black/[0.08]'
                      : 'bg-transparent'
                  }`}
                  style={{
                    boxShadow: isHover ? `inset 3px 0 0 ${slice.fill}` : undefined,
                  }}
                >
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="flex items-center gap-2 min-w-0">
                      <span
                        className={`rounded-full flex-shrink-0 transition-all duration-300 ${isHover ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
                        style={{ background: slice.fill }}
                      />
                      <span
                        className={`text-[13px] leading-tight break-words transition-colors duration-300 ${
                          isHover ? 'font-bold' : heading
                        }`}
                        style={isHover ? { color: slice.fill } : undefined}
                      >
                        {slice.name}
                      </span>
                    </span>
                    <span
                      className={`text-[13px] tabular-nums transition-colors duration-300 ${
                        isHover ? 'font-bold' : 'font-semibold'
                      } ${heading}`}
                      style={isHover ? { color: slice.fill } : undefined}
                    >
                      {formatStatValue(live.value, activeStat.pct, activeStat.digits ?? 1)}
                    </span>
                  </div>
                  <div className={`mt-1 h-[3px] rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${(live.value / maxVal) * 100}%`,
                        background: slice.fill,
                        opacity: hoverId != null && !isHover ? 0.35 : 1,
                        transition: 'opacity 220ms ease',
                      }}
                    />
                  </div>
                </button>
              );
            })}
        </div>
      </div>
    </div>
  );
}
