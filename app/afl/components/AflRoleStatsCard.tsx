'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';

type GameLog = Record<string, unknown>;

export type AflRoleStatsCardProps = {
  playerName?: string | null;
  team?: string | null;
  gameLogs: GameLog[];
  /** Current season year for season averages (defaults to calendar year). */
  season?: number;
  isDark?: boolean;
};

type WindowKey = 'season' | 'l5' | 'l10';
type LeaderStat = 'cba' | 'kick_ins';

type CountWindow = {
  avg: number | null;
  total: number;
};

type FractionWindow = {
  avg: number | null;
  player: number;
  team: number | null;
  sharePct: number | null;
  fraction: string;
};

type RoleLeader = {
  player: string;
  total: number;
  rate: number | null;
};

function toNumber(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const cleaned = v.replace(/%/g, '').replace(/,/g, '').trim();
    if (!cleaned || cleaned === '-' || cleaned === '—') return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function gameSeason(game: GameLog): number | null {
  const raw = game.season ?? game.game_season;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  return Number.isFinite(n) ? n : null;
}

function lastN(games: GameLog[], n: number): GameLog[] {
  if (!games.length || n <= 0) return [];
  return games.slice(-n);
}

function sumKey(games: GameLog[], key: string): { sum: number; count: number } {
  let sum = 0;
  let count = 0;
  for (const g of games) {
    const v = toNumber(g[key]);
    if (v == null) continue;
    sum += v;
    count += 1;
  }
  return { sum, count };
}

function countWindow(games: GameLog[], key: string): CountWindow {
  const { sum, count } = sumKey(games, key);
  return {
    total: Math.round(sum),
    avg: count > 0 ? sum / count : null,
  };
}

function pctWindow(games: GameLog[], key: string): CountWindow {
  const { sum, count } = sumKey(games, key);
  return {
    total: count,
    avg: count > 0 ? sum / count : null,
  };
}

function deriveCbaTeam(game: GameLog): number | null {
  const stored = toNumber(game.cba_team);
  if (stored != null && stored > 0) return stored;
  const cba = toNumber(game.cba);
  const pct = toNumber(game.cba_pct);
  if (cba != null && cba > 0 && pct != null && pct > 0) {
    return Math.round(cba / (pct / 100));
  }
  return null;
}

function withDerivedCbaTeam(games: GameLog[]): GameLog[] {
  return games.map((game) => {
    const team = deriveCbaTeam(game);
    return team == null ? game : { ...game, cba_team: team };
  });
}

function fractionWindow(games: GameLog[], playerKey: string, teamKey: string): FractionWindow {
  const player = sumKey(games, playerKey);
  const team = sumKey(games, teamKey);
  const teamTotal = team.count > 0 ? Math.round(team.sum) : null;
  const playerTotal = Math.round(player.sum);
  const sharePct =
    teamTotal != null && teamTotal > 0 ? (playerTotal / teamTotal) * 100 : null;
  return {
    avg: player.count > 0 ? player.sum / player.count : null,
    player: playerTotal,
    team: teamTotal,
    sharePct,
    fraction: teamTotal != null ? `${playerTotal}/${teamTotal}` : String(playerTotal),
  };
}

function formatAvg(value: number | null, isPercent?: boolean): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (isPercent) return `${Math.round(value)}%`;
  return value.toFixed(1);
}

const WINDOWS: { key: WindowKey; label: string }[] = [
  { key: 'season', label: 'Season' },
  { key: 'l5', label: 'L5' },
  { key: 'l10', label: 'L10' },
];

function StatTable({
  isDark,
  rows,
}: {
  isDark: boolean;
  rows: Array<{ label: string; values: [string, string, string]; valueSize?: 'sm' | 'md' }>;
}) {
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const labelCls = isDark ? 'text-gray-300' : 'text-gray-600';
  const valueCls = isDark ? 'text-white' : 'text-gray-900';
  const line = isDark ? 'border-white/10' : 'border-black/5';

  return (
    <div className="w-full min-w-0">
      <div className={`grid grid-cols-[2.75rem_1fr_1fr_1fr] gap-x-1 border-b pb-1 mb-1 ${line}`}>
        <span className={`text-[10px] font-semibold uppercase tracking-wide ${muted}`} />
        {WINDOWS.map((w) => (
          <span
            key={w.key}
            className={`text-[10px] font-semibold uppercase tracking-wide ${muted} text-center`}
          >
            {w.label}
          </span>
        ))}
      </div>
      <div className="space-y-1">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[2.75rem_1fr_1fr_1fr] gap-x-1 items-baseline">
            <span className={`text-[11px] ${labelCls}`}>{row.label}</span>
            {row.values.map((v, i) => (
              <span
                key={`${row.label}-${i}`}
                className={`${row.valueSize === 'sm' ? 'text-[11px]' : 'text-[13px]'} font-semibold tabular-nums text-center ${valueCls}`}
              >
                {v}
              </span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatBlock({
  title,
  accentClass,
  frameClass,
  children,
}: {
  title: string;
  accentClass: string;
  frameClass: string;
  children: ReactNode;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2.5 ${frameClass}`}>
      <div className={`mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${accentClass}`}>
        {title}
      </div>
      {children}
    </div>
  );
}

function LeadersPanel({
  isDark,
  accentClass,
  title,
  loading,
  error,
  leaders,
  teamTotal,
  showFraction,
  selectedPlayer,
}: {
  isDark: boolean;
  accentClass: string;
  title: string;
  loading: boolean;
  error: string | null;
  leaders: RoleLeader[];
  teamTotal?: number | null;
  /** When true, show player/teamTotal instead of bare total (kick-ins). */
  showFraction?: boolean;
  selectedPlayer?: string | null;
}) {
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const valueCls = isDark ? 'text-white' : 'text-gray-900';
  const selectedCls = isDark ? 'text-amber-200' : 'text-amber-800';
  const panel = isDark ? 'border-white/10 bg-black/20' : 'border-black/5 bg-white/70';
  const denom = teamTotal != null && teamTotal > 0 ? teamTotal : null;

  return (
    <div className={`mt-2 rounded-md border px-2.5 py-2 ${panel}`}>
      <div className={`mb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${accentClass}`}>
        {title}
        {denom != null ? (
          <span className={`ml-1.5 font-medium normal-case tracking-normal ${muted}`}>
            ({denom} season)
          </span>
        ) : null}
      </div>
      {loading ? (
        <p className={`text-[11px] ${muted}`}>Loading…</p>
      ) : error ? (
        <p className={`text-[11px] ${muted}`}>{error}</p>
      ) : !leaders.length ? (
        <p className={`text-[11px] ${muted}`}>No leaders found.</p>
      ) : (
        <ol className="space-y-1">
          {leaders.map((row, idx) => {
            const isSelected =
              !!selectedPlayer &&
              row.player.trim().toLowerCase() === selectedPlayer.trim().toLowerCase();
            const totalLabel =
              showFraction && denom != null ? `${row.total}/${denom}` : String(row.total);
            return (
              <li
                key={`${row.player}-${idx}`}
                className="grid grid-cols-[1rem_1fr_auto_auto] gap-x-1.5 items-baseline text-[11px]"
              >
                <span className={`tabular-nums ${muted}`}>{idx + 1}.</span>
                <span className={`truncate font-medium ${isSelected ? selectedCls : valueCls}`}>
                  {row.player}
                </span>
                <span
                  className={`tabular-nums font-semibold ${valueCls} ${
                    showFraction ? 'text-[10px]' : ''
                  }`}
                >
                  {totalLabel}
                </span>
                <span className={`tabular-nums w-8 text-right ${muted}`}>
                  {row.rate != null ? `${Math.round(row.rate)}%` : ''}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Role Stats panel: CBA (yellow) + kick-ins (blue).
 */
export function AflRoleStatsCard({
  playerName,
  team,
  gameLogs,
  season = new Date().getFullYear(),
  isDark = false,
}: AflRoleStatsCardProps) {
  const [openLeader, setOpenLeader] = useState<LeaderStat | null>(null);
  const [leadersByStat, setLeadersByStat] = useState<Partial<Record<LeaderStat, RoleLeader[]>>>({});
  const [teamTotalByStat, setTeamTotalByStat] = useState<Partial<Record<LeaderStat, number>>>({});
  const [loadingStat, setLoadingStat] = useState<LeaderStat | null>(null);
  const [errorByStat, setErrorByStat] = useState<Partial<Record<LeaderStat, string>>>({});

  useEffect(() => {
    setOpenLeader(null);
    setLeadersByStat({});
    setTeamTotalByStat({});
    setErrorByStat({});
    setLoadingStat(null);
  }, [team, season, playerName]);

  // Prefetch full-season kick-in team total so Season Total matches the leaders board.
  useEffect(() => {
    if (!team?.trim()) return;
    let cancelled = false;
    const params = new URLSearchParams({
      team: team.trim(),
      season: String(season),
      stat: 'kick_ins',
      limit: '5',
    });
    void (async () => {
      try {
        const res = await fetch(`/api/afl/role-leaders?${params.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        const json = (await res.json()) as {
          leaders?: RoleLeader[];
          teamTotal?: number;
        };
        if (cancelled || !res.ok) return;
        setLeadersByStat((prev) => ({ ...prev, kick_ins: json.leaders || [] }));
        if (typeof json.teamTotal === 'number' && json.teamTotal > 0) {
          setTeamTotalByStat((prev) => ({ ...prev, kick_ins: json.teamTotal }));
        }
      } catch {
        // Keep game-log team totals if tracker prefetch fails.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [team, season]);

  const data = useMemo(() => {
    const seasonGames = gameLogs.filter((g) => {
      const s = gameSeason(g);
      return s == null || s === season;
    });
    const seasonSlice = withDerivedCbaTeam(seasonGames.length ? seasonGames : gameLogs);
    const slices: Record<WindowKey, GameLog[]> = {
      season: seasonSlice,
      l5: lastN(seasonSlice, 5),
      l10: lastN(seasonSlice, 10),
    };

    const buildCount = (key: string) => ({
      season: countWindow(slices.season, key),
      l5: countWindow(slices.l5, key),
      l10: countWindow(slices.l10, key),
    });
    const buildPct = (key: string) => ({
      season: pctWindow(slices.season, key),
      l5: pctWindow(slices.l5, key),
      l10: pctWindow(slices.l10, key),
    });
    const buildFraction = (playerKey: string, teamKey: string) => ({
      season: fractionWindow(slices.season, playerKey, teamKey),
      l5: fractionWindow(slices.l5, playerKey, teamKey),
      l10: fractionWindow(slices.l10, playerKey, teamKey),
    });

    const kickIns = buildFraction('kick_ins', 'kick_ins_team');
    const seasonTeamTotal = teamTotalByStat.kick_ins;
    if (seasonTeamTotal != null && seasonTeamTotal > 0) {
      const playerSeason = kickIns.season.player;
      kickIns.season = {
        ...kickIns.season,
        team: seasonTeamTotal,
        sharePct: seasonTeamTotal > 0 ? (playerSeason / seasonTeamTotal) * 100 : null,
        fraction: `${playerSeason}/${seasonTeamTotal}`,
      };
    }

    return {
      cba: buildCount('cba'),
      cba_pct: buildPct('cba_pct'),
      cba_total: buildFraction('cba', 'cba_team'),
      kick_ins: kickIns,
    };
  }, [gameLogs, season, teamTotalByStat.kick_ins]);

  const loadLeaders = useCallback(
    async (stat: LeaderStat) => {
      if (!team?.trim()) {
        setErrorByStat((prev) => ({ ...prev, [stat]: 'No team selected.' }));
        return;
      }
      if (leadersByStat[stat]) return;
      setLoadingStat(stat);
      setErrorByStat((prev) => ({ ...prev, [stat]: undefined }));
      try {
        const params = new URLSearchParams({
          team: team.trim(),
          season: String(season),
          stat,
          limit: '5',
        });
        const res = await fetch(`/api/afl/role-leaders?${params.toString()}`, {
          headers: { Accept: 'application/json' },
        });
        const json = (await res.json()) as {
          leaders?: RoleLeader[];
          teamTotal?: number;
          error?: string;
        };
        if (!res.ok) {
          setErrorByStat((prev) => ({
            ...prev,
            [stat]: json.error || 'Failed to load leaders.',
          }));
          return;
        }
        setLeadersByStat((prev) => ({ ...prev, [stat]: json.leaders || [] }));
        if (typeof json.teamTotal === 'number' && json.teamTotal > 0) {
          setTeamTotalByStat((prev) => ({ ...prev, [stat]: json.teamTotal }));
        }
      } catch {
        setErrorByStat((prev) => ({ ...prev, [stat]: 'Failed to load leaders.' }));
      } finally {
        setLoadingStat((current) => (current === stat ? null : current));
      }
    },
    [team, season, leadersByStat]
  );

  const toggleLeaders = useCallback(
    (stat: LeaderStat) => {
      setOpenLeader((current) => {
        const next = current === stat ? null : stat;
        if (next) void loadLeaders(next);
        return next;
      });
    },
    [loadLeaders]
  );

  const hasLogs = gameLogs.length > 0;
  const muted = isDark ? 'text-gray-400' : 'text-gray-500';
  const valueCls = isDark ? 'text-white' : 'text-gray-900';

  const cbaFrame = isDark
    ? 'border-amber-400/40 bg-amber-400/[0.07]'
    : 'border-amber-300 bg-amber-50';
  const kickFrame = isDark
    ? 'border-sky-400/40 bg-sky-400/[0.07]'
    : 'border-sky-300 bg-sky-50';
  const cbaAccent = isDark ? 'text-amber-300' : 'text-amber-700';
  const kickAccent = isDark ? 'text-sky-300' : 'text-sky-700';

  const btnBase = isDark
    ? 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
    : 'border-black/10 bg-white/80 text-gray-700 hover:bg-white';
  const btnActiveCba = isDark
    ? 'border-amber-400/50 bg-amber-400/15 text-amber-200'
    : 'border-amber-400 bg-amber-100 text-amber-800';
  const btnActiveKick = isDark
    ? 'border-sky-400/50 bg-sky-400/15 text-sky-200'
    : 'border-sky-400 bg-sky-100 text-sky-800';

  if (!playerName?.trim()) {
    return <p className={`text-sm ${muted}`}>Select a player to view role stats.</p>;
  }
  if (!hasLogs) {
    return <p className={`text-sm ${muted}`}>No game logs loaded yet.</p>;
  }

  return (
    <div className="w-full min-w-0 mx-auto space-y-2.5 text-sm">
      <div className="flex items-center justify-between gap-2 px-0.5">
        <span className={`text-sm font-medium ${valueCls} truncate`}>{playerName}</span>
        <span className={`text-xs uppercase tracking-wide font-semibold ${muted}`}>Role Stats</span>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <div className="min-w-0">
          <StatBlock title="CBA" accentClass={cbaAccent} frameClass={cbaFrame}>
            <StatTable
              isDark={isDark}
              rows={[
                {
                  label: 'Total',
                  valueSize: 'sm',
                  values: [
                    data.cba_total.season.fraction,
                    data.cba_total.l5.fraction,
                    data.cba_total.l10.fraction,
                  ],
                },
                {
                  label: 'Avg',
                  values: [
                    formatAvg(data.cba.season.avg),
                    formatAvg(data.cba.l5.avg),
                    formatAvg(data.cba.l10.avg),
                  ],
                },
                {
                  label: 'Rate',
                  values: [
                    formatAvg(data.cba_pct.season.avg, true),
                    formatAvg(data.cba_pct.l5.avg, true),
                    formatAvg(data.cba_pct.l10.avg, true),
                  ],
                },
              ]}
            />
          </StatBlock>
          <button
            type="button"
            onClick={() => toggleLeaders('cba')}
            disabled={!team?.trim()}
            className={`mt-1.5 w-full rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
              openLeader === 'cba' ? btnActiveCba : btnBase
            }`}
          >
            Team CBA
          </button>
          {openLeader === 'cba' ? (
            <LeadersPanel
              isDark={isDark}
              accentClass={cbaAccent}
              title="Team CBA leaders"
              loading={loadingStat === 'cba'}
              error={errorByStat.cba ?? null}
              leaders={leadersByStat.cba || []}
              teamTotal={teamTotalByStat.cba}
              selectedPlayer={playerName}
            />
          ) : null}
        </div>

        <div className="min-w-0">
          <StatBlock title="Kick-ins" accentClass={kickAccent} frameClass={kickFrame}>
            <StatTable
              isDark={isDark}
              rows={[
                {
                  label: 'Total',
                  values: [
                    data.kick_ins.season.fraction,
                    data.kick_ins.l5.fraction,
                    data.kick_ins.l10.fraction,
                  ],
                },
                {
                  label: 'Avg',
                  values: [
                    formatAvg(data.kick_ins.season.avg),
                    formatAvg(data.kick_ins.l5.avg),
                    formatAvg(data.kick_ins.l10.avg),
                  ],
                },
                {
                  label: 'Rate',
                  values: [
                    formatAvg(data.kick_ins.season.sharePct, true),
                    formatAvg(data.kick_ins.l5.sharePct, true),
                    formatAvg(data.kick_ins.l10.sharePct, true),
                  ],
                },
              ]}
            />
          </StatBlock>
          <button
            type="button"
            onClick={() => toggleLeaders('kick_ins')}
            disabled={!team?.trim()}
            className={`mt-1.5 w-full rounded-md border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors disabled:opacity-40 ${
              openLeader === 'kick_ins' ? btnActiveKick : btnBase
            }`}
          >
            Team Kick-ins
          </button>
          {openLeader === 'kick_ins' ? (
            <LeadersPanel
              isDark={isDark}
              accentClass={kickAccent}
              title="Team kick-in leaders"
              loading={loadingStat === 'kick_ins'}
              error={errorByStat.kick_ins ?? null}
              leaders={leadersByStat.kick_ins || []}
              teamTotal={teamTotalByStat.kick_ins}
              showFraction
              selectedPlayer={playerName}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default AflRoleStatsCard;
