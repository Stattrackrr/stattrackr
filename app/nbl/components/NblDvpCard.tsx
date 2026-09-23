'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  NBL_PLAY_TYPE_STAT_LABELS,
  NBL_PLAY_TYPE_YEAR,
  type NblPlayTypeCell,
  type NblPlayTypeRoundPick,
  type NblPlayTypesPayload,
} from '@/lib/nbl/playTypesShared';
import { nblSeasonLabel } from '@/lib/nblTeamCanonical';
import { resolveNblSteTeamCode } from '@/lib/nbl/teamSteStatsShared';

function fmtBoost(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  if (Object.is(rounded, -0) || rounded === 0) return '0.0';
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}`;
}

function boostChipClasses(boost: number | null, isDark: boolean): { tone: string; wrap: string } {
  if (boost == null || !Number.isFinite(boost)) {
    return {
      tone: isDark ? 'text-slate-400' : 'text-slate-500',
      wrap: isDark ? 'bg-white/5' : 'bg-gray-100',
    };
  }
  if (boost > 0.15) {
    return {
      tone: isDark ? 'text-emerald-300' : 'text-emerald-700',
      wrap: isDark ? 'bg-emerald-500/20' : 'bg-emerald-50',
    };
  }
  if (boost < -0.15) {
    return {
      tone: isDark ? 'text-red-300' : 'text-red-700',
      wrap: isDark ? 'bg-red-500/20' : 'bg-red-50',
    };
  }
  return {
    tone: isDark ? 'text-slate-200' : 'text-slate-700',
    wrap: isDark ? 'bg-white/5' : 'bg-gray-100',
  };
}

function sampleAlpha(cell: NblPlayTypeCell | undefined): number {
  if (!cell || cell.boost == null) return 0.16;
  const gamePart = Math.min(1, cell.games / 14);
  const playerPart = Math.min(1, cell.players / 5);
  const confidence = 0.5 + 0.5 * Math.min(gamePart, playerPart);
  return cell.significant ? Math.max(0.64, confidence) : Math.max(0.5, confidence);
}

function cellBackground(cell: NblPlayTypeCell | undefined, isDark: boolean, emphasize: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'rgba(148,163,184,0.10)' : 'rgba(148,163,184,0.12)';
  }
  const mag = Math.min(1, Math.abs(boost) / 2.0);
  const alpha = sampleAlpha(cell) * (0.62 + 0.38 * mag) * (emphasize ? 1.1 : 1);
  const capped = Math.min(isDark ? 0.62 : 0.42, alpha);
  if (boost > 0.15) return `rgba(16, 185, 129, ${capped})`;
  if (boost < -0.15) return `rgba(239, 68, 68, ${capped})`;
  return isDark ? 'rgba(148,163,184,0.12)' : 'rgba(148,163,184,0.14)';
}

function cellTextClass(cell: NblPlayTypeCell | undefined, isDark: boolean, emphasize: boolean): string {
  const boost = cell?.boost;
  if (boost == null || !Number.isFinite(boost)) {
    return isDark ? 'text-slate-500' : 'text-slate-400';
  }
  if (boost > 0.15) return isDark ? 'text-emerald-200' : 'text-emerald-900';
  if (boost < -0.15) return isDark ? 'text-red-200' : 'text-red-900';
  if (!cell?.significant && !emphasize) return isDark ? 'text-slate-300' : 'text-slate-500';
  return isDark ? 'text-slate-200' : 'text-slate-700';
}

function cellTitle(rowLabel: string, teamName: string, cell: NblPlayTypeCell | undefined): string {
  if (!cell || cell.boost == null) return `${rowLabel} vs ${teamName}: no sample`;
  const names = cell.names.length ? ` · ${cell.names.join(', ')}` : '';
  const allowed =
    cell.allowed != null && cell.league != null
      ? `allowed ${cell.allowed.toFixed(1)} vs ${cell.league.toFixed(1)} type avg`
      : fmtBoost(cell.boost);
  const rank =
    typeof cell.rank === 'number' && cell.rank > 0
      ? ` · #${cell.rank}/${cell.fieldSize || 10}`
      : '';
  return `${rowLabel} vs ${teamName}: ${fmtBoost(cell.boost)} (${allowed}${rank} · ${cell.games} g, ${cell.players} players)${names}`;
}

function fmtStat(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(1);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return `${Math.round(value)}%`;
}

const MATRIX_STAT_CHIPS = ['PTS', 'AST', 'REB'] as const;

function chartStatLabel(stat: string): string {
  const key = String(stat || '').trim();
  if (key in NBL_PLAY_TYPE_STAT_LABELS) {
    return NBL_PLAY_TYPE_STAT_LABELS[key as keyof typeof NBL_PLAY_TYPE_STAT_LABELS];
  }
  const map: Record<string, string> = {
    minutes: 'MINS',
    threeMade: '3PM',
    threeAttempted: '3PA',
    threePct: '3P%',
    fgMade: 'FGM',
    fgAttempted: 'FGA',
    fgPct: 'FG%',
    twoMade: '2PM',
    twoAttempted: '2PA',
    twoPct: '2P%',
    ftMade: 'FTM',
    ftAttempted: 'FTA',
    ftPct: 'FT%',
    pra: 'PRA',
    pr: 'PR',
    pa: 'PA',
    ra: 'RA',
    steals: 'STL',
    blocks: 'BLK',
    turnovers: 'TO',
    fouls: 'PF',
    usgPct: 'USG%',
    tsPct: 'TS%',
    trebPct: 'TREB%',
    orebPct: 'OREB%',
    drebPct: 'DREB%',
    pace: 'PACE',
    efficiency: 'EFF',
  };
  return map[key] || key.toUpperCase();
}

function opponentShort(pick: NblPlayTypeRoundPick, teams: NblPlayTypesPayload['teams']): string {
  if (pick.opponentCode) {
    const hit = teams.find((t) => t.code === pick.opponentCode);
    if (hit) return hit.code;
  }
  return pick.opponent.replace(/^.*\s/, '').slice(0, 8);
}

function playerInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 1).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function WeekPickAvatar({
  name,
  imageUrl,
  isDark,
}: {
  name: string;
  imageUrl: string | null;
  isDark: boolean;
}) {
  const src = imageUrl?.trim() || null;
  const [failed, setFailed] = useState(false);
  const showPhoto = Boolean(src) && !failed;

  return (
    <div
      className={`relative h-9 w-9 shrink-0 overflow-hidden rounded-full ${
        isDark ? 'bg-slate-800 text-slate-300' : 'bg-slate-200 text-slate-600'
      }`}
    >
      <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[10px] font-bold">
        {playerInitials(name)}
      </span>
      {src && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          decoding="async"
          className={`absolute inset-0 h-full w-full object-cover object-top ${
            showPhoto ? 'opacity-100' : 'opacity-0'
          }`}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

export function PlayTypesInfoButton({
  isDark,
  onAccent = false,
}: {
  isDark: boolean;
  onAccent?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const hovering = useRef(false);

  useEffect(() => {
    if (!onAccent) {
      hovering.current = false;
      setOpen(false);
    }
  }, [onAccent]);

  return (
    <span
      className={`relative inline-flex w-4 h-4 shrink-0 items-center justify-center ${
        onAccent ? '' : 'pointer-events-none'
      }`}
      onMouseEnter={() => {
        if (!onAccent) return;
        hovering.current = true;
        setOpen(true);
      }}
      onMouseLeave={() => {
        hovering.current = false;
        setOpen(false);
      }}
      onClick={(e) => {
        if (!onAccent) return;
        e.preventDefault();
        e.stopPropagation();
        if (!hovering.current) setOpen((prev) => !prev);
      }}
    >
      <span
        aria-hidden="true"
        className={`w-4 h-4 rounded-full text-[10px] font-bold leading-none flex items-center justify-center transition-colors ${
          onAccent
            ? 'bg-white/25 text-white'
            : isDark
              ? 'bg-gray-600 text-gray-300 hover:bg-gray-500'
              : 'bg-gray-300 text-gray-700 hover:bg-gray-400'
        }`}
      >
        ?
      </span>
      <span className="sr-only">How play types work</span>
      {open ? (
        <span
          role="tooltip"
          aria-hidden="true"
          className={`absolute z-[80] left-0 top-full mt-1.5 w-72 px-3 py-2 text-xs font-normal leading-relaxed text-left rounded-lg border shadow-lg pointer-events-none ${
            isDark
              ? 'bg-[#0a1929] border-gray-600 text-gray-100'
              : 'bg-white border-gray-300 text-gray-900'
          }`}
        >
          <strong>How Play Types work</strong>
          <br />
          Current season ({nblSeasonLabel(NBL_PLAY_TYPE_YEAR)}). Each rotation player is tagged as
          one attacking type. On each team, the highest on-court usage creator is Primary BH and
          the next is Second BH. Everyone else is 3PT (mainly threes), Interior (mainly paint),
          Stretch (bigs who space), or Slasher.
          <br />
          <br />
          Each cell is a position matchup: what that team allows to this type versus the type&apos;s
          league average. Green is an easier matchup. Red means they hold that type down.
          <br />
          <br />
          The matrix follows PTS, AST, or REB on the main chart.
          The purple column is the current opponent. This player&apos;s type is highlighted on the left.
        </span>
      ) : null}
    </span>
  );
}

export default function NblDvpCard({
  isDark = false,
  playerId = null,
  opponentName = null,
  selectedStat = 'points',
  resolveTeamLogo,
}: {
  isDark?: boolean;
  season?: number;
  playerId?: string | null;
  opponentName?: string | null;
  selectedStat?: string;
  resolveTeamLogo?: (teamName: string) => string | null;
}) {
  const [payload, setPayload] = useState<NblPlayTypesPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [weekOpen, setWeekOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      stat: selectedStat || 'points',
    });
    if (playerId) params.set('playerId', playerId);

    fetch(`/api/nbl/play-types?${params.toString()}`)
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.error || 'Failed to load play types');
        return json as NblPlayTypesPayload;
      })
      .then((data) => {
        if (cancelled) return;
        setPayload(data);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load play types');
        setPayload(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedStat, playerId]);

  const opponentCode = useMemo(
    () => resolveNblSteTeamCode(opponentName),
    [opponentName]
  );

  const playerType = payload?.player?.type ?? null;

  const teams = useMemo(() => {
    const list = payload?.teams ?? [];
    if (!opponentCode) return list;
    return [...list].sort((a, b) => {
      if (a.code === opponentCode) return -1;
      if (b.code === opponentCode) return 1;
      return 0;
    });
  }, [payload?.teams, opponentCode]);

  const rows = payload?.rows ?? [];

  const weekPicks = useMemo(() => {
    const slate = (payload?.roundPicks ?? []).filter(
      (p) => p.opponentCode && p.boost != null && Number.isFinite(p.boost) && p.boost > 0
    );
    const bestByTeam = new Map<string, (typeof slate)[number]>();
    for (const pick of slate) {
      const teamKey = pick.teamCode || pick.team;
      if (!teamKey) continue;
      const existing = bestByTeam.get(teamKey);
      if (
        !existing ||
        (pick.boost ?? -999) > (existing.boost ?? -999) ||
        ((pick.boost ?? -999) === (existing.boost ?? -999) &&
          (pick.statValue ?? 0) > (existing.statValue ?? 0))
      ) {
        bestByTeam.set(teamKey, pick);
      }
    }
    return [...bestByTeam.values()]
      .sort((a, b) => {
        const boostDelta = (b.boost ?? -999) - (a.boost ?? -999);
        if (boostDelta !== 0) return boostDelta;
        return (b.statValue ?? 0) - (a.statValue ?? 0);
      })
      .slice(0, 10);
  }, [payload?.roundPicks]);

  if (loading && !payload) {
    const pulse = isDark ? 'bg-slate-800' : 'bg-slate-200';
    return <div className={`h-40 w-full rounded-lg animate-pulse ${pulse}`} />;
  }

  if (error) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{error}</div>
    );
  }

  if (!payload) {
    return (
      <div className={`text-sm py-4 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
        Play type matrix unavailable.
      </div>
    );
  }

  if (!payload.statSupported) {
    const current = chartStatLabel(selectedStat);
    return (
      <div className="py-3 px-0.5">
        <p className={`text-sm font-semibold ${isDark ? 'text-gray-100' : 'text-gray-800'}`}>
          Matrix is PTS, AST, or REB
        </p>
        <p className={`text-xs mt-1.5 leading-relaxed ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
          Chart is on {current}. Switch to one of these to see type-vs-team boosts
          {payload.player ? ` for ${payload.player.typeLabel}s` : ''}.
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {MATRIX_STAT_CHIPS.map((chip) => (
            <span
              key={chip}
              className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                isDark ? 'bg-white/10 text-gray-200' : 'bg-gray-100 text-gray-700'
              }`}
            >
              {chip}
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`min-w-0 ${loading ? 'opacity-70' : ''}`}>
    <p className={`text-[11px] font-semibold tracking-wide mb-2 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
      Showing {payload.statLabel ?? 'PTS'}
      <span className="lg:hidden font-normal tracking-normal opacity-80"> · swipe for all teams</span>
    </p>
    <div className="min-w-0 overflow-x-auto overscroll-x-contain [scrollbar-width:thin] -mx-0.5 px-0.5">
    <table className="w-max min-w-full border-collapse lg:w-full lg:table-fixed">
      <thead>
        <tr>
          <th
            className={`sticky left-0 z-20 w-[68px] min-w-[68px] p-0 text-left ${
              isDark ? 'bg-[#0a1929]' : 'bg-white'
            }`}
          />
          {teams.map((team) => {
            const logo = resolveTeamLogo?.(team.name);
            const isOpp = team.code === opponentCode;
            return (
              <th
                key={team.code}
                title={team.name}
                className={`p-0.5 sm:p-1 align-bottom min-w-[52px] w-[52px] lg:min-w-0 lg:w-auto ${
                  isOpp ? 'border-x-2 border-t-2 border-violet-400 bg-violet-500/10' : ''
                }`}
              >
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex h-5 w-5 sm:h-6 sm:w-6 items-center justify-center">
                    {logo ? (
                      <img src={logo} alt={team.shortName} className="h-5 w-5 sm:h-6 sm:w-6 object-contain" />
                    ) : (
                      <span className={`text-[9px] font-semibold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {team.code}
                      </span>
                    )}
                  </div>
                  <span
                    className={`text-[9px] sm:text-[10px] leading-none font-semibold whitespace-nowrap ${
                      isOpp
                        ? isDark
                          ? 'text-violet-200'
                          : 'text-violet-700'
                        : isDark
                          ? 'text-slate-400'
                          : 'text-slate-500'
                    }`}
                  >
                    {team.code}
                  </span>
                </div>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, rowIdx) => {
          const isPlayerType = row.type === playerType;
          const isLast = rowIdx === rows.length - 1;
          return (
            <tr key={row.type}>
              <td
                className={`sticky left-0 z-20 pr-2 py-0.5 align-middle text-right w-[68px] min-w-[68px] ${
                  isDark ? 'bg-[#0a1929]' : 'bg-white'
                }`}
              >
                <span
                  className={`block text-[10px] sm:text-[11px] leading-tight font-semibold whitespace-nowrap ${
                    isPlayerType
                      ? isDark
                        ? 'text-violet-200'
                        : 'text-violet-700'
                      : isDark
                        ? 'text-slate-300'
                        : 'text-slate-600'
                  }`}
                >
                  {row.label}
                </span>
              </td>
              {teams.map((team) => {
                const cell = row.cells[team.code];
                const isOpp = team.code === opponentCode;
                const emphasize = isPlayerType && isOpp;
                return (
                  <td
                    key={team.code}
                    className={`p-0.5 min-w-[52px] w-[52px] lg:min-w-0 lg:w-auto ${
                      isOpp
                        ? `border-x-2 border-violet-400 bg-violet-500/10 ${isLast ? 'border-b-2' : ''}`
                        : ''
                    }`}
                  >
                    <div
                      title={cellTitle(row.label, team.shortName, cell)}
                      className={`h-8 sm:h-9 w-full rounded-md flex items-center justify-center text-[11px] sm:text-xs font-semibold tabular-nums leading-none whitespace-nowrap ${cellTextClass(
                        cell,
                        isDark,
                        emphasize
                      )}`}
                      style={{ backgroundColor: cellBackground(cell, isDark, emphasize || isPlayerType) }}
                    >
                      {fmtBoost(cell?.boost ?? null)}
                    </div>
                  </td>
                );
              })}
            </tr>
          );
        })}
      </tbody>
    </table>
    </div>

      <div className={`mt-3 pt-3 pb-1 border-t min-w-0 shrink-0 overflow-visible ${isDark ? 'border-slate-700' : 'border-slate-200'}`}>
        <button
          type="button"
          aria-expanded={weekOpen}
          onClick={() => setWeekOpen((open) => !open)}
          className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm font-semibold transition-colors ${
            weekOpen
              ? 'bg-purple-600 text-white border-purple-600'
              : isDark
                ? 'bg-[#0a1929] text-gray-200 border-gray-700 hover:bg-gray-800'
                : 'bg-gray-100 text-gray-800 border-gray-200 hover:bg-gray-200'
          }`}
        >
          <span>Best edges this week</span>
          <svg
            className={`w-4 h-4 shrink-0 transition-transform ${weekOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {weekOpen ? (
          !weekPicks.length ? (
            <div className={`text-xs py-4 text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
              No upcoming-game edges for this stat yet.
            </div>
          ) : (
            <div className="mt-2 space-y-1.5 min-w-0">
              {weekPicks.map((pick) => {
                const pctText = fmtPct(pick.pct);
                const opp = pick.opponentCode || opponentShort(pick, teams) || '—';
                const meta = [pick.teamCode || pick.team, pick.typeLabel, `vs ${opp}`]
                  .filter(Boolean)
                  .join(' · ');
                const chip = boostChipClasses(pick.boost, isDark);
                return (
                  <div
                    key={pick.playerId}
                    className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${
                      pick.playerId === playerId
                        ? isDark
                          ? 'bg-violet-500/15 ring-1 ring-violet-400/40'
                          : 'bg-violet-50 ring-1 ring-violet-200'
                        : isDark
                          ? 'bg-[#0d2137] ring-1 ring-white/10'
                          : 'bg-white ring-1 ring-gray-200'
                    }`}
                  >
                    <WeekPickAvatar name={pick.name} imageUrl={pick.imageUrl} isDark={isDark} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-xs font-semibold truncate leading-tight ${
                          isDark ? 'text-white' : 'text-gray-900'
                        }`}
                      >
                        {pick.name}
                      </div>
                      <div className={`text-[10px] truncate mt-0.5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                        {meta}
                      </div>
                      <div className={`text-[10px] tabular-nums mt-0.5 ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>
                        {fmtStat(pick.statValue)}
                        {payload.statLabel ? ` ${payload.statLabel}` : ''}
                        {pctText ? ` · ${pctText} ${pick.pctLabel}` : ''}
                      </div>
                    </div>
                    <div className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${chip.tone} ${chip.wrap}`}>
                      {fmtBoost(pick.boost)}
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
