'use client';

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import SimpleChart from '@/app/nba/research/dashboard/components/charts/SimpleChart';
import StatPill from '@/app/nba/research/dashboard/components/ui/StatPill';
import type { SoccerwayMatchStat, SoccerwayRecentMatch } from '@/lib/soccerwayTeamResults';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { DEFAULT_ODDS_FORMAT } from '@/lib/currencyUtils';

export type SoccerTimeframe = 'last5' | 'last10' | 'last20' | 'last50' | 'h2h' | 'all' | `season:${number}`;
type SoccerVenueFilter = 'all' | 'HOME' | 'AWAY';
type SoccerMatchVenue = Exclude<SoccerVenueFilter, 'all'>;
export type SoccerStatTeamScope = 'all' | 'team' | 'opp';
type SoccerResultLabel = 'W' | 'D' | 'L';
const SOCCER_CHART_TEAM_SCOPE_STORAGE_KEY = 'soccer-chart-team-scope';

type SoccerChartRow = {
  key: string;
  xKey: string;
  tickLabel: string;
  tickDateLabel: string;
  opponent: string;
  opponentLogoUrl: string | null;
  result: string;
  venue: SoccerMatchVenue;
  value: number | null;
  comparisonValue: string | null;
  gameDate: string;
  scoreline: string;
  sourceMatch: SoccerwayRecentMatch;
  gameSeason: number;
  moneylineLabel?: string;
};

type SoccerStatsChartProps = {
  matches: SoccerwayRecentMatch[];
  selectedTeamName: string;
  nextOpponentName?: string | null;
  selectedTeamHref?: string | null;
  nextFixtureMatchId?: string | null;
  oddsFormat?: 'american' | 'decimal';
  isDark: boolean;
  onSelectedStatChange?: (stat: string) => void;
  onSelectedTimeframeChange?: (timeframe: SoccerTimeframe) => void;
  onSelectedTeamScopeChange?: (scope: SoccerStatTeamScope) => void;
  onSelectedCompetitionChange?: (competition: string) => void;
};

type SoccerOddsOutcome = {
  participant: string | null;
  side: 'home' | 'away' | null;
  selection: string | null;
  value: string | null;
  handicap: string | null;
  active: boolean;
};

type SoccerOddsOffer = {
  bookmakerId: number | string | null;
  bookmakerName: string | null;
  odds: SoccerOddsOutcome[];
};

type SoccerOddsMarket = {
  key: string;
  bettingType: string | null;
  bettingScope: string | null;
  offers: SoccerOddsOffer[];
};

type SoccerOddsPayload = {
  success?: boolean;
  error?: string;
  groupedMarkets?: SoccerOddsMarket[];
};

type SoccerOddsBookRow = {
  name: string;
  moneyline: {
    home: string | null;
    draw: string | null;
    away: string | null;
  };
  doubleChance: {
    winDraw: string | null;
    winLoss: string | null;
    drawLoss: string | null;
  };
  totalGoals: Array<{
    line: string;
    over: string | null;
    under: string | null;
  }>;
};

export const SOCCER_STAT_PRIORITY = [
  'moneyline',
  'total_goals',
  'expected_goals_xg',
  'xg_on_target_xgot',
  'ball_possession',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'passes',
  'accurate_passes',
  'long_passes',
  'passes_in_final_third',
  'crosses',
  'expected_assists_xa',
  'fouls',
  'offsides',
  'free_kicks',
  'throw_ins',
  'touches_in_opposition_box',
  'accurate_through_passes',
  'tackles',
  'duels_won',
  'clearances',
  'interceptions',
  'errors_leading_to_shot',
  'errors_leading_to_goal',
  'goalkeeper_saves',
  'xgot_faced',
  'goals_prevented',
  'shots_inside_the_box',
  'shots_outside_the_box',
  'hit_the_woodwork',
];

export const SOCCER_TOP_STAT_PRIORITY = [
  'moneyline',
  'total_goals',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'fouls',
  'free_kicks',
  'touches_in_opposition_box',
  'tackles',
  'goalkeeper_saves',
  'shots_inside_the_box',
  'shots_outside_the_box',
] as const;

export const SOCCER_BETTABLE_STATS = new Set([
  'moneyline',
  'total_goals',
  'total_shots',
  'shots_on_target',
  'shots_off_target',
  'blocked_shots',
  'big_chances',
  'corner_kicks',
  'yellow_cards',
  'red_cards',
  'fouls',
  'free_kicks',
  'touches_in_opposition_box',
  'tackles',
  'goalkeeper_saves',
  'shots_inside_the_box',
  'shots_outside_the_box',
]);

function normalizeTeamName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*\([^)]+\)\s*$/g, '')
    .replace(/\s+/g, ' ');
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
  return left === right || (left.includes(right) && right.length >= 5) || (right.includes(left) && left.length >= 5);
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

function formatStatLabel(label: string): string {
  if (label === 'moneyline') return 'H2H';
  if (label === 'total_goals') return 'Total goals';
  if (label === 'expected_goals_xg') return 'xG';
  if (label === 'xg_on_target_xgot') return 'xGOT';
  if (label === 'expected_assists_xa') return 'xA';
  return label
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
    .trim();
}

function roundToSoccerHalfStep(value: number): number {
  return Math.round(value * 2) / 2;
}

function clampSoccerLineValue(value: number, minValue = 0): number {
  const rounded = roundToSoccerHalfStep(value);
  return Math.max(minValue, rounded);
}

function formatSoccerAxisValue(value: number): string {
  return `${Math.round(value)}`;
}

function getSoccerMoneylineLineLabel(value: number): 'W' | 'D' | 'L' {
  if (value <= -0.5) return 'L';
  if (value >= 0.5) return 'W';
  return 'D';
}

function isSoccerTeamScope(value: string | null | undefined): value is SoccerStatTeamScope {
  return value === 'all' || value === 'team' || value === 'opp';
}

function readStoredSoccerTeamScope(): SoccerStatTeamScope | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(SOCCER_CHART_TEAM_SCOPE_STORAGE_KEY);
    return isSoccerTeamScope(stored) ? stored : null;
  } catch {
    return null;
  }
}

function writeStoredSoccerTeamScope(scope: SoccerStatTeamScope): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SOCCER_CHART_TEAM_SCOPE_STORAGE_KEY, scope);
  } catch {
    /* ignore */
  }
}

function getDoubleChanceKey(results: SoccerResultLabel[]): keyof SoccerOddsBookRow['doubleChance'] {
  const selected = new Set(results);
  if (selected.has('W') && selected.has('L')) return 'winLoss';
  if (selected.has('D') && selected.has('L')) return 'drawLoss';
  return 'winDraw';
}

function getDoubleChanceLabel(results: SoccerResultLabel[]): string {
  const key = getDoubleChanceKey(results);
  if (key === 'winLoss') return 'W/L';
  if (key === 'drawLoss') return 'D/L';
  return 'W/D';
}

function getDoubleChanceValue(book: SoccerOddsBookRow | undefined, results: SoccerResultLabel[]): string | null {
  return book?.doubleChance[getDoubleChanceKey(results)] ?? null;
}

function getMoneylineValue(book: SoccerOddsBookRow | undefined, result: SoccerResultLabel): string | null {
  if (!book) return null;
  if (result === 'W') return book.moneyline.home;
  if (result === 'D') return book.moneyline.draw;
  return book.moneyline.away;
}

function getSoccerResultButtonClass(result: SoccerResultLabel, selected: boolean, doubleChanceMode: boolean): string {
  if (!selected) return 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800';
  if (!doubleChanceMode) return 'bg-purple-600 text-white';
  if (result === 'W') return 'bg-green-600 text-white';
  if (result === 'D') return 'bg-slate-600 text-white';
  return 'bg-red-600 text-white';
}

function parseSoccerOddsNumber(value: string | null | undefined): number | null {
  if (!value) return null;
  const cleaned = String(value).replace(/,/g, '').trim();
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function decimalToAmerican(decimal: number): number | null {
  if (!Number.isFinite(decimal) || decimal <= 1) return null;
  if (decimal >= 2) return Math.round((decimal - 1) * 100);
  return Math.round(-100 / (decimal - 1));
}

function formatSoccerOddsValue(value: string | null | undefined, format: 'american' | 'decimal'): string {
  const decimal = parseSoccerOddsNumber(value);
  if (decimal == null) return 'N/A';
  if (format === 'decimal') return decimal.toFixed(2);
  const american = decimalToAmerican(decimal);
  if (american == null) return 'N/A';
  return american > 0 ? `+${american}` : String(american);
}

function normalizeSoccerMarketText(value: string | null | undefined): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractSoccerLine(outcome: SoccerOddsOutcome): string | null {
  const raw = outcome.handicap ?? outcome.selection ?? '';
  const match = String(raw).match(/-?\d+(?:\.\d+)?/);
  return match ? match[0] : null;
}

function isSoccerOverOutcome(outcome: SoccerOddsOutcome): boolean {
  const text = normalizeSoccerMarketText(`${outcome.selection || ''} ${outcome.participant || ''}`);
  return /\bover\b/.test(text);
}

function isSoccerUnderOutcome(outcome: SoccerOddsOutcome): boolean {
  const text = normalizeSoccerMarketText(`${outcome.selection || ''} ${outcome.participant || ''}`);
  return /\bunder\b/.test(text);
}

function soccerLineToNumber(value: string | null | undefined): number | null {
  if (!value || value === 'N/A') return null;
  const n = Number.parseFloat(String(value).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function isSameSoccerLine(left: string | null | undefined, right: number | null | undefined): boolean {
  const n = soccerLineToNumber(left);
  return n != null && right != null && Number.isFinite(right) && Math.abs(n - right) < 0.01;
}

function isHalfGoalLine(value: string | null | undefined): boolean {
  const n = soccerLineToNumber(value);
  if (n == null || n < 0) return false;
  return Math.abs(n - (Math.floor(n) + 0.5)) < 0.01;
}

function getPreferredSoccerTotalLine(lines: Array<{ line: string; over: string | null; under: string | null }>): number | null {
  if (!lines.length) return null;
  const parsed = lines
    .map((item) => soccerLineToNumber(item.line))
    .filter((value): value is number => value != null);
  if (!parsed.length) return null;
  const mainLine = parsed.find((value) => Math.abs(value - 2.5) < 0.01);
  if (mainLine != null) return mainLine;
  return parsed.reduce((best, value) => (Math.abs(value - 2.5) < Math.abs(best - 2.5) ? value : best), parsed[0]);
}

function buildPositiveIntegerAxis(maxValue: number): { domain: [number, number]; ticks: number[] } {
  const safeMax = Math.max(1, Math.ceil(maxValue));
  let bestOption: { bound: number; intervals: number; padding: number } | null = null;

  for (const intervals of [4, 3, 2]) {
    const bound = Math.max(intervals, Math.ceil(safeMax / intervals) * intervals);
    const padding = bound - safeMax;
    if (
      !bestOption ||
      padding < bestOption.padding ||
      (padding === bestOption.padding && intervals > bestOption.intervals)
    ) {
      bestOption = { bound, intervals, padding };
    }
  }

  const selected = bestOption ?? { bound: 2, intervals: 2, padding: 0 };
  const step = selected.bound / selected.intervals;
  return {
    domain: [0, selected.bound],
    ticks: Array.from({ length: selected.intervals + 1 }, (_, index) => index * step),
  };
}

function buildSymmetricIntegerAxis(maxAbsValue: number): { domain: [number, number]; ticks: number[] } {
  const safeMax = Math.max(1, Math.ceil(maxAbsValue));
  let bestOption: { bound: number; halfIntervals: number; padding: number } | null = null;

  for (const halfIntervals of [2, 1]) {
    const step = Math.max(1, Math.ceil(safeMax / halfIntervals));
    const bound = step * halfIntervals;
    const padding = bound - safeMax;
    if (
      !bestOption ||
      padding < bestOption.padding ||
      (padding === bestOption.padding && halfIntervals > bestOption.halfIntervals)
    ) {
      bestOption = { bound, halfIntervals, padding };
    }
  }

  const selected = bestOption ?? { bound: 1, halfIntervals: 1, padding: 0 };
  const step = selected.bound / selected.halfIntervals;
  const ticks: number[] = [];
  for (let value = -selected.bound; value <= selected.bound; value += step) {
    ticks.push(value);
  }

  return {
    domain: [-selected.bound, selected.bound],
    ticks,
  };
}

function buildSoccerOddsBooks(markets: SoccerOddsMarket[] | null | undefined): SoccerOddsBookRow[] {
  const rows = new Map<string, SoccerOddsBookRow>();

  const getRow = (offer: SoccerOddsOffer) => {
    const rawName = (offer.bookmakerName || '').trim() || 'Unknown';
    const name = getBookmakerInfo(rawName).name;
    const key = name.toLowerCase();
    const row = rows.get(key) ?? {
      name,
      moneyline: { home: null, draw: null, away: null },
      doubleChance: { winDraw: null, winLoss: null, drawLoss: null },
      totalGoals: [],
    };
    rows.set(key, row);
    return row;
  };

  for (const market of markets ?? []) {
    const bettingType = String(market.bettingType || '').trim().toUpperCase();
    const bettingScope = String(market.bettingScope || '').trim().toUpperCase();
    const marketKey = String(market.key || '').trim().toUpperCase();
    const isMoneylineMarket =
      marketKey === 'HOME_DRAW_AWAY__FULL_TIME' ||
      (bettingType === 'HOME_DRAW_AWAY' && (!bettingScope || bettingScope === 'FULL_TIME'));
    const isDoubleChanceMarket =
      marketKey === 'DOUBLE_CHANCE__FULL_TIME' ||
      (bettingType === 'DOUBLE_CHANCE' && (!bettingScope || bettingScope === 'FULL_TIME'));
    const isTotalGoalsMarket =
      marketKey === 'OVER_UNDER__FULL_TIME' ||
      (bettingType === 'OVER_UNDER' && (!bettingScope || bettingScope === 'FULL_TIME'));

    if (!isMoneylineMarket && !isDoubleChanceMarket && !isTotalGoalsMarket) continue;

    for (const offer of market.offers ?? []) {
      const row = getRow(offer);

      if (isMoneylineMarket) {
        for (const outcome of offer.odds ?? []) {
          if (!outcome.active || !outcome.value) continue;
          const selection = normalizeSoccerMarketText(`${outcome.selection || ''} ${outcome.participant || ''}`);
          if (outcome.side === 'home' || selection === '1' || selection.includes('home')) row.moneyline.home = outcome.value;
          else if (outcome.side === 'away' || selection === '2' || selection.includes('away')) row.moneyline.away = outcome.value;
          else if (selection === 'x' || selection.includes('draw')) row.moneyline.draw = outcome.value;
        }
      }

      if (isDoubleChanceMarket) {
        for (const outcome of offer.odds ?? []) {
          if (!outcome.active || !outcome.value) continue;
          if (outcome.side === 'home') row.doubleChance.winDraw = outcome.value;
          else if (outcome.side === 'away') row.doubleChance.drawLoss = outcome.value;
          else row.doubleChance.winLoss = outcome.value;
        }
      }

      if (isTotalGoalsMarket) {
        const byLine = new Map<string, { line: string; over: string | null; under: string | null }>();
        for (const outcome of offer.odds ?? []) {
          if (!outcome.active || !outcome.value) continue;
          const line = extractSoccerLine(outcome);
          if (!line) continue;
          if (!isHalfGoalLine(line)) continue;
          const item = byLine.get(line) ?? { line, over: null, under: null };
          if (isSoccerOverOutcome(outcome)) item.over = outcome.value;
          if (isSoccerUnderOutcome(outcome)) item.under = outcome.value;
          byLine.set(line, item);
        }
        for (const item of byLine.values()) {
          if (!item.over && !item.under) continue;
          const existing = row.totalGoals.find((line) => isSameSoccerLine(line.line, soccerLineToNumber(item.line)));
          if (existing) {
            existing.over ??= item.over;
            existing.under ??= item.under;
          } else {
            row.totalGoals.push(item);
          }
        }
      }
    }
  }

  return Array.from(rows.values())
    .map((row) => ({
      ...row,
      totalGoals: row.totalGoals.sort((a, b) => (soccerLineToNumber(a.line) ?? 0) - (soccerLineToNumber(b.line) ?? 0)),
    }))
    .filter((row) =>
      row.moneyline.home ||
      row.moneyline.draw ||
      row.moneyline.away ||
      row.doubleChance.winDraw ||
      row.doubleChance.winLoss ||
      row.doubleChance.drawLoss ||
      row.totalGoals.length > 0
    );
}

function SoccerBookmakerIcon({ info, className = 'w-6 h-6' }: { info: ReturnType<typeof getBookmakerInfo>; className?: string }) {
  return (
    <span className="relative inline-flex flex-shrink-0 items-center justify-center">
      {info.logoUrl ? (
        <img
          src={info.logoUrl}
          alt={info.name}
          className={`${className} rounded object-contain flex-shrink-0`}
          onError={(event) => {
            (event.target as HTMLImageElement).style.display = 'none';
            const fallback = (event.target as HTMLImageElement).nextElementSibling as HTMLElement;
            if (fallback) fallback.style.display = 'flex';
          }}
        />
      ) : null}
      <span
        className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${info.logoUrl ? 'hidden' : 'flex'}`}
        style={{ backgroundColor: info.color }}
      >
        {info.logo}
      </span>
    </span>
  );
}

function SoccerOddsPill({
  label,
  value,
  className,
  textClassName = 'text-[10px]',
}: {
  label: string;
  value: string | null | undefined;
  className: string;
  textClassName?: string;
}) {
  if (!value || value === 'N/A') return null;
  return (
    <span className={`px-1.5 py-0.5 rounded ${textClassName} font-mono whitespace-nowrap ${className}`}>
      {label} {value}
    </span>
  );
}

function SoccerOddsLineSelector({
  books,
  selectedStat,
  selectedBookIndex,
  onSelectBookIndex,
  onSelectLineValue,
  currentLineValue,
  doubleChanceMode = false,
  selectedDoubleChance = ['W', 'D'],
  noOddsAvailable = false,
  oddsFormat,
  isDark,
  disabled = false,
}: {
  books: SoccerOddsBookRow[];
  selectedStat: string;
  selectedBookIndex: number;
  onSelectBookIndex: (index: number) => void;
  onSelectLineValue: (line: number) => void;
  currentLineValue: number;
  doubleChanceMode?: boolean;
  selectedDoubleChance?: SoccerResultLabel[];
  noOddsAvailable?: boolean;
  oddsFormat: 'american' | 'decimal';
  isDark: boolean;
  disabled?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const selectedBook = books[selectedBookIndex];
  const isMoneyline = selectedStat === 'moneyline';
  const selectedMoneylineResult = getSoccerMoneylineLineLabel(currentLineValue);
  const selectedMoneylineValue = getMoneylineValue(selectedBook, selectedMoneylineResult);
  const doubleChanceLabel = getDoubleChanceLabel(selectedDoubleChance);
  const selectedDoubleChanceValue = getDoubleChanceValue(selectedBook, selectedDoubleChance);
  const bookmakerInfo = selectedBook ? getBookmakerInfo(selectedBook.name) : null;
  const totalItems = noOddsAvailable
    ? []
    : books
      .flatMap((book, bookIndex) => book.totalGoals.map((line) => ({ book, bookIndex, line })))
      .sort((a, b) => (soccerLineToNumber(a.line.line) ?? 0) - (soccerLineToNumber(b.line.line) ?? 0));
  const selectedTotal = !isMoneyline && selectedBook
    ? selectedBook.totalGoals.find((item) => isSameSoccerLine(item.line, currentLineValue))
    : null;
  const hasSelectedTotalLine = isMoneyline ? false : totalItems.some((item) => isSameSoccerLine(item.line.line, currentLineValue));
  const showNoLineState = noOddsAvailable || (!isMoneyline && !hasSelectedTotalLine);
  const hasOdds = showNoLineState ? false : isMoneyline
    ? doubleChanceMode
      ? Boolean(selectedDoubleChanceValue)
      : Boolean(selectedMoneylineValue)
    : Boolean(totalItems.length > 0);
  const showSkeleton = !disabled && !showNoLineState && (!selectedBook || !hasOdds);

  return (
    <div className="relative flex-shrink-0 w-[116px] sm:w-[128px]" ref={ref}>
      <button
        type="button"
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        disabled={disabled}
        className="w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] sm:h-[36px] overflow-hidden disabled:opacity-60"
      >
        <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
          {showSkeleton ? (
            <div className={`h-4 w-20 rounded animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          ) : showNoLineState ? (
            <div className={`h-4 w-16 rounded flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
          ) : bookmakerInfo && selectedBook && hasOdds ? (
            <>
              <SoccerBookmakerIcon info={bookmakerInfo} className="w-6 h-6" />
              <div className={`flex flex-col gap-0.5 min-w-0 ${isMoneyline ? 'flex-1 items-center text-center' : 'items-start'}`}>
                {isMoneyline ? (
                  <>
                    <span className={`${isMoneyline ? 'text-[11px] sm:text-xs' : 'text-[10px] sm:text-[11px]'} font-semibold text-gray-900 dark:text-white whitespace-nowrap truncate max-w-full`}>
                      {doubleChanceMode
                        ? `${doubleChanceLabel} ${formatSoccerOddsValue(selectedDoubleChanceValue, oddsFormat)}`
                        : `${selectedMoneylineResult} ${formatSoccerOddsValue(selectedMoneylineValue, oddsFormat)}`}
                    </span>
                  </>
                ) : selectedTotal ? (
                  <>
                    <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                      O {formatSoccerOddsValue(selectedTotal.over, oddsFormat)}
                    </span>
                    <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                      U {formatSoccerOddsValue(selectedTotal.under, oddsFormat)}
                    </span>
                  </>
                ) : null}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-start gap-0.5 min-w-0">
              <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium">Odds</span>
            </div>
          )}
        </div>
        <svg className="w-3 h-3 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && !disabled ? (
        <div className={`absolute top-full left-0 mt-1 ${isMoneyline ? 'w-48' : 'w-56'} bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-[80] max-h-80 overflow-y-auto`}>
          <div className={isMoneyline ? 'p-1.5' : 'p-2'}>
          {showNoLineState && !totalItems.length ? (
            <>
              <div className="px-3 py-3 border-b border-gray-200 dark:border-gray-600">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
              </div>
              <div className="px-3 py-8 text-center text-xs text-gray-500 dark:text-gray-400">No alternative lines available</div>
            </>
          ) : isMoneyline ? (
            books.map((book, index) => {
              const info = getBookmakerInfo(book.name);
              const isSelected = index === selectedBookIndex;
              const moneylineValue = getMoneylineValue(book, selectedMoneylineResult);
              const doubleChanceValue = getDoubleChanceValue(book, selectedDoubleChance);
              return (
                <button
                  key={`${book.name}-${index}`}
                  type="button"
                  onClick={() => {
                    onSelectBookIndex(index);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-2 py-1.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between gap-1.5 transition-colors border ${
                    isSelected
                      ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0">
                    <SoccerBookmakerIcon info={info} className="w-6 h-6" />
                    <span className="text-xs font-semibold text-gray-900 dark:text-white">
                      {doubleChanceMode ? doubleChanceLabel : 'H2H'}
                    </span>
                  </div>
                  <div className="flex min-w-0 items-center justify-end gap-1.5">
                    {doubleChanceMode ? (
                      <SoccerOddsPill
                        label={doubleChanceLabel}
                        value={formatSoccerOddsValue(doubleChanceValue, oddsFormat)}
                        className="bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300"
                        textClassName="text-[11px]"
                      />
                    ) : (
                      <SoccerOddsPill
                        label={selectedMoneylineResult}
                        value={formatSoccerOddsValue(moneylineValue, oddsFormat)}
                        textClassName="text-[11px]"
                        className={
                          selectedMoneylineResult === 'W'
                            ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                            : selectedMoneylineResult === 'D'
                              ? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                        }
                      />
                    )}
                  </div>
                </button>
              );
            })
          ) : totalItems.length ? (
            <>
              {showNoLineState ? (
                <div className="px-3 py-3 mb-1 border-b border-gray-200 dark:border-gray-600">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
                </div>
              ) : null}
              {totalItems.map(({ book, bookIndex, line }, index) => {
              const info = getBookmakerInfo(book.name);
              const isSelected = isSameSoccerLine(line.line, currentLineValue);
              return (
                <button
                  key={`${book.name}-${line.line}-${index}`}
                  type="button"
                  onClick={() => {
                    const parsedLine = soccerLineToNumber(line.line);
                    onSelectBookIndex(bookIndex);
                    if (parsedLine != null) onSelectLineValue(parsedLine);
                    setIsOpen(false);
                  }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg mb-1 last:mb-0 flex items-center justify-between gap-2 transition-colors border ${
                    isSelected
                      ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                      : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <SoccerBookmakerIcon info={info} className="w-5 h-5" />
                    <span className="font-semibold text-sm text-gray-900 dark:text-white">{line.line}</span>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <SoccerOddsPill
                      label="O"
                      value={formatSoccerOddsValue(line.over, oddsFormat)}
                      className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400"
                    />
                    <SoccerOddsPill
                      label="U"
                      value={formatSoccerOddsValue(line.under, oddsFormat)}
                      className="bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
                    />
                  </div>
                </button>
              );
              })}
            </>
          ) : (
            <div className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400">No matching total goals lines</div>
          )}
          </div>
        </div>
      ) : null}
    </div>
  );
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
  const n = Number.parseFloat(match[0]);
  return Number.isFinite(n) ? n : null;
}

function getTeamValueForStat(match: SoccerwayRecentMatch, selectedTeamName: string, stat: SoccerwayMatchStat): number | null {
  const side = getSelectedTeamSide(match, selectedTeamName);
  const raw = side === 'away' ? stat.awayValue : stat.homeValue;
  return parseNumericValue(raw);
}

function getOpponentValueForStat(match: SoccerwayRecentMatch, selectedTeamName: string, stat: SoccerwayMatchStat): string | null {
  const side = getSelectedTeamSide(match, selectedTeamName);
  return side === 'away' ? stat.homeValue ?? null : stat.awayValue ?? null;
}

function getSelectedTeamPerspective(match: SoccerwayRecentMatch, selectedTeamName: string) {
  const side = getSelectedTeamSide(match, selectedTeamName);
  const teamScore = side === 'away' ? match.awayScore : match.homeScore;
  const opponentScore = side === 'away' ? match.homeScore : match.awayScore;
  const opponent = side === 'away' ? match.homeTeam : match.awayTeam;
  const opponentLogoUrl = side === 'away' ? match.homeLogoUrl ?? null : match.awayLogoUrl ?? null;
  const venue: SoccerMatchVenue = side === 'away' ? 'AWAY' : 'HOME';
  const result = teamScore > opponentScore ? 'W' : teamScore < opponentScore ? 'L' : 'D';

  return {
    teamScore,
    opponentScore,
    opponent,
    opponentLogoUrl,
    result,
    venue,
  };
}

function getTeamAbbrev(team: string): string {
  const parts = team.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
  return parts.slice(0, 3).map((part) => part[0]).join('').toUpperCase();
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

function getTimeframeLabel(value: SoccerTimeframe): string {
  if (value === 'last5') return 'L5';
  if (value === 'last10') return 'L10';
  if (value === 'last20') return 'L20';
  if (value === 'last50') return 'L50';
  if (value === 'h2h') return 'H2H';
  if (value === 'all') return 'ALL';
  return value.replace('season:', '');
}

function shouldHideSoccerTickDetails(timeframe: SoccerTimeframe): boolean {
  return timeframe === 'last50' || timeframe === 'all' || timeframe.startsWith('season:');
}

function shouldHideSoccerVenueMarker(timeframe: SoccerTimeframe): boolean {
  return timeframe === 'all';
}

function formatTickDate(kickoffUnix: number | null): string {
  if (kickoffUnix == null) return '';
  return new Date(kickoffUnix * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getSoccerSeasonYear(kickoff: Date | null): number {
  if (!kickoff) return 0;
  const month = kickoff.getUTCMonth();
  const year = kickoff.getUTCFullYear();
  return month >= 6 ? year : year - 1;
}

function SoccerXAxisTick({ x, y, payload, data, isDark, hideTickDetails, hideVenueMarker }: any) {
  const point = data?.find((item: SoccerChartRow) => item.xKey === payload.value) as SoccerChartRow | undefined;
  if (!point) return null;

  return (
    <g transform={`translate(${x},${y})`}>
      {!hideTickDetails && point.opponentLogoUrl ? (
        <image
          href={point.opponentLogoUrl}
          x={-10}
          y={4}
          width={20}
          height={20}
          preserveAspectRatio="xMidYMid meet"
        />
      ) : !hideTickDetails ? (
        <text
          x={0}
          y={0}
          dy={18}
          textAnchor="middle"
          fill={isDark ? '#cbd5e1' : '#475569'}
          fontSize={10}
          fontWeight={700}
        >
          {point.tickLabel}
        </text>
      ) : null}
      {!hideVenueMarker ? (
        <text
          x={0}
          y={0}
          dy={!hideTickDetails && point.opponentLogoUrl ? 36 : !hideTickDetails ? 34 : 18}
          textAnchor="middle"
          fill={isDark ? '#c084fc' : '#9333ea'}
          fontSize={9}
          fontWeight={700}
        >
          {point.venue === 'HOME' ? 'H' : 'A'}
        </text>
      ) : null}
      {!hideTickDetails ? (
        <text
          x={0}
          y={0}
          dy={50}
          textAnchor="middle"
          fill={isDark ? '#94a3b8' : '#64748b'}
          fontSize={9}
          fontWeight={600}
        >
          {point.tickDateLabel}
        </text>
      ) : null}
    </g>
  );
}

function SoccerChartTooltip({ active, payload, coordinate, isDark, selectedStatLabel, selectedStatKey }: any) {
  const [mousePosition, setMousePosition] = useState<{ x: number; y: number } | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(typeof window !== 'undefined' && window.innerWidth < 640);
    };
    checkMobile();
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', checkMobile);
      return () => window.removeEventListener('resize', checkMobile);
    }
  }, []);

  useEffect(() => {
    if (!active) {
      setMousePosition(null);
      return;
    }
    const handleMouseMove = (e: MouseEvent) => {
      setMousePosition({ x: e.clientX, y: e.clientY });
    };
    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches?.length > 0) {
        const t = e.touches[0];
        setMousePosition({ x: t.clientX, y: t.clientY });
      }
    };
    if (coordinate?.x != null && coordinate?.y != null) {
      setMousePosition({ x: coordinate.x, y: coordinate.y });
    }
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchstart', handleTouchStart);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, [active, coordinate?.x, coordinate?.y]);

  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload as SoccerChartRow | undefined;
  if (!point) return null;
  const displayValue =
    selectedStatKey === 'moneyline'
      ? point.result === 'D' ? '0' : point.result
      : payload[0]?.value;

  const getTooltipPosition = () => {
    const currentPosition = mousePosition ?? (coordinate ? { x: coordinate.x, y: coordinate.y } : null);
    if (!currentPosition) return { left: undefined, top: undefined };
    if (isMobile) {
      const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
      const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 0;
      const tooltipWidth = 280;
      const tooltipHeight = 120;
      const left = Math.max(10, (viewportWidth - tooltipWidth) / 2);
      const top = Math.max(10, Math.min(viewportHeight * 0.4, viewportHeight - tooltipHeight - 20));
      return { left: `${left}px`, top: `${top}px` };
    }
    const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 0;
    const tooltipWidth = 240;
    const offsetX = 15;
    const offsetY = -10;
    let left = currentPosition.x + offsetX;
    if (left + tooltipWidth > viewportWidth - 10) left = viewportWidth - tooltipWidth - 10;
    return { left: `${left}px`, top: `${currentPosition.y + offsetY}px` };
  };

  const position = getTooltipPosition();
  const tooltipContent = (
    <div
      className="rounded-lg border px-3 py-2 text-xs shadow-xl"
      style={{
        backgroundColor: isDark ? '#111827' : '#ffffff',
        borderColor: isDark ? '#374151' : '#e5e7eb',
        color: isDark ? '#f9fafb' : '#111827',
        minWidth: isMobile ? '280px' : '220px',
        maxWidth: isMobile ? '90vw' : 'none',
        zIndex: 999999,
        pointerEvents: 'none',
        position: 'fixed',
        left: position.left,
        top: position.top,
        transform: 'none',
      }}
    >
      <div className="font-semibold">{point.opponent}</div>
      <div className="text-[11px] opacity-70">{point.gameDate}</div>
      <div className="mt-1">{point.result} · {point.scoreline}</div>
      <div className="mt-1">
        {selectedStatLabel}: <span className="font-semibold">{displayValue}</span>
        {point.comparisonValue ? <span className="opacity-70"> vs {point.comparisonValue}</span> : null}
      </div>
    </div>
  );

  const shouldRender = typeof window !== 'undefined' && active && (mousePosition ?? (isMobile && coordinate));
  if (shouldRender) {
    return createPortal(tooltipContent, document.body);
  }
  return null;
}

export const SoccerStatsChart = memo(function SoccerStatsChart({
  matches,
  selectedTeamName,
  nextOpponentName = null,
  selectedTeamHref,
  nextFixtureMatchId,
  oddsFormat = DEFAULT_ODDS_FORMAT,
  isDark,
  onSelectedStatChange,
  onSelectedTimeframeChange,
  onSelectedTeamScopeChange,
  onSelectedCompetitionChange,
}: SoccerStatsChartProps) {
  const [selectedStat, setSelectedStat] = useState('');
  const [selectedTimeframe, setSelectedTimeframe] = useState<SoccerTimeframe>('last10');
  const storedTeamScopeRef = useRef<SoccerStatTeamScope | null>(readStoredSoccerTeamScope());
  const [selectedStatTeamScope, setSelectedStatTeamScope] = useState<SoccerStatTeamScope>(storedTeamScopeRef.current ?? 'team');
  const [selectedCompetition, setSelectedCompetition] = useState('all');
  const [lineValue, setLineValue] = useState(0);
  const [oddsBooks, setOddsBooks] = useState<SoccerOddsBookRow[]>([]);
  const [oddsLoading, setOddsLoading] = useState(false);
  const [selectedBookIndex, setSelectedBookIndex] = useState(0);
  const [doubleChanceMode, setDoubleChanceMode] = useState(false);
  const [selectedDoubleChance, setSelectedDoubleChance] = useState<SoccerResultLabel[]>(['W', 'D']);
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  const [isCompetitionDropdownOpen, setIsCompetitionDropdownOpen] = useState(false);
  const timeframeDropdownRef = useRef<HTMLDivElement>(null);
  const competitionDropdownRef = useRef<HTMLDivElement>(null);
  const previousSelectedStatRef = useRef(selectedStat);

  useEffect(() => {
    const href = String(selectedTeamHref || '').trim();
    const matchId = String(nextFixtureMatchId || '').trim();
    if (!href || !matchId) {
      setOddsBooks([]);
      setOddsLoading(false);
      setSelectedBookIndex(0);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setOddsLoading(true);

    const params = new URLSearchParams({ href, matchId });
    fetch(`/api/soccer/odds?${params.toString()}`, { signal: controller.signal, cache: 'no-store' })
      .then(async (response) => {
        const json = (await response.json().catch(() => null)) as SoccerOddsPayload | null;
        if (!response.ok || json?.success === false) {
          throw new Error(json?.error || `Soccer odds request failed (${response.status})`);
        }
        return json;
      })
      .then((json) => {
        if (cancelled) return;
        setOddsBooks(buildSoccerOddsBooks(json?.groupedMarkets ?? []));
        setSelectedBookIndex(0);
      })
      .catch((error) => {
        if (cancelled || error?.name === 'AbortError') return;
        setOddsBooks([]);
        setSelectedBookIndex(0);
      })
      .finally(() => {
        if (!cancelled) setOddsLoading(false);
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [nextFixtureMatchId, selectedTeamHref]);

  const normalizedRows = useMemo(() => {
    return matches
      .map((match) => {
        const side = getSelectedTeamSide(match, selectedTeamName);
        if (!side) return null;

        const statMap: Record<string, number> = {};
        const homeStatMap: Record<string, number> = {};
        const awayStatMap: Record<string, number> = {};
        const comparisonMap: Record<string, string | null> = {};
        const labelMap: Record<string, string> = {};
        const opponentStatMap: Record<string, number> = {};

        for (const stat of getMatchPeriodStats(match)) {
          const key = formatStatKey(stat.name);
          const homeValue = parseNumericValue(stat.homeValue);
          const awayValue = parseNumericValue(stat.awayValue);
          const value = getTeamValueForStat(match, selectedTeamName, stat);
          const opponentValue = side === 'away' ? homeValue : awayValue;
          if (homeValue != null) homeStatMap[key] = homeValue;
          if (awayValue != null) awayStatMap[key] = awayValue;
          if (value == null) continue;
          statMap[key] = value;
          if (opponentValue != null) opponentStatMap[key] = opponentValue;
          comparisonMap[key] = getOpponentValueForStat(match, selectedTeamName, stat);
          labelMap[key] = stat.name;
        }

        const kickoff = match.kickoffUnix != null ? new Date(match.kickoffUnix * 1000) : null;
        const gameSeason = getSoccerSeasonYear(kickoff);
        const gameDate = kickoff
          ? kickoff.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';
        const perspective = getSelectedTeamPerspective(match, selectedTeamName);
        statMap.total_goals = perspective.teamScore;
        opponentStatMap.total_goals = perspective.opponentScore;
        homeStatMap.total_goals = match.homeScore;
        awayStatMap.total_goals = match.awayScore;
        comparisonMap.total_goals = `${match.homeScore}-${match.awayScore}`;
        labelMap.total_goals = 'Total goals';
        statMap.moneyline = perspective.result === 'W' ? 1 : perspective.result === 'L' ? -1 : 0;
        opponentStatMap.moneyline = perspective.result === 'W' ? -1 : perspective.result === 'L' ? 1 : 0;
        comparisonMap.moneyline = null;
        labelMap.moneyline = 'H2H';

        return {
          match,
          side,
          gameSeason,
          gameDate,
          kickoffMs: kickoff?.getTime() ?? 0,
          competitionKey: getCompetitionKey(match),
          competitionLabel: getCompetitionLabel(match),
          ...perspective,
          statMap,
          opponentStatMap,
          homeStatMap,
          awayStatMap,
          comparisonMap,
          labelMap,
        };
      })
      .filter((row): row is NonNullable<typeof row> => row != null)
      .sort((a, b) => a.kickoffMs - b.kickoffMs);
  }, [matches, selectedTeamName]);

  const statLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of normalizedRows) {
      for (const [key, label] of Object.entries(row.labelMap)) {
        if (!map.has(key)) map.set(key, label);
      }
    }
    return map;
  }, [normalizedRows]);

  const availableStats = useMemo(() => {
    const keys = new Set<string>();
    for (const row of normalizedRows) {
      for (const [key, value] of Object.entries(row.statMap)) {
        if (Number.isFinite(value) && SOCCER_BETTABLE_STATS.has(key)) keys.add(key);
      }
    }

    const ordered: string[] = [];
    for (const key of SOCCER_TOP_STAT_PRIORITY) {
      if (keys.has(key)) ordered.push(key);
    }
    for (const key of keys) {
      if (!ordered.includes(key)) ordered.push(key);
    }
    return ordered;
  }, [normalizedRows]);

  useEffect(() => {
    if (!availableStats.length) {
      setSelectedStat('');
      return;
    }
    if (selectedStat && availableStats.includes(selectedStat)) return;
    setSelectedStat(availableStats[0]);
  }, [availableStats, selectedStat]);

  useEffect(() => {
    if (selectedStat) onSelectedStatChange?.(selectedStat);
  }, [selectedStat, onSelectedStatChange]);

  useEffect(() => {
    if (selectedStat !== 'moneyline') {
      setDoubleChanceMode(false);
    }
  }, [selectedStat]);

  const statSupportsTeamScope = useMemo(() => {
    if (!selectedStat) return false;
    if (selectedStat === 'moneyline') return false;
    return normalizedRows.some((row) => {
      const teamValue = row.statMap[selectedStat];
      const opponentValue = row.opponentStatMap[selectedStat];
      return Number.isFinite(teamValue) || Number.isFinite(opponentValue);
    });
  }, [normalizedRows, selectedStat]);

  const statTeamScopeOptions = useMemo(() => {
    return [
      { key: 'team' as const, label: selectedTeamName || 'Team' },
      { key: 'all' as const, label: 'Combined' },
      { key: 'opp' as const, label: 'Opp' },
    ];
  }, [selectedTeamName]);

  useEffect(() => {
    if (!statSupportsTeamScope) {
      setSelectedStatTeamScope('all');
      return;
    }

    if (!statTeamScopeOptions.some((option) => option.key === selectedStatTeamScope)) {
      setSelectedStatTeamScope(statTeamScopeOptions[0].key);
    }
  }, [selectedStatTeamScope, statSupportsTeamScope, statTeamScopeOptions]);

  useEffect(() => {
    const onDocMouseDown = (event: MouseEvent) => {
      const timeframeEl = timeframeDropdownRef.current;
      if (timeframeEl && event.target instanceof Node && !timeframeEl.contains(event.target)) {
        setIsTimeframeDropdownOpen(false);
      }
      const competitionEl = competitionDropdownRef.current;
      if (competitionEl && event.target instanceof Node && !competitionEl.contains(event.target)) {
        setIsCompetitionDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  const competitionOptions = useMemo(() => {
    const counts = new Map<string, { label: string; count: number }>();
    for (const row of normalizedRows) {
      const existing = counts.get(row.competitionKey);
      if (existing) existing.count += 1;
      else counts.set(row.competitionKey, { label: row.competitionLabel, count: 1 });
    }
    return Array.from(counts.entries())
      .map(([key, value]) => ({ key, label: value.label, count: value.count }))
      .sort((a, b) => (b.count - a.count) || a.label.localeCompare(b.label));
  }, [normalizedRows]);

  useEffect(() => {
    if (selectedCompetition === 'all') return;
    if (competitionOptions.some((option) => option.key === selectedCompetition)) return;
    setSelectedCompetition('all');
  }, [competitionOptions, selectedCompetition]);

  const filteredRows = useMemo(() => {
    if (selectedCompetition === 'all') return normalizedRows;
    return normalizedRows.filter((row) => row.competitionKey === selectedCompetition);
  }, [normalizedRows, selectedCompetition]);

  const seasonOptions = useMemo(() => {
    const years = [...new Set(filteredRows.map((row) => row.gameSeason).filter((year) => year >= 2008))].sort((a, b) => b - a);
    return years.map((year) => `season:${year}` as SoccerTimeframe);
  }, [filteredRows]);

  const timeframeOptions = useMemo(() => {
    return ['last5', 'last10', 'last20', 'last50', 'h2h', 'all', ...seasonOptions] as SoccerTimeframe[];
  }, [seasonOptions]);

  useEffect(() => {
    if (!timeframeOptions.includes(selectedTimeframe)) {
      setSelectedTimeframe('last10');
    }
  }, [timeframeOptions, selectedTimeframe]);

  useEffect(() => {
    onSelectedTimeframeChange?.(selectedTimeframe);
  }, [selectedTimeframe, onSelectedTimeframeChange]);

  useEffect(() => {
    onSelectedTeamScopeChange?.(selectedStatTeamScope);
  }, [onSelectedTeamScopeChange, selectedStatTeamScope]);

  const selectStatTeamScope = (scope: SoccerStatTeamScope) => {
    storedTeamScopeRef.current = scope;
    writeStoredSoccerTeamScope(scope);
    setSelectedStatTeamScope(scope);
  };

  useEffect(() => {
    onSelectedCompetitionChange?.(selectedCompetition);
  }, [onSelectedCompetitionChange, selectedCompetition]);

  const selectedCompetitionLabel = useMemo(() => {
    if (selectedCompetition === 'all') return 'All comps';
    return competitionOptions.find((option) => option.key === selectedCompetition)?.label ?? 'Competition';
  }, [competitionOptions, selectedCompetition]);

  const baseChartData = useMemo(() => {
    if (!selectedStat) return [];
    return filteredRows
      .map((row, idx): SoccerChartRow | null => {
        const homeValue = row.homeStatMap[selectedStat];
        const awayValue = row.awayStatMap[selectedStat];
        const teamValue = row.statMap[selectedStat];
        const opponentValue = row.opponentStatMap[selectedStat];
        let value: number | null = null;
        let comparisonValue: string | null = null;

        if (selectedStatTeamScope === 'all') {
          if (Number.isFinite(homeValue) && Number.isFinite(awayValue)) {
            value = homeValue + awayValue;
            comparisonValue = `${homeValue}-${awayValue}`;
          } else if (Number.isFinite(teamValue)) {
            value = teamValue;
            comparisonValue = row.comparisonMap[selectedStat] ?? null;
          }
        } else if (selectedStatTeamScope === 'team') {
          if (Number.isFinite(teamValue)) {
            value = teamValue;
            comparisonValue = Number.isFinite(opponentValue) ? String(opponentValue) : null;
          }
        } else if (selectedStatTeamScope === 'opp') {
          if (Number.isFinite(opponentValue)) {
            value = opponentValue;
            comparisonValue = Number.isFinite(teamValue) ? String(teamValue) : null;
          }
        }

        if (!Number.isFinite(value)) return null;
        const numericValue = value as number;

        return {
          key: `${row.match.matchId}-${idx}`,
          xKey: `${row.match.matchId}-${idx}`,
          tickLabel: getTeamAbbrev(row.opponent),
          tickDateLabel: formatTickDate(row.match.kickoffUnix),
          opponent: row.opponent,
          opponentLogoUrl: row.opponentLogoUrl,
          result: row.result,
          venue: row.venue,
          value: numericValue,
          comparisonValue,
          gameDate: row.gameDate,
          scoreline: `${row.teamScore}-${row.opponentScore}`,
          sourceMatch: row.match,
          gameSeason: row.gameSeason,
        };
      })
      .filter((row): row is SoccerChartRow => row != null);
  }, [filteredRows, selectedStat, selectedStatTeamScope]);

  const chartData = useMemo(() => {
    if (selectedTimeframe === 'all') return baseChartData;
    if (selectedTimeframe === 'h2h') {
      const targetOpponent = String(nextOpponentName || '').trim();
      if (!targetOpponent) return [];
      return baseChartData.filter((row) => opponentNamesMatch(row.opponent, targetOpponent)).slice(-15);
    }
    if (selectedTimeframe.startsWith('season:')) {
      const year = Number.parseInt(selectedTimeframe.replace('season:', ''), 10);
      return baseChartData.filter((row) => row.gameSeason === year);
    }
    const lastN = Number.parseInt(selectedTimeframe.replace('last', ''), 10);
    if (!Number.isFinite(lastN) || lastN <= 0) return baseChartData;
    return baseChartData.slice(-lastN);
  }, [baseChartData, nextOpponentName, selectedTimeframe]);

  const isMoneylineDrawMode = selectedStat === 'moneyline' && getSoccerMoneylineLineLabel(lineValue) === 'D';
  const isMoneylineDoubleChanceMode = selectedStat === 'moneyline' && doubleChanceMode;
  const displayChartData = useMemo(() => {
    if (isMoneylineDoubleChanceMode) {
      return chartData.map((row) => (
        selectedDoubleChance.includes(row.result as SoccerResultLabel)
          ? { ...row, value: 1, moneylineLabel: row.result }
          : { ...row, value: null, moneylineLabel: undefined }
      ));
    }
    if (!isMoneylineDrawMode) return chartData;
    return chartData.map((row) => (
      row.result === 'D'
        ? { ...row, value: 1, moneylineLabel: '0' }
        : { ...row, value: null, moneylineLabel: undefined }
    ));
  }, [chartData, isMoneylineDoubleChanceMode, isMoneylineDrawMode, selectedDoubleChance]);

  useEffect(() => {
    if (previousSelectedStatRef.current === selectedStat) return;
    previousSelectedStatRef.current = selectedStat;
    if (selectedStat === 'total_goals') {
      setSelectedStatTeamScope('all');
      setLineValue(2.5);
    } else {
      setLineValue(0.5);
    }
  }, [selectedStat]);

  useEffect(() => {
    if (selectedStat !== 'total_goals' || !oddsBooks.length) return;
    const selectedBook = oddsBooks[selectedBookIndex];
    const preferredLine = getPreferredSoccerTotalLine(selectedBook?.totalGoals ?? []);
    if (preferredLine != null) {
      setLineValue(preferredLine);
      return;
    }

    const firstBookWithTotal = oddsBooks.findIndex((book) => book.totalGoals.length > 0);
    if (firstBookWithTotal >= 0) {
      setSelectedBookIndex(firstBookWithTotal);
      const firstLine = getPreferredSoccerTotalLine(oddsBooks[firstBookWithTotal].totalGoals);
      if (firstLine != null) setLineValue(firstLine);
    }
  }, [oddsBooks, selectedStat]);

  const yAxisConfig = useMemo(() => {
    if (selectedStat === 'moneyline') {
      if (isMoneylineDrawMode || isMoneylineDoubleChanceMode) {
        return {
          domain: [0, 1] as [number, number],
          ticks: [0, 1],
        };
      }
      return {
        // Add a little extra room below losses so the -1 bar
        // doesn't sit flush with the bottom edge of the plot.
        domain: [-1.12, 1] as [number, number],
        ticks: [-1, 0, 1],
      };
    }

    const values = displayChartData
      .map((row) => row.value)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    if (!values.length) return buildPositiveIntegerAxis(4);

    const minValue = Math.min(...values, lineValue);
    const maxValue = Math.max(...values, lineValue);
    if (minValue < 0) {
      return buildSymmetricIntegerAxis(Math.max(Math.abs(minValue), Math.abs(maxValue)));
    }

    return buildPositiveIntegerAxis(maxValue);
  }, [displayChartData, isMoneylineDoubleChanceMode, isMoneylineDrawMode, lineValue, selectedStat]);

  const lineInputBounds = useMemo(() => {
    if (selectedStat === 'moneyline') {
      return { min: -1, max: 1 };
    }
    return { min: yAxisConfig.domain[0], max: yAxisConfig.domain[1] };
  }, [selectedStat, yAxisConfig]);

  const selectMoneylineResult = (result: SoccerResultLabel) => {
    if (!doubleChanceMode) {
      setLineValue(result === 'W' ? 0.5 : result === 'D' ? 0 : -0.5);
      return;
    }

    setSelectedDoubleChance((prev) => {
      if (prev.includes(result)) return prev;
      const next = [...prev, result];
      return next.length > 2 ? next.slice(1) : next;
    });
  };

  const enableDoubleChanceMode = () => {
    if (doubleChanceMode) {
      setDoubleChanceMode(false);
      return;
    }
    const current = getSoccerMoneylineLineLabel(lineValue);
    setSelectedDoubleChance(current === 'L' ? ['D', 'L'] : ['W', 'D']);
    setDoubleChanceMode(true);
  };

  const customTooltip = useMemo(() => {
    const selectedStatLabel = statLabels.get(selectedStat) || formatStatLabel(selectedStat || 'stat');
    return (props: any) => (
      <SoccerChartTooltip
        {...props}
        isDark={isDark}
        selectedStatLabel={selectedStatLabel}
        selectedStatKey={selectedStat}
      />
    );
  }, [isDark, selectedStat, statLabels]);

  const hideTickDetails = useMemo(() => shouldHideSoccerTickDetails(selectedTimeframe), [selectedTimeframe]);
  const hideVenueMarker = useMemo(() => shouldHideSoccerVenueMarker(selectedTimeframe), [selectedTimeframe]);
  const soccerXAxisTick = useMemo(
    () => <SoccerXAxisTick data={chartData} isDark={isDark} hideTickDetails={hideTickDetails} hideVenueMarker={hideVenueMarker} />,
    [chartData, hideTickDetails, hideVenueMarker, isDark]
  );

  if (!selectedTeamName) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4 text-sm text-gray-500 dark:text-gray-400">
        Select a team to load the chart.
      </div>
    );
  }

  if (!availableStats.length) {
    return (
      <div className="h-full w-full flex items-center justify-center p-4 text-sm text-gray-500 dark:text-gray-400">
        No chartable Soccerway team stats were returned for this team.
      </div>
    );
  }

  return (
    <div className="h-full w-full pt-3 pb-2 flex flex-col px-0 sm:px-1 md:px-2">
      <div className="mb-4 sm:mb-5 md:mb-4 mt-0 w-full max-w-full">
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
            {availableStats.map((key) => (
              <StatPill
                key={key}
                label={statLabels.get(key) || formatStatLabel(key)}
                value={key}
                isSelected={selectedStat === key}
                onSelect={setSelectedStat}
                isDark={isDark}
                darker
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
        <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-0 sm:ml-1">
          <div className="flex items-center gap-1 sm:gap-2 md:gap-3">
            {(selectedStat === 'moneyline' || selectedStat === 'total_goals') ? (
              oddsLoading ? (
                <div className={`h-8 w-[132px] sm:w-[150px] rounded-lg animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
              ) : (
                <SoccerOddsLineSelector
                  books={oddsBooks}
                  selectedStat={selectedStat}
                  selectedBookIndex={selectedBookIndex}
                  onSelectBookIndex={setSelectedBookIndex}
                  onSelectLineValue={setLineValue}
                  currentLineValue={lineValue}
                  doubleChanceMode={doubleChanceMode}
                  selectedDoubleChance={selectedDoubleChance}
                  noOddsAvailable={selectedStat === 'total_goals' && selectedStatTeamScope !== 'all'}
                  oddsFormat={oddsFormat}
                  isDark={isDark}
                />
              )
            ) : null}
            {selectedStat === 'moneyline' ? (
              <>
                <div
                  className="flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] p-0.5"
                  aria-label="Set H2H result line"
                  role="group"
                >
                  {[
                    { label: 'W', value: 0.5 },
                    { label: 'D', value: 0 },
                    { label: 'L', value: -0.5 },
                  ].map((option) => {
                    const label = option.label as SoccerResultLabel;
                    const isSelected = doubleChanceMode
                      ? selectedDoubleChance.includes(label)
                      : getSoccerMoneylineLineLabel(lineValue) === label;
                    return (
                      <button
                        key={option.label}
                        type="button"
                        onClick={() => selectMoneylineResult(label)}
                        className={`min-w-[38px] px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors ${getSoccerResultButtonClass(label, isSelected, doubleChanceMode)}`}
                        aria-pressed={isSelected}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={enableDoubleChanceMode}
                  className={`h-[32px] px-2.5 rounded-lg border text-[11px] sm:text-xs font-medium transition-colors ${
                    doubleChanceMode
                      ? 'bg-blue-600 text-white border-blue-500'
                      : 'bg-white dark:bg-[#0a1929] border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                  }`}
                  aria-pressed={doubleChanceMode}
                >
                  Double chance
                </button>
              </>
            ) : (
              <input
                id="soccer-betting-line-input"
                key={`soccer-line-${selectedStat}`}
                type="number"
                step={0.5}
                value={lineValue}
                min={lineInputBounds.min}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  if (Number.isFinite(next)) {
                    setLineValue(clampSoccerLineValue(next, selectedStat === 'moneyline' ? -1 : 0));
                  }
                }}
                className="w-20 sm:w-20 md:w-22 px-2.5 py-1.5 bg-white dark:bg-gray-900 dark:border-gray-700 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                aria-label={`Set line value for ${statLabels.get(selectedStat) || formatStatLabel(selectedStat)}`}
              />
            )}
            <div className="relative" ref={timeframeDropdownRef}>
              <button
                type="button"
                onClick={() => setIsTimeframeDropdownOpen((prev) => !prev)}
                className="w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
              >
                <span className="truncate">{getTimeframeLabel(selectedTimeframe)}</span>
                <svg className="w-3 h-3 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {isTimeframeDropdownOpen ? (
                <div className="absolute top-full right-0 mt-1 w-20 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                  {timeframeOptions.map((timeframe) => (
                    <button
                      key={timeframe}
                      type="button"
                      onClick={() => {
                        setSelectedTimeframe(timeframe);
                        setIsTimeframeDropdownOpen(false);
                      }}
                      className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
                        selectedTimeframe === timeframe
                          ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                          : 'text-gray-900 dark:text-white'
                      }`}
                    >
                      {getTimeframeLabel(timeframe)}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {statSupportsTeamScope ? (
            <div className="flex basis-full justify-center sm:flex-1">
              <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#0a1929] p-0.5">
                {statTeamScopeOptions.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => selectStatTeamScope(option.key)}
                    className={`px-2.5 py-1 text-[11px] sm:text-xs font-medium rounded-md transition-colors ${
                      selectedStatTeamScope === option.key
                        ? 'bg-purple-600 text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="relative sm:ml-auto" ref={competitionDropdownRef}>
            <button
              type="button"
              onClick={() => setIsCompetitionDropdownOpen((prev) => !prev)}
              className={`w-36 sm:w-40 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600 ${
                isCompetitionDropdownOpen ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''
              }`}
            >
              <span className="truncate">{selectedCompetitionLabel}</span>
              <svg className="w-3 h-3 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {isCompetitionDropdownOpen ? (
              <div className="absolute top-full right-0 mt-1 w-56 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
                {[
                  { key: 'all', label: `All competitions (${normalizedRows.length})` },
                  ...competitionOptions.map((option) => ({
                    key: option.key,
                    label: `${option.label} (${option.count})`,
                  })),
                ].map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => {
                      setSelectedCompetition(option.key);
                      setIsCompetitionDropdownOpen(false);
                    }}
                    className={`w-full px-2 py-1.5 text-xs font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-800 first:rounded-t-lg last:rounded-b-lg ${
                      selectedCompetition === option.key
                        ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                        : 'text-gray-900 dark:text-white'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 relative">
        {chartData.length === 0 ? (
          <div className="h-full w-full flex items-center justify-center p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {selectedTimeframe === 'h2h'
                ? nextOpponentName?.trim()
                  ? 'No cached H2H matches found for the upcoming opponent'
                  : 'No upcoming opponent found for H2H timeframe'
                : 'No stats match selected filters'}
            </p>
          </div>
        ) : (
          <SimpleChart
            key={`soccer-chart-${selectedStat}`}
            chartData={displayChartData}
            yAxisConfig={yAxisConfig}
            isDark={isDark}
            bettingLine={lineValue}
            selectedStat={selectedStat}
            selectedTimeframe={selectedTimeframe}
            customTooltip={customTooltip}
            customXAxisTick={soccerXAxisTick}
            yAxisTickFormatter={(value: number) => {
              if (selectedStat === 'moneyline') {
                if (isMoneylineDoubleChanceMode) {
                  return value >= 1 ? getDoubleChanceLabel(selectedDoubleChance) : '';
                }
                if (isMoneylineDrawMode) {
                  return value >= 1 ? 'D' : '';
                }
                if (value >= 1) return 'W';
                if (value <= -1) return 'L';
                return '0';
              }
              return formatSoccerAxisValue(value);
            }}
            yAxisTickStyle={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace' }}
            preservePrimaryYAxisTicks={true}
            centerAverageOverlay={true}
            averageOverlayLowerOnMobile={true}
            desktopChartLeftInset={40}
            desktopChartRightInset={8}
            desktopChartRightMargin={8}
            yAxisWidth={34}
            xAxisHeight={hideTickDetails ? 28 : 56}
            chartBottomMargin={8}
            hideBarValueLabels={selectedTimeframe === 'all'}
            hideBettingLineOverlay={selectedStat === 'moneyline'}
          />
        )}
      </div>
    </div>
  );
});
