'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  NBL_STE_STAT_LABELS,
  resolveNblSteTeamCode,
  type NblSteStatKey,
  type NblSteStatsPayload,
} from '@/lib/nbl/teamSteStatsShared';
import {
  NBL_SHOT_CHART_SEASON_YEAR,
  normalizeTeamKey,
  resolveNblClubName,
} from '@/lib/nblTeamCanonical';

type LeaguePlayerRow = {
  name?: string;
  team?: string;
  teamCode?: string | null;
  games?: number | null;
  points?: number | null;
  rebounds?: number | null;
  assists?: number | null;
  steals?: number | null;
  blocks?: number | null;
  fgPct?: number | null;
  threePct?: number | null;
};

type PlayerVsRow = {
  label: string;
  playerStatKey: string;
  steKey: NblSteStatKey;
  isPercent?: boolean;
};

const PLAYER_VS_ROWS: PlayerVsRow[] = [
  { label: NBL_STE_STAT_LABELS.pts, playerStatKey: 'points', steKey: 'pts' },
  { label: NBL_STE_STAT_LABELS.reb, playerStatKey: 'rebounds', steKey: 'reb' },
  { label: NBL_STE_STAT_LABELS.ast, playerStatKey: 'assists', steKey: 'ast' },
  { label: NBL_STE_STAT_LABELS.fg_pct, playerStatKey: 'fgPct', steKey: 'fg_pct', isPercent: true },
  { label: NBL_STE_STAT_LABELS.fg3_pct, playerStatKey: 'threePct', steKey: 'fg3_pct', isPercent: true },
  { label: NBL_STE_STAT_LABELS.stl, playerStatKey: 'steals', steKey: 'stl' },
  { label: NBL_STE_STAT_LABELS.blk, playerStatKey: 'blocks', steKey: 'blk' },
];

function normalizePlayerName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

function gameBelongsToSeason(game: Record<string, unknown>, season: number): boolean {
  const seasonRaw = Number(game.season);
  if (Number.isFinite(seasonRaw)) return seasonRaw === season;
  const dateRaw = String(game.date ?? game.game_date ?? '').trim();
  if (dateRaw.length >= 4) {
    const y = Number(dateRaw.slice(0, 4));
    if (Number.isFinite(y)) return y === season || y === season + 1;
  }
  return false;
}

function toDisplayPct(raw: number): number {
  // League / logs often store 0–1; STE uses 0–100.
  if (!Number.isFinite(raw)) return raw;
  return raw <= 1 ? raw * 100 : raw;
}

function teamsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const ca = resolveNblClubName(a);
  const cb = resolveNblClubName(b);
  if (ca && cb) return normalizeTeamKey(ca) === normalizeTeamKey(cb);
  return normalizeTeamKey(a) === normalizeTeamKey(b);
}

export function NblPlayerVsTeamPanel({
  isDark = false,
  layout = 'desktop',
  season = NBL_SHOT_CHART_SEASON_YEAR,
  playerName = null,
  playerTeam = null,
  opponentName = null,
  gameLogs = [],
}: {
  isDark?: boolean;
  layout?: 'mobile' | 'desktop';
  season?: number;
  playerName?: string | null;
  playerTeam?: string | null;
  opponentName?: string | null;
  gameLogs?: Array<Record<string, unknown>>;
}) {
  const [rankScope, setRankScope] = useState<'team' | 'league'>('team');
  const [leaguePlayers, setLeaguePlayers] = useState<LeaguePlayerRow[] | null>(null);
  const [stePayload, setStePayload] = useState<NblSteStatsPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nbl/league-player-stats?year=${season}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setLeaguePlayers(Array.isArray(json?.players) ? json.players : []);
      })
      .catch(() => {
        if (!cancelled) setLeaguePlayers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/nbl/team-ste-stats?year=${season}&window=0`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => {
        if (cancelled) return;
        setStePayload(json as NblSteStatsPayload);
      })
      .catch(() => {
        if (!cancelled) setStePayload(null);
      });
    return () => {
      cancelled = true;
    };
  }, [season]);

  const opponentCode = useMemo(
    () => resolveNblSteTeamCode(opponentName),
    [opponentName]
  );

  const opponentLabel =
    (opponentCode && stePayload?.names?.[opponentCode]) ||
    opponentName ||
    'Select opponent';

  const seasonLogs = useMemo(
    () =>
      (gameLogs || []).filter((g) =>
        gameBelongsToSeason(g as Record<string, unknown>, season)
      ),
    [gameLogs, season]
  );

  const getLeagueSeasonAvg = (statKey: string): number | null => {
    if (!leaguePlayers?.length || !playerName) return null;
    const want = normalizePlayerName(playerName);
    const row =
      leaguePlayers.find((p) => normalizePlayerName(String(p.name ?? '')) === want) ||
      leaguePlayers.find((p) => {
        const n = normalizePlayerName(String(p.name ?? ''));
        return n.includes(want) || want.includes(n);
      });
    if (!row) return null;
    const v = Number((row as Record<string, unknown>)[statKey]);
    if (!Number.isFinite(v)) return null;
    if (statKey === 'fgPct' || statKey === 'threePct') {
      return Math.round(toDisplayPct(v) * 10) / 10;
    }
    return Math.round(v * 10) / 10;
  };

  const getPlayerSeasonAvg = (statKey: string, isPercent?: boolean): number | null => {
    if (!seasonLogs.length) return getLeagueSeasonAvg(statKey);

    if (isPercent) {
      const madeKey = statKey === 'threePct' ? 'threeMade' : 'fgMade';
      const attKey = statKey === 'threePct' ? 'threeAttempted' : 'fgAttempted';
      let made = 0;
      let att = 0;
      for (const g of seasonLogs) {
        const m = Number((g as Record<string, unknown>)[madeKey]);
        const a = Number((g as Record<string, unknown>)[attKey]);
        if (Number.isFinite(m) && Number.isFinite(a) && a > 0) {
          made += m;
          att += a;
        }
      }
      if (att > 0) return Math.round((made / att) * 1000) / 10;
      // Fallback: average of per-game pct
      const pcts = seasonLogs
        .map((g) => Number((g as Record<string, unknown>)[statKey]))
        .filter((v) => Number.isFinite(v))
        .map(toDisplayPct);
      if (!pcts.length) return getLeagueSeasonAvg(statKey);
      return Math.round((pcts.reduce((s, v) => s + v, 0) / pcts.length) * 10) / 10;
    }

    const values = seasonLogs
      .map((g) => Number((g as Record<string, unknown>)[statKey]))
      .filter((v) => Number.isFinite(v));
    if (!values.length) return getLeagueSeasonAvg(statKey);
    return Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
  };

  const getOpponentSeasonAvg = (steKey: NblSteStatKey): number | null => {
    if (!opponentCode || !stePayload?.metrics?.[steKey]) return null;
    const v = stePayload.metrics[steKey].values[opponentCode];
    return Number.isFinite(v) ? Math.round(v * 10) / 10 : null;
  };

  const getOpponentSeasonRank = (steKey: NblSteStatKey): number | null => {
    if (!opponentCode || !stePayload?.metrics?.[steKey]) return null;
    const rank = stePayload.metrics[steKey].ranks[opponentCode];
    return Number.isFinite(rank) ? rank : null;
  };

  const playerRanks = useMemo(() => {
    const empty = Object.fromEntries(
      PLAYER_VS_ROWS.map((r) => [r.steKey, null])
    ) as Record<NblSteStatKey, { rank: number; total: number } | null>;

    if (!playerName || !leaguePlayers?.length) return empty;

    let comparePool = leaguePlayers;
    if (rankScope === 'team') {
      if (!playerTeam) return empty;
      comparePool = leaguePlayers.filter((p) => teamsMatch(p.team, playerTeam));
      if (!comparePool.length) return empty;
    }

    const want = normalizePlayerName(playerName);
    let playerRow =
      comparePool.find((p) => normalizePlayerName(String(p.name ?? '')) === want) ||
      comparePool.find((p) => {
        const n = normalizePlayerName(String(p.name ?? ''));
        return n.includes(want) || want.includes(n);
      });
    if (!playerRow && rankScope === 'league') {
      playerRow =
        leaguePlayers.find((p) => normalizePlayerName(String(p.name ?? '')) === want) ||
        undefined;
    }
    if (!playerRow) return empty;

    const maxGames = Math.max(...comparePool.map((p) => Number(p.games) || 0), 0);
    const minGames = maxGames >= 5 ? 5 : 1;

    const result = { ...empty };
    for (const row of PLAYER_VS_ROWS) {
      if (rankScope === 'league' && (Number(playerRow.games) || 0) < minGames) {
        result[row.steKey] = null;
        continue;
      }
      let playerValue = Number((playerRow as Record<string, unknown>)[row.playerStatKey]);
      if (!Number.isFinite(playerValue)) {
        result[row.steKey] = null;
        continue;
      }
      if (row.isPercent) playerValue = toDisplayPct(playerValue);

      const eligible = comparePool.filter((p) => {
        if ((Number(p.games) || 0) < minGames) return false;
        return Number.isFinite(Number((p as Record<string, unknown>)[row.playerStatKey]));
      });
      if (!eligible.length) {
        result[row.steKey] = null;
        continue;
      }

      const above = eligible.filter((p) => {
        let v = Number((p as Record<string, unknown>)[row.playerStatKey]);
        if (row.isPercent) v = toDisplayPct(v);
        return v > playerValue;
      }).length;
      result[row.steKey] = { rank: above + 1, total: eligible.length };
    }
    return result;
  }, [leaguePlayers, rankScope, playerName, playerTeam]);

  const renderPlayerRank = (steKey: NblSteStatKey) => {
    const rank = playerRanks[steKey];
    if (!rank) return null;
    const isTeamScope = rankScope === 'team';
    const top5 = rank.rank <= 5;
    const bottom5 = rank.total > 0 && rank.rank >= rank.total - 4;
    const topPct = rank.total > 0 && rank.rank <= Math.ceil(rank.total * 0.1);
    const bottomPct =
      rank.total > 0 && rank.rank >= rank.total - Math.ceil(rank.total * 0.1);
    const isTop = isTeamScope ? top5 : topPct;
    const isBottom = isTeamScope ? bottom5 : bottomPct;
    const rankClass = isTop
      ? 'text-emerald-600 dark:text-emerald-400'
      : isBottom
        ? 'text-red-600 dark:text-red-400'
        : 'text-amber-600 dark:text-amber-400';
    return (
      <span
        className={`inline-block w-[3.5ch] xl:w-[4ch] text-left tabular-nums text-[10px] sm:text-[11px] font-semibold ${rankClass}`}
      >
        #{rank.rank}
      </span>
    );
  };

  const renderOpponentRank = (steKey: NblSteStatKey) => {
    const rank = getOpponentSeasonRank(steKey);
    if (rank == null) return null;
    const teamCount = Math.max(stePayload?.teamCount || 10, 10);
    // Hardest allowed (low #) = red; softest = green. Scaled for 10-team NBL.
    const hardCut = Math.max(2, Math.ceil(teamCount * 0.3));
    const softCut = teamCount - Math.max(1, Math.ceil(teamCount * 0.3)) + 1;
    const rankClass =
      rank <= hardCut
        ? 'text-red-600 dark:text-red-400'
        : rank >= softCut
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-amber-600 dark:text-amber-400';
    return (
      <span
        className={`inline-block w-[3.5ch] xl:w-[4ch] text-right tabular-nums text-[10px] sm:text-[11px] font-semibold ${rankClass}`}
      >
        #{rank}
      </span>
    );
  };

  const formatPlayerValue = (row: PlayerVsRow): string | null => {
    const v = getPlayerSeasonAvg(row.playerStatKey, row.isPercent);
    if (v == null || !Number.isFinite(v)) return null;
    return row.isPercent ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  const formatOppValue = (row: PlayerVsRow): string | null => {
    const v = getOpponentSeasonAvg(row.steKey);
    if (v == null || !Number.isFinite(v)) return null;
    return row.isPercent ? `${v.toFixed(1)}%` : v.toFixed(1);
  };

  const scopeToggle = (
    <div className="flex justify-center mb-2">
      <div
        className={`inline-flex rounded-lg border overflow-hidden ${
          isDark ? 'border-gray-600' : 'border-gray-300'
        }`}
      >
        <button
          type="button"
          onClick={() => setRankScope('team')}
          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
            rankScope === 'team'
              ? 'bg-purple-600 text-white'
              : isDark
                ? 'bg-transparent text-gray-400 hover:text-gray-200'
                : 'bg-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          vs Team
        </button>
        <button
          type="button"
          onClick={() => setRankScope('league')}
          className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
            rankScope === 'league'
              ? 'bg-purple-600 text-white'
              : isDark
                ? 'bg-transparent text-gray-400 hover:text-gray-200'
                : 'bg-transparent text-gray-600 hover:text-gray-900'
          }`}
        >
          vs League
        </button>
      </div>
    </div>
  );

  if (layout === 'mobile') {
    return (
      <div>
        {scopeToggle}
        <div className="flex items-start justify-between gap-2 mb-1">
          <span className="text-sm font-semibold text-gray-900 dark:text-white">
            {playerName || 'Select a player'}
          </span>
          <span className="text-sm font-semibold text-gray-900 dark:text-white text-right">
            {opponentLabel}
          </span>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_12ch_3.5ch_3.5ch_6ch_minmax(0,1fr)] gap-x-1.5 mb-1">
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400">
            Stat
          </span>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right pr-0">
            Player
          </span>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400" />
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400" />
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-left">
            Opp
          </span>
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right">
            Stat
          </span>
        </div>
        <div className="space-y-0.5 text-sm">
          {PLAYER_VS_ROWS.map((row) => {
            const playerValue = formatPlayerValue(row);
            const opponentValue = formatOppValue(row);
            const playerRank = playerValue != null ? renderPlayerRank(row.steKey) : null;
            const opponentRank = opponentValue != null ? renderOpponentRank(row.steKey) : null;
            return (
              <div
                key={`m-${row.steKey}`}
                className="grid grid-cols-[minmax(0,1fr)_12ch_3.5ch_3.5ch_6ch_minmax(0,1fr)] items-center gap-x-1.5 min-w-0"
              >
                <span className="text-gray-700 dark:text-gray-200 truncate pr-1">{row.label}</span>
                <span className="font-semibold text-gray-900 dark:text-white justify-self-end text-right tabular-nums whitespace-nowrap text-[11px]">
                  {playerValue ?? '—'}
                </span>
                <span className="justify-self-start whitespace-nowrap">
                  {playerRank ?? <span className="inline-block w-[3.5ch]" />}
                </span>
                <span className="justify-self-end whitespace-nowrap">
                  {opponentRank ?? <span className="inline-block w-[3.5ch]" />}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white justify-self-start text-left tabular-nums whitespace-nowrap">
                  {opponentValue ?? '—'}
                </span>
                <span className="text-gray-700 dark:text-gray-200 truncate pl-1 text-right">
                  {row.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      {scopeToggle}
      <div className="flex items-start mb-1">
        <div className="flex-1 flex items-start justify-start pr-3">
          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white truncate">
            {playerName || 'Select a player'}
          </span>
        </div>
        <div className="flex-1 flex items-start justify-end pl-3">
          <span className="text-xs sm:text-sm font-medium text-gray-900 dark:text-white text-right truncate">
            {opponentLabel}
          </span>
        </div>
      </div>
      <div className="text-xs sm:text-sm min-w-0">
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:grid-cols-[minmax(0,1fr)_12ch_auto_auto_auto_minmax(0,1fr)] gap-x-1 xl:gap-x-2 mb-1">
          <span className="text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-left">
            Player season avg
          </span>
          <span />
          <span />
          <span />
          <span />
          <span className="hidden xl:block text-[11px] uppercase tracking-wide font-semibold text-gray-500 dark:text-gray-400 text-right">
            Opponent team avg
          </span>
        </div>
        <div className="space-y-0.5">
          {PLAYER_VS_ROWS.map((row) => {
            const playerValue = formatPlayerValue(row);
            const opponentValue = formatOppValue(row);
            const playerRank = playerValue != null ? renderPlayerRank(row.steKey) : null;
            const opponentRank = opponentValue != null ? renderOpponentRank(row.steKey) : null;
            return (
              <div
                key={row.steKey}
                className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] xl:grid-cols-[minmax(0,1fr)_12ch_auto_auto_auto_minmax(0,1fr)] items-center gap-x-1 xl:gap-x-2 min-w-0"
              >
                <span className="text-gray-700 dark:text-gray-200 text-left whitespace-nowrap truncate pr-1">
                  {row.label}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white justify-self-end w-[5ch] xl:w-[12ch] text-right tabular-nums whitespace-nowrap text-[11px] xl:text-xs">
                  {playerValue ?? '—'}
                </span>
                <span className="justify-self-start whitespace-nowrap">
                  {playerRank ?? <span className="inline-block w-[3.5ch] xl:w-[4ch]" />}
                </span>
                <span className="justify-self-end whitespace-nowrap">
                  {opponentRank ?? <span className="inline-block w-[3.5ch] xl:w-[4ch]" />}
                </span>
                <span className="font-semibold text-gray-900 dark:text-white justify-self-start w-[6ch] xl:w-[7ch] text-left tabular-nums whitespace-nowrap">
                  {opponentValue ?? '—'}
                </span>
                <span className="hidden xl:block text-gray-700 dark:text-gray-200 text-right whitespace-nowrap truncate pl-1">
                  {row.label}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default NblPlayerVsTeamPanel;
