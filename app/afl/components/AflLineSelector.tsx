'use client';

import { useState, useRef, useEffect } from 'react';
import { americanToDecimal } from '@/lib/currencyUtils';
import { getBookmakerInfo } from '@/lib/bookmakers';
import { opponentToFootywireTeam } from '@/lib/aflTeamMapping';
import type { AflBookRow } from './AflBestOddsTable';
import { getGoalsMarketLineOver, getGoalsMarketLines } from './AflBestOddsTable';

function parseAmerican(s: string): number {
  if (s === 'N/A' || s == null) return NaN;
  const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

function fmtOdds(americanStr: string, format: 'american' | 'decimal'): string {
  const am = parseAmerican(americanStr);
  if (Number.isNaN(am)) return 'N/A';
  if (format === 'decimal') {
    const dec = americanToDecimal(am);
    return dec.toFixed(2);
  }
  return am > 0 ? `+${am}` : String(am);
}

type AflGameStat =
  | 'moneyline'
  | 'spread'
  | 'total_goals'
  | 'total_points'
  | 'q1_total'
  | 'q1_spread'
  | 'q1_total_goals'
  | 'q2_total'
  | 'q2_spread'
  | 'q2_total_goals'
  | 'q3_total'
  | 'q3_spread'
  | 'q3_total_goals'
  | 'q4_total'
  | 'q4_spread'
  | 'q4_total_goals';

const STAT_TO_KEY: Partial<Record<AflGameStat, keyof AflBookRow>> = {
  moneyline: 'H2H',
  spread: 'Spread',
  total_goals: 'Total',
  total_points: 'Total',
  // Quarter stats have no bookmaker column → selector shows skeleton
};

type AflPlayerPropKey = 'Disposals' | 'DisposalsOver' | 'AnytimeGoalScorer' | 'GoalsOver' | 'MarksOver' | 'TacklesOver';

interface AflLineSelectorProps {
  books: AflBookRow[];
  selectedStat: AflGameStat;
  selectedBookIndex: number;
  onSelectBookIndex: (index: number) => void;
  oddsFormat: 'american' | 'decimal';
  isDark: boolean;
  homeTeam: string;
  awayTeam: string;
  disabled?: boolean;
  /** When set, use this column from books (player props mode) instead of STAT_TO_KEY[selectedStat]. */
  playerPropColumn?: AflPlayerPropKey;
  /** When playerPropColumn is Disposals, which column is selected (O/U vs Over-only). */
  selectedDisposalsColumn?: 'Disposals' | 'DisposalsOver';
  /** When playerPropColumn is Disposals, called when user picks a line (book index + column). */
  onSelectDisposalsOption?: (bookIndex: number, column: 'Disposals' | 'DisposalsOver') => void;
  /** When playerPropColumn is GoalsOver, called when user picks a line (book index + line value) so 0.5 (Anytime) and Goals Over both show. */
  onSelectGoalsOption?: (bookIndex: number, lineValue: number) => void;
  /** Current line value from the input; when it doesn't match the selected book's line, show skeleton instead of bookmaker. */
  currentLineValue?: number | null;
}

export function AflLineSelector({
  books,
  selectedStat,
  selectedBookIndex,
  onSelectBookIndex,
  oddsFormat,
  isDark,
  homeTeam,
  awayTeam,
  disabled = false,
  playerPropColumn,
  selectedDisposalsColumn = 'Disposals',
  onSelectDisposalsOption,
  onSelectGoalsOption,
  currentLineValue = null,
}: AflLineSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isDisposals = playerPropColumn === 'Disposals';
  const displayKey = (isDisposals ? selectedDisposalsColumn : playerPropColumn ?? STAT_TO_KEY[selectedStat]) as keyof AflBookRow | undefined;
  const key = (playerPropColumn ?? STAT_TO_KEY[selectedStat]) as keyof AflBookRow | undefined;
  const isGoalsOver = playerPropColumn === 'GoalsOver';
  const selectedBook = books[selectedBookIndex];
  const isMoneyline = !playerPropColumn && selectedStat === 'moneyline';
  const isYesNo = playerPropColumn === 'AnytimeGoalScorer';
  // For Goals: use line that matches currentLineValue so 0.5 (Anytime) and Goals Over both display correctly
  const goalsData = isGoalsOver && selectedBook
    ? (currentLineValue != null && Number.isFinite(currentLineValue)
        ? getGoalsMarketLines(selectedBook).find((x) => Math.abs(parseFloat(x.line) - currentLineValue) < 0.01)
        : null) ?? getGoalsMarketLineOver(selectedBook)
    : null;
  const data = isGoalsOver
    ? (goalsData as { line?: string; over?: string } | undefined)
    : (displayKey != null && selectedBook
        ? (selectedBook[displayKey] as { home?: string; away?: string; line?: string; over?: string; under?: string; yes?: string; no?: string } | undefined)
        : undefined);
  const bookmakerInfo = selectedBook ? getBookmakerInfo(selectedBook.name) : null;
  const displayHomeTeam = opponentToFootywireTeam(homeTeam) || homeTeam;
  const displayAwayTeam = opponentToFootywireTeam(awayTeam) || awayTeam;

  const hasDisplayableOdds =
    books.length > 0 &&
    (isMoneyline
      ? data && (data as { home?: string; away?: string }).home !== 'N/A' && (data as { home?: string; away?: string }).away !== 'N/A'
      : isYesNo
        ? data && ((data as { yes?: string; no?: string }).yes !== 'N/A' || (data as { yes?: string; no?: string }).no !== 'N/A')
        : isGoalsOver
          ? goalsData != null
          : isDisposals
            ? data && (data.over !== 'N/A' || (data as { under?: string }).under !== 'N/A')
            : data && (data.over !== 'N/A' || (data as { under?: string }).under !== 'N/A'));

  const selectedBookLineMismatch =
    currentLineValue != null &&
    Number.isFinite(currentLineValue) &&
    !isMoneyline &&
    !isYesNo &&
    data?.line != null &&
    data.line !== 'N/A' &&
    Math.abs(parseFloat(String(data.line).replace(/[^0-9.-]/g, '')) - currentLineValue) >= 0.01;

  // For disposals stat: O/U lines first, then Over-only (alt) lines with an "Alternate" section title
  const disposalsOuItems = isDisposals
    ? (() => {
        const out: { bookIndex: number; column: 'Disposals'; d: { line?: string; over?: string; under?: string } }[] = [];
        books.forEach((book, idx) => {
          const ou = book.Disposals;
          if (ou?.line && ou.line !== 'N/A' && (ou.over !== 'N/A' || ou.under !== 'N/A')) {
            out.push({ bookIndex: idx, column: 'Disposals', d: ou });
          }
        });
        return out;
      })()
    : [];
  const disposalsAltItems = isDisposals
    ? (() => {
        const out: { bookIndex: number; column: 'DisposalsOver'; d: { line?: string; over?: string } }[] = [];
        books.forEach((book, idx) => {
          const overOnly = book.DisposalsOver;
          if (overOnly?.line && overOnly.line !== 'N/A' && overOnly.over !== 'N/A') {
            out.push({ bookIndex: idx, column: 'DisposalsOver', d: overOnly });
          }
        });
        return out;
      })()
    : [];
  const hasDisposalsDropdown = disposalsOuItems.length > 0 || disposalsAltItems.length > 0;

  // For Goals: flat list so each book can show both Goals Over (e.g. 2.5) and Anytime 0.5; sort by line ascending (0.5 first)
  const goalsDropdownItems = isGoalsOver
    ? (() => {
        const out: { bookIndex: number; line: string; over: string }[] = [];
        books.forEach((book, idx) => {
          for (const { line, over } of getGoalsMarketLines(book)) {
            out.push({ bookIndex: idx, line, over });
          }
        });
        out.sort((a, b) => {
          const na = parseFloat(String(a.line).replace(/[^0-9.-]/g, ''));
          const nb = parseFloat(String(b.line).replace(/[^0-9.-]/g, ''));
          if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
          return 0;
        });
        return out;
      })()
    : [];
  const hasGoalsDropdown = goalsDropdownItems.length > 0;

  const showSkeleton = (books.length === 0 || !hasDisplayableOdds || selectedBookLineMismatch) && !disabled;

  return (
    <div className="relative flex-shrink-0 w-[100px] sm:w-[110px] md:w-[120px]" ref={ref}>
        <button
          type="button"
          onClick={() => !disabled && setIsOpen((o) => !o)}
          disabled={disabled}
          className="w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] sm:h-[36px] overflow-hidden disabled:opacity-60"
        >
          <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
            {showSkeleton ? (
              <div className={`h-4 w-16 rounded animate-pulse flex-shrink-0 ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} />
            ) : bookmakerInfo && selectedBook ? (
              <>
                {bookmakerInfo.logoUrl ? (
                  <img
                    src={bookmakerInfo.logoUrl}
                    alt={bookmakerInfo.name}
                    className="w-6 h-6 sm:w-7 sm:h-7 rounded object-contain flex-shrink-0"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = 'none';
                      const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                      if (fallback) fallback.style.display = 'flex';
                    }}
                  />
                ) : null}
                <span
                  className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo.logoUrl ? 'flex' : 'hidden'}`}
                  style={{ backgroundColor: bookmakerInfo.color }}
                >
                  {bookmakerInfo.logo}
                </span>
                <div className="flex flex-col items-start gap-0.5 min-w-0">
                  {isMoneyline ? (
                    <>
                      <span className="text-[11px] sm:text-xs font-semibold text-gray-900 dark:text-white">ML</span>
                      <span className="text-[10px] sm:text-[11px] text-gray-500 dark:text-gray-400 font-medium whitespace-nowrap truncate max-w-full">
                        {bookmakerInfo.name}
                      </span>
                    </>
                  ) : isYesNo && data ? (
                    <>
                      {(data as { yes?: string }).yes != null && (data as { yes?: string }).yes !== 'N/A' && (
                        <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                          Yes {fmtOdds((data as { yes?: string }).yes!, oddsFormat)}
                        </span>
                      )}
                      {(data as { no?: string }).no != null && (data as { no?: string }).no !== 'N/A' && (
                        <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                          No {fmtOdds((data as { no?: string }).no!, oddsFormat)}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      {(data as { over?: string })?.over != null && (data as { over?: string }).over !== 'N/A' && (
                        <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                          O&nbsp;{fmtOdds((data as { over?: string }).over!, oddsFormat)}
                        </span>
                      )}
                      {(data as { under?: string })?.under != null && (data as { under?: string }).under !== 'N/A' && (
                        <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                          U&nbsp;{fmtOdds((data as { under?: string }).under!, oddsFormat)}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium">Odds</span>
              </div>
            )}
          </div>
          <svg
            className={`w-4 h-4 flex-shrink-0 ml-auto transition-transform ${isOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isOpen && (
          <>
            <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
              <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Select line</div>
              </div>
              <div className="p-2">
                {books.length === 0 ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                    No odds available
                  </div>
                ) : isDisposals && !hasDisposalsDropdown ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                    No odds available
                  </div>
                ) : isDisposals && hasDisposalsDropdown ? (
                  <>
                    {disposalsOuItems.map((item) => {
                      const book = books[item.bookIndex];
                      const d = item.d;
                      const isSelected = item.bookIndex === selectedBookIndex && item.column === selectedDisposalsColumn;
                      const info = getBookmakerInfo(book.name);
                      return (
                        <button
                          key={`${book.name}-${item.bookIndex}-ou`}
                          type="button"
                          onClick={() => {
                            onSelectBookIndex(item.bookIndex);
                            onSelectDisposalsOption?.(item.bookIndex, 'Disposals');
                            setIsOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                            isSelected
                              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                              : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            {info.logoUrl ? (
                              <>
                                <img
                                  src={info.logoUrl}
                                  alt=""
                                  className="w-5 h-5 rounded object-contain flex-shrink-0"
                                  onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                    const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                    if (fallback) fallback.style.display = 'flex';
                                  }}
                                />
                                <span
                                  className="w-5 h-5 rounded flex-shrink-0 hidden items-center justify-center text-[10px] font-semibold text-white"
                                  style={{ backgroundColor: info.color }}
                                >
                                  {info.logo}
                                </span>
                              </>
                            ) : (
                              <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: info.color }}>
                                {info.logo}
                              </span>
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {d?.line != null && d.line !== 'N/A' && (
                                  <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                    {d.line}
                                  </span>
                                )}
                                <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                  {book.name}
                                </span>
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {d?.over != null && d.over !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                O {fmtOdds(d.over, oddsFormat)}
                              </span>
                            )}
                            {d?.under != null && d.under !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                U {fmtOdds(d.under, oddsFormat)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                    {disposalsAltItems.length > 0 && (
                      <>
                        <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                          Alternate
                        </div>
                        {disposalsAltItems.map((item) => {
                          const book = books[item.bookIndex];
                          const d = item.d;
                          const isSelected = item.bookIndex === selectedBookIndex && item.column === selectedDisposalsColumn;
                          const info = getBookmakerInfo(book.name);
                          return (
                            <button
                              key={`${book.name}-${item.bookIndex}-alt`}
                              type="button"
                              onClick={() => {
                                onSelectBookIndex(item.bookIndex);
                                onSelectDisposalsOption?.(item.bookIndex, 'DisposalsOver');
                                setIsOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                                isSelected
                                  ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                {info.logoUrl ? (
                                  <>
                                    <img
                                      src={info.logoUrl}
                                      alt=""
                                      className="w-5 h-5 rounded object-contain flex-shrink-0"
                                      onError={(e) => {
                                        (e.target as HTMLImageElement).style.display = 'none';
                                        const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                        if (fallback) fallback.style.display = 'flex';
                                      }}
                                    />
                                    <span
                                      className="w-5 h-5 rounded flex-shrink-0 hidden items-center justify-center text-[10px] font-semibold text-white"
                                      style={{ backgroundColor: info.color }}
                                    >
                                      {info.logo}
                                    </span>
                                  </>
                                ) : (
                                  <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: info.color }}>
                                    {info.logo}
                                  </span>
                                )}
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    {d?.line != null && d.line !== 'N/A' && (
                                      <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                        {d.line}
                                      </span>
                                    )}
                                    <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                      {book.name}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                {d?.over != null && d.over !== 'N/A' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                    O {fmtOdds(d.over, oddsFormat)}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </>
                    )}
                  </>
                ) : isGoalsOver && !hasGoalsDropdown ? (
                  <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                    No odds available
                  </div>
                ) : isGoalsOver && hasGoalsDropdown ? (
                  goalsDropdownItems.map((item) => {
                    const book = books[item.bookIndex];
                    const isSelected = item.bookIndex === selectedBookIndex && currentLineValue != null && Number.isFinite(currentLineValue) && Math.abs(parseFloat(item.line) - currentLineValue) < 0.01;
                    const info = getBookmakerInfo(book.name);
                    return (
                      <button
                        key={`${book.name}-${item.bookIndex}-${item.line}`}
                        type="button"
                        onClick={() => {
                          onSelectBookIndex(item.bookIndex);
                          const lineNum = parseFloat(item.line);
                          if (Number.isFinite(lineNum)) onSelectGoalsOption?.(item.bookIndex, lineNum);
                          setIsOpen(false);
                        }}
                        className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                          isSelected
                            ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                            : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          {info.logoUrl ? (
                            <>
                              <img
                                src={info.logoUrl}
                                alt=""
                                className="w-5 h-5 rounded object-contain flex-shrink-0"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).style.display = 'none';
                                  const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                  if (fallback) fallback.style.display = 'flex';
                                }}
                              />
                              <span
                                className="w-5 h-5 rounded flex-shrink-0 hidden items-center justify-center text-[10px] font-semibold text-white"
                                style={{ backgroundColor: info.color }}
                              >
                                {info.logo}
                              </span>
                            </>
                          ) : (
                            <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: info.color }}>
                              {info.logo}
                            </span>
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">{item.line}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{book.name}</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                          {item.over !== 'N/A' && (
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                              O {fmtOdds(item.over, oddsFormat)}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                ) : books.map((book, idx) => {
                  const goalsLineOver = isGoalsOver ? getGoalsMarketLineOver(book) : null;
                  const d = isGoalsOver
                    ? (goalsLineOver as { line?: string; over?: string } | undefined)
                    : (key != null ? (book[key] as { home?: string; away?: string; line?: string; over?: string; under?: string; yes?: string; no?: string } | undefined) : undefined);
                  const isSelected = idx === selectedBookIndex;
                  const hasData = d && (isMoneyline ? ((d as { home?: string; away?: string }).home !== 'N/A' || (d as { home?: string; away?: string }).away !== 'N/A') : isYesNo ? ((d as { yes?: string; no?: string }).yes !== 'N/A' || (d as { yes?: string; no?: string }).no !== 'N/A') : (d.line !== 'N/A' || d.over !== 'N/A'));
                  if (!hasData) return null;
                  const displayData = d;
                  const info = getBookmakerInfo(book.name);
                  return (
                    <button
                      key={`${book.name}-${idx}`}
                      type="button"
                      onClick={() => {
                        onSelectBookIndex(idx);
                        setIsOpen(false);
                      }}
                      className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                        isSelected
                          ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                          : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                      }`}
                    >
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {info.logoUrl ? (
                          <>
                            <img
                              src={info.logoUrl}
                              alt=""
                              className="w-5 h-5 rounded object-contain flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                            <span
                              className="w-5 h-5 rounded flex-shrink-0 hidden items-center justify-center text-[10px] font-semibold text-white"
                              style={{ backgroundColor: info.color }}
                            >
                              {info.logo}
                            </span>
                          </>
                        ) : (
                          <span className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white" style={{ backgroundColor: info.color }}>
                            {info.logo}
                          </span>
                        )}
                        <div className="flex-1 min-w-0">
                          {isMoneyline ? (
                            <div className="flex flex-col items-start gap-0.5">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">ML</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-full">
                                {book.name}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              {!isYesNo && displayData?.line != null && displayData.line !== 'N/A' && (
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                  {displayData.line}
                                </span>
                              )}
                              {isYesNo && (
                                <span className="font-semibold text-sm text-gray-900 dark:text-white">Y/N</span>
                              )}
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {book.name}
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {isMoneyline && (d as { home?: string; away?: string }).home != null && (d as { home?: string; away?: string }).away != null && (
                          <>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                              {displayHomeTeam} {fmtOdds((d as { home: string; away: string }).home, oddsFormat)}
                            </span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                              {displayAwayTeam} {fmtOdds((d as { home: string; away: string }).away, oddsFormat)}
                            </span>
                          </>
                        )}
                        {isYesNo && ((d as { yes?: string; no?: string }).yes != null || (d as { yes?: string; no?: string }).no != null) && (
                          <>
                            {(d as { yes?: string }).yes != null && (d as { yes?: string }).yes !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                Yes {fmtOdds((d as { yes: string }).yes, oddsFormat)}
                              </span>
                            )}
                            {(d as { no?: string }).no != null && (d as { no?: string }).no !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                No {fmtOdds((d as { no: string }).no, oddsFormat)}
                              </span>
                            )}
                          </>
                        )}
                        {!isMoneyline && !isYesNo && (
                          <>
                            {displayData?.over != null && displayData.over !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                O {fmtOdds(displayData.over, oddsFormat)}
                              </span>
                            )}
                            {(displayData as { under?: string })?.under != null && (displayData as { under?: string }).under !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                U {fmtOdds((displayData as { under?: string }).under!, oddsFormat)}
                              </span>
                            )}
                          </>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="fixed inset-0 z-40" aria-hidden onClick={() => setIsOpen(false)} />
          </>
        )}
    </div>
  );
}
