'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

type SoccerHomeAwayCardProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
  /** Hide the centered "Home vs Away" title (e.g. when embedded in a tabbed shell). */
  hideTitle?: boolean;
};

type TeamResultsApiResponse = {
  matches?: SoccerwayRecentMatch[];
  error?: string;
};

type ViewMode = 'selected' | 'opponent';
type VenueMode = 'home' | 'away';
type VenueStatId = 'goals' | 'expected_goals_xg' | 'total_shots' | 'shots_on_target';

type VenueSummary = {
  key: VenueMode;
  label: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  stats: Array<{
    id: VenueStatId;
    label: string;
    venueAverage: number | null;
    comparisonAverage: number | null;
    delta: number | null;
  }>;
};

type TeamHomeAwaySummary = {
  teamName: string;
  seasonYear: number;
  seasonGames: number;
  venues: VenueSummary[];
};

const VENUE_STATS: Array<{ id: VenueStatId; label: string; statName: string | null }> = [
  { id: 'goals', label: 'Goals', statName: null },
  { id: 'expected_goals_xg', label: 'xG', statName: 'Expected goals (xG)' },
  { id: 'total_shots', label: 'Shots', statName: 'Total shots' },
  { id: 'shots_on_target', label: 'SOT', statName: 'Shots on target' },
];

function normalizeTeamName(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/\b(fc|afc|cf|sc|ac|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTeamSide(match: SoccerwayRecentMatch, teamName: string): 'home' | 'away' | null {
  const normalizedTeam = normalizeTeamName(teamName);
  if (normalizeTeamName(match.homeTeam) === normalizedTeam) return 'home';
  if (normalizeTeamName(match.awayTeam) === normalizedTeam) return 'away';
  return null;
}

function getGoalsFor(match: SoccerwayRecentMatch, teamName: string): number | null {
  const side = getTeamSide(match, teamName);
  if (!side) return null;
  return side === 'home' ? match.homeScore : match.awayScore;
}

function parseNumeric(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = String(raw).replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function getMatchStats(match: SoccerwayRecentMatch): SoccerwayMatchStat[] {
  const matchPeriod = match.stats?.periods.find((period) => String(period.name || '').trim().toLowerCase() === 'match');
  if (!matchPeriod) return [];
  return matchPeriod.categories.flatMap((category) => category.stats);
}

function findStat(match: SoccerwayRecentMatch, statName: string): SoccerwayMatchStat | null {
  for (const stat of getMatchStats(match)) {
    if (String(stat.name || '').trim().toLowerCase() === statName.toLowerCase()) return stat;
  }
  return null;
}

function getTeamStatValue(match: SoccerwayRecentMatch, teamName: string, statName: string): number | null {
  const side = getTeamSide(match, teamName);
  const stat = findStat(match, statName);
  if (!side || !stat) return null;
  return parseNumeric(side === 'home' ? stat.homeValue : stat.awayValue);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatValue(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(2);
}

function formatDelta(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 0.005) return 'EVEN';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

function getDeltaStyles(delta: number | null): { textClass: string; fill: string } {
  if (delta == null || !Number.isFinite(delta) || Math.abs(delta) < 0.005) {
    return {
      textClass: 'text-amber-600 dark:text-amber-300',
      fill: '#d97706',
    };
  }
  if (delta > 0) {
    return {
      textClass: 'text-green-600 dark:text-green-400',
      fill: '#16a34a',
    };
  }
  return {
    textClass: 'text-red-600 dark:text-red-400',
    fill: '#ef4444',
  };
}

function getLastCompletedSoccerSeasonYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year - 1 : year - 2;
}

function buildVenueSummary(
  seasonMatches: SoccerwayRecentMatch[],
  teamName: string,
  venue: VenueMode,
  label: string
): VenueSummary {
  const venueMatches = seasonMatches.filter((match) => getTeamSide(match, teamName) === venue);
  const comparisonMatches = seasonMatches.filter((match) => getTeamSide(match, teamName) !== venue);
  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (const match of venueMatches) {
    const goalsFor = getGoalsFor(match, teamName);
    const goalsAgainst = venue === 'home' ? match.awayScore : match.homeScore;
    if (goalsFor == null || goalsAgainst == null) continue;
    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor < goalsAgainst) losses += 1;
    else draws += 1;
  }

  const stats = VENUE_STATS.map((stat) => {
    const venueValues =
      stat.id === 'goals'
        ? venueMatches.map((match) => getGoalsFor(match, teamName)).filter((value): value is number => value != null)
        : venueMatches
            .map((match) => getTeamStatValue(match, teamName, stat.statName!))
            .filter((value): value is number => value != null);

    const comparisonValues =
      stat.id === 'goals'
        ? comparisonMatches.map((match) => getGoalsFor(match, teamName)).filter((value): value is number => value != null)
        : comparisonMatches
            .map((match) => getTeamStatValue(match, teamName, stat.statName!))
            .filter((value): value is number => value != null);

    const venueAverage = average(venueValues);
    const comparisonAverage = average(comparisonValues);

    return {
      id: stat.id,
      label: stat.label,
      venueAverage,
      comparisonAverage,
      delta:
        venueAverage != null && comparisonAverage != null && Number.isFinite(venueAverage) && Number.isFinite(comparisonAverage)
          ? venueAverage - comparisonAverage
          : null,
    };
  });

  return {
    key: venue,
    label,
    games: venueMatches.length,
    wins,
    draws,
    losses,
    stats,
  };
}

function buildTeamHomeAwaySummary(teamName: string, matches: SoccerwayRecentMatch[], seasonYear: number): TeamHomeAwaySummary | null {
  const filteredMatches = matches
    .filter((match) => {
      if (match.kickoffUnix == null || !Number.isFinite(match.kickoffUnix)) return false;
      const kickoff = new Date(match.kickoffUnix * 1000);
      const month = kickoff.getUTCMonth();
      const year = kickoff.getUTCFullYear();
      const matchSeasonYear = month >= 6 ? year : year - 1;
      return matchSeasonYear === seasonYear;
    })
    .sort((a, b) => {
      const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
      const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
      if (aKickoff !== bKickoff) return bKickoff - aKickoff;
      return String(b.matchId || '').localeCompare(String(a.matchId || ''));
    });

  if (!filteredMatches.length) return null;

  return {
    teamName,
    seasonYear,
    seasonGames: filteredMatches.length,
    venues: [
      buildVenueSummary(filteredMatches, teamName, 'home', 'Home'),
      buildVenueSummary(filteredMatches, teamName, 'away', 'Away'),
    ],
  };
}

function HomeAwayHeader() {
  return (
    <div className="relative flex items-center justify-center mt-1 mb-2 flex-shrink-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Home vs Away</h3>
    </div>
  );
}

export function SoccerHomeAwayCard({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  emptyTextClass,
  showSkeleton = false,
  hideTitle = false,
}: SoccerHomeAwayCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('selected');
  const [teamMatches, setTeamMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [opponentMatches, setOpponentMatches] = useState<SoccerwayRecentMatch[]>([]);

  const canFetch = Boolean(teamHref?.trim() && opponentHref?.trim() && teamName?.trim() && opponentName?.trim());

  useEffect(() => {
    if (!canFetch || !teamHref || !opponentHref) {
      setTeamMatches([]);
      setOpponentMatches([]);
      setError(null);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setLoading(true);
    setError(null);

    const fetchMatches = async (href: string) => {
      const response = await fetch(`/api/soccer/team-results?href=${encodeURIComponent(href)}&cacheOnly=1`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as TeamResultsApiResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load home vs away');
      }
      return Array.isArray(payload?.matches) ? payload.matches : [];
    };

    void Promise.all([fetchMatches(teamHref), fetchMatches(opponentHref)])
      .then(([selectedMatches, opponentSideMatches]) => {
        if (cancelled) return;
        setTeamMatches(selectedMatches);
        setOpponentMatches(opponentSideMatches);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        setTeamMatches([]);
        setOpponentMatches([]);
        setError(err instanceof Error ? err.message : 'Failed to load home vs away');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canFetch, opponentHref, teamHref]);

  const seasonYear = getLastCompletedSoccerSeasonYear();
  const selectedSummary = useMemo(
    () => (teamName ? buildTeamHomeAwaySummary(teamName, teamMatches, seasonYear) : null),
    [seasonYear, teamMatches, teamName]
  );
  const opponentSummary = useMemo(
    () => (opponentName ? buildTeamHomeAwaySummary(opponentName, opponentMatches, seasonYear) : null),
    [opponentMatches, opponentName, seasonYear]
  );

  const currentSummary = viewMode === 'opponent' ? opponentSummary : selectedSummary;
  const selectedLabel = selectedSummary?.teamName ?? teamName ?? 'Selected team';
  const opponentLabel = opponentSummary?.teamName ?? opponentName ?? 'Opponent';

  if (showSkeleton || loading) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <HomeAwayHeader /> : null}
        <div className="flex-1 min-h-0 flex flex-col px-2 pb-1.5">
          <div className={`mb-1.5 h-9 rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          <div className="grid min-h-0 grid-cols-1 gap-1 lg:grid-cols-2">
            {[0, 1].map((idx) => (
              <div key={idx} className={`min-h-[10rem] flex-1 rounded-xl animate-pulse xl:min-h-[12rem] ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!canFetch) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <HomeAwayHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <HomeAwayHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!selectedSummary && !opponentSummary) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <HomeAwayHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>No cached split data found yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 flex flex-col">
      {!hideTitle ? <HomeAwayHeader /> : null}
      <div className="flex flex-col px-2 pb-1.5">
        <div className="mb-1">
          <div className={`inline-flex w-full items-center rounded-xl border p-0.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
            <button
              type="button"
              onClick={() => setViewMode('selected')}
              className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                viewMode === 'selected'
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
              onClick={() => setViewMode('opponent')}
              className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                viewMode === 'opponent'
                  ? 'bg-red-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              <span className="block truncate">{opponentLabel}</span>
            </button>
          </div>
        </div>

        {!currentSummary ? (
          <div className={`text-sm py-4 ${emptyTextClass}`}>No data available come back later</div>
        ) : (
          <div className="overflow-x-hidden pr-0.5">
            <div className="grid grid-cols-1 gap-1 lg:grid-cols-2 lg:items-start">
              {currentSummary.venues.map((venue) => (
                <div
                  key={venue.key}
                  className={`flex flex-col rounded-lg border px-2.5 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}
                >
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                        {venue.label}
                      </div>
                      <div className="ml-auto text-xs font-semibold leading-none tabular-nums">
                        <span className="text-green-500 dark:text-green-400">{venue.wins}</span>
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                        <span className="text-slate-500 dark:text-slate-300">{venue.draws}</span>
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                        <span className="text-red-500 dark:text-red-400">{venue.losses}</span>
                      </div>
                    </div>
                    <div className={`mt-0.5 text-xs leading-none ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                      {venue.games} matches
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {venue.stats.map((stat) => {
                      const primary = stat.venueAverage;
                      const secondary = stat.comparisonAverage;
                      const primaryStrength = Math.max(primary ?? 0, 0.05);
                      const secondaryStrength = Math.max(secondary ?? 0, 0.05);
                      const totalStrength = primaryStrength + secondaryStrength;
                      const primaryShare = totalStrength > 0 ? (primaryStrength / totalStrength) * 100 : 50;
                      const secondaryShare = 100 - primaryShare;
                      const deltaStyles = getDeltaStyles(stat.delta);

                      return (
                        <div key={stat.id} className="space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold leading-none">
                            <span className={deltaStyles.textClass}>{formatValue(primary)}</span>
                            <span className={`${isDark ? 'text-gray-300' : 'text-gray-700'}`}>{stat.label}</span>
                            <span className={`${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{formatValue(secondary)}</span>
                          </div>
                          <div className="relative h-3.5 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/60">
                            <div
                              className="absolute inset-y-0 left-0"
                              style={{ width: `${primaryShare}%`, backgroundColor: deltaStyles.fill }}
                            />
                            <div
                              className="absolute inset-y-0 right-0 bg-slate-400 dark:bg-slate-500"
                              style={{ width: `${secondaryShare}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between text-[11px] leading-none">
                            <span className={deltaStyles.textClass}>{formatDelta(stat.delta)}</span>
                            <span className={`${isDark ? 'text-white' : 'text-gray-500'}`}>
                              {venue.key === 'home' ? 'vs away avg' : 'vs home avg'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
