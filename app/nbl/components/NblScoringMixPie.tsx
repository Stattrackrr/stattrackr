'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { NblChartTimeframe } from '@/app/nbl/components/NblStatsChart';
import { NBL_CURRENT_SEASON_YEAR, normalizeTeamKey, resolveNblClubName } from '@/lib/nblTeamCanonical';

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
const EMPTY_SLICE_FILL_DARK = '#4b5563';
const EMPTY_SLICE_FILL_LIGHT = '#9ca3af';
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

function wrapPieLabel(label: string, maxChars = 11): string[] {
  const words = String(label || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxChars) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 3);
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

function slicesLookSame(a: BuiltSlice[], b: BuiltSlice[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i].playerId !== b[i].playerId) return false;
    if (Math.abs(a[i].value - b[i].value) > 0.05) return false;
    if (Math.abs(a[i].span - b[i].span) > 0.01) return false;
  }
  return true;
}

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

type PieRosterPlayer = {
  playerId: string | null;
  name: string;
  team?: string | null;
};

export function NblScoringMixPie({
  team,
  playerId,
  playerName,
  timeframe,
  season = NBL_CURRENT_SEASON_YEAR,
  isDark,
  rosterPlayers = [],
  teammateFilterName = null,
  setTeammateFilterName,
  withWithoutMode = 'with',
  setWithWithoutMode,
  clearTeammateFilter,
  valuesLocked = false,
}: {
  team?: string | null;
  playerId?: string | null;
  playerName?: string | null;
  timeframe: NblChartTimeframe;
  season?: number;
  isDark: boolean;
  rosterPlayers?: PieRosterPlayer[];
  teammateFilterName?: string | null;
  setTeammateFilterName?: (name: string | null) => void;
  withWithoutMode?: 'with' | 'without';
  setWithWithoutMode?: (mode: 'with' | 'without') => void;
  clearTeammateFilter?: () => void;
  /** Free accounts see the layout with stat figures replaced by TBD. */
  valuesLocked?: boolean;
}) {
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [statKey, setStatKey] = useState('usgPct');
  const [players, setPlayers] = useState<TeamUsagePlayer[] | null>(null);
  const [splitSampleGames, setSplitSampleGames] = useState<number | null>(null);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'empty' | 'ready'>('idle');
  const [animSlices, setAnimSlices] = useState<BuiltSlice[]>([]);
  const [labelVisible, setLabelVisible] = useState(true);
  const [shownLabel, setShownLabel] = useState(PIE_STATS[0].full);
  const [teammateMenuOpen, setTeammateMenuOpen] = useState(false);
  const teammateMenuRef = useRef<HTMLDivElement>(null);
  const selectedRowRef = useRef<HTMLButtonElement | null>(null);
  const namesListRef = useRef<HTMLDivElement | null>(null);
  const pieBoxRef = useRef<HTMLDivElement | null>(null);
  const [pieBoxSize, setPieBoxSize] = useState(0);
  const animFromRef = useRef<BuiltSlice[]>([]);
  const teammateFillRef = useRef(new Map<string, string>());

  const activeStat = PIE_STATS.find((s) => s.key === statKey) ?? PIE_STATS[0];

  const teammateOptions = useMemo(() => {
    const selfName = String(playerName || '').trim().toLowerCase();
    const selfId = String(playerId || '').trim();
    const teamKey = normalizeTeamKey(resolveNblClubName(team) || team || '');
    return rosterPlayers
      .filter((p) => {
        const id = String(p.playerId || '').trim();
        const name = String(p.name || '').trim();
        if (!id || !name) return false;
        if (selfId && id === selfId) return false;
        if (selfName && name.toLowerCase() === selfName) return false;
        if (!teamKey) return true;
        const playerTeam = normalizeTeamKey(resolveNblClubName(p.team) || p.team || '');
        return !playerTeam || playerTeam === teamKey;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [rosterPlayers, team, playerId, playerName]);

  useEffect(() => {
    if (!teammateMenuOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (teammateMenuRef.current && !teammateMenuRef.current.contains(e.target as Node)) {
        setTeammateMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [teammateMenuOpen]);

  const canEditTeammate = Boolean(setTeammateFilterName && setWithWithoutMode);
  const activeTeammate = teammateFilterName?.trim() || null;
  const playersRef = useRef(players);
  playersRef.current = players;
  const teammateId = useMemo(() => {
    if (!activeTeammate) return null;
    const want = activeTeammate.toLowerCase();
    return (
      rosterPlayers.find((p) => String(p.name || '').trim().toLowerCase() === want)?.playerId ||
      null
    );
  }, [activeTeammate, rosterPlayers]);

  useEffect(() => {
    const teamName = team?.trim();
    if (!teamName) {
      setPlayers(null);
      setSplitSampleGames(null);
      setLoadState('empty');
      return;
    }
    const ac = new AbortController();
    const hadPlayers = (playersRef.current?.length ?? 0) > 0;
    if (!hadPlayers) setLoadState('loading');
    const year = yearFromTimeframe(timeframe, season);
    const params = new URLSearchParams({
      team: teamName,
      year: String(year),
      tf: String(timeframe),
    });
    if (playerId) params.set('playerId', playerId);
    if (activeTeammate) {
      params.set('teammateName', activeTeammate);
      params.set('ww', withWithoutMode);
      if (teammateId) params.set('teammateId', teammateId);
    }
    fetch(`/api/nbl/team-usage?${params}`, { signal: ac.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error('usage'))))
      .then((data: { players?: TeamUsagePlayer[]; sampleGames?: number | null }) => {
        const rows = Array.isArray(data.players) ? data.players : [];
        setPlayers(rows);
        setSplitSampleGames(typeof data.sampleGames === 'number' ? data.sampleGames : null);
        setLoadState(rows.length ? 'ready' : 'empty');
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        if (!hadPlayers) {
          setPlayers(null);
          setSplitSampleGames(null);
          setLoadState('empty');
        }
      });
    return () => ac.abort();
  }, [team, playerId, timeframe, season, activeTeammate, withWithoutMode, teammateId]);

  const emptySplit = Boolean(activeTeammate && splitSampleGames === 0);

  const slices = useMemo(() => {
    if (!players?.length) return [] as BuiltSlice[];
    const selectedKey = (playerId || playerName || '').toLowerCase();
    const grey = isDark ? EMPTY_SLICE_FILL_DARK : EMPTY_SLICE_FILL_LIGHT;
    const rows = players
      .map((p) => ({ ...p, value: Math.max(0, playerValue(p, activeStat.key)) }))
      .filter((p) => emptySplit || p.value > 0 || (playerId && p.playerId === playerId));
    const total = rows.reduce((s, p) => s + p.value, 0);
    if (!rows.length) return [] as BuiltSlice[];
    if (!emptySplit && total <= 0) return [] as BuiltSlice[];

    const ranked = rows.slice().sort((a, b) => {
      const aSel =
        (playerId && a.playerId === playerId) ||
        (!!playerName && a.name.toLowerCase() === playerName.toLowerCase());
      const bSel =
        (playerId && b.playerId === playerId) ||
        (!!playerName && b.name.toLowerCase() === playerName.toLowerCase());
      if (aSel !== bSel) return aSel ? -1 : 1;
      return b.value - a.value;
    });
    const equalSpan = (Math.PI * 2) / ranked.length;
    const defs = ranked.map((p) => {
      const isSelected =
        (playerId && p.playerId === playerId) ||
        (!!playerName && p.name.toLowerCase() === playerName.toLowerCase()) ||
        (!!selectedKey && p.playerId.toLowerCase() === selectedKey);
      const fill = emptySplit
        ? grey
        : isSelected
          ? SELECTED_FILL
          : (() => {
              const map = teammateFillRef.current;
              if (!map.has(p.playerId)) {
                map.set(p.playerId, TEAMMATE_FILLS[map.size % TEAMMATE_FILLS.length]);
              }
              return map.get(p.playerId) as string;
            })();
      const span = emptySplit || valuesLocked ? equalSpan : (p.value / total) * Math.PI * 2;
      return { ...p, fill, isSelected, span };
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
        share: emptySplit || valuesLocked ? 1 / defs.length : total > 0 ? item.value / total : 0,
        span: item.span,
        a0,
        a1,
        path: donutPath(R_OUT, R_IN, a0 - overlap, a1 + overlap),
        isSelected: item.isSelected,
      });
      a0 = a1;
    }
    return placed;
  }, [players, playerId, playerName, activeStat.key, emptySplit, isDark, valuesLocked]);

  useEffect(() => {
    const to = slices;
    const from = animFromRef.current;
    if (!to.length) {
      animFromRef.current = [];
      setAnimSlices([]);
      return;
    }
    if (!from.length || slicesLookSame(from, to)) {
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
    if (emptySplit) return;
    const t = window.setTimeout(() => {
      const list = namesListRef.current;
      const row = selectedRowRef.current;
      if (!list || !row) return;
      const listBox = list.getBoundingClientRect();
      const rowBox = row.getBoundingClientRect();
      if (rowBox.top < listBox.top || rowBox.bottom > listBox.bottom) {
        list.scrollTop += rowBox.top - listBox.top - Math.max(0, (listBox.height - rowBox.height) / 2);
      }
    }, 80);
    return () => window.clearTimeout(t);
  }, [emptySplit, playerId, playerName, slices]);

  useEffect(() => {
    const el = pieBoxRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect().width;
      const svg = el.querySelector('svg');
      const svgH = svg?.getBoundingClientRect().height ?? 0;
      const size = Math.round(Math.max(box, svgH));
      const desktop = window.matchMedia('(min-width: 1024px)').matches;
      const next = desktop ? Math.min(size, 320) : size;
      if (next > 0) setPieBoxSize(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loadState]);

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

  const sampleGames = useMemo(() => {
    if (activeTeammate && splitSampleGames != null) return splitSampleGames;
    if (!players?.length) return null;
    const self =
      (playerId && players.find((p) => p.playerId === playerId)) ||
      (playerName &&
        players.find((p) => p.name.toLowerCase() === playerName.toLowerCase())) ||
      null;
    return typeof self?.games === 'number' ? self.games : null;
  }, [players, playerId, playerName, activeTeammate, splitSampleGames]);

  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const heading = isDark ? 'text-gray-100' : 'text-gray-800';
  const ring = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(15,23,42,0.08)';
  const hole = isDark ? '#0a1929' : '#ffffff';
  const painted = animSlices.length ? animSlices : slices;
  const paintedById = new Map(painted.map((s) => [s.playerId, s]));
  const maxVal = slices.reduce((m, s) => Math.max(m, s.value), 0) || 1;
  const pieLabelLines = emptySplit ? ['0 games'] : wrapPieLabel(shownLabel);
  const pieLabelCount = Math.max(1, pieLabelLines.length);
  const pieLabelSize = pieLabelCount >= 3 ? 16 : pieLabelCount === 2 ? 19 : 24;
  const pieLabelLineHeight = pieLabelSize * 1.18;
  const pieLabelStartY = CY - ((pieLabelCount - 1) * pieLabelLineHeight) / 2;
  const activeIdx = Math.max(0, PIE_STATS.findIndex((s) => s.key === activeStat.key));

  const tabPct = 100 / PIE_STATS.length;
  const controlShell = `h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white`;
  const controlActive =
    'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200';
  const header = (
    <div className="flex flex-col gap-2.5 px-3 sm:px-4">
      <div className="flex items-end justify-between gap-3">
        <h3 className={`text-sm font-semibold ${heading}`}>Advanced averages</h3>
        <span className={`text-[11px] font-medium truncate sm:hidden ${muted}`}>{activeStat.full}</span>
      </div>
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
      {canEditTeammate ? (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          {activeTeammate && !emptySplit ? (
            <p className={`text-[11px] ${muted}`}>
              {valuesLocked
                ? `TBD games ${withWithoutMode === 'without' ? 'without' : 'with'} ${activeTeammate}`
                : sampleGames != null
                  ? `${sampleGames} ${sampleGames === 1 ? 'game' : 'games'} ${
                      withWithoutMode === 'without' ? 'without' : 'with'
                    } ${activeTeammate}`
                  : `${withWithoutMode === 'without' ? 'Without' : 'With'} ${activeTeammate}`}
            </p>
          ) : (
            <span className="hidden sm:block" />
          )}
          <div className="flex items-center gap-2 min-w-0 sm:justify-end">
            <div className={`inline-flex p-0.5 ${controlShell}`}>
              {(['with', 'without'] as const).map((mode) => {
                const on = withWithoutMode === mode;
                return (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setWithWithoutMode?.(mode)}
                    className={`px-2.5 h-[26px] rounded-[10px] text-xs font-medium transition-colors ${
                      on
                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200'
                        : isDark
                          ? 'text-gray-400 hover:text-gray-200'
                          : 'text-gray-500 hover:text-gray-800'
                    }`}
                  >
                    {mode === 'with' ? 'With' : 'Without'}
                  </button>
                );
              })}
            </div>
            <div className="relative min-w-0 flex-1 sm:flex-none sm:w-[190px]" ref={teammateMenuRef}>
              <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setTeammateMenuOpen((open) => !open)}
                className={`min-w-0 flex-1 ${controlShell} px-2.5 flex items-center justify-between gap-1.5 hover:bg-gray-50 dark:hover:bg-gray-600 ${
                  activeTeammate ? controlActive : ''
                }`}
              >
                <span className={`truncate ${activeTeammate ? '' : muted}`}>
                  {activeTeammate || 'Teammate'}
                </span>
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {activeTeammate ? (
                <button
                  type="button"
                  aria-label="Clear teammate"
                  onClick={() => {
                    clearTeammateFilter?.();
                    setTeammateFilterName?.(null);
                    setTeammateMenuOpen(false);
                  }}
                  className={`${controlShell} w-[32px] px-0 flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600`}
                >
                  <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                    <path d="M1 1L7 7M7 1L1 7" />
                  </svg>
                </button>
              ) : null}
              </div>
              {teammateMenuOpen ? (
                <>
                  <div
                    className={`absolute top-full right-0 mt-1 w-full min-w-[190px] max-h-64 overflow-y-auto rounded-lg border shadow-lg z-50 ${
                      isDark ? 'border-gray-600 bg-[#0a1929]' : 'border-gray-300 bg-white'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        clearTeammateFilter?.();
                        setTeammateFilterName?.(null);
                        setTeammateMenuOpen(false);
                      }}
                      className={`w-full text-left px-2.5 py-1.5 text-xs font-medium first:rounded-t-lg ${
                        !activeTeammate
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : isDark
                            ? 'text-white hover:bg-gray-800'
                            : 'text-gray-900 hover:bg-gray-100'
                      }`}
                    >
                      Any teammate
                    </button>
                    {teammateOptions.map((mate) => {
                      const selected = activeTeammate === mate.name;
                      return (
                        <button
                          key={mate.playerId || mate.name}
                          type="button"
                          onClick={() => {
                            setTeammateFilterName?.(mate.name);
                            setTeammateMenuOpen(false);
                          }}
                          className={`w-full text-left px-2.5 py-1.5 text-xs font-medium last:rounded-b-lg ${
                            selected
                              ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                              : isDark
                                ? 'text-white hover:bg-gray-800'
                                : 'text-gray-900 hover:bg-gray-100'
                          }`}
                        >
                          {mate.name}
                        </button>
                      );
                    })}
                  </div>
                  <div className="fixed inset-0 z-40" onClick={() => setTeammateMenuOpen(false)} aria-hidden />
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
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
        <div className={`min-h-[280px] flex items-center justify-center text-sm ${muted}`}>
          {activeTeammate
            ? `No ${activeStat.short} sample ${withWithoutMode === 'without' ? 'without' : 'with'} ${activeTeammate}`
            : 'No team data for this stat'}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 min-w-0 w-full">
      {header}
      <div
        className={`w-full px-3 sm:px-4 lg:px-3 rounded-xl pt-3 pb-2 min-w-0 overflow-visible box-border ${
          isDark
            ? 'bg-white/[0.035] ring-1 ring-white/10'
            : 'bg-slate-50 ring-1 ring-black/[0.06]'
        }`}
      >
        <div className="flex flex-row items-start gap-3.5 sm:gap-8 min-w-0 w-full overflow-visible">
          <div
            ref={pieBoxRef}
            className="relative w-[46%] max-w-[196px] sm:w-[44%] sm:max-w-none lg:w-[320px] lg:max-w-[320px] flex-shrink-0 aspect-square overflow-visible"
          >
            <svg
              viewBox="0 0 320 320"
              className="w-[128%] max-w-none -ml-[16%] h-auto sm:w-full sm:h-full sm:ml-0 lg:w-full lg:h-full lg:ml-0"
              role="img"
              aria-label={activeStat.full}
            >
              <defs>
                <filter id="nbl-selected-slice" x="-25%" y="-25%" width="150%" height="150%">
                  <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#8b5cf6" floodOpacity="0.7" />
                </filter>
              </defs>
              <circle cx={CX} cy={CY} r={R_OUT + 3} fill="none" stroke={ring} strokeWidth="1" />
              {painted
                .slice()
                .sort((a, b) => Number(a.isSelected) - Number(b.isSelected))
                .map((slice) => {
                  const selected = !emptySplit && slice.isSelected;
                  const hovered = !emptySplit && hoverId === slice.playerId;
                  const fill =
                    emptySplit || selected || hovered
                      ? slice.fill
                      : mixHex(slice.fill, hole, hoverId != null ? 0.62 : 0.28);
                  return (
                    <path
                      key={slice.playerId}
                      d={
                        selected
                          ? donutPath(R_OUT + 8, R_IN - 1, slice.a0, slice.a1)
                          : slice.path
                      }
                      fill={fill}
                      stroke={selected ? (isDark ? '#ddd6fe' : '#ede9fe') : 'none'}
                      strokeWidth={selected ? 2.25 : 0}
                      filter={selected ? 'url(#nbl-selected-slice)' : undefined}
                      className={emptySplit ? undefined : 'cursor-pointer'}
                      style={{ transition: 'fill 220ms ease' }}
                      onMouseEnter={() => !emptySplit && setHoverId(slice.playerId)}
                      onMouseLeave={() => setHoverId(null)}
                      onClick={() => {
                        if (emptySplit) return;
                        setHoverId((id) => (id === slice.playerId ? null : slice.playerId));
                      }}
                    />
                  );
                })}
              <circle cx={CX} cy={CY} r={R_IN - 1.5} fill={hole} className="pointer-events-none" />
              <g
                className="pointer-events-none"
                style={{
                  opacity: emptySplit || labelVisible ? 1 : 0,
                  transition: 'opacity 280ms ease',
                }}
              >
                {pieLabelLines.map((line, i) => (
                  <text
                    key={`${line}-${i}`}
                    x={CX}
                    y={pieLabelStartY + i * pieLabelLineHeight}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={isDark ? '#d1d5db' : '#4b5563'}
                    fontSize={pieLabelSize}
                    fontWeight={700}
                    fontFamily="inherit"
                  >
                    {line}
                  </text>
                ))}
              </g>
            </svg>
          </div>

          <div
            ref={namesListRef}
            className="nbl-pie-names-scroll flex flex-col gap-1 sm:gap-1.5 min-w-0 flex-1 min-h-0 overflow-y-scroll overscroll-contain touch-pan-y ml-1.5 sm:ml-0 pr-1 custom-scrollbar"
            style={
              pieBoxSize > 0
                ? {
                    height: pieBoxSize,
                    maxHeight: pieBoxSize,
                    scrollbarGutter: 'stable',
                  }
                : { scrollbarGutter: 'stable' }
            }
            onWheel={(e) => e.stopPropagation()}
          >
            {slices
              .slice()
              .sort((a, b) => (emptySplit ? 0 : b.value - a.value))
              .map((slice) => {
                const live = paintedById.get(slice.playerId) ?? slice;
                const selected = !emptySplit && slice.isSelected;
                const isHover = !emptySplit && hoverId === slice.playerId;
                const emphasized = selected || isHover;
                const barFill = emptySplit
                  ? isDark
                    ? EMPTY_SLICE_FILL_DARK
                    : EMPTY_SLICE_FILL_LIGHT
                  : slice.fill;
                return (
                  <button
                    key={slice.playerId}
                    type="button"
                    ref={selected ? selectedRowRef : undefined}
                    onMouseEnter={() => !emptySplit && setHoverId(slice.playerId)}
                    onMouseLeave={() => setHoverId(null)}
                    onClick={() => {
                      if (emptySplit) return;
                      setHoverId((id) => (id === slice.playerId ? null : slice.playerId));
                    }}
                    className={`w-full text-left rounded-lg px-1.5 sm:px-2 py-1 sm:py-1.5 transition-all duration-500 ${
                      selected
                        ? isDark
                          ? 'bg-violet-500/25'
                          : 'bg-violet-50'
                        : isHover
                          ? isDark
                            ? 'bg-white/12'
                            : 'bg-black/[0.08]'
                          : 'bg-transparent'
                    }`}
                    style={{
                      boxShadow: selected
                        ? `inset 3px 0 0 ${slice.fill}, 0 0 0 1px ${isDark ? 'rgba(196,181,253,0.55)' : 'rgba(167,139,250,0.7)'}`
                        : isHover
                          ? `inset 3px 0 0 ${slice.fill}`
                          : undefined,
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2 sm:gap-3">
                      <span className="flex items-center gap-1.5 sm:gap-2 min-w-0">
                        <span
                          className={`rounded-full flex-shrink-0 transition-all duration-300 ${emphasized ? 'h-2.5 w-2.5' : 'h-2 w-2'}`}
                          style={{ background: barFill }}
                        />
                        <span
                          className={`text-[12px] sm:text-[13px] leading-tight truncate transition-colors duration-300 ${
                            emptySplit ? muted : emphasized ? 'font-bold' : heading
                          }`}
                          style={!emptySplit && emphasized ? { color: slice.fill } : undefined}
                        >
                          {slice.name}
                        </span>
                      </span>
                      <span
                        className={`text-[12px] sm:text-[13px] tabular-nums flex-shrink-0 transition-colors duration-300 ${
                          emptySplit
                            ? muted
                            : `${emphasized ? 'font-bold' : 'font-semibold'} ${heading}`
                        }`}
                        style={!emptySplit && emphasized ? { color: slice.fill } : undefined}
                      >
                        {valuesLocked ? 'TBD' : emptySplit ? '—' : formatStatValue(live.value, activeStat.pct, activeStat.digits ?? 1)}
                      </span>
                    </div>
                    <div className={`mt-1 h-1 sm:h-[3px] rounded-full overflow-hidden ${isDark ? 'bg-white/10' : 'bg-black/10'}`}>
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: valuesLocked ? '42%' : emptySplit ? '100%' : `${(live.value / maxVal) * 100}%`,
                          background: barFill,
                          opacity: emptySplit ? 0.55 : hoverId != null && !isHover && !selected ? 0.35 : 1,
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
    </div>
  );
}
