'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';
import { CHART_CONFIG } from '@/app/nba/research/dashboard/constants';
import type { AflChartTimeframe } from '@/app/afl/components/AflStatsChart';
import { opponentToOfficialTeamName, rosterTeamToInjuryTeam } from '@/lib/aflTeamMapping';

function toNumericValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type BaseRow = { xKey: string; opponent: string; key: string; tickLabel: string; round: string; gameSeason?: number };

function parseRoundIndex(round: unknown): number {
  const text = String(round ?? '').trim().toUpperCase();
  if (!text) return Number.POSITIVE_INFINITY;
  const match = text.match(/(?:ROUND|R)?\s*(\d+)/);
  if (match) return parseInt(match[1], 10);

  // Finals ordering after regular rounds so "last X" includes recent finals.
  if (/\b(GF|GRAND\s*FINAL)\b/.test(text)) return 29;
  if (/\b(PF|PRELIM)\b/.test(text)) return 28;
  if (/\b(SF|SEMI)\b/.test(text)) return 27;
  if (/\b(QF|QUAL)\b/.test(text)) return 26;
  if (/\b(EF|ELIM)\b/.test(text)) return 25;

  return Number.POSITIVE_INFINITY;
}

/** Apply same timeframe filter as AflStatsChart so bars match the main chart. */
function applyTimeframe<T extends BaseRow>(
  baseData: T[],
  timeframe: AflChartTimeframe,
  season?: number,
  nextOpponent?: string | null
): T[] {
  if (!baseData.length) return [];
  if (timeframe === 'season2026') {
    return baseData.filter((row) => row.gameSeason === 2026) as T[];
  }
  if (timeframe === 'season2025') {
    return baseData.filter((row) => row.gameSeason === 2025) as T[];
  }
  if (timeframe === 'season2024') {
    return baseData.filter((row) => row.gameSeason === 2024) as T[];
  }
  if (timeframe === 'h2h') {
    // Match AflStatsChart: prefer upcoming opponent when provided; otherwise fallback to latest game's opponent.
    const targetOpponent = nextOpponent?.trim() || baseData[baseData.length - 1]?.opponent;
    if (!targetOpponent) return baseData;
    const resolveOpp = (opp: string | undefined) =>
      opp ? (opponentToOfficialTeamName(opp) || rosterTeamToInjuryTeam(opp) || opp.trim()) : '';
    const targetOfficial = resolveOpp(targetOpponent);
    const h2h = baseData.filter((row) => {
      const rowOpp = row.opponent;
      if (!rowOpp || typeof rowOpp !== 'string') return false;
      return resolveOpp(rowOpp) === targetOfficial || rowOpp.trim() === targetOpponent;
    });
    return (h2h.length ? h2h : baseData) as T[];
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) {
    // baseData is already oldest → newest; take last N = N most recent, still oldest→newest (newest on right)
    return baseData.slice(-lastN) as T[];
  }
  return baseData;
}

export type SupportingStatKind =
  | 'tog'
  | 'tackles'
  | 'goals'
  | 'goal_assists'
  | 'disposals'
  | 'kicks'
  | 'handballs'
  | 'effective_disposals'
  | 'disposal_efficiency'
  | 'behinds'
  | 'inside_50s'
  | 'marks_inside_50'
  | 'contested_marks'
  | 'meters_gained'
  | 'intercepts'
  | 'free_kicks_for'
  | 'contested_possessions'
  | 'tackles_inside_50'
  | 'free_kicks_against'
  | 'one_percenters'
  | 'clangers';

const DISPOSALS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'kicks', label: 'Kicks' },
  { value: 'handballs', label: 'Handballs' },
  { value: 'meters_gained', label: 'Meters gained' },
  { value: 'intercepts', label: 'Intercepts' },
  { value: 'free_kicks_for', label: 'Free kicks for' },
  { value: 'contested_possessions', label: 'Contested possessions' },
];

const GOALS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'behinds', label: 'Behinds' },
  { value: 'inside_50s', label: 'Inside 50s' },
  { value: 'marks_inside_50', label: 'Marks inside 50' },
];

const MARKS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'marks_inside_50', label: 'Marks inside 50' },
  { value: 'contested_marks', label: 'Contested marks' },
];

const TACKLES_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'tackles_inside_50', label: 'Tackles inside 50' },
  { value: 'free_kicks_against', label: 'Free kicks against' },
  { value: 'one_percenters', label: 'One percenters' },
  { value: 'clangers', label: 'Clangers' },
];

const KICKS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'disposals', label: 'Disposals' },
  { value: 'handballs', label: 'Handballs' },
  { value: 'meters_gained', label: 'Meters gained' },
  { value: 'intercepts', label: 'Intercepts' },
  { value: 'free_kicks_for', label: 'Free kicks for' },
  { value: 'contested_possessions', label: 'Contested possessions' },
];

const HANDBALLS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'disposals', label: 'Disposals' },
  { value: 'kicks', label: 'Kicks' },
  { value: 'meters_gained', label: 'Meters gained' },
  { value: 'intercepts', label: 'Intercepts' },
  { value: 'free_kicks_for', label: 'Free kicks for' },
  { value: 'contested_possessions', label: 'Contested possessions' },
];

const BEHINDS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'goals', label: 'Goals' },
  { value: 'marks_inside_50', label: 'Marks inside 50' },
];

const TACKLES_INSIDE_50_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'tackles', label: 'Tackles' },
  { value: 'inside_50s', label: 'Inside 50s' },
];

const SCORE_INVOLVEMENTS_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
  { value: 'goal_assists', label: 'Goals assisted' },
  { value: 'meters_gained', label: 'Meters gained' },
];

/** For main chart stats that don't have their own supporting options yet, show TOG only. */
const DEFAULT_TOGGLE_OPTIONS: { value: SupportingStatKind; label: string }[] = [
  { value: 'tog', label: 'TOG %' },
];

interface AflSupportingStatsProps {
  gameLogs: Array<Record<string, unknown>>;
  timeframe: AflChartTimeframe;
  season?: number;
  nextOpponent?: string | null;
  mainChartStat?: string;
  supportingStatKind: SupportingStatKind;
  onSupportingStatKindChange: (kind: SupportingStatKind) => void;
  isDark: boolean;
  alignRightTight?: boolean;
}

export function AflSupportingStats({
  gameLogs,
  timeframe,
  season = 2026,
  nextOpponent = null,
  mainChartStat,
  supportingStatKind,
  onSupportingStatKindChange,
  isDark,
  alignRightTight = false,
}: AflSupportingStatsProps) {
  const showDisposalsToggle = mainChartStat === 'disposals';
  const showGoalsToggle = mainChartStat === 'goals';
  const showMarksToggle = mainChartStat === 'marks';
  const showTacklesToggle = mainChartStat === 'tackles';
  const showKicksToggle = mainChartStat === 'kicks';
  const showHandballsToggle = mainChartStat === 'handballs';
  const showBehindsToggle = mainChartStat === 'behinds';
  const showTacklesInside50Toggle = mainChartStat === 'tackles_inside_50';
  const showScoreInvolvementsToggle = mainChartStat === 'score_involvements';
  const supportingOptions =
    showScoreInvolvementsToggle
      ? SCORE_INVOLVEMENTS_TOGGLE_OPTIONS
      : showTacklesInside50Toggle
      ? TACKLES_INSIDE_50_TOGGLE_OPTIONS
      : showBehindsToggle
      ? BEHINDS_TOGGLE_OPTIONS
      : showHandballsToggle
      ? HANDBALLS_TOGGLE_OPTIONS
      : showKicksToggle
      ? KICKS_TOGGLE_OPTIONS
      : showTacklesToggle
      ? TACKLES_TOGGLE_OPTIONS
      : showMarksToggle
      ? MARKS_TOGGLE_OPTIONS
      : showGoalsToggle
      ? GOALS_TOGGLE_OPTIONS
      : showDisposalsToggle
        ? DISPOSALS_TOGGLE_OPTIONS
        : DEFAULT_TOGGLE_OPTIONS;
  const showSupportingToggle = true;
  const toggleRailPaddingClass = alignRightTight ? 'pl-3 pr-4 sm:pl-4 sm:pr-6' : 'px-3 sm:px-4';

  // All games (2025 + 2026) sorted oldest → newest (newest on the right)
  const baseData = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;
      const aRound = parseRoundIndex(a.round);
      const bRound = parseRoundIndex(b.round);
      if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) return aRound - bRound;
      const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
      const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      return 0;
    });
    return sorted.map((g, idx) => {
      const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
      const round = String(g.round ?? '-');
      const opponent = String(g.opponent ?? '-');
      const key = `${gameNum}-${round}-${opponent}-${idx}`;
      const percentPlayed = Math.max(0, Math.min(100, toNumericValue(g.percent_played) ?? 0));
      const kicks = Math.max(0, toNumericValue(g.kicks) ?? 0);
      const handballs = Math.max(0, toNumericValue(g.handballs) ?? 0);
      const tackles = Math.max(0, toNumericValue(g.tackles) ?? 0);
      const goalAssists = Math.max(0, toNumericValue(g.goal_assists) ?? 0);
      const disposals = Math.max(0, toNumericValue(g.disposals) ?? 0);
      const effectiveDisposals = Math.max(0, toNumericValue(g.effective_disposals) ?? 0);
      const disposalEfficiency = Math.max(0, Math.min(100, toNumericValue(g.disposal_efficiency) ?? 0));
      const behinds = Math.max(0, toNumericValue(g.behinds) ?? 0);
      const goals = Math.max(0, toNumericValue(g.goals) ?? 0);
      const inside50s = Math.max(0, toNumericValue(g.inside_50s) ?? 0);
      const marksInside50 = Math.max(0, toNumericValue(g.marks_inside_50) ?? 0);
      const contestedMarks = Math.max(0, toNumericValue(g.contested_marks) ?? 0);
      const metersGained = Math.max(0, toNumericValue(g.meters_gained) ?? 0);
      const intercepts = Math.max(0, toNumericValue(g.intercepts) ?? 0);
      const freeKicksFor = Math.max(0, toNumericValue(g.free_kicks_for) ?? 0);
      const contestedPossessions = Math.max(0, toNumericValue(g.contested_possessions) ?? 0);
      const tacklesInside50 = Math.max(0, toNumericValue(g.tackles_inside_50) ?? 0);
      const freeKicksAgainst = Math.max(0, toNumericValue(g.free_kicks_against) ?? 0);
      const onePercenters = Math.max(0, toNumericValue(g.one_percenters) ?? 0);
      const clangers = Math.max(0, toNumericValue(g.clangers) ?? 0);
      const useTog = supportingStatKind === 'tog';
      const value =
        useTog
          ? percentPlayed
          : supportingStatKind === 'tackles'
            ? tackles
          : supportingStatKind === 'goal_assists'
            ? goalAssists
          : supportingStatKind === 'disposals'
            ? disposals
          : supportingStatKind === 'kicks'
            ? kicks
            : supportingStatKind === 'handballs'
              ? handballs
              : supportingStatKind === 'meters_gained'
                ? metersGained
                : supportingStatKind === 'intercepts'
                  ? intercepts
                  : supportingStatKind === 'free_kicks_for'
                    ? freeKicksFor
                    : supportingStatKind === 'contested_possessions'
                      ? contestedPossessions
              : supportingStatKind === 'effective_disposals'
                ? effectiveDisposals
                : supportingStatKind === 'disposal_efficiency'
                  ? disposalEfficiency
                  : supportingStatKind === 'goals'
                    ? goals
                  : supportingStatKind === 'behinds'
                    ? behinds
                    : supportingStatKind === 'inside_50s'
                      ? inside50s
                      : supportingStatKind === 'contested_marks'
                        ? contestedMarks
                        : supportingStatKind === 'tackles_inside_50'
                          ? tacklesInside50
                          : supportingStatKind === 'free_kicks_against'
                            ? freeKicksAgainst
                            : supportingStatKind === 'one_percenters'
                              ? onePercenters
                              : supportingStatKind === 'clangers'
                                ? clangers
                        : marksInside50;
      const isPercent = useTog || supportingStatKind === 'disposal_efficiency';
      const gameSeason =
        typeof (g as Record<string, unknown>).season === 'number'
          ? ((g as Record<string, unknown>).season as number)
          : (() => {
              const dateStr = String(g.date ?? g.game_date ?? '');
              const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
              return Number.isFinite(year) ? year : season;
            })();
      return {
        key,
        xKey: key,
        tickLabel: opponent,
        round,
        opponent,
        value,
        isPercent,
        gameDate: String(g.date ?? g.game_date ?? ''),
        gameSeason,
      };
    });
  }, [gameLogs, supportingStatKind, season]);

  const chartData = useMemo(() => {
    const data = applyTimeframe(baseData, timeframe, season, nextOpponent) as (BaseRow & { value: number; isPercent: boolean; gameDate: string })[];
    // Ensure unique keys per bar so Recharts doesn't merge (e.g. same game_number across seasons)
    return data.map((row, idx) => ({ ...row, key: `supporting-${idx}`, xKey: `supporting-${idx}` }));
  }, [baseData, timeframe, season, nextOpponent]);

  const baseDataAll = useMemo(() => {
    if (!Array.isArray(gameLogs) || gameLogs.length === 0) return [];
    const sorted = [...gameLogs].sort((a, b) => {
      const aRound = parseRoundIndex(a.round);
      const bRound = parseRoundIndex(b.round);
      if (Number.isFinite(aRound) && Number.isFinite(bRound) && aRound !== bRound) return aRound - bRound;

      const aDate = new Date(String(a.date ?? a.game_date ?? '')).getTime();
      const bDate = new Date(String(b.date ?? b.game_date ?? '')).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate) && aDate !== bDate) return aDate - bDate;

      const aNum = typeof a.game_number === 'number' ? a.game_number : Number(a.game_number ?? 0);
      const bNum = typeof b.game_number === 'number' ? b.game_number : Number(b.game_number ?? 0);
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) return aNum - bNum;
      return 0;
    });
    return sorted.map((g, idx) => {
      const gameNum = typeof g.game_number === 'number' ? g.game_number : idx + 1;
      const round = String(g.round ?? '-');
      const opponent = String(g.opponent ?? '-');
      const key = `${gameNum}-${round}-${opponent}-${idx}`;
      const tog = Math.max(0, Math.min(100, toNumericValue(g.percent_played) ?? 0));
      const disposals = Math.max(0, toNumericValue(g.disposals) ?? 0);
      const kicks = Math.max(0, toNumericValue(g.kicks) ?? 0);
      const handballs = Math.max(0, toNumericValue(g.handballs) ?? 0);
      const tackles = Math.max(0, toNumericValue(g.tackles) ?? 0);
      const goal_assists = Math.max(0, toNumericValue(g.goal_assists) ?? 0);
      const effective_disposals = Math.max(0, toNumericValue(g.effective_disposals) ?? 0);
      const disposal_efficiency = Math.max(0, Math.min(100, toNumericValue(g.disposal_efficiency) ?? 0));
      const behinds = Math.max(0, toNumericValue(g.behinds) ?? 0);
      const goals = Math.max(0, toNumericValue(g.goals) ?? 0);
      const inside_50s = Math.max(0, toNumericValue(g.inside_50s) ?? 0);
      const marks_inside_50 = Math.max(0, toNumericValue(g.marks_inside_50) ?? 0);
      const contested_marks = Math.max(0, toNumericValue(g.contested_marks) ?? 0);
      const meters_gained = Math.max(0, toNumericValue(g.meters_gained) ?? 0);
      const intercepts = Math.max(0, toNumericValue(g.intercepts) ?? 0);
      const free_kicks_for = Math.max(0, toNumericValue(g.free_kicks_for) ?? 0);
      const contested_possessions = Math.max(0, toNumericValue(g.contested_possessions) ?? 0);
      const tackles_inside_50 = Math.max(0, toNumericValue(g.tackles_inside_50) ?? 0);
      const free_kicks_against = Math.max(0, toNumericValue(g.free_kicks_against) ?? 0);
      const one_percenters = Math.max(0, toNumericValue(g.one_percenters) ?? 0);
      const clangers = Math.max(0, toNumericValue(g.clangers) ?? 0);
      const gameSeason =
        typeof (g as Record<string, unknown>).season === 'number'
          ? ((g as Record<string, unknown>).season as number)
          : (() => {
              const dateStr = String((g as Record<string, unknown>).date ?? (g as Record<string, unknown>).game_date ?? '');
              const year = dateStr ? parseInt(dateStr.slice(0, 4), 10) : NaN;
              return Number.isFinite(year) ? year : season;
            })();
      return { key, xKey: `G${gameNum}`, tickLabel: opponent, round, opponent, gameSeason, tog, tackles, goals, goal_assists, disposals, kicks, handballs, effective_disposals, disposal_efficiency, behinds, inside_50s, marks_inside_50, contested_marks, meters_gained, intercepts, free_kicks_for, contested_possessions, tackles_inside_50, free_kicks_against, one_percenters, clangers };
    });
  }, [gameLogs, season]);

  const filteredAll = useMemo(
    () => applyTimeframe(baseDataAll, timeframe, season, nextOpponent),
    [baseDataAll, timeframe, season, nextOpponent]
  );

  const averagesByStat = useMemo(() => {
    if (!filteredAll.length)
      return {
        tog: null,
        tackles: null,
        goals: null,
        goal_assists: null,
        disposals: null,
        kicks: null,
        handballs: null,
        effective_disposals: null,
        disposal_efficiency: null,
        behinds: null,
        inside_50s: null,
        marks_inside_50: null,
        contested_marks: null,
        meters_gained: null,
        intercepts: null,
        free_kicks_for: null,
        contested_possessions: null,
        tackles_inside_50: null,
        free_kicks_against: null,
        one_percenters: null,
        clangers: null,
      };
    const n = filteredAll.length;
    const tog = filteredAll.reduce((s, r) => s + r.tog, 0) / n;
    const tackles = filteredAll.reduce((s, r) => s + r.tackles, 0) / n;
    const goals = filteredAll.reduce((s, r) => s + r.goals, 0) / n;
    const goal_assists = filteredAll.reduce((s, r) => s + r.goal_assists, 0) / n;
    const disposals = filteredAll.reduce((s, r) => s + r.disposals, 0) / n;
    const kicks = filteredAll.reduce((s, r) => s + r.kicks, 0) / n;
    const handballs = filteredAll.reduce((s, r) => s + r.handballs, 0) / n;
    const effective_disposals = filteredAll.reduce((s, r) => s + r.effective_disposals, 0) / n;
    const disposal_efficiency = filteredAll.reduce((s, r) => s + r.disposal_efficiency, 0) / n;
    const behinds = filteredAll.reduce((s, r) => s + r.behinds, 0) / n;
    const inside_50s = filteredAll.reduce((s, r) => s + r.inside_50s, 0) / n;
    const marks_inside_50 = filteredAll.reduce((s, r) => s + r.marks_inside_50, 0) / n;
    const contested_marks = filteredAll.reduce((s, r) => s + r.contested_marks, 0) / n;
    const meters_gained = filteredAll.reduce((s, r) => s + r.meters_gained, 0) / n;
    const intercepts = filteredAll.reduce((s, r) => s + r.intercepts, 0) / n;
    const free_kicks_for = filteredAll.reduce((s, r) => s + r.free_kicks_for, 0) / n;
    const contested_possessions = filteredAll.reduce((s, r) => s + r.contested_possessions, 0) / n;
    const tackles_inside_50 = filteredAll.reduce((s, r) => s + r.tackles_inside_50, 0) / n;
    const free_kicks_against = filteredAll.reduce((s, r) => s + r.free_kicks_against, 0) / n;
    const one_percenters = filteredAll.reduce((s, r) => s + r.one_percenters, 0) / n;
    const clangers = filteredAll.reduce((s, r) => s + r.clangers, 0) / n;
    return { tog, tackles, goals, goal_assists, disposals, kicks, handballs, effective_disposals, disposal_efficiency, behinds, inside_50s, marks_inside_50, contested_marks, meters_gained, intercepts, free_kicks_for, contested_possessions, tackles_inside_50, free_kicks_against, one_percenters, clangers };
  }, [filteredAll]);

  const average = useMemo(() => {
    if (!chartData.length) return null;
    const sum = chartData.reduce((s, row) => s + row.value, 0);
    const avg = sum / chartData.length;
    const isPct = chartData[0]?.isPercent ?? supportingStatKind === 'tog';
    return { value: avg, isPercent: isPct };
  }, [chartData, supportingStatKind]);

  const barFill = isDark ? '#6b7280' : '#9ca3af';
  const margin = { top: 24, right: 0, left: 0, bottom: 4 };
  const labelFill = isDark ? '#e5e7eb' : '#374151';
  const xAxisHeight = 8;
  const emptyTick = useMemo(
    () => ({ x, y }: { x: number; y: number }) => <g transform={`translate(${x},${y})`} />,
    []
  );

  const formatLabel = (value: number, isPercent: boolean) =>
    isPercent ? `${Math.round(value)}%` : String(Math.round(value));

  const emptyMessage =
    supportingStatKind === 'tog'
      ? 'No % on ground data'
      : supportingStatKind === 'disposal_efficiency'
        ? 'No disposal efficiency data'
      : supportingStatKind === 'tackles'
        ? 'No tackles data'
      : supportingStatKind === 'goal_assists'
        ? 'No goals assisted data'
      : supportingStatKind === 'disposals'
        ? 'No disposals data'
      : supportingStatKind === 'goals'
        ? 'No goals data'
        : supportingStatKind === 'effective_disposals'
          ? 'No effective disposals data'
          : supportingStatKind === 'meters_gained'
            ? 'No meters gained data'
            : supportingStatKind === 'intercepts'
              ? 'No intercepts data'
              : supportingStatKind === 'free_kicks_for'
                ? 'No free kicks for data'
                : supportingStatKind === 'contested_possessions'
                  ? 'No contested possessions data'
          : supportingStatKind === 'behinds'
            ? 'No behinds data'
            : supportingStatKind === 'inside_50s'
              ? 'No inside 50s data'
              : supportingStatKind === 'marks_inside_50'
                ? 'No marks inside 50 data'
              : supportingStatKind === 'contested_marks'
                ? 'No contested marks data'
                : supportingStatKind === 'tackles_inside_50'
                  ? 'No tackles inside 50 data'
                  : supportingStatKind === 'free_kicks_against'
                    ? 'No free kicks against data'
                    : supportingStatKind === 'one_percenters'
                      ? 'No one percenters data'
                      : supportingStatKind === 'clangers'
                        ? 'No clangers data'
                : `No ${supportingStatKind} data`;

  /** Stats that often come only from advanced/supplementary source; show "No data" when all zeros but other stats exist. */
  const advancedSourceStatKinds: SupportingStatKind[] = [
    'tog',
    'meters_gained',
    'intercepts',
    'contested_possessions',
    'contested_marks',
    'marks_inside_50',
    'one_percenters',
    'tackles_inside_50',
    'effective_disposals',
    'disposal_efficiency',
  ];

  const formatAvg = (kind: SupportingStatKind) => {
    const v =
      kind === 'tog'
        ? averagesByStat.tog
        : kind === 'tackles'
          ? averagesByStat.tackles
        : kind === 'goal_assists'
          ? averagesByStat.goal_assists
        : kind === 'goals'
          ? averagesByStat.goals
        : kind === 'disposals'
          ? averagesByStat.disposals
        : kind === 'kicks'
          ? averagesByStat.kicks
          : kind === 'handballs'
            ? averagesByStat.handballs
            : kind === 'meters_gained'
              ? averagesByStat.meters_gained
              : kind === 'intercepts'
                ? averagesByStat.intercepts
                : kind === 'free_kicks_for'
                  ? averagesByStat.free_kicks_for
                  : kind === 'contested_possessions'
                    ? averagesByStat.contested_possessions
            : kind === 'effective_disposals'
              ? averagesByStat.effective_disposals
              : kind === 'disposal_efficiency'
                ? averagesByStat.disposal_efficiency
                : kind === 'behinds'
                  ? averagesByStat.behinds
                  : kind === 'inside_50s'
                    ? averagesByStat.inside_50s
                    : kind === 'marks_inside_50'
                      ? averagesByStat.marks_inside_50
                      : kind === 'contested_marks'
                        ? averagesByStat.contested_marks
                        : kind === 'tackles_inside_50'
                          ? averagesByStat.tackles_inside_50
                          : kind === 'free_kicks_against'
                            ? averagesByStat.free_kicks_against
                            : kind === 'one_percenters'
                              ? averagesByStat.one_percenters
                              : averagesByStat.clangers;
    if (v == null || !Number.isFinite(v)) return '—';
    const hasCoreStats =
      (averagesByStat.kicks != null && averagesByStat.kicks > 0) ||
      (averagesByStat.handballs != null && averagesByStat.handballs > 0) ||
      (averagesByStat.disposals != null && averagesByStat.disposals > 0);
    const isAllZerosForKind =
      kind === 'tog'
        ? filteredAll.every((r) => r.tog === 0)
        : kind === 'meters_gained'
          ? filteredAll.every((r) => r.meters_gained === 0)
          : kind === 'intercepts'
            ? filteredAll.every((r) => r.intercepts === 0)
            : kind === 'contested_possessions'
              ? filteredAll.every((r) => r.contested_possessions === 0)
              : kind === 'contested_marks'
                ? filteredAll.every((r) => r.contested_marks === 0)
                : kind === 'marks_inside_50'
                  ? filteredAll.every((r) => r.marks_inside_50 === 0)
                  : kind === 'one_percenters'
                    ? filteredAll.every((r) => r.one_percenters === 0)
                    : kind === 'tackles_inside_50'
                      ? filteredAll.every((r) => r.tackles_inside_50 === 0)
                      : kind === 'effective_disposals'
                        ? filteredAll.every((r) => r.effective_disposals === 0)
                        : kind === 'disposal_efficiency'
                          ? filteredAll.every((r) => r.disposal_efficiency === 0)
                          : false;
    if (
      hasCoreStats &&
      advancedSourceStatKinds.includes(kind) &&
      v === 0 &&
      isAllZerosForKind
    ) {
      return 'No data';
    }
    if (kind === 'tog' || kind === 'disposal_efficiency') return `${v.toFixed(1)}%`;
    return v.toFixed(1);
  };

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3 min-w-0">
        {showSupportingToggle && (
          <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
            <div className={`w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar ${toggleRailPaddingClass}`} style={{ scrollbarWidth: 'thin' }}>
              <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
                {supportingOptions.map((o) => (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => onSupportingStatKindChange(o.value)}
                    className={`flex-shrink-0 min-w-[80px] sm:min-w-[100px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                      supportingStatKind === o.value
                        ? isDark
                          ? 'bg-gray-600 text-gray-100'
                          : 'bg-gray-500 text-white'
                        : isDark
                          ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                          : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
                    <span>{o.label}</span>
                    <span className="text-xs font-normal opacity-90">{formatAvg(o.value)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className={`h-px w-full shrink-0 ${isDark ? 'bg-gray-600' : 'bg-gray-300'}`} aria-hidden />
          </div>
        )}
        <div className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
          {emptyMessage}
        </div>
      </div>
    );
  }

  const isPercent = chartData[0]?.isPercent ?? supportingStatKind === 'tog';

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 min-w-0 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className={`w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar ${toggleRailPaddingClass}`} style={{ scrollbarWidth: 'thin' }}>
            <div className="flex flex-nowrap gap-2 justify-start min-w-min pb-1">
              {supportingOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSupportingStatKindChange(o.value)}
                  className={`flex-shrink-0 min-w-[80px] sm:min-w-[100px] px-3 sm:px-5 py-2.5 sm:py-3 rounded-lg text-sm sm:text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
                    supportingStatKind === o.value
                      ? isDark
                        ? 'bg-gray-600 text-gray-100'
                        : 'bg-gray-500 text-white'
                      : isDark
                        ? 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                        : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                  }`}
                >
                  <span>{o.label}</span>
                  <span className="text-xs font-normal opacity-90">{formatAvg(o.value)}</span>
                </button>
              ))}
            </div>
          </div>
          <div
            className={`h-px w-full shrink-0 ${
              isDark ? 'bg-gray-600' : 'bg-gray-300'
            }`}
            aria-hidden
          />
        </div>
      )}
      <div className={`w-full h-[380px] min-h-[340px] flex-shrink-0 min-w-0 pointer-events-none select-none ${alignRightTight ? 'lg:pr-6 xl:pr-7' : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart key={timeframe} data={chartData} margin={margin} barCategoryGap="5%">
            <XAxis
              dataKey="xKey"
              axisLine={{ stroke: isDark ? '#6b7280' : '#9ca3af', strokeWidth: 2 }}
              tickLine={false}
              tick={emptyTick}
              tickFormatter={() => ''}
              height={xAxisHeight}
              interval={0}
            />
            <Bar
              dataKey="value"
              radius={CHART_CONFIG.bar.radius}
              isAnimationActive={false}
              label={(props) => {
                const { x, y, width, value } = props;
                const payload = (props as { payload?: { isPercent?: boolean } }).payload;
                const labelX = Number(x ?? 0) + Number(width ?? 0) / 2;
                const labelY = Number(y ?? 0) - 6;
                const numericValue = Number(value);
                return (
                  <text
                    x={labelX}
                    y={labelY}
                    textAnchor="middle"
                    fill={labelFill}
                    fontSize={12}
                    fontWeight={500}
                  >
                    {Number.isFinite(numericValue)
                      ? formatLabel(numericValue, payload?.isPercent ?? isPercent)
                      : ''}
                  </text>
                );
              }}
            >
              {chartData.map((_, index) => (
                <Cell key={`cell-${index}`} fill={barFill} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
