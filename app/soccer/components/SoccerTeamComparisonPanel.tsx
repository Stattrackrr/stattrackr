'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { SoccerStatsCustomizer } from '@/app/soccer/components/SoccerStatsCustomizer';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import { SOCCER_BETTABLE_STATS } from '@/app/soccer/components/SoccerStatsChart';

type SoccerTeamComparisonPanelProps = {
  isDark: boolean;
  teamName: string | null;
  matches: SoccerwayRecentMatch[];
  teamCompetitions?: Array<{ country: string; competition: string }>;
  nextCompetitionName?: string | null;
  nextCompetitionCountry?: string | null;
  emptyTextClass: string;
  showSkeleton?: boolean;
  hideTitle?: boolean;
};

type CompareMode = 'competition' | 'season';

type NormalizedRow = {
  matchId: string;
  gameSeason: number;
  competitionKey: string;
  competitionLabel: string;
  statMap: Record<string, number>;
};

type AggregateSummary = {
  count: number;
  averages: Record<string, number>;
  competitionCount: number;
};

type CompetitionOption = {
  key: string;
  label: string;
  count: number;
};

type SeasonSelectionOption = {
  key: string;
  label: string;
  seasons: number[];
};

const COMPARE_STAT_PRIORITY = [
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

function normalizeTeamName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
}

function getSelectedTeamSide(match: SoccerwayRecentMatch, selectedTeamName: string): 'home' | 'away' | null {
  const selected = normalizeTeamName(selectedTeamName);
  if (normalizeTeamName(match.homeTeam) === selected) return 'home';
  if (normalizeTeamName(match.awayTeam) === selected) return 'away';
  return null;
}

function getMatchPeriodStats(match: SoccerwayRecentMatch): SoccerwayMatchStat[] {
  const period = match.stats?.periods.find((item) => item.name.toLowerCase() === 'match');
  if (!period) return [];
  return period.categories.flatMap((category) => category.stats);
}

function parseNumericValue(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = String(raw).replace(/,/g, '').trim();
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const value = Number.parseFloat(match[0]);
  return Number.isFinite(value) ? value : null;
}

function formatStatKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(xg\)/g, ' xg')
    .replace(/\(xgot\)/g, ' xgot')
    .replace(/\(xa\)/g, ' xa')
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

function formatCompareRowLabel(label: string): string {
  if (label === 'Goals' || label === 'Shots' || label === 'SOT' || label === 'xG') return label.toUpperCase();
  return label.toUpperCase();
}

const COMPARE_LEFT_TEXT_CLASS = 'text-blue-600 dark:text-blue-400';
const COMPARE_RIGHT_TEXT_CLASS = 'text-amber-500 dark:text-yellow-300';
const COMPARE_LEFT_FILL = '#2563eb';
const COMPARE_RIGHT_FILL = '#eab308';
const ALL_COMPS_KEY = '__all_comps_combined__';
const ALL_COMPS_LABEL = 'All comps';

function formatAverage(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) >= 10) return value.toFixed(1);
  const formatted = value.toFixed(2);
  return formatted.replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function formatDelta(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const absValue = Math.abs(value);
  const formatted = absValue >= 10 ? absValue.toFixed(1) : absValue.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
  return `${value >= 0 ? '+' : '-'}${formatted}`;
}

function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function formatSeasonLabel(seasonYear: number): string {
  return `${seasonYear}/${String(seasonYear + 1).slice(-2)}`;
}

function formatCompactSeasonLabel(seasonYear: number): string {
  return `${String(seasonYear).slice(-2)}/${String(seasonYear + 1).slice(-2)}`;
}

function formatSeasonCompareSummary(leftLabel: string, rightLabel: string): string {
  return `${leftLabel} vs ${rightLabel}`;
}

function getCompetitionLabel(match: SoccerwayRecentMatch): string {
  const competition = String(match.competitionName || '').trim();
  if (competition) return competition;
  const country = String(match.competitionCountry || '').trim();
  if (country) return country;
  return 'Unknown competition';
}

function getCompetitionKey(match: SoccerwayRecentMatch): string {
  const country = String(match.competitionCountry || '').trim();
  const competition = String(match.competitionName || '').trim();
  return `${country}:::${competition}`;
}

function getCompetitionKeyFromParts(country: string | null | undefined, competition: string | null | undefined): string {
  return `${String(country || '').trim()}:::${String(competition || '').trim()}`;
}

function normalizeCompetitionToken(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDomesticLeagueCompetition(competition: string | null | undefined): boolean {
  const token = normalizeCompetitionToken(competition);
  if (!token) return false;
  return token.includes('premier league')
    || token.includes('league')
    || token.includes('bundesliga')
    || token.includes('serie a')
    || token.includes('la liga')
    || token.includes('ligue 1')
    || token.includes('eredivisie')
    || token.includes('primeira liga')
    || token.includes('super lig')
    || token.includes('championship');
}

function isComparableStat(key: string): boolean {
  return key === 'total_goals' || key === 'expected_goals_xg' || key === 'ball_possession' || SOCCER_BETTABLE_STATS.has(key);
}

function hasTrackedComparisonStats(statMap: Record<string, number>): boolean {
  return Object.entries(statMap).some(
    ([key, value]) => key !== 'total_goals' && isComparableStat(key) && Number.isFinite(value)
  );
}

function buildSeasonSelectionOptions(seasons: number[]): SeasonSelectionOption[] {
  const options: SeasonSelectionOption[] = [];

  for (let count = 1; count <= seasons.length; count += 1) {
    options.push({
      key: `range:${count}`,
      label: count === 1 ? 'This season' : `Last ${count} seasons`,
      seasons: seasons.slice(0, count),
    });
  }

  seasons.forEach((season) => {
    options.push({
      key: `season:${season}`,
      label: `Season ${formatCompactSeasonLabel(season)}`,
      seasons: [season],
    });
  });

  return options;
}

function buildAggregateSummary(rows: NormalizedRow[]): AggregateSummary {
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  const competitions = new Set<string>();

  for (const row of rows) {
    competitions.add(row.competitionKey);
    for (const [key, value] of Object.entries(row.statMap)) {
      if (!Number.isFinite(value)) continue;
      sums[key] = (sums[key] ?? 0) + value;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }

  const averages = Object.fromEntries(
    Object.entries(sums)
      .filter(([key]) => (counts[key] ?? 0) > 0)
      .map(([key, sum]) => [key, sum / (counts[key] ?? 1)])
  );

  return {
    count: rows.length,
    averages,
    competitionCount: competitions.size,
  };
}

function getSelectClassName(isDark: boolean): string {
  return `w-full rounded-lg border px-3 py-2 text-xs font-medium focus:border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-500/30 ${
    isDark
      ? 'border-gray-600 bg-[#0f172a] text-white'
      : 'border-gray-300 bg-white text-gray-900'
  }`;
}

function SeasonSelectionDropdown({
  value,
  onChange,
  rangeOptions,
  singleOptions,
  isDark,
}: {
  value: string;
  onChange: (value: string) => void;
  rangeOptions: SeasonSelectionOption[];
  singleOptions: SeasonSelectionOption[];
  isDark: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'range' | 'single'>(() => (value.startsWith('season:') ? 'single' : 'range'));
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = useMemo(
    () => [...rangeOptions, ...singleOptions].find((option) => option.key === value) ?? null,
    [rangeOptions, singleOptions, value]
  );
  const visibleOptions = tab === 'single' ? singleOptions : rangeOptions;

  useEffect(() => {
    setTab(value.startsWith('season:') ? 'single' : 'range');
  }, [value]);

  useEffect(() => {
    const onDocumentMouseDown = (event: MouseEvent) => {
      const el = containerRef.current;
      if (!el) return;
      if (event.target instanceof Node && !el.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => document.removeEventListener('mousedown', onDocumentMouseDown);
  }, []);

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className={`${getSelectClassName(isDark)} flex items-center justify-between gap-2 text-left`}
      >
        <span className="truncate">{selectedOption?.label ?? 'Select season'}</span>
        <svg className={`h-3 w-3 flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open ? (
        <div
          className={`absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border shadow-lg ${
            isDark ? 'border-gray-600 bg-[#0f172a]' : 'border-gray-200 bg-white'
          }`}
        >
          <div className={`m-1 inline-flex w-[calc(100%-8px)] items-center rounded-xl border p-1 ${isDark ? 'border-gray-700 bg-[#111827]' : 'border-gray-200 bg-gray-100'}`}>
            <button
              type="button"
              onClick={() => setTab('range')}
              className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                tab === 'range'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              Range
            </button>
            <button
              type="button"
              onClick={() => setTab('single')}
              className={`flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                tab === 'single'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : isDark
                    ? 'text-gray-300 hover:bg-gray-800'
                    : 'text-gray-600 hover:bg-white'
              }`}
            >
              Single
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto py-1 custom-scrollbar">
            {visibleOptions.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => {
                  onChange(option.key);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2 text-left text-xs font-medium transition-colors ${
                  value === option.key
                    ? 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                    : isDark
                      ? 'text-white hover:bg-gray-800'
                      : 'text-gray-900 hover:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TeamComparisonHeader() {
  return (
    <div className="relative mt-1 mb-2 flex flex-shrink-0 items-center justify-center">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Team Compare</h3>
    </div>
  );
}

export function SoccerTeamComparisonPanel({
  isDark,
  teamName,
  matches,
  teamCompetitions = [],
  nextCompetitionName = null,
  nextCompetitionCountry = null,
  emptyTextClass,
  showSkeleton = false,
  hideTitle = false,
}: SoccerTeamComparisonPanelProps) {
  const [mode, setMode] = useState<CompareMode>('competition');
  const [selectedStats, setSelectedStats] = useState<string[]>([]);
  const [showStatPicker, setShowStatPicker] = useState(false);
  const [selectedCompetitionSeason, setSelectedCompetitionSeason] = useState('');
  const [leftCompetition, setLeftCompetition] = useState('');
  const [rightCompetition, setRightCompetition] = useState('');
  const [leftSeason, setLeftSeason] = useState('');
  const [rightSeason, setRightSeason] = useState('');

  const normalizedRows = useMemo(() => {
    const selected = String(teamName || '').trim();
    if (!selected) return [];

    return matches
      .map((match) => {
        const side = getSelectedTeamSide(match, selected);
        if (!side) return null;

        const statMap: Record<string, number> = {};
        for (const stat of getMatchPeriodStats(match)) {
          const key = formatStatKey(stat.name);
          const rawValue = side === 'away' ? stat.awayValue : stat.homeValue;
          const parsedValue = parseNumericValue(rawValue);
          if (parsedValue == null) continue;
          statMap[key] = parsedValue;
        }

        statMap.total_goals = side === 'away' ? match.awayScore : match.homeScore;

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;

        return {
          matchId: match.matchId,
          gameSeason: getSoccerSeasonYear(kickoff),
          competitionKey: getCompetitionKey(match),
          competitionLabel: getCompetitionLabel(match),
          statMap,
        } satisfies NormalizedRow;
      })
      .filter((row): row is NormalizedRow => row != null)
      .sort((a, b) => a.gameSeason - b.gameSeason || a.matchId.localeCompare(b.matchId));
  }, [matches, teamName]);

  const seasonOptions = useMemo(() => {
    const seasonsWithTrackedStats = [
      ...new Set(
        normalizedRows
          .filter((row) => hasTrackedComparisonStats(row.statMap))
          .map((row) => row.gameSeason)
          .filter((year) => year >= 2008)
      ),
    ].sort((a, b) => b - a);

    if (seasonsWithTrackedStats.length > 0) return seasonsWithTrackedStats;

    return [...new Set(normalizedRows.map((row) => row.gameSeason).filter((year) => year >= 2008))].sort((a, b) => b - a);
  }, [normalizedRows]);

  const latestSeason = seasonOptions[0] ?? null;
  const seasonSelectionOptions = useMemo(() => buildSeasonSelectionOptions(seasonOptions), [seasonOptions]);
  const seasonSelectionOptionsByKey = useMemo(
    () => new Map(seasonSelectionOptions.map((option) => [option.key, option])),
    [seasonSelectionOptions]
  );
  const seasonRangeOptions = useMemo(
    () => seasonSelectionOptions.filter((option) => option.key.startsWith('range:')),
    [seasonSelectionOptions]
  );
  const singleSeasonOptions = useMemo(
    () => seasonSelectionOptions.filter((option) => option.key.startsWith('season:')),
    [seasonSelectionOptions]
  );

  const competitionOptions = useMemo(() => {
    if (!selectedCompetitionSeason) return [] as CompetitionOption[];
    const selectedSeasonOption = seasonSelectionOptionsByKey.get(selectedCompetitionSeason);
    if (!selectedSeasonOption) return [] as CompetitionOption[];
    const counts = new Map<string, CompetitionOption>();

    for (const row of normalizedRows) {
      if (!selectedSeasonOption.seasons.includes(row.gameSeason)) continue;
      const existing = counts.get(row.competitionKey);
      if (existing) existing.count += 1;
      else {
        counts.set(row.competitionKey, {
          key: row.competitionKey,
          label: row.competitionLabel,
          count: 1,
        });
      }
    }

    const options = Array.from(counts.values()).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
    if (options.length > 0) {
      return [{ key: ALL_COMPS_KEY, label: ALL_COMPS_LABEL, count: selectedSeasonOption.seasons.length }, ...options];
    }
    return options;
  }, [normalizedRows, seasonSelectionOptionsByKey, selectedCompetitionSeason]);

  const defaultCompetitionKey = useMemo(() => {
    const selectedSeasonOption = seasonSelectionOptionsByKey.get(selectedCompetitionSeason);
    const rowsForSeason = selectedSeasonOption
      ? normalizedRows.filter((row) => selectedSeasonOption.seasons.includes(row.gameSeason))
      : normalizedRows;
    const counts = new Map<string, { count: number; label: string }>();

    for (const row of rowsForSeason) {
      const existing = counts.get(row.competitionKey);
      if (existing) existing.count += 1;
      else counts.set(row.competitionKey, { count: 1, label: row.competitionLabel });
    }

    const sorted = Array.from(counts.entries()).sort((a, b) => {
      const aLeague = isDomesticLeagueCompetition(a[1].label);
      const bLeague = isDomesticLeagueCompetition(b[1].label);
      if (aLeague !== bLeague) return aLeague ? -1 : 1;
      return b[1].count - a[1].count || a[1].label.localeCompare(b[1].label);
    });

    if (sorted[0]?.[0]) return sorted[0][0];

    const fallbackTeamCompetition = teamCompetitions.find((entry) => isDomesticLeagueCompetition(entry.competition)) ?? teamCompetitions[0] ?? null;
    return fallbackTeamCompetition
      ? getCompetitionKeyFromParts(fallbackTeamCompetition.country, fallbackTeamCompetition.competition)
      : '';
  }, [normalizedRows, selectedCompetitionSeason, seasonSelectionOptionsByKey, teamCompetitions]);

  const nextCompetitionKey = useMemo(
    () => getCompetitionKeyFromParts(nextCompetitionCountry, nextCompetitionName),
    [nextCompetitionCountry, nextCompetitionName]
  );

  const leftRows = useMemo(() => {
    if (mode === 'competition') {
      const selectedSeasonOption = seasonSelectionOptionsByKey.get(selectedCompetitionSeason);
      if (!selectedSeasonOption) return [];
      return normalizedRows.filter(
        (row) =>
          selectedSeasonOption.seasons.includes(row.gameSeason)
          && (leftCompetition === ALL_COMPS_KEY || row.competitionKey === leftCompetition)
      );
    }
    const selectedOption = seasonSelectionOptionsByKey.get(leftSeason);
    if (!selectedOption) return [];
    return normalizedRows.filter((row) => selectedOption.seasons.includes(row.gameSeason));
  }, [leftCompetition, leftSeason, mode, normalizedRows, seasonSelectionOptionsByKey, selectedCompetitionSeason]);

  const rightRows = useMemo(() => {
    if (mode === 'competition') {
      const selectedSeasonOption = seasonSelectionOptionsByKey.get(selectedCompetitionSeason);
      if (!selectedSeasonOption) return [];
      return normalizedRows.filter(
        (row) =>
          selectedSeasonOption.seasons.includes(row.gameSeason)
          && (rightCompetition === ALL_COMPS_KEY || row.competitionKey === rightCompetition)
      );
    }
    const selectedOption = seasonSelectionOptionsByKey.get(rightSeason);
    if (!selectedOption) return [];
    return normalizedRows.filter((row) => selectedOption.seasons.includes(row.gameSeason));
  }, [mode, normalizedRows, rightCompetition, rightSeason, seasonSelectionOptionsByKey, selectedCompetitionSeason]);

  const leftSummary = useMemo(() => buildAggregateSummary(leftRows), [leftRows]);
  const rightSummary = useMemo(() => buildAggregateSummary(rightRows), [rightRows]);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const key of Object.keys(leftSummary.averages)) {
      if (Number.isFinite(leftSummary.averages[key]) && isComparableStat(key)) keys.add(key);
    }
    for (const key of Object.keys(rightSummary.averages)) {
      if (Number.isFinite(rightSummary.averages[key]) && isComparableStat(key)) keys.add(key);
    }

    const ordered: string[] = [];
    for (const key of COMPARE_STAT_PRIORITY) {
      if (keys.has(key)) ordered.push(key);
    }
    for (const key of keys) {
      if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
  }, [leftSummary.averages, rightSummary.averages]);

  const defaultVisibleStats = useMemo(() => availableStats.slice(0, 8), [availableStats]);
  const visibleStats = useMemo(() => {
    const validSelectedStats = selectedStats.filter((statKey) => availableStats.includes(statKey));
    if (validSelectedStats.length > 0) return validSelectedStats;
    return defaultVisibleStats;
  }, [availableStats, defaultVisibleStats, selectedStats]);
  const statCustomizerOptions = useMemo(
    () => availableStats.map((statKey) => ({ key: statKey, label: formatStatLabel(statKey) })),
    [availableStats]
  );

  const leftTitle =
    mode === 'competition'
      ? competitionOptions.find((option) => option.key === leftCompetition)?.label ?? 'Competition'
      : seasonSelectionOptionsByKey.get(leftSeason)?.label ?? 'Season';
  const rightTitle =
    mode === 'competition'
      ? competitionOptions.find((option) => option.key === rightCompetition)?.label ?? 'Competition'
      : seasonSelectionOptionsByKey.get(rightSeason)?.label ?? 'Season';
  const leftCompetitionOptions = useMemo(
    () => competitionOptions.filter((option) => option.key === leftCompetition || option.key !== rightCompetition),
    [competitionOptions, leftCompetition, rightCompetition]
  );
  const rightCompetitionOptions = useMemo(
    () => competitionOptions.filter((option) => option.key === rightCompetition || option.key !== leftCompetition),
    [competitionOptions, leftCompetition, rightCompetition]
  );

  useEffect(() => {
    if (!latestSeason) {
      setSelectedCompetitionSeason('');
      return;
    }
    const defaultCompetitionSeasonKey =
      seasonRangeOptions[0]?.key ?? seasonSelectionOptions[0]?.key ?? '';
    if (seasonSelectionOptions.some((option) => option.key === selectedCompetitionSeason)) return;
    setSelectedCompetitionSeason(defaultCompetitionSeasonKey);
  }, [latestSeason, seasonRangeOptions, seasonSelectionOptions, selectedCompetitionSeason]);

  useEffect(() => {
    if (!seasonSelectionOptions.length) {
      setLeftSeason('');
      return;
    }
    const first = seasonRangeOptions[0]?.key ?? seasonSelectionOptions[0]?.key ?? '';
    if (!seasonSelectionOptions.some((option) => option.key === leftSeason)) {
      setLeftSeason(first);
    }
  }, [leftSeason, seasonRangeOptions, seasonSelectionOptions]);

  useEffect(() => {
    if (!seasonSelectionOptions.length) {
      setRightSeason('');
      return;
    }
    const preferred =
      seasonSelectionOptions.find((option) => option.key !== leftSeason)?.key
      ?? seasonRangeOptions[0]?.key
      ?? seasonSelectionOptions[0]?.key
      ?? '';
    if (!seasonSelectionOptions.some((option) => option.key === rightSeason) || rightSeason === leftSeason) {
      setRightSeason(preferred);
    }
  }, [leftSeason, rightSeason, seasonRangeOptions, seasonSelectionOptions]);

  useEffect(() => {
    if (!competitionOptions.length) {
      setLeftCompetition('');
      setRightCompetition('');
      return;
    }
    const preferredLeft =
      competitionOptions.find((option) => option.key === defaultCompetitionKey)?.key
      ?? competitionOptions.find((option) => option.key !== ALL_COMPS_KEY)?.key
      ?? competitionOptions[0]?.key
      ?? '';
    const preferredRight =
      nextCompetitionKey && nextCompetitionKey !== preferredLeft && competitionOptions.some((option) => option.key === nextCompetitionKey)
        ? nextCompetitionKey
        : competitionOptions.find((option) => option.key === ALL_COMPS_KEY)?.key
          ?? competitionOptions.find((option) => option.key !== preferredLeft)?.key
          ?? preferredLeft;

    const leftIsValid = competitionOptions.some((option) => option.key === leftCompetition);
    const rightIsValid = competitionOptions.some((option) => option.key === rightCompetition);

    if (!leftIsValid) setLeftCompetition(preferredLeft);
    if (!rightIsValid || rightCompetition === leftCompetition) setRightCompetition(preferredRight);
  }, [competitionOptions, defaultCompetitionKey, leftCompetition, nextCompetitionKey, rightCompetition]);

  useEffect(() => {
    if (!availableStats.length) {
      setSelectedStats([]);
      return;
    }
    setSelectedStats((current) => current.filter((statKey) => availableStats.includes(statKey)));
  }, [availableStats]);

  const toggleVisibleStat = (statKey: string) => {
    setSelectedStats((current) => {
      const validCurrent = current.filter((key) => availableStats.includes(key));
      const base = validCurrent.length > 0 ? validCurrent : defaultVisibleStats;
      if (base.includes(statKey)) {
        return base.length > 1 ? base.filter((key) => key !== statKey) : base;
      }
      return [...base, statKey];
    });
  };

  if (showSkeleton) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamComparisonHeader /> : null}
        <div className="flex-1 min-h-0 flex flex-col px-2 pb-1.5">
          <div className={`mb-1.5 h-9 rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          <div className="grid grid-cols-1 gap-1 lg:grid-cols-2">
            {[0, 1].map((idx) => (
              <div key={idx} className={`min-h-[12rem] rounded-xl animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!teamName?.trim()) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamComparisonHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>Select a team above to compare splits.</div>
        </div>
      </div>
    );
  }

  if (!normalizedRows.length) {
    return (
      <div className="w-full min-w-0 h-full flex flex-col">
        {!hideTitle ? <TeamComparisonHeader /> : null}
        <div className="flex-1 min-h-0 flex items-center px-2 pb-1.5">
          <div className={`text-sm ${emptyTextClass}`}>No data available come back later</div>
        </div>
      </div>
    );
  }

  const competitionCompareReady = competitionOptions.length >= 2 && leftRows.length > 0 && rightRows.length > 0;
  const seasonCompareReady = seasonOptions.length >= 2 && leftRows.length > 0 && rightRows.length > 0;
  const compareReady = mode === 'competition' ? competitionCompareReady : seasonCompareReady;

  return (
    <div className="w-full min-w-0 flex flex-col">
      {!hideTitle ? <TeamComparisonHeader /> : null}
      <div className="flex flex-col px-2 pb-1.5">
        <div className="mb-1">
          <div className={`inline-flex w-full items-center rounded-xl border p-0.5 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
            {([
              { key: 'competition', label: 'Competition' },
              { key: 'season', label: 'Season' },
            ] as const).map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setMode(option.key)}
                className={`min-w-0 flex-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition-colors ${
                  mode === option.key
                    ? option.key === 'competition'
                      ? 'bg-green-600 text-white shadow-sm'
                      : 'bg-red-600 text-white shadow-sm'
                    : isDark
                      ? 'text-gray-300 hover:bg-gray-800'
                      : 'text-gray-600 hover:bg-white'
                }`}
              >
                <span className="block truncate">{option.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mb-1 grid grid-cols-1 gap-1 lg:grid-cols-2">
          {mode === 'competition' ? (
            <>
              <div className="grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-3 lg:col-span-2">
                <select value={leftCompetition} onChange={(event) => setLeftCompetition(event.target.value)} className={getSelectClassName(isDark)}>
                  {leftCompetitionOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <SeasonSelectionDropdown
                  value={selectedCompetitionSeason}
                  onChange={setSelectedCompetitionSeason}
                  rangeOptions={seasonRangeOptions}
                  singleOptions={singleSeasonOptions}
                  isDark={isDark}
                />
                <select value={rightCompetition} onChange={(event) => setRightCompetition(event.target.value)} className={getSelectClassName(isDark)}>
                  {rightCompetitionOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : (
            <>
              <SeasonSelectionDropdown
                value={leftSeason}
                onChange={setLeftSeason}
                rangeOptions={seasonRangeOptions}
                singleOptions={singleSeasonOptions}
                isDark={isDark}
              />
              <SeasonSelectionDropdown
                value={rightSeason}
                onChange={setRightSeason}
                rangeOptions={seasonRangeOptions}
                singleOptions={singleSeasonOptions}
                isDark={isDark}
              />
            </>
          )}
        </div>

        {!compareReady ? (
          <div className={`text-sm py-4 ${emptyTextClass}`}>
            {mode === 'competition'
              ? 'Need at least two competitions in the selected season to compare.'
              : 'Need at least two seasons of cached matches to compare.'}
          </div>
        ) : (
          <div className="overflow-x-hidden pr-0.5">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className={`inline-flex w-full items-center rounded-xl border p-1 ${isDark ? 'border-gray-700 bg-[#0f172a]' : 'border-gray-200 bg-gray-100'}`}>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg bg-blue-600 px-2 py-1.5 text-[11px] font-semibold text-white shadow-sm transition-colors"
                  >
                    <span className="block truncate">{leftTitle}</span>
                  </button>
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg bg-yellow-400 px-2 py-1.5 text-[11px] font-semibold text-gray-900 shadow-sm transition-colors dark:text-gray-950"
                  >
                    <span className="block truncate">{rightTitle}</span>
                  </button>
                </div>
                <div className={`mt-1 text-center text-[10px] font-medium uppercase tracking-wide ${isDark ? 'text-white' : 'text-gray-500'}`}>
                  {mode === 'competition' ? `${leftTitle} vs ${rightTitle}` : formatSeasonCompareSummary(leftTitle, rightTitle)}
                </div>
              </div>
            </div>

            {visibleStats.length === 0 ? (
              <div className={`text-sm py-4 ${emptyTextClass}`}>No comparable stats found for these selections.</div>
            ) : (
              <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-1 custom-scrollbar">
                {visibleStats.map((statKey) => {
                  const leftValue = leftSummary.averages[statKey] ?? null;
                  const rightValue = rightSummary.averages[statKey] ?? null;
                  const leftStrength = Math.max(leftValue ?? 0, 0.05);
                  const rightStrength = Math.max(rightValue ?? 0, 0.05);
                  const totalStrength = leftStrength + rightStrength;
                  const leftShare = totalStrength > 0 ? (leftStrength / totalStrength) * 100 : 50;
                  const rightShare = 100 - leftShare;

                  return (
                    <div key={statKey} className="flex flex-col items-center justify-center px-1 py-0.5">
                      <div className="mb-0.5 text-[11px] font-semibold uppercase tracking-wide text-purple-600 dark:text-purple-300">
                        {formatCompareRowLabel(formatStatLabel(statKey))}
                      </div>
                      <div className="w-full px-0.5">
                        <div className="mb-0.5 flex items-center justify-between text-[11px] font-medium leading-none">
                          <span className={COMPARE_LEFT_TEXT_CLASS}>{formatAverage(leftValue)}</span>
                          <span className={COMPARE_RIGHT_TEXT_CLASS}>{formatAverage(rightValue)}</span>
                        </div>
                        <div className="relative h-2 overflow-hidden rounded-full bg-gray-200/70 dark:bg-gray-700/60">
                          <div
                            className="absolute inset-y-0 left-0"
                            style={{ width: `${leftShare}%`, backgroundColor: COMPARE_LEFT_FILL }}
                          />
                          <div
                            className="absolute inset-y-0 right-0"
                            style={{ width: `${rightShare}%`, backgroundColor: COMPARE_RIGHT_FILL }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
                <div className="pt-0.5 text-center text-[10px] font-medium text-gray-500 dark:text-gray-400">
                  {`${leftSummary.count} games ${leftTitle} · ${rightSummary.count} games ${rightTitle}`}
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
        )}
      </div>
    </div>
  );
}
