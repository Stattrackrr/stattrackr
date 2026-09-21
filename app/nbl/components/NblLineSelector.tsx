'use client';

import { useEffect, useRef, useState } from 'react';
import { americanToDecimal } from '@/lib/currencyUtils';
import BookmakerLogo from '@/app/components/BookmakerLogo';
import { getBookmakerInfo, getBookmakerRegion, type BookmakerRegion } from '@/lib/bookmakers';
import {
  nblBookLines,
  nblH2hMeetsMinOdds,
  nblLineMatchingValue,
  nblOuHasOdds,
  parseNblOddsLine,
  type NblBookRow,
  type NblOddsMarket,
  type NblPropLine,
} from '@/lib/nbl/oddsTypes';

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

function bookRegion(book: NblBookRow): BookmakerRegion {
  return getBookmakerRegion(book.name);
}

function groupByRegion<T>(items: T[], bookOf: (item: T) => NblBookRow): { region: BookmakerRegion; items: T[] }[] {
  const buckets: Record<BookmakerRegion, T[]> = { us: [], au: [], uk: [], other: [] };
  for (const item of items) buckets[bookRegion(bookOf(item))].push(item);
  return REGION_ORDER.filter((region) => buckets[region].length).map((region) => ({
    region,
    items: buckets[region],
  }));
}

function RegionHeader({ region, isFirst }: { region: BookmakerRegion; isFirst: boolean }) {
  return (
    <div className={`sticky top-0 z-10 px-2 py-1.5 bg-white dark:bg-[#0a1929] ${isFirst ? '' : 'mt-1'}`}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <span aria-hidden>{REGION_FLAG[region]}</span>
        <span>{REGION_LABEL[region]}</span>
      </div>
    </div>
  );
}

function ouEvenness(over: string, under: string): number {
  const o = Math.abs(parseAmerican(over));
  const u = Math.abs(parseAmerican(under));
  if (!Number.isFinite(o) || !Number.isFinite(u)) return Number.POSITIVE_INFINITY;
  return Math.abs(o - u);
}

interface NblLineSelectorProps {
  books: NblBookRow[];
  market: NblOddsMarket | null;
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

export function NblLineSelector({
  books,
  market,
  selectedBookIndex,
  onSelectBookIndex,
  oddsFormat,
  isDark,
  homeTeam,
  awayTeam,
  disabled = false,
  currentLineValue = null,
  onSelectLineValue,
}: NblLineSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const isMoneyline = market === 'h2h';
  const isOu = market === 'spread' || market === 'total';
  const selectedBook = books[selectedBookIndex];
  const selectedLine: NblPropLine | undefined = isOu
    ? market === 'spread'
      ? nblOuHasOdds(selectedBook?.Spread)
        ? { ...selectedBook.Spread, kind: 'ou', label: selectedBook.Spread.line }
        : undefined
      : nblLineMatchingValue(selectedBook, currentLineValue)
    : undefined;
  const ouRow = selectedLine;
  const bookmakerInfo = selectedBook ? getBookmakerInfo(selectedBook.name) : null;
  const isMilestone = selectedLine?.kind === 'milestone';

  const hasDisplayableOdds = isMoneyline
    ? Boolean(books.length && nblH2hMeetsMinOdds(selectedBook?.H2H))
    : Boolean(ouRow && nblOuHasOdds(ouRow));

  const showSkeleton = !disabled && market != null && (books.length === 0 || !hasDisplayableOdds);

  const ouDropdownItems = isOu && market === 'spread'
    ? books
        .map((book, bookIndex) => ({
          bookIndex,
          book,
          d: { ...book.Spread, kind: 'ou' as const, label: book.Spread.line },
        }))
        .filter((item) => nblOuHasOdds(item.d))
        .sort((a, b) => {
          const even = ouEvenness(a.d.over, a.d.under) - ouEvenness(b.d.over, b.d.under);
          if (even !== 0) return even;
          const na = parseNblOddsLine(a.d.line);
          const nb = parseNblOddsLine(b.d.line);
          if (na != null && nb != null && na !== nb) return nb - na;
          return a.bookIndex - b.bookIndex;
        })
    : [];

  const playerLineItems =
    isOu && market === 'total'
      ? books.flatMap((book, bookIndex) =>
          nblBookLines(book).map((d) => ({ bookIndex, book, d }))
        )
      : [];
  const playerOuItems = playerLineItems
    .filter((item) => item.d.kind !== 'milestone')
    .sort((a, b) => {
      const even = ouEvenness(a.d.over, a.d.under) - ouEvenness(b.d.over, b.d.under);
      if (even !== 0) return even;
      const na = parseNblOddsLine(a.d.line);
      const nb = parseNblOddsLine(b.d.line);
      if (na != null && nb != null && na !== nb) return nb - na;
      return a.bookIndex - b.bookIndex;
    });
  const playerMilestoneItems = playerLineItems
    .filter((item) => item.d.kind === 'milestone')
    .sort((a, b) => (parseNblOddsLine(a.d.line) ?? 0) - (parseNblOddsLine(b.d.line) ?? 0));

  const moneylineItems = isMoneyline
    ? books.map((book, bookIndex) => ({ book, bookIndex })).filter(({ book }) => nblH2hMeetsMinOdds(book.H2H))
    : [];
  const moneylineGroups = groupByRegion(moneylineItems, (item) => item.book);
  const ouGroups = groupByRegion(market === 'total' ? playerOuItems : ouDropdownItems, (item) => item.book);
  const milestoneGroups = groupByRegion(playerMilestoneItems, (item) => item.book);

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
              <BookmakerLogo
                bookKey={selectedBook.name}
                alt={bookmakerInfo.name}
                className="w-6 h-6 sm:w-7 sm:h-7 rounded object-contain flex-shrink-0"
              />
              <div className="flex flex-col items-start gap-0.5 min-w-0">
                {isMoneyline ? (
                  <>
                    {selectedBook.H2H.home !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-blue-600 dark:text-blue-400 font-mono whitespace-nowrap">
                        {fmtOdds(selectedBook.H2H.home, oddsFormat)}
                      </span>
                    )}
                    {selectedBook.H2H.away !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-orange-600 dark:text-orange-400 font-mono whitespace-nowrap">
                        {fmtOdds(selectedBook.H2H.away, oddsFormat)}
                      </span>
                    )}
                  </>
                ) : isMilestone ? (
                  <>
                    <span className="text-[11px] sm:text-xs text-gray-900 dark:text-white font-semibold whitespace-nowrap">
                      {selectedLine?.label}
                    </span>
                    {ouRow?.over != null && ouRow.over !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                        {fmtOdds(ouRow.over, oddsFormat)}
                      </span>
                    )}
                  </>
                ) : (
                  <>
                    {ouRow?.over != null && ouRow.over !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                        O&nbsp;{fmtOdds(ouRow.over, oddsFormat)}
                      </span>
                    )}
                    {ouRow?.under != null && ouRow.under !== 'N/A' && (
                      <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                        U&nbsp;{fmtOdds(ouRow.under, oddsFormat)}
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
              {!market ||
              books.length === 0 ||
              (isOu &&
                (market === 'total' ? playerLineItems.length === 0 : ouDropdownItems.length === 0)) ||
              (isMoneyline && moneylineItems.length === 0) ? (
                <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                  No odds available
                </div>
              ) : isOu ? (
                <>
                {ouGroups.map((group, groupIndex) => (
                  <div key={group.region}>
                    <RegionHeader region={group.region} isFirst={groupIndex === 0} />
                    {group.items.map((item) => {
                      const book = item.book;
                      const d = item.d;
                      const lineN = parseNblOddsLine(d.line);
                      const isSelected =
                        item.bookIndex === selectedBookIndex &&
                        (currentLineValue == null ||
                          lineN == null ||
                          Math.abs(lineN - currentLineValue) < 0.01);
                      return (
                        <button
                          key={`${book.name}-${item.bookIndex}-${d.line}`}
                          type="button"
                          onClick={() => {
                            onSelectBookIndex(item.bookIndex);
                            if (lineN != null) onSelectLineValue?.(lineN);
                            setIsOpen(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                            isSelected
                              ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                              : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                          }`}
                        >
                          <div className="flex items-center gap-2 flex-1 min-w-0">
                            <BookmakerLogo bookKey={book.name} className="w-5 h-5 rounded object-contain flex-shrink-0" />
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">{d.label ?? d.line}</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                {getBookmakerInfo(book.name).name}
                              </span>
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
                ))}
                {milestoneGroups.length > 0 && (
                  <>
                    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                      Milestones
                    </div>
                    {milestoneGroups.map((group) => (
                      <div key={`ms-${group.region}`}>
                        {group.items.map((item) => {
                          const book = item.book;
                          const d = item.d;
                          const lineN = parseNblOddsLine(d.line);
                          const isSelected =
                            item.bookIndex === selectedBookIndex &&
                            currentLineValue != null &&
                            lineN != null &&
                            Math.abs(lineN - currentLineValue) < 0.01;
                          return (
                            <button
                              key={`${book.name}-${item.bookIndex}-ms-${d.label}`}
                              type="button"
                              onClick={() => {
                                onSelectBookIndex(item.bookIndex);
                                if (lineN != null) onSelectLineValue?.(lineN);
                                setIsOpen(false);
                              }}
                              className={`w-full text-left px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between transition-colors border ${
                                isSelected
                                  ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 text-purple-800 dark:text-purple-200'
                                  : 'border-transparent hover:bg-gray-50 dark:hover:bg-gray-700/50 text-gray-900 dark:text-gray-200'
                              }`}
                            >
                              <div className="flex items-center gap-2 flex-1 min-w-0">
                                <BookmakerLogo bookKey={book.name} className="w-5 h-5 rounded object-contain flex-shrink-0" />
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="font-semibold text-sm text-gray-900 dark:text-white">{d.label}</span>
                                  <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                    {getBookmakerInfo(book.name).name}
                                  </span>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                                {d.over !== 'N/A' && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400">
                                    {fmtOdds(d.over, oddsFormat)}
                                  </span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </>
                )}
                </>
              ) : (
                moneylineGroups.map((group, groupIndex) => (
                  <div key={group.region}>
                    <RegionHeader region={group.region} isFirst={groupIndex === 0} />
                    {group.items.map(({ book, bookIndex }) => {
                      const d = book.H2H;
                      const isSelected = bookIndex === selectedBookIndex;
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
                            <BookmakerLogo bookKey={book.name} className="w-5 h-5 rounded object-contain flex-shrink-0" />
                            <div className="flex flex-col items-start gap-0.5 min-w-0">
                              <span className="font-semibold text-sm text-gray-900 dark:text-white">ML</span>
                              <span className="text-xs text-gray-500 dark:text-gray-400 truncate max-w-full">
                                {getBookmakerInfo(book.name).name}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                            {d.home != null && d.away != null && (
                              <>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400">
                                  {homeTeam} {fmtOdds(d.home, oddsFormat)}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400">
                                  {awayTeam} {fmtOdds(d.away, oddsFormat)}
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
