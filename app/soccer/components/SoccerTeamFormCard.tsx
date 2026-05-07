'use client';

import { useEffect, useMemo, useState } from 'react';

import { SoccerStatsCustomizer } from '@/app/soccer/components/SoccerStatsCustomizer';
import { SOCCER_BETTABLE_STATS } from '@/app/soccer/components/SoccerStatsChart';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';

type SoccerTeamFormCardProps = {
  isDark: boolean;
  teamName: string | null;
  teamHref: string | null;
  opponentName: string | null;
  opponentHref: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
  /** Hide the centered "Team Form" title (e.g. when embedded in a tabbed shell). */
  hideTitle?: boolean;
};

type TeamResultsApiResponse = {
  matches?: SoccerwayRecentMatch[];
  error?: string;
};

type FormViewMode = 'selected' | 'opponent';
type FormWindowKey = 'last5' | 'h2h';
type FormStatId = string;

type FormWindowSummary = {
  key: FormWindowKey;
  label: string;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  stats: Array<{
    id: FormStatId;
    label: string;
    recentAverage: number | null;
    seasonAverage: number | null;
    delta: number | null;
  }>;
};

type TeamFormSummary = {
  teamName: string;
  seasonYear: number;
  seasonGames: number;
  windows: FormWindowSummary[];
};

const FORM_STAT_PRIORITY: FormStatId[] = [
  'total_goals',
  'expected_goals_xg',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'big_chances',
  'corner_kicks',
  'ball_possession',
  'touches_in_opposition_box',
  'yellow_cards',
  'red_cards',
  'fouls',
  'goalkeeper_saves',
];
const FORM_DEFAULT_VISIBLE_STATS: FormStatId[] = [
  'total_goals',
  'expected_goals_xg',
  'total_shots',
  'shots_on_target',
];
const TEAM_FORM_MATCHES_SESSION_PREFIX = 'soccer-team-form-matches:v1:';

function getTeamFormMatchesSessionKey(teamHref: string): string {
  return `${TEAM_FORM_MATCHES_SESSION_PREFIX}${teamHref}`;
}

function readCachedTeamFormMatches(teamHref: string | null | undefined): SoccerwayRecentMatch[] {
  if (typeof window === 'undefined') return [];
  const normalizedHref = String(teamHref || '').trim();
  if (!normalizedHref) return [];
  try {
    const raw = window.sessionStorage.getItem(getTeamFormMatchesSessionKey(normalizedHref));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { matches?: SoccerwayRecentMatch[] } | null;
    return Array.isArray(parsed?.matches) ? parsed.matches : [];
  } catch {
    return [];
  }
}

function writeCachedTeamFormMatches(teamHref: string | null | undefined, matches: SoccerwayRecentMatch[]): void {
  if (typeof window === 'undefined') return;
  const normalizedHref = String(teamHref || '').trim();
  if (!normalizedHref || matches.length === 0) return;
  try {
    window.sessionStorage.setItem(
      getTeamFormMatchesSessionKey(normalizedHref),
      JSON.stringify({ matches, cachedAt: Date.now() })
    );
  } catch {
    /* ignore */
  }
}

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

function normalizeOpponentToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/\b(fc|afc|cf|sc|ac|club)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function opponentNamesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeOpponentToken(a);
  const right = normalizeOpponentToken(b);
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function getTeamSide(match: SoccerwayRecentMatch, teamName: string): 'home' | 'away' | null {
  const normalizedTeam = normalizeTeamName(teamName);
  if (normalizeTeamName(match.homeTeam) === normalizedTeam) return 'home';
  if (normalizeTeamName(match.awayTeam) === normalizedTeam) return 'away';
  return null;
}

function getCurrentSoccerSeasonYear(): number {
  const now = new Date();
  const month = now.getUTCMonth();
  const year = now.getUTCFullYear();
  return month >= 6 ? year : year - 1;
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

function getGoalsFor(match: SoccerwayRecentMatch, teamName: string): number | null {
  const side = getTeamSide(match, teamName);
  if (!side) return null;
  return side === 'home' ? match.homeScore : match.awayScore;
}

function getGoalsAgainst(match: SoccerwayRecentMatch, teamName: string): number | null {
  const side = getTeamSide(match, teamName);
  if (!side) return null;
  return side === 'home' ? match.awayScore : match.homeScore;
}

function getTeamStatValue(match: SoccerwayRecentMatch, teamName: string, statName: string): number | null {
  const side = getTeamSide(match, teamName);
  const stat = findStat(match, statName);
  if (!side || !stat) return null;
  return parseNumeric(side === 'home' ? stat.homeValue : stat.awayValue);
}

function formatStatKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(xg\)/g, ' xg')
    .replace(/%/g, ' percent ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function formatStatLabel(key: string): string {
  if (key === 'total_goals') return 'Goals';
  if (key === 'expected_goals_xg') return 'xG';
  if (key === 'xg_on_target_xgot') return 'xGOT';
  if (key === 'expected_assists_xa') return 'xA';
  if (key === 'ball_possession') return 'Possession';
  return key
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function isComparableStat(key: string): boolean {
  return key === 'total_goals' || key === 'expected_goals_xg' || key === 'ball_possession' || SOCCER_BETTABLE_STATS.has(key);
}

function buildTeamStatAverages(matches: SoccerwayRecentMatch[], teamName: string): Record<string, number> {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};

  for (const match of matches) {
    const side = getTeamSide(match, teamName);
    if (!side) continue;

    const goals = getGoalsFor(match, teamName);
    if (goals != null) {
      sums.total_goals = (sums.total_goals ?? 0) + goals;
      counts.total_goals = (counts.total_goals ?? 0) + 1;
    }

    for (const stat of getMatchStats(match)) {
      const key = formatStatKey(stat.name);
      if (!isComparableStat(key) || key === 'total_goals') continue;
      const rawValue = side === 'home' ? stat.homeValue : stat.awayValue;
      const parsedValue = parseNumeric(rawValue);
      if (parsedValue == null) continue;
      sums[key] = (sums[key] ?? 0) + parsedValue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  return Object.fromEntries(
    Object.entries(sums)
      .filter(([key]) => (counts[key] ?? 0) > 0)
      .map(([key, sum]) => [key, sum / (counts[key] ?? 1)])
  );
}

function orderComparableStatKeys(keys: Iterable<string>): string[] {
  const keySet = new Set<string>(keys);
  const ordered: string[] = [];

  for (const key of FORM_STAT_PRIORITY) {
    if (keySet.has(key)) ordered.push(key);
  }
  for (const key of keySet) {
    if (!ordered.includes(key)) ordered.push(key);
  }

  return ordered;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
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

function buildWindowSummary(matches: SoccerwayRecentMatch[], teamName: string, key: FormWindowKey, label: string, seasonMatches: SoccerwayRecentMatch[]): FormWindowSummary {
  const windowMatches = matches.slice(0, 5);
  const comparisonMatches = key === 'h2h' ? seasonMatches.slice(0, 10) : seasonMatches;
  let wins = 0;
  let draws = 0;
  let losses = 0;

  for (const match of windowMatches) {
    const goalsFor = getGoalsFor(match, teamName);
    const goalsAgainst = getGoalsAgainst(match, teamName);
    if (goalsFor == null || goalsAgainst == null) continue;
    if (goalsFor > goalsAgainst) wins += 1;
    else if (goalsFor < goalsAgainst) losses += 1;
    else draws += 1;
  }

  const recentAverages = buildTeamStatAverages(windowMatches, teamName);
  const comparisonAverages = buildTeamStatAverages(comparisonMatches, teamName);
  const statKeys = orderComparableStatKeys([...Object.keys(recentAverages), ...Object.keys(comparisonAverages)]);
  const stats = statKeys.map((statKey) => {
    const recentAverage = recentAverages[statKey] ?? null;
    const seasonAverage = comparisonAverages[statKey] ?? null;

    return {
      id: statKey,
      label: formatStatLabel(statKey),
      recentAverage,
      seasonAverage,
      delta:
        recentAverage != null && seasonAverage != null && Number.isFinite(recentAverage) && Number.isFinite(seasonAverage)
          ? recentAverage - seasonAverage
          : null,
    };
  });

  return {
    key,
    label,
    games: windowMatches.length,
    wins,
    draws,
    losses,
    stats,
  };
}

function buildTeamFormSummary(
  teamName: string,
  matches: SoccerwayRecentMatch[],
  seasonYear: number,
  opponentName: string
): TeamFormSummary | null {
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

  if (filteredMatches.length === 0) return null;

  const h2hMatches = matches
    .filter((match) => {
      const side = getTeamSide(match, teamName);
      if (!side) return false;
      const otherTeam = side === 'home' ? match.awayTeam : match.homeTeam;
      return opponentNamesMatch(otherTeam, opponentName);
    })
    .sort((a, b) => {
      const aKickoff = a.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
      const bKickoff = b.kickoffUnix ?? Number.MIN_SAFE_INTEGER;
      if (aKickoff !== bKickoff) return bKickoff - aKickoff;
      return String(b.matchId || '').localeCompare(String(a.matchId || ''));
    });

  return {
    teamName,
    seasonYear,
    seasonGames: filteredMatches.length,
    windows: [
      buildWindowSummary(filteredMatches, teamName, 'last5', 'Last 5', filteredMatches),
      buildWindowSummary(h2hMatches, teamName, 'h2h', 'Last 5 H2H', filteredMatches),
    ],
  };
}

function TeamFormHeader() {
  return (
    <div className="relative flex items-center justify-center mt-1 mb-2 flex-shrink-0">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Form</h3>
    </div>
  );
}

export function SoccerTeamFormCard({
  isDark,
  teamName,
  teamHref,
  opponentName,
  opponentHref,
  emptyTextClass,
  showSkeleton = false,
  hideTitle = false,
}: SoccerTeamFormCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<FormViewMode>('selected');
  const [teamMatches, setTeamMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [opponentMatches, setOpponentMatches] = useState<SoccerwayRecentMatch[]>([]);
  const [selectedStats, setSelectedStats] = useState<FormStatId[]>([]);
  const [showStatPicker, setShowStatPicker] = useState(false);

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
    const cachedSelectedMatches = readCachedTeamFormMatches(teamHref);
    const cachedOpponentMatches = readCachedTeamFormMatches(opponentHref);
    const hasCachedSelectedMatches = cachedSelectedMatches.length > 0;
    const hasCachedOpponentMatches = cachedOpponentMatches.length > 0;
    if (hasCachedSelectedMatches) setTeamMatches(cachedSelectedMatches);
    if (hasCachedOpponentMatches) setOpponentMatches(cachedOpponentMatches);
    setLoading(!hasCachedSelectedMatches && !hasCachedOpponentMatches);
    setError(null);

    const fetchMatches = async (href: string) => {
      const response = await fetch(`/api/soccer/team-results?href=${encodeURIComponent(href)}&cacheOnly=1`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      const payload = (await response.json().catch(() => null)) as TeamResultsApiResponse | null;
      if (!response.ok) {
        throw new Error(payload?.error || 'Failed to load team form');
      }
      return Array.isArray(payload?.matches) ? payload.matches : [];
    };

    void Promise.all([fetchMatches(teamHref), fetchMatches(opponentHref)])
      .then(([selectedMatches, opponentSideMatches]) => {
        if (cancelled) return;
        setTeamMatches(selectedMatches);
        setOpponentMatches(opponentSideMatches);
        writeCachedTeamFormMatches(teamHref, selectedMatches);
        writeCachedTeamFormMatches(opponentHref, opponentSideMatches);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        if (!hasCachedSelectedMatches && !hasCachedOpponentMatches) {
          setTeamMatches([]);
          setOpponentMatches([]);
          setError(err instanceof Error ? err.message : 'Failed to load team form');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [canFetch, opponentHref, teamHref]);

  const seasonYear = getCurrentSoccerSeasonYear();
  const selectedSummary = useMemo(
    () => (teamName && opponentName ? buildTeamFormSummary(teamName, teamMatches, seasonYear, opponentName) : null),
    [opponentName, seasonYear, teamMatches, teamName]
  );
  const opponentSummary = useMemo(
    () => (opponentName && teamName ? buildTeamFormSummary(opponentName, opponentMatches, seasonYear, teamName) : null),
    [opponentMatches, opponentName, seasonYear, teamName]
  );

  const currentSummary = viewMode === 'opponent' ? opponentSummary : selectedSummary;
  const selectedLabel = selectedSummary?.teamName ?? teamName ?? 'Selected team';
  const opponentLabel = opponentSummary?.teamName ?? opponentName ?? 'Opponent';
  const availableStats = useMemo<FormStatId[]>(() => {
    if (!currentSummary) return [];
    return orderComparableStatKeys(currentSummary.windows.flatMap((window) => window.stats.map((stat) => stat.id)));
  }, [currentSummary]);
  const defaultVisibleStats = useMemo(() => {
    const preferredDefaults = FORM_DEFAULT_VISIBLE_STATS.filter((statId) => availableStats.includes(statId));
    return preferredDefaults.length > 0 ? preferredDefaults : availableStats.slice(0, 4);
  }, [availableStats]);
  const visibleStats = useMemo(() => {
    const validSelectedStats = selectedStats.filter((statId) => availableStats.includes(statId));
    return validSelectedStats.length > 0 ? validSelectedStats : defaultVisibleStats;
  }, [availableStats, defaultVisibleStats, selectedStats]);
  const visibleStatSet = useMemo(() => new Set<FormStatId>(visibleStats), [visibleStats]);
  const statCustomizerOptions = useMemo(
    () => availableStats.map((statId) => ({ key: statId, label: formatStatLabel(statId) })),
    [availableStats]
  );

  useEffect(() => {
    setSelectedStats((current) => current.filter((statId) => availableStats.includes(statId)));
  }, [availableStats]);

  const toggleVisibleStat = (statId: string) => {
    setSelectedStats((current) => {
      const validCurrent = current.filter((key) => availableStats.includes(key));
      const base = validCurrent.length > 0 ? validCurrent : defaultVisibleStats;
      if (base.includes(statId as FormStatId)) {
        return base.length > 1 ? base.filter((key) => key !== statId) : base;
      }
      return [...base, statId as FormStatId];
    });
  };

  if (showSkeleton || loading) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamFormHeader /> : null}
        <div className="flex-1 min-h-0 flex flex-col px-2 pb-1.5">
          <div className="flex items-center justify-center gap-2 mb-1.5">
            <div className={`w-2 h-2 rounded-full ${isDark ? 'bg-cyan-400' : 'bg-cyan-500'} animate-pulse`} />
            <div className={`h-4 w-36 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          </div>
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
        {!hideTitle ? <TeamFormHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamFormHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className="text-sm text-red-600 dark:text-red-400">{error}</div>
        </div>
      </div>
    );
  }

  if (!selectedSummary && !opponentSummary) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamFormHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>No cached season form data found yet.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0 flex flex-col">
      {!hideTitle ? <TeamFormHeader /> : null}
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
              {currentSummary.windows.map((window) => (
                <div
                  key={window.key}
                  className={`flex flex-col rounded-lg border px-2.5 py-2.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-50/80'}`}
                >
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`text-sm font-semibold uppercase tracking-wide ${isDark ? 'text-purple-300' : 'text-purple-600'}`}>
                        {window.label}
                      </div>
                      <div className="ml-auto text-xs font-semibold leading-none tabular-nums">
                        <span className="text-green-500 dark:text-green-400">{window.wins}</span>
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                        <span className="text-slate-500 dark:text-slate-300">{window.draws}</span>
                        <span className="text-gray-400 dark:text-gray-500">-</span>
                        <span className="text-red-500 dark:text-red-400">{window.losses}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    {window.stats.filter((stat) => visibleStatSet.has(stat.id)).map((stat) => {
                      const primary = stat.recentAverage;
                      const secondary = stat.seasonAverage;
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
                              {window.key === 'h2h' ? 'vs last 10 avg' : 'vs season avg'}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            <SoccerStatsCustomizer
              isDark={isDark}
              open={showStatPicker}
              options={statCustomizerOptions}
              selectedKeys={visibleStats}
              onToggleOpen={() => setShowStatPicker((current) => !current)}
              onToggleKey={toggleVisibleStat}
              onSelectAll={() => setSelectedStats(availableStats)}
              onReset={() => setSelectedStats(defaultVisibleStats)}
              resetLabel="Top stats"
            />
          </div>
        )}
      </div>
    </div>
  );
}
