import type { AflBookRow } from '@/app/afl/components/AflBestOddsTable';
import { getGoalsMarketLineOver, getGoalsMarketLines } from '@/app/afl/components/AflBestOddsTable';
import { americanToDecimal } from '@/lib/currencyUtils';

/** Minimal bookmaker line snapshot for the compact AFL journal flow (matches AddToJournalModal BookmakerOdds shape). */
export type AflJournalQuickBookmakerOdds = {
  bookmaker: string;
  line: number;
  overPrice: number;
  underPrice: number;
  homeTeam?: string;
  awayTeam?: string;
  homeOdds?: number;
  awayOdds?: number;
  favoriteTeam?: string;
  underdogTeam?: string;
  favoriteSpread?: number;
  underdogSpread?: number;
  favoriteOdds?: number;
  underdogOdds?: number;
};

export type AflJournalQuickPreset = {
  isGameProp: boolean;
  statType: string;
  odds: AflJournalQuickBookmakerOdds;
};

const CHART_TO_PROP_COL: Partial<
  Record<string, 'Disposals' | 'DisposalsOver' | 'AnytimeGoalScorer' | 'GoalsOver' | 'MarksOver' | 'TacklesOver'>
> = {
  disposals: 'Disposals',
  goals: 'GoalsOver',
  marks: 'MarksOver',
  tackles: 'TacklesOver',
};

function toLineNumber(line: string | null | undefined): number | null {
  if (line == null || line === '' || line === 'N/A') return null;
  const n = parseFloat(String(line).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function toAmericanDecimal(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === '' || raw === 'N/A') return null;
  const am = typeof raw === 'number' ? raw : parseFloat(String(raw).replace(/[^+\-\d.]/g, ''));
  if (!Number.isFinite(am) || am === 0) return null;
  return americanToDecimal(am);
}

function isSameLine(a: number | null, b: number | null, tol = 0.02): boolean {
  if (a == null || b == null) return false;
  return Math.abs(a - b) < tol;
}

function buildPlayerPreset(
  mainChartStat: string,
  selectedAflDisposalsColumn: 'Disposals' | 'DisposalsOver',
  book: AflBookRow,
  aflCurrentLineValue: number | null
): AflJournalQuickPreset | null {
  const bookmaker = book.name;
  if (!bookmaker) return null;

  if (mainChartStat === 'goals') {
    const lines = getGoalsMarketLines(book);
    if (!lines.length) return null;
    const target =
      aflCurrentLineValue != null && Number.isFinite(aflCurrentLineValue)
        ? lines.find((x) => isSameLine(toLineNumber(x.line), aflCurrentLineValue))
        : null;
    const pick = target ?? lines[0];
    const line = toLineNumber(pick.line);
    if (line == null) return null;
    const overDec = toAmericanDecimal(pick.over);
    let underRaw: string | undefined;
    if (isSameLine(line, 0.5) && book.AnytimeGoalScorer?.no && book.AnytimeGoalScorer.no !== 'N/A') {
      underRaw = book.AnytimeGoalScorer.no;
    }
    const underDec = underRaw ? toAmericanDecimal(underRaw) : null;
    if (overDec == null || underDec == null) return null;
    return {
      isGameProp: false,
      statType: 'goals',
      odds: { bookmaker, line, overPrice: overDec, underPrice: underDec },
    };
  }

  if (mainChartStat === 'disposals') {
    const col = selectedAflDisposalsColumn;
    if (col === 'Disposals') {
      const m = book.Disposals;
      if (!m || m.line === 'N/A') return null;
      const line = toLineNumber(m.line);
      const o = toAmericanDecimal(m.over);
      const u = toAmericanDecimal(m.under);
      if (line == null || o == null || u == null) return null;
      return {
        isGameProp: false,
        statType: 'disposals',
        odds: { bookmaker, line, overPrice: o, underPrice: u },
      };
    }
    const m = book.DisposalsOver;
    if (!m || m.line === 'N/A' || !m.over || m.over === 'N/A') return null;
    const line = toLineNumber(m.line);
    const o = toAmericanDecimal(m.over);
    if (line == null || o == null) return null;
    return null;
  }

  const propCol = CHART_TO_PROP_COL[mainChartStat];
  if (!propCol || propCol === 'GoalsOver' || propCol === 'Disposals' || propCol === 'DisposalsOver') return null;

  // Marks / tackles over-only (no under in feed): quick journal not supported.
  return null;
}

function buildTeamPreset(
  mainChartStat: string,
  book: AflBookRow,
  actualHomeTeam: string,
  actualAwayTeam: string
): AflJournalQuickPreset | null {
  const bookmaker = book.name;
  if (!bookmaker || !actualHomeTeam || !actualAwayTeam) return null;

  if (mainChartStat === 'moneyline') {
    const h2h = book.H2H;
    if (!h2h || h2h.home === 'N/A' || h2h.away === 'N/A') return null;
    const homeAm = parseFloat(String(h2h.home).replace(/[^+\-\d.]/g, ''));
    const awayAm = parseFloat(String(h2h.away).replace(/[^+\-\d.]/g, ''));
    if (!Number.isFinite(homeAm) || !Number.isFinite(awayAm) || homeAm === 0 || awayAm === 0) return null;
    const homeDec = americanToDecimal(homeAm);
    const awayDec = americanToDecimal(awayAm);
    return {
      isGameProp: true,
      statType: 'moneyline',
      odds: {
        bookmaker,
        line: 0,
        overPrice: homeDec,
        underPrice: awayDec,
        homeTeam: actualHomeTeam,
        awayTeam: actualAwayTeam,
        homeOdds: homeDec,
        awayOdds: awayDec,
      },
    };
  }

  if (mainChartStat === 'spread') {
    const gameData = book.Spread;
    if (!gameData || gameData.line === 'N/A') return null;
    const lineValue = toLineNumber(gameData.line);
    if (lineValue == null) return null;
    const overOdds = parseFloat(String(gameData.over).replace(/[^+\-\d.]/g, ''));
    const underOdds = parseFloat(String(gameData.under).replace(/[^+\-\d.]/g, ''));
    if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds)) return null;

    const favoriteTeam = lineValue < 0 ? actualHomeTeam : actualAwayTeam;
    const underdogTeam = lineValue < 0 ? actualAwayTeam : actualHomeTeam;
    const favoriteSpread = lineValue < 0 ? lineValue : -Math.abs(lineValue);
    const underdogSpread = lineValue < 0 ? Math.abs(lineValue) : lineValue;
    const favoriteOdds = lineValue < 0 ? overOdds : underOdds;
    const underdogOdds = lineValue < 0 ? underOdds : overOdds;

    return {
      isGameProp: true,
      statType: 'spread',
      odds: {
        bookmaker,
        line: lineValue,
        // Match AddToJournalModal single-bet path: over = favorite side, under = underdog side.
        overPrice: americanToDecimal(favoriteOdds),
        underPrice: americanToDecimal(underdogOdds),
        homeTeam: actualHomeTeam,
        awayTeam: actualAwayTeam,
        favoriteTeam,
        underdogTeam,
        favoriteSpread,
        underdogSpread,
        favoriteOdds: americanToDecimal(favoriteOdds),
        underdogOdds: americanToDecimal(underdogOdds),
      },
    };
  }

  if (mainChartStat === 'total_points') {
    const gameData = book.Total;
    if (!gameData || gameData.line === 'N/A') return null;
    const lineValue = toLineNumber(gameData.line);
    if (lineValue == null) return null;
    const overOdds = parseFloat(String(gameData.over).replace(/[^+\-\d.]/g, ''));
    const underOdds = parseFloat(String(gameData.under).replace(/[^+\-\d.]/g, ''));
    if (!Number.isFinite(overOdds) || !Number.isFinite(underOdds)) return null;

    return {
      isGameProp: true,
      statType: 'total_points',
      odds: {
        bookmaker,
        line: lineValue,
        overPrice: americanToDecimal(overOdds),
        underPrice: americanToDecimal(underOdds),
        homeTeam: actualHomeTeam,
        awayTeam: actualAwayTeam,
      },
    };
  }

  return null;
}

/**
 * Build a single-bookmaker preset for the compact AFL journal (Over/Under → stake).
 * Returns null when the selected book has no usable two-sided market for this stat.
 */
export function buildAflJournalQuickPreset(opts: {
  mode: 'player' | 'team';
  mainChartStat: string;
  selectedAflDisposalsColumn: 'Disposals' | 'DisposalsOver';
  book: AflBookRow | undefined;
  aflCurrentLineValue: number | null;
  homeTeam: string;
  awayTeam: string;
}): AflJournalQuickPreset | null {
  const { mode, mainChartStat, selectedAflDisposalsColumn, book, aflCurrentLineValue, homeTeam, awayTeam } = opts;
  if (!book || !mainChartStat) return null;
  if (mode === 'player') {
    return buildPlayerPreset(mainChartStat, selectedAflDisposalsColumn, book, aflCurrentLineValue);
  }
  return buildTeamPreset(mainChartStat, book, homeTeam, awayTeam);
}
