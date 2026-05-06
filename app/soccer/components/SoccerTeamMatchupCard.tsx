'use client';

import { useEffect, useState } from 'react';
import { Info } from 'lucide-react';
import type { TeamMatchupApiResponse } from '@/app/api/soccer/team-matchup/route';

type SoccerTeamMatchupCardProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  nextCompetitionName: string | null;
  nextCompetitionCountry: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
};

function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function getRankTierStyles(rank: number | null, isOpposingAllowed: boolean): { textClass: string; fill: string } {
  return isOpposingAllowed
    ? { textClass: 'text-red-600 dark:text-red-400', fill: '#ef4444' }
    : { textClass: 'text-green-600 dark:text-green-400', fill: '#16a34a' };
}

function formatMatchupLabel(label: string): string {
  if (label === 'Goals' || label === 'Shots' || label === 'SOT' || label === 'xG') return label.toUpperCase();
  return label.toUpperCase();
}

function formatSeasonLabel(seasonYear: number | null | undefined): string | null {
  if (!seasonYear || !Number.isFinite(seasonYear)) return null;
  return `${seasonYear}/${String(seasonYear + 1).slice(-2)}`;
}

const MATCHUP_INFO_TEXT =
  'This shows the selected team averages going forward (attacking) versus what the opponent allows (defending).';
const TEAM_MATCHUP_SESSION_PREFIX = 'soccer-team-matchup:v1:';

type MatchupViewMode = 'selected-for' | 'opponent-for';

function getTeamMatchupSessionKey(key: string): string {
  return `${TEAM_MATCHUP_SESSION_PREFIX}${key}`;
}

function readCachedTeamMatchup(key: string): TeamMatchupApiResponse | null {
  if (typeof window === 'undefined' || !key) return null;
  try {
    const raw = window.sessionStorage.getItem(getTeamMatchupSessionKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { data?: TeamMatchupApiResponse } | null;
    return parsed?.data ?? null;
  } catch {
    return null;
  }
}

function writeCachedTeamMatchup(key: string, data: TeamMatchupApiResponse): void {
  if (typeof window === 'undefined' || !key) return;
  try {
    window.sessionStorage.setItem(
      getTeamMatchupSessionKey(key),
      JSON.stringify({ data, cachedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

function getMatchupInfoText(viewMode: MatchupViewMode): string {
  return viewMode === 'opponent-for'
    ? 'This shows the opponent averages going forward (attacking) versus what the selected team allows (defending).'
    : MATCHUP_INFO_TEXT;
}

function getViewModeSummary(
  viewMode: MatchupViewMode,
  selectedTeamName: string | null | undefined,
  opponentTeamName: string | null | undefined
): string {
  const selectedLabel = selectedTeamName?.trim() || 'Selected team';
  const opponentLabel = opponentTeamName?.trim() || 'Opponent';
  return viewMode === 'opponent-for'
    ? `${opponentLabel} attack vs ${selectedLabel} defense`
    : `${selectedLabel} attack vs ${opponentLabel} defense`;
}

function TeamMatchupHeaderRow({
}: {
  isDark: boolean;
}) {
  return (
    <div className="mt-1 mb-2 flex flex-shrink-0 items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Matchup</h3>
    </div>
  );
}

export function SoccerTeamMatchupCard({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  nextCompetitionName,
  nextCompetitionCountry,
  emptyTextClass,
  showSkeleton = false,
}: SoccerTeamMatchupCardProps) {
  const [data, setData] = useState<TeamMatchupApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<MatchupViewMode>('selected-for');

  const canFetch = Boolean(nextCompetitionName && (teamName?.trim() || teamHref) && (opponentName?.trim() || opponentHref));
  const cacheKey = [
    String(nextCompetitionName || '').trim(),
    String(nextCompetitionCountry || '').trim(),
    String(teamName || '').trim(),
    String(teamHref || '').trim(),
    String(opponentName || '').trim(),
    String(opponentHref || '').trim(),
  ].join('|');

  useEffect(() => {
    if (!canFetch || !nextCompetitionName) {
      setData(null);
      setError(null);
      return;
    }

    let cancelled = false;
    const cachedData = readCachedTeamMatchup(cacheKey);
    if (cachedData) setData(cachedData);
    setLoading(!cachedData);
    setError(null);

    const fetchMatchup = async () => {
      const params = new URLSearchParams();
      params.set('competitionName', nextCompetitionName);
      params.set('timeframe', 'season');
      if (nextCompetitionCountry?.trim()) params.set('competitionCountry', nextCompetitionCountry.trim());
      if (teamName?.trim()) params.set('teamName', teamName.trim());
      if (teamHref?.trim()) params.set('teamHref', teamHref.trim());
      if (opponentName?.trim()) params.set('opponentName', opponentName.trim());
      if (opponentHref?.trim()) params.set('opponentHref', opponentHref.trim());
      const response = await fetch(`/api/soccer/team-matchup?${params.toString()}`, { cache: 'no-store' });
        const payload = (await response.json().catch(() => null)) as TeamMatchupApiResponse | { error?: string } | null;
        if (!response.ok) {
          throw new Error(payload && 'error' in payload ? String(payload.error) : 'Failed to load team matchup');
        }
        return payload as TeamMatchupApiResponse;
    };

    void Promise.all([fetchMatchup()])
      .then((payloads) => {
        if (cancelled) return;
        const primaryPayload = payloads[0] ?? null;
        setData(primaryPayload);
        if (primaryPayload) writeCachedTeamMatchup(cacheKey, primaryPayload);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (!cachedData) {
          setData(null);
          setError(err instanceof Error ? err.message : 'Failed to load team matchup');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cacheKey, canFetch, nextCompetitionCountry, nextCompetitionName, opponentHref, opponentName, teamHref, teamName]);

  const rows = data?.rows ?? [];
  const seasonLabel = formatSeasonLabel(data?.seasonYear);
  const selectedLabel = data?.team?.name ?? teamName ?? 'Selected team';
  const opponentLabel = data?.opponent?.name ?? opponentName ?? 'Opponent';
  const matchupGamesLabel =
    data?.team?.games && data?.opponent?.games
      ? `${data.team.games}/${data.opponent.games} games`
      : data?.team?.games
        ? `${data.team.games} games`
        : data?.opponent?.games
          ? `${data.opponent.games} games`
          : null;

  if (showSkeleton || loading) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="px-3">
          <TeamMatchupHeaderRow isDark={isDark} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2.5">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
            <div className={`h-4 w-36 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          </div>
          <div className="space-y-1.5">
            {[0, 1, 2, 3].map((idx) => (
              <div key={idx} className={`h-14 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!canFetch) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="px-3">
          <TeamMatchupHeaderRow isDark={isDark} />
        </div>
        <div className="flex-1 min-h-0 flex items-center px-3 pb-2.5">
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        <div className="px-3">
          <TeamMatchupHeaderRow isDark={isDark} />
        </div>
        <div className="flex-1 min-h-0 flex flex-col px-3 pb-2.5">
          <div className="flex-1 min-h-0 flex items-center">
            <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 h-full flex flex-col">
      <div className="px-3">
        <TeamMatchupHeaderRow isDark={isDark} />
      </div>
      <div className="flex-1 min-h-0 flex flex-col px-3 pb-2.5">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className={`inline-flex w-full items-center rounded-xl border p-1 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
              <button
                type="button"
                onClick={() => setViewMode('selected-for')}
                className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  viewMode === 'selected-for'
                    ? 'bg-green-600 text-white shadow-sm'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-white'
                }`}
              >
                <span className="block truncate">{selectedLabel}</span>
              </button>
              <button
                type="button"
                onClick={() => setViewMode('opponent-for')}
                className={`min-w-0 flex-1 rounded-lg px-2 py-1.5 text-[11px] font-semibold transition-colors ${
                  viewMode === 'opponent-for'
                    ? 'bg-red-600 text-white shadow-sm'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-white'
                }`}
              >
                <span className="block truncate">{opponentLabel}</span>
              </button>
            </div>
            <div className={`mt-1 text-center text-[10px] font-medium uppercase tracking-wide ${isDark ? 'text-white' : 'text-gray-500'}`}>
              {getViewModeSummary(viewMode, selectedLabel, opponentLabel)}
            </div>
          </div>
          <div className="group relative">
            <button
              type="button"
              aria-label="Explain current matchup view"
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border transition-colors ${
                isDark
                  ? 'border-gray-600 text-gray-300 hover:bg-gray-800'
                  : 'border-gray-300 text-gray-600 hover:bg-gray-100'
              }`}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
            <div
              className={`pointer-events-none absolute right-0 top-full z-20 mt-2 w-60 rounded-lg border p-2 text-[11px] leading-snug opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
                isDark
                  ? 'border-gray-700 bg-[#0f172a] text-gray-200'
                  : 'border-gray-200 bg-white text-gray-700'
              }`}
            >
              {getMatchupInfoText(viewMode)}
            </div>
          </div>
        </div>
        {rows.length === 0 ? (
          <div className={`text-sm py-4 ${emptyTextClass}`}>No data available come back later</div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
            {rows.map((selectedRow) => {
              const isOpponentPrimary = viewMode === 'opponent-for';
              const primaryRank = isOpponentPrimary ? selectedRow.opponentForRank : selectedRow.teamForRank;
              const secondaryRank = isOpponentPrimary ? selectedRow.teamAgainstRank : selectedRow.opponentAgainstRank;
              const rankedSize = Math.max(
                isOpponentPrimary ? selectedRow.opponentForRankedSize : selectedRow.teamForRankedSize,
                isOpponentPrimary ? selectedRow.teamAgainstRankedSize : selectedRow.opponentAgainstRankedSize,
                20
              );
              const primaryStrength = primaryRank ? Math.max(1, rankedSize + 1 - primaryRank) : 1;
              const secondaryStrength = secondaryRank ? Math.max(1, rankedSize + 1 - secondaryRank) : 1;
              const totalStrength = primaryStrength + secondaryStrength;
              const primaryShare = totalStrength > 0 ? (primaryStrength / totalStrength) * 100 : 50;
              const secondaryShare = 100 - primaryShare;
              const primaryTier = isOpponentPrimary
                ? getRankTierStyles(selectedRow.opponentForRank, true)
                : getRankTierStyles(selectedRow.teamForRank, false);
              const secondaryTier = isOpponentPrimary
                ? getRankTierStyles(selectedRow.teamAgainstRank, false)
                : getRankTierStyles(selectedRow.opponentAgainstRank, true);
              const primaryValue = isOpponentPrimary ? selectedRow.opponentForValue : selectedRow.teamForValue;
              const secondaryValue = isOpponentPrimary ? selectedRow.teamAgainstValue : selectedRow.opponentAgainstValue;

              return (
                <div
                  key={selectedRow.id}
                  className="flex flex-col items-center justify-center px-1 py-0.5"
                >
                  <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                    {formatMatchupLabel(selectedRow.label)}
                  </div>
                  <div className="w-full px-0.5">
                    <div className="mb-0.5 flex items-center justify-between text-[11px] font-medium leading-none">
                      <span className={primaryTier.textClass}>{formatValue(primaryValue)}</span>
                      <span className={secondaryTier.textClass}>{formatValue(secondaryValue)}</span>
                    </div>
                    <div className="relative h-2 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/60">
                      <div
                        className="absolute inset-y-0 left-0"
                        style={{ width: `${primaryShare}%`, backgroundColor: primaryTier.fill }}
                      />
                      <div
                        className="absolute inset-y-0 right-0"
                        style={{ width: `${secondaryShare}%`, backgroundColor: secondaryTier.fill }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
            {matchupGamesLabel || seasonLabel ? (
              <div className="pt-0.5 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">
                {[matchupGamesLabel, seasonLabel].filter(Boolean).join(' · ')}
              </div>
            ) : null}
            <div className="pt-0.5 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">Premier League</div>
          </div>
        )}
      </div>
    </div>
  );
}
