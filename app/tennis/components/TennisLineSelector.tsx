'use client';

import { useEffect, useRef, useState } from 'react';
import { americanToDecimal } from '@/lib/currencyUtils';
import { getBookmakerInfo, getBookmakerRegion, type BookmakerRegion } from '@/lib/bookmakers';
import { tennisLastName } from '@/lib/tennis/chartStats';
import {
  isTennisOuStat,
  tennisLineMatches,
  tennisMainLineForStat,
  tennisOuEvenness,
  tennisOuLinesForStat,
  tennisParseLineNumber,
  type TennisBookRow,
  type TennisOuLine,
} from '@/lib/tennis/oddsTypes';

function parseAmerican(s: string): number {
  if (s === 'N/A' || s == null) return NaN;
  const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(v) ? v : NaN;
}

function fmtOdds(americanStr: string, format: 'american' | 'decimal'): string {
  const am = parseAmerican(americanStr);
  if (Number.isNaN(am)) return 'N/A';
  if (format === 'decimal') {
    return americanToDecimal(am).toFixed(2);
  }
  return am > 0 ? `+${am}` : String(am);
}

const REGION_ORDER: BookmakerRegion[] = ['us', 'au', 'uk', 'other'];
const REGION_LABEL: Record<BookmakerRegion, string> = {
  us: 'United States',
  au: 'Australia',
  uk: 'United Kingdom',
  other: 'Other',
};
const REGION_FLAG: Record<BookmakerRegion, string> = {
  us: '🇺🇸',
  au: '🇦🇺',
  uk: '🇬🇧',
  other: '🌍',
};

function bookRegion(book: TennisBookRow): BookmakerRegion {
  return book.region ?? getBookmakerRegion(book.name);
}

function groupByRegion<T>(items: T[], bookOf: (item: T) => TennisBookRow): { region: BookmakerRegion; items: T[] }[] {
  const buckets: Record<BookmakerRegion, T[]> = { us: [], au: [], uk: [], other: [] };
  for (const item of items) buckets[bookRegion(bookOf(item))].push(item);
  return REGION_ORDER.filter((region) => buckets[region].length).map((region) => ({
    region,
    items: buckets[region],
  }));
}

function RegionHeader({ region, isFirst }: { region: BookmakerRegion; isFirst: boolean }) {
  return (
    <div
      className={`sticky top-0 z-10 px-2 py-1.5 bg-white dark:bg-[#0a1929] ${isFirst ? '' : 'mt-1'}`}
    >
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span aria-hidden>{REGION_FLAG[region]}</span>
        <span>{REGION_LABEL[region]}</span>
      </div>
    </div>
  );
}

interface TennisLineSelectorProps {
  books: TennisBookRow[];
  selectedStat: string;
  selectedBookIndex: number;
  onSelectBookIndex: (index: number) => void;
  oddsFormat: 'american' | 'decimal';
  isDark: boolean;
  homeTeam: string;
  awayTeam: string;
  disabled?: boolean;
  currentLineValue?: number | null;
  onSelectLineValue?: (lineValue: number) => void;
}

export function TennisLineSelector({
  books,
  selectedStat,
  selectedBookIndex,
  onSelectBookIndex,
  oddsFormat,
  isDark,
  homeTeam,
  awayTeam,
  disabled = false,
  currentLineValue = null,
  onSelectLineValue,
}: TennisLineSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isMoneyline = selectedStat === 'moneyline';
  const isOu = isTennisOuStat(selectedStat);
  const selectedBook = books[selectedBookIndex];
  const ouLines = tennisOuLinesForStat(selectedBook, selectedStat);
  const mainOu = tennisMainLineForStat(selectedBook, selectedStat);
  const displayOu: TennisOuLine | undefined =
    currentLineValue != null && Number.isFinite(currentLineValue)
      ? ouLines.find((row) => tennisLineMatches(row.line, currentLineValue)) ?? mainOu ?? ouLines[0]
      : mainOu ?? ouLines[0];
  const data = isMoneyline ? selectedBook?.H2H : displayOu;
  const bookmakerInfo = selectedBook ? getBookmakerInfo(selectedBook.name) : null;
  const displayHomeTeam = tennisLastName(homeTeam) || homeTeam;
  const displayAwayTeam = tennisLastName(awayTeam) || awayTeam;

  const hasDisplayableOdds = isMoneyline
    ? Boolean(
        books.length &&
          data &&
          (data as { home?: string }).home !== 'N/A' &&
          (data as { away?: string }).away !== 'N/A'
      )
    : Boolean(displayOu && (displayOu.over !== 'N/A' || displayOu.under !== 'N/A'));

  const selectedBookLineMismatch =
    isOu &&
    currentLineValue != null &&
    Number.isFinite(currentLineValue) &&
    !ouLines.some((row) => tennisLineMatches(row.line, currentLineValue));

  const showSkeleton = (books.length === 0 || !hasDisplayableOdds || selectedBookLineMismatch) && !disabled;

  const ouDropdownItems = isOu
    ? books.flatMap((book, bookIndex) =>
        tennisOuLinesForStat(book, selectedStat).map((d) => ({ bookIndex, d }))
      ).sort((a, b) => {
        const even = tennisOuEvenness(a.d) - tennisOuEvenness(b.d);
        if (even !== 0) return even;
        const na = parseFloat(a.d.line);
        const nb = parseFloat(b.d.line);
        if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
        return a.bookIndex - b.bookIndex;
      })
    : [];

  const moneylineItems = isOu
    ? []
    : books
        .map((book, bookIndex) => ({ book, bookIndex }))
        .filter(({ book }) => book.H2H && (book.H2H.home !== 'N/A' || book.H2H.away !== 'N/A'));
  const moneylineGroups = groupByRegion(moneylineItems, (item) => item.book);
  const ouGroups = groupByRegion(ouDropdownItems, (item) => books[item.bookIndex]);

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
                    {selectedBook?.H2H?.home != null && selectedBook.H2H.home !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-blue-600 dark:text-blue-400 font-mono whitespace-nowrap">
                        {fmtOdds(selectedBook.H2H.home, oddsFormat)}
                      </span>
                    )}
                    {selectedBook?.H2H?.away != null && selectedBook.H2H.away !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-orange-600 dark:text-orange-400 font-mono whitespace-nowrap">
                        {fmtOdds(selectedBook.H2H.away, oddsFormat)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {displayOu?.over != null && displayOu.over !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                        O&nbsp;{fmtOdds(displayOu.over, oddsFormat)}
                      </span>
                    )}
                    {displayOu?.under != null && displayOu.under !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                        U&nbsp;{fmtOdds(displayOu.under, oddsFormat)}
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
          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[340px] w-[min(420px,calc(100vw-2rem))] max-h-[400px] overflow-y-auto">
            <div className="p-3 border-b border-gray-200 dark:border-gray-600">
              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Select line</div>
            </div>
            <div className="p-2">
              {books.length === 0 || (!isMoneyline && ouDropdownItems.length === 0) ? (
                <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                  No odds available
                </div>
              ) : isOu ? (
                ouGroups.map((group, groupIndex) => (
                  <div key={group.region}>
                    <RegionHeader region={group.region} isFirst={groupIndex === 0} />
                    {group.items.map((item) => {
                      const book = books[item.bookIndex];
                      const d = item.d;
                      const isSelected =
                        item.bookIndex === selectedBookIndex &&
                        tennisLineMatches(d.line, currentLineValue ?? tennisParseLineNumber(displayOu?.line));
                      const info = getBookmakerInfo(book.name);
                      return (
                        <button
                          key={`${book.name}-${item.bookIndex}-${d.line}`}
                          type="button"
                          onClick={() => {
                            onSelectBookIndex(item.bookIndex);
                            const n = parseFloat(d.line);
                            if (Number.isFinite(n)) onSelectLineValue?.(n);
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
                              <span
                                className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white"
                                style={{ backgroundColor: info.color }}
                              >
                                {info.logo}
                              </span>
                            )}
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">{d.line}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">{book.name}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {d.over !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                O {fmtOdds(d.over, oddsFormat)}
                              </span>
                            )}
                            {d.under !== 'N/A' && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                U {fmtOdds(d.under, oddsFormat)}
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              ) : (
                moneylineGroups.map((group, groupIndex) => (
                  <div key={group.region}>
                    <RegionHeader region={group.region} isFirst={groupIndex === 0} />
                    {group.items.map(({ book, bookIndex }) => {
                      const d = book.H2H;
                      const isSelected = bookIndex === selectedBookIndex;
                      const info = getBookmakerInfo(book.name);
                      return (
                        <button
                          key={`${book.name}-${bookIndex}`}
                          type="button"
                          onClick={() => {
                            onSelectBookIndex(bookIndex);
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
                              <span
                                className="w-5 h-5 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-semibold text-white"
                                style={{ backgroundColor: info.color }}
                              >
                                {info.logo}
                              </span>
                            )}
                            <div className="flex flex-col items-start gap-0.5 min-w-0">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">ML</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-full">{book.name}</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {d.home != null && d.away != null && (
                              <>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                  {displayHomeTeam} {fmtOdds(d.home, oddsFormat)}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                                  {displayAwayTeam} {fmtOdds(d.away, oddsFormat)}
                                </span>
                              </>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="fixed inset-0 z-40" aria-hidden onClick={() => setIsOpen(false)} />
        </>
      )}
    </div>
  );
}
