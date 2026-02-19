'use client';

import { useMemo } from 'react';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell } from 'recharts';
import { CHART_CONFIG } from '@/app/nba/research/dashboard/constants';
import type { AflChartTimeframe } from '@/app/afl/components/AflStatsChart';

function toNumericValue(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, '').trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

type BaseRow = { xKey: string; opponent: string; key: string; tickLabel: string; round: string };

function parseRoundIndex(round: unknown): number {
  const text = String(round ?? '').trim().toUpperCase();
  if (!text) return Number.POSITIVE_INFINITY;
  const match = text.match(/(?:ROUND|R)?\s*(\d+)/);
  if (!match) return Number.POSITIVE_INFINITY;
  return parseInt(match[1], 10);
}

/** Apply same timeframe filter as AflStatsChart so bars match the main chart. */
function applyTimeframe<T extends BaseRow>(baseData: T[], timeframe: AflChartTimeframe): T[] {
  if (!baseData.length) return [];
  if (timeframe === 'thisseason' || timeframe === 'lastseason') return baseData;
  if (timeframe === 'h2h') {
    const latestOpponent = baseData[baseData.length - 1]?.opponent;
    if (!latestOpponent) return baseData;
    const h2h = baseData.filter((row) => row.opponent === latestOpponent);
    return (h2h.length ? h2h : baseData) as T[];
  }
  const lastN = parseInt(timeframe.replace('last', ''), 10);
  if (Number.isFinite(lastN) && lastN > 0) return baseData.slice(-lastN) as T[];
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
  mainChartStat?: string;
  supportingStatKind: SupportingStatKind;
  onSupportingStatKindChange: (kind: SupportingStatKind) => void;
  isDark: boolean;
}

export function AflSupportingStats({
  gameLogs,
  timeframe,
  mainChartStat,
  supportingStatKind,
  onSupportingStatKindChange,
  isDark,
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

  const baseData = useMemo(() => {
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
      return {
        key,
        xKey: `G${gameNum}`,
        tickLabel: opponent,
        round,
        opponent,
        value,
        isPercent,
        gameDate: String(g.date ?? g.game_date ?? ''),
      };
    });
  }, [gameLogs, supportingStatKind]);

  const chartData = useMemo(() => {
    const data = applyTimeframe(baseData, timeframe);
    return [...data].sort((a, b) => {
      const aRi = parseRoundIndex(a.round);
      const bRi = parseRoundIndex(b.round);
      if (aRi !== bRi) return aRi - bRi;
      const aDate = new Date((a as { gameDate?: string }).gameDate ?? 0).getTime();
      const bDate = new Date((b as { gameDate?: string }).gameDate ?? 0).getTime();
      if (Number.isFinite(aDate) && Number.isFinite(bDate)) return aDate - bDate;
      return 0;
    });
  }, [baseData, timeframe]);

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
      return { key, xKey: `G${gameNum}`, tickLabel: opponent, round, opponent, tog, tackles, goals, goal_assists, disposals, kicks, handballs, effective_disposals, disposal_efficiency, behinds, inside_50s, marks_inside_50, contested_marks, meters_gained, intercepts, free_kicks_for, contested_possessions, tackles_inside_50, free_kicks_against, one_percenters, clangers };
    });
  }, [gameLogs]);

  const filteredAll = useMemo(
    () => applyTimeframe(baseDataAll, timeframe),
    [baseDataAll, timeframe]
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
  const margin = { top: 24, right: 14, left: 0, bottom: 4 };
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
    if (kind === 'tog' || kind === 'disposal_efficiency') return `${v.toFixed(1)}%`;
    return v.toFixed(1);
  };

  if (chartData.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className="flex flex-wrap gap-2 justify-center">
              {supportingOptions.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => onSupportingStatKindChange(o.value)}
                  className={`min-w-[100px] px-5 py-3 rounded-lg text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
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
            <div
              className={`h-px w-full shrink-0 ${
                isDark ? 'bg-gray-600' : 'bg-gray-300'
              }`}
              aria-hidden
            />
          </div>
        )}
        <div
          className={`min-h-[120px] flex items-center justify-center text-sm ${isDark ? 'text-gray-500' : 'text-gray-400'}`}
        >
          {emptyMessage}
        </div>
      </div>
    );
  }

  const isPercent = chartData[0]?.isPercent ?? supportingStatKind === 'tog';

  return (
    <div className="flex flex-col gap-3">
      {showSupportingToggle && (
        <div className={`sticky top-0 z-10 flex flex-col -mt-1 pt-1 pb-2 ${isDark ? 'bg-[#0a1929]' : 'bg-white'}`}>
          <div className="flex flex-wrap gap-2 justify-center">
            {supportingOptions.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => onSupportingStatKindChange(o.value)}
                className={`min-w-[100px] px-5 py-3 rounded-lg text-base font-semibold transition-colors flex flex-col items-center justify-center gap-0.5 ${
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
          <div
            className={`h-px w-full shrink-0 ${
              isDark ? 'bg-gray-600' : 'bg-gray-300'
            }`}
            aria-hidden
          />
        </div>
      )}
      <div className="w-full h-[380px] min-h-[340px] -mx-1 flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData} margin={margin} barCategoryGap="5%">
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
