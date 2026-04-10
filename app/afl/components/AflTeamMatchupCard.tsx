'use client';

import { useEffect, useMemo, useState } from 'react';
import { opponentToFootywireTeam } from '@/lib/aflTeamMapping';

const SEASON_OPTIONS = [2026, 2025] as const;
const MATCHUP_STATS = [
  { key: 'D', label: 'Disposals' },
  { key: 'K', label: 'Kicks' },
  { key: 'HB', label: 'Handballs' },
  { key: 'G', label: 'Goals' },
  { key: 'M', label: 'Marks' },
  { key: 'T', label: 'Tackles' },
  { key: 'CL', label: 'Clearances' },
  { key: 'I50', label: 'Inside 50s' },
] as const;
type MatchupStatKey = (typeof MATCHUP_STATS)[number]['key'];

type TeamRow = {
  rank: number | null;
  team: string;
  stats: Record<string, number | string | null>;
};

type RankingData = {
  season: number;
  teams: TeamRow[];
};

export interface AflTeamMatchupCardProps {
  isDark: boolean;
  season: number;
  teamName: string | null;
  opponentName: string | null;
}

function fmt(value: number | string | null | undefined): string {
  if (value == null) return '—';
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function getRankForStat(
  rows: TeamRow[],
  team: string,
  statKey: MatchupStatKey,
  higherIsBetter: boolean
): number | null {
  if (!rows?.length || !team) return null;
  const sorted = [...rows].sort((a, b) => {
    const va = toNumber(a.stats?.[statKey]);
    const vb = toNumber(b.stats?.[statKey]);
    if (higherIsBetter) {
      return (vb ?? -Infinity) - (va ?? -Infinity); // higher value = better rank (#1)
    }
    return (va ?? Infinity) - (vb ?? Infinity); // lower value = better rank (#1)
  });
  const idx = sorted.findIndex((r) => r.team === team);
  return idx >= 0 ? idx + 1 : null;
}

function getRankTierStyles(rank: number | null, isOpposingAllowed: boolean): { textClass: string; fill: string } {
  if (!rank || !Number.isFinite(rank)) {
    return { textClass: 'text-gray-500 dark:text-gray-400', fill: '#6b7280' };
  }
  const r = Math.trunc(rank);
  // Team selected ("for"): 1-7 green, 8-13 orange, 14-18 red.
  if (!isOpposingAllowed) {
    if (r <= 7) return { textClass: 'text-green-600 dark:text-green-400', fill: '#16a34a' };
    if (r <= 13) return { textClass: 'text-orange-600 dark:text-orange-400', fill: '#f59e0b' };
    return { textClass: 'text-red-600 dark:text-red-400', fill: '#ef4444' };
  }
  // Opponent allowed ("opposing"): flipped.
  if (r <= 7) return { textClass: 'text-red-600 dark:text-red-400', fill: '#ef4444' };
  if (r <= 13) return { textClass: 'text-orange-600 dark:text-orange-400', fill: '#f59e0b' };
  return { textClass: 'text-green-600 dark:text-green-400', fill: '#16a34a' };
}

export default function AflTeamMatchupCard({
  isDark,
  season: _season,
  teamName,
  opponentName,
}: AflTeamMatchupCardProps) {
  const [selectedSeason, setSelectedSeason] = useState<2025 | 2026>(2026);
  const [selectedStat, setSelectedStat] = useState<MatchupStatKey>('D');
  const [taData, setTaData] = useState<RankingData | null>(null);
  const [oaData, setOaData] = useState<RankingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const footywireTeam = teamName ? opponentToFootywireTeam(teamName) : null;
  const footywireOpponent = opponentName ? opponentToFootywireTeam(opponentName) : null;

  useEffect(() => {
    if (!footywireTeam || !footywireOpponent) {
      setTaData(null);
      setOaData(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      fetch(`/api/afl/team-rankings?season=${selectedSeason}&type=ta`).then((r) => r.json()),
      fetch(`/api/afl/team-rankings?season=${selectedSeason}&type=oa`).then((r) => r.json()),
    ])
      .then(([taJson, oaJson]) => {
        if (cancelled) return;
        if (taJson?.error || oaJson?.error) {
          setError(taJson?.error || oaJson?.error || 'Failed to load team matchup stats');
          setTaData(null);
          setOaData(null);
          return;
        }
        setTaData({ season: taJson?.season ?? selectedSeason, teams: taJson?.teams ?? [] });
        setOaData({ season: oaJson?.season ?? selectedSeason, teams: oaJson?.teams ?? [] });
      })
      .catch(() => {
        if (!cancelled) {
          setError('Failed to load team matchup stats');
          setTaData(null);
          setOaData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [selectedSeason, footywireTeam, footywireOpponent]);

  const teamRow = useMemo(
    () => (footywireTeam ? taData?.teams?.find((t) => t.team === footywireTeam) ?? null : null),
    [taData, footywireTeam]
  );
  const oppRow = useMemo(
    () => (footywireOpponent ? oaData?.teams?.find((t) => t.team === footywireOpponent) ?? null : null),
    [oaData, footywireOpponent]
  );
  const selectedLabel = useMemo(
    () => MATCHUP_STATS.find((s) => s.key === selectedStat)?.label ?? 'Disposals',
    [selectedStat]
  );

  if (!teamName) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
        Select a team to see Team Matchup.
      </div>
    );
  }

  if (!opponentName) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400 py-4">
        Team Matchup will show once the upcoming opponent is available.
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="flex items-center justify-between gap-2 mb-3 flex-shrink-0">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
        <div className="flex rounded-lg border border-gray-300 dark:border-gray-600 overflow-hidden">
          {SEASON_OPTIONS.map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => setSelectedSeason(y)}
              className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedSeason === y
                  ? 'bg-purple-600 text-white'
                  : isDark
                    ? 'bg-[#0a1929] text-gray-400 hover:text-gray-200'
                    : 'bg-gray-100 text-gray-600 hover:text-gray-900'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className={`rounded-lg border p-3 flex-1 min-h-0 flex flex-col ${isDark ? 'border-gray-700 bg-[#0a1929]' : 'border-gray-200 bg-gray-50'}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
          <h4 className={`text-sm font-mono font-bold uppercase tracking-wider ${isDark ? 'text-white' : 'text-slate-900'}`}>
            {(footywireTeam || teamName)} vs {(footywireOpponent || opponentName)}
          </h4>
        </div>

        {loading ? (
          <div className="text-sm text-gray-500 dark:text-gray-400 py-4">Loading…</div>
        ) : selectedSeason === 2026 && (error || !taData?.teams?.length || !oaData?.teams?.length) ? (
          <div className={`text-sm py-4 ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
            2026 stats will show once Team Averages and Opponent Breakdown data is available.
          </div>
        ) : error ? (
          <div className="text-sm text-amber-600 dark:text-amber-400">{error}</div>
        ) : !teamRow || !oppRow ? (
          <div className="text-sm text-gray-500 dark:text-gray-400">
            No matchup stats available for this team/opponent.
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
            <div className="grid grid-cols-2 gap-1">
              {MATCHUP_STATS.map((stat) => (
                <button
                  key={stat.key}
                  type="button"
                  onClick={() => setSelectedStat(stat.key)}
                  className={`px-1.5 py-1 text-[11px] font-medium rounded border transition-colors ${
                    selectedStat === stat.key
                      ? 'bg-purple-600 text-white border-purple-500'
                      : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-200/80 dark:border-gray-600/60'
                  }`}
                >
                  {stat.label.toUpperCase()}
                </button>
              ))}
            </div>
            {(() => {
              const teamValue = toNumber(teamRow.stats?.[selectedStat]) ?? 0;
              const oppAllowed = toNumber(oppRow.stats?.[selectedStat]) ?? 0;
              const teamRank = getRankForStat(taData?.teams ?? [], teamRow.team, selectedStat, true);
              // Opponent Allowed is defensive quality: allowing less is better rank.
              const oppRank = getRankForStat(oaData?.teams ?? [], oppRow.team, selectedStat, false);
              const teamCount = Math.max((taData?.teams?.length ?? 0), (oaData?.teams?.length ?? 0), 18);
              const teamStrength = teamRank ? Math.max(1, teamCount + 1 - teamRank) : 1;
              const oppStrength = oppRank ? Math.max(1, teamCount + 1 - oppRank) : 1;
              const totalStrength = teamStrength + oppStrength;
              // Keep the bar aligned with the label: left is always the selected team's "For",
              // right is always the opponent's "Against".
              const teamShare = totalStrength > 0 ? (teamStrength / totalStrength) * 100 : 50;
              const oppShare = 100 - teamShare;
              const teamTier = getRankTierStyles(teamRank, false);
              const oppTier = getRankTierStyles(oppRank, true);
              return (
                <div className="flex flex-col items-center justify-center">
                  <div className="w-full bg-gray-100 dark:bg-[#0a1929] rounded-lg border border-gray-200/80 dark:border-gray-600/60 px-2 py-0.5">
                    <div className="flex items-center justify-between gap-1 text-xs">
                      <div className={`flex-1 text-center ${teamTier.textClass}`}>
                        <span className="font-bold">{footywireTeam || teamName}</span>
                        <span className="font-bold ml-1">{teamRank ? `#${teamRank}` : '—'}</span>
                        <div className={`text-[11px] font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {fmt(teamValue)}
                        </div>
                      </div>
                      <div className="text-gray-400 font-bold px-1">VS</div>
                      <div className={`flex-1 text-center ${oppTier.textClass}`}>
                        <span className="font-bold">{footywireOpponent || opponentName}</span>
                        <span className="font-bold ml-1">{oppRank ? `#${oppRank}` : '—'}</span>
                        <div className={`text-[11px] font-medium ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                          {fmt(oppAllowed)}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {selectedLabel}
                  </div>
                  <div className="w-full px-1">
                    <div className="flex items-center justify-between text-[10px] text-gray-500 dark:text-gray-400 mb-1">
                      <span>#1</span>
                      <span>Rank</span>
                      <span>#{teamCount}</span>
                    </div>
                    <div className="relative h-3 rounded-full overflow-hidden border border-gray-200 dark:border-gray-600">
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${teamShare}%`, backgroundColor: teamTier.fill }}
                      />
                      <div
                        className="absolute inset-y-0 right-0"
                        style={{ width: `${oppShare}%`, backgroundColor: oppTier.fill }}
                      />
                    </div>
                    <div className="mt-2 flex items-center justify-center gap-4 text-[10px]">
                      <span className="inline-flex items-center gap-1 text-gray-300">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: teamTier.fill }} />
                        {footywireTeam || teamName}
                      </span>
                      <span className="inline-flex items-center gap-1 text-gray-300">
                        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: oppTier.fill }} />
                        {footywireOpponent || opponentName}
                      </span>
                    </div>
                    <div className="mt-1 text-center text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      For vs Against
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
