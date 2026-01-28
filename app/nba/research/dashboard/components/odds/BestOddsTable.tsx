'use client';

import { memo, useState, useEffect, useMemo } from 'react';
import { mergeBookRowsByBaseName } from '../../utils';
import { getTeamAbbr } from '@/lib/teamMapping';

// Placeholder book rows for when no real odds data is available
const PLACEHOLDER_BOOK_ROWS: any[] = [
  {
    name: 'DraftKings',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    DD: { yes: 'N/A', no: 'N/A' },
    TD: { yes: 'N/A', no: 'N/A' },
  },
  {
    name: 'FanDuel',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    DD: { yes: 'N/A', no: 'N/A' },
    TD: { yes: 'N/A', no: 'N/A' },
  },
  {
    name: 'BetMGM',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    DD: { yes: 'N/A', no: 'N/A' },
    TD: { yes: 'N/A', no: 'N/A' },
  },
  {
    name: 'Caesars',
    H2H: { home: 'N/A', away: 'N/A' },
    Spread: { line: 'N/A', over: 'N/A', under: 'N/A' },
    Total: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PTS: { line: 'N/A', over: 'N/A', under: 'N/A' },
    REB: { line: 'N/A', over: 'N/A', under: 'N/A' },
    AST: { line: 'N/A', over: 'N/A', under: 'N/A' },
    THREES: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PRA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PR: { line: 'N/A', over: 'N/A', under: 'N/A' },
    PA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    RA: { line: 'N/A', over: 'N/A', under: 'N/A' },
    DD: { yes: 'N/A', no: 'N/A' },
    TD: { yes: 'N/A', no: 'N/A' },
  },
];

// Optimized clone function - replaces expensive JSON.parse(JSON.stringify())
// Performs shallow clone with nested object cloning for BookRow structure
function cloneBookRow(book: any): any {
  const clone: any = { ...book };
  // Clone nested objects (H2H, Spread, Total, etc.)
  if (book.H2H) clone.H2H = { ...book.H2H };
  if (book.Spread) clone.Spread = { ...book.Spread };
  if (book.Total) clone.Total = { ...book.Total };
  if (book.PTS) clone.PTS = { ...book.PTS };
  if (book.REB) clone.REB = { ...book.REB };
  if (book.AST) clone.AST = { ...book.AST };
  if (book.THREES) clone.THREES = { ...book.THREES };
  if (book.PRA) clone.PRA = { ...book.PRA };
  if (book.PR) clone.PR = { ...book.PR };
  if (book.PA) clone.PA = { ...book.PA };
  if (book.RA) clone.RA = { ...book.RA };
  if (book.BLK) clone.BLK = { ...book.BLK };
  if (book.STL) clone.STL = { ...book.STL };
  if (book.TO) clone.TO = { ...book.TO };
  if (book.DD) clone.DD = { ...book.DD };
  if (book.TD) clone.TD = { ...book.TD };
  if (book.FIRST_BASKET) clone.FIRST_BASKET = { ...book.FIRST_BASKET };
  // Clone metadata if present
  if (book.meta) clone.meta = { ...book.meta };
  // Clone any other nested objects
  for (const key in book) {
    if (book[key] && typeof book[key] === 'object' && !Array.isArray(book[key]) && 
        !clone[key] && key !== 'meta' && 
        !['H2H', 'Spread', 'Total', 'PTS', 'REB', 'AST', 'THREES', 'PRA', 'PR', 'PA', 'RA', 'BLK', 'STL', 'TO', 'DD', 'TD', 'FIRST_BASKET'].includes(key)) {
      clone[key] = { ...book[key] };
    }
  }
  return clone;
}

export const BestOddsTable = memo(function BestOddsTable({
  isDark,
  oddsLoading,
  oddsError,
  realOddsData,
  selectedTeam,
  gamePropsTeam,
  propsMode,
  opponentTeam,
  oddsFormat,
  fmtOdds,
  playerId,
  selectedStat
}: {
  isDark: boolean;
  oddsLoading: boolean;
  oddsError: string | null;
  realOddsData: any[];
  selectedTeam: string;
  gamePropsTeam: string;
  propsMode: 'player' | 'team';
  opponentTeam: string;
  oddsFormat: string;
  fmtOdds: (odds: string) => string;
  playerId?: string | number | null;
  selectedStat?: string;
}) {
  const [mounted, setMounted] = useState(false);
  
  useEffect(() => {
    setMounted(true);
  }, []);
  
  // Map selectedStat to API format
  const statTypeMap: Record<string, string> = {
    'pts': 'PTS',
    'reb': 'REB',
    'ast': 'AST',
    'fg3m': 'THREES',
    'fgm': 'FGM',
    'fga': 'FGA',
    'ftm': 'FTM',
    'fta': 'FTA',
    'oreb': 'OREB',
    'dreb': 'DREB',
    'double_double': 'Double Double',
    'triple_double': 'Triple Double',
    'to': 'TO',
    'pf': 'PF',
    'stl': 'STL',
    'blk': 'BLK',
    'pra': 'PRA',
    'pr': 'PR',
    'pa': 'PA',
    'ra': 'RA',
  };
  const statType = selectedStat ? (statTypeMap[selectedStat.toLowerCase()] || selectedStat.toUpperCase()) : 'PTS';

  const home = (propsMode === 'team' ? gamePropsTeam : selectedTeam) || 'HOME';
  const away = opponentTeam || 'AWAY';
  const hasRealOdds = realOddsData.length > 0;
  
  // Helper to normalize team abbreviations for matching
  const normalizeAbbrForMatch = (abbr: string) => abbr?.toUpperCase().trim() || '';
  
  const books = useMemo(
    () => {
      const merged = mergeBookRowsByBaseName(hasRealOdds ? realOddsData : PLACEHOLDER_BOOK_ROWS, !hasRealOdds);
      // Show all vendors from BDL (no filtering)
      const filtered = merged;
      
      // If selected team is away, flip spread and swap odds for team mode
      if (propsMode === 'team' && filtered.length > 0) {
        const firstBook = filtered[0] as any;
        const gameHomeTeam = firstBook?.meta?.gameHomeTeam;
        const gameAwayTeam = firstBook?.meta?.gameAwayTeam;
        const selectedTeamAbbr = gamePropsTeam;
        
        if (gameHomeTeam && gameAwayTeam && selectedTeamAbbr) {
          // Convert team names to abbreviations for comparison
          const gameHomeAbbr = getTeamAbbr(gameHomeTeam);
          const gameAwayAbbr = getTeamAbbr(gameAwayTeam);
          const isAway = normalizeAbbrForMatch(gameAwayAbbr) === normalizeAbbrForMatch(selectedTeamAbbr);
          
          if (isAway) {
            // Flip spread sign and swap over/under odds, swap H2H odds
            return filtered.map((book: any) => {
              const flipped = cloneBookRow(book);
              
              // Flip spread: if home is -8.5, away should be +8.5
              if (flipped.Spread && flipped.Spread.line !== 'N/A') {
                const lineVal = parseFloat(String(flipped.Spread.line).replace(/[^0-9.+-]/g, ''));
                if (!Number.isNaN(lineVal)) {
                  flipped.Spread.line = String(-lineVal); // Flip sign
                  // Swap over/under odds
                  const tempOver = flipped.Spread.over;
                  flipped.Spread.over = flipped.Spread.under;
                  flipped.Spread.under = tempOver;
                }
              }
              
              // Swap H2H odds (home becomes away, away becomes home)
              if (flipped.H2H) {
                const tempHome = flipped.H2H.home;
                flipped.H2H.home = flipped.H2H.away;
                flipped.H2H.away = tempHome;
              }
              
              return flipped;
            });
          }
        }
      }
      
      return filtered;
    },
    [hasRealOdds, realOddsData, propsMode, gamePropsTeam]
  );

  const americanToNumber = (s: string) => {
    if (s === 'N/A') return 0;
    return parseInt(s.replace(/[^+\-\d]/g, ''), 10);
  };
  
  // Convert American odds to a comparable value where higher = better
  const oddsToComparable = (s: string) => {
    if (s === 'N/A') return -Infinity;
    const american = americanToNumber(s);
    // For negative odds (favorites): -110 is better than -150 (less risk)
    // For positive odds (underdogs): +150 is better than +110 (more payout)
    // To make both comparable: convert to decimal-like value
    if (american < 0) {
      return 100 / Math.abs(american); // -110 -> ~0.909, -150 -> ~0.667
    } else if (american > 0) {
      return 1 + american / 100; // +150 -> 2.5, +110 -> 2.1
    }
    return 0;
  };
  
  // Helper to get PrizePicks variant label or formatted odds
  const getOddsDisplay = (row: any, statKey: string, oddsValue: string) => {
    const meta = (row as any)?.meta;
    const baseName = (meta?.baseName || row?.name || '').toLowerCase();
    const isPrizePicks = baseName.includes('prizepicks');
    const isPickem = meta?.isPickem ?? false;
    const variantLabel = meta?.variantLabel;
    const stat = meta?.stat;
    
    // If this is PrizePicks pick'em for the matching stat, show variant label
    if (isPrizePicks && isPickem && stat === statKey && variantLabel) {
      return variantLabel; // "Goblin" or "Demon"
    }
    
    // Otherwise show formatted odds
    return fmtOdds(oddsValue);
  };
  
  const displayHalfLine = (s: string) => {
    if (s === 'N/A') return 'N/A';
    const v = parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
    if (Number.isNaN(v)) return s;
    const frac = Math.abs(v * 10) % 10;
    if (frac === 0) {
      const adj = v > 0 ? v - 0.5 : v + 0.5;
      return adj.toFixed(1);
    }
    return Number.isFinite(v) ? v.toFixed(1) : s;
  };

  const maxIdx = (get: (b: any) => string) => {
    let bi = 0;
    for (let i = 1; i < books.length; i++) {
      if (americanToNumber(get(books[i])) > americanToNumber(get(books[bi]))) bi = i;
    }
    return bi;
  };

  const parseLine = (s: string) => {
    if (s === 'N/A') return NaN;
    return parseFloat(String(s).replace(/[^0-9.+-]/g, ''));
  };
  const pickBest = (
    preferLowLine: boolean,
    getLine: (b: any) => string,
    getOdds: (b: any) => string,
  ) => {
    let bestLine = preferLowLine ? Infinity : -Infinity;
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (Number.isNaN(v)) continue;
      if (preferLowLine ? v < bestLine : v > bestLine) bestLine = v;
    }
    const EPS = 1e-6;
    const candIdx: number[] = [];
    for (let i = 0; i < books.length; i++) {
      const v = parseLine(getLine(books[i]));
      if (!Number.isNaN(v) && Math.abs(v - bestLine) < EPS) candIdx.push(i);
    }
    if (candIdx.length <= 1) return new Set(candIdx);
    let maxOdds = -Infinity;
    let bestIdx = candIdx[0];
    for (const i of candIdx) {
      const o = americanToNumber(getOdds(books[i]));
      if (o > maxOdds) {
        maxOdds = o;
        bestIdx = i;
      }
    }
    return new Set([bestIdx]);
  };

  const bestH2H = {
    home: maxIdx((b: any) => b.H2H.home),
    away: maxIdx((b: any) => b.H2H.away),
  } as const;

  // For Spread: - display wants max line (closest to 0), + display wants min line (farthest from 0)
  const pickBestSpreadForPositive = () => {
    return pickBest(true, (b: any) => b.Spread.line, (b: any) => b.Spread.over); // min line for + display
  };
  
  const pickBestSpreadForNegative = () => {
    return pickBest(false, (b: any) => b.Spread.line, (b: any) => b.Spread.under); // max line for - display
  };

  const bestSets = {
    Spread: {
      positive: pickBestSpreadForPositive(),  // + display: min line (e.g., -8.5 shown as +8.5)
      negative: pickBestSpreadForNegative(),  // - display: max line (e.g., -7.5 shown as -7.5)
    },
    Total: {
      over: pickBest(true, (b: any) => b.Total.line, (b: any) => b.Total.over),
      under: pickBest(false, (b: any) => b.Total.line, (b: any) => b.Total.under),
    },
    PTS: {
      over: pickBest(true, (b: any) => b.PTS.line, (b: any) => b.PTS.over),
      under: pickBest(false, (b: any) => b.PTS.line, (b: any) => b.PTS.under),
    },
    REB: {
      over: pickBest(true, (b: any) => b.REB.line, (b: any) => b.REB.over),
      under: pickBest(false, (b: any) => b.REB.line, (b: any) => b.REB.under),
    },
    AST: {
      over: pickBest(true, (b: any) => b.AST.line, (b: any) => b.AST.over),
      under: pickBest(false, (b: any) => b.AST.line, (b: any) => b.AST.under),
    },
    THREES: {
      over: pickBest(true, (b: any) => b.THREES?.line, (b: any) => b.THREES?.over),
      under: pickBest(false, (b: any) => b.THREES?.line, (b: any) => b.THREES?.under),
    },
    PRA: {
      over: pickBest(true, (b: any) => b.PRA?.line, (b: any) => b.PRA?.over),
      under: pickBest(false, (b: any) => b.PRA?.line, (b: any) => b.PRA?.under),
    },
    PR: {
      over: pickBest(true, (b: any) => b.PR?.line, (b: any) => b.PR?.over),
      under: pickBest(false, (b: any) => b.PR?.line, (b: any) => b.PR?.under),
    },
    PA: {
      over: pickBest(true, (b: any) => b.PA?.line, (b: any) => b.PA?.over),
      under: pickBest(false, (b: any) => b.PA?.line, (b: any) => b.PA?.under),
    },
    RA: {
      over: pickBest(true, (b: any) => b.RA?.line, (b: any) => b.RA?.over),
      under: pickBest(false, (b: any) => b.RA?.line, (b: any) => b.RA?.under),
    },
  } as const;

  const green = mounted && isDark ? 'text-green-400' : 'text-green-600';
  const grey = mounted && isDark ? 'text-slate-300' : 'text-slate-600';

  // Different markets for player vs team mode
  const markets = propsMode === 'player' 
    ? ['PTS','REB','AST','3PT','P+R+A','P+R','P+A','R+A']
    : ['H2H','Spread','Total'];

  return (
    <div className="lg:hidden bg-white dark:bg-[#0a1929] rounded-lg shadow-sm p-3 md:p-4 border border-gray-200 dark:border-gray-700">
      {/* Header */}
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Best Odds</h3>
      </div>
      
      {oddsError && (
        <div className="text-xs text-red-500 mb-2">Error: {oddsError}</div>
      )}
      
      {oddsLoading ? (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className={(mounted && isDark ? 'bg-[#0a1929]' : 'bg-slate-100') + ' sticky top-0'}>
                <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
                {markets.map((market) => (
                  <th key={market} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{market}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...Array(4)].map((_, idx) => (
                <tr key={idx} className={(mounted && isDark ? 'border-slate-700' : 'border-slate-200') + ' border-b'}>
                  <td className="py-2 pr-3">
                    <div className={`h-4 w-20 rounded animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                  </td>
                  {markets.map((market, marketIdx) => (
                    <td key={market} className="py-2 px-3">
                      <div className={`h-4 w-16 rounded animate-pulse ${mounted && isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1 + marketIdx * 0.05}s` }}></div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-xs border-collapse">
            <thead>
              <tr className={(mounted && isDark ? 'bg-[#0a1929]' : 'bg-slate-100') + ' sticky top-0'}>
                <th className="text-left py-2 pr-3 font-semibold text-gray-700 dark:text-gray-300">Bookmaker</th>
                {markets.map((market) => (
                  <th key={market} className="text-left py-2 px-3 font-semibold text-gray-700 dark:text-gray-300 whitespace-nowrap">{market}</th>
                ))}
              </tr>
            </thead>
            <tbody>
          {books.map((row: any, i: number) => (
            <tr key={`${row.name}-${i}`} className={mounted && isDark ? 'border-b border-slate-700' : 'border-b border-slate-200'}>
              <td className="py-2 pr-3 text-gray-700 dark:text-gray-300 whitespace-nowrap">{row.name}</td>
              
              {/* Team mode: show H2H, Spread, Total */}
              {propsMode === 'team' && (
                <>
              <td className="py-2 px-3">
                <div className="font-mono text-gray-900 dark:text-white whitespace-nowrap">
{home} <span className={i === bestH2H.home ? green : grey}>{fmtOdds(row.H2H.home)}</span>
                </div>
                <div className="font-mono text-gray-900 dark:text-white opacity-80 whitespace-nowrap">
{away} <span className={i === bestH2H.away ? green : grey}>{fmtOdds(row.H2H.away)}</span>
                </div>
              </td>
              <td className="py-2 px-3">
                {(() => {
                  const lineVal = parseLine(row.Spread.line);
                  if (row.Spread.line === 'N/A' || Number.isNaN(lineVal)) {
                    return (
                      <>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          + N/A ({fmtOdds(row.Spread.over)})
                        </div>
                        <div className={`font-mono whitespace-nowrap ${grey}`}>
                          - N/A ({fmtOdds(row.Spread.under)})
                        </div>
                      </>
                    );
                  }
                  // Display both + and - with the same line value
                  const absLineVal = Math.abs(lineVal);
                  return (
                    <>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.positive.has(i) ? green : grey}`}>
                        + {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.over)})
                      </div>
                      <div className={`font-mono whitespace-nowrap ${bestSets.Spread.negative.has(i) ? green : grey}`}>
                        - {displayHalfLine(String(absLineVal))} ({fmtOdds(row.Spread.under)})
                      </div>
                    </>
                  );
                })()}
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.Total.over.has(i) ? green : grey}`}>O {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.Total.under.has(i) ? green : grey}`}>U {displayHalfLine(row.Total.line)} ({fmtOdds(row.Total.under)})</div>
              </td>
                </>
              )}
              
              {/* Player mode: show player props */}
              {propsMode === 'player' && (
                <>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PTS.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PTS.line)} ({getOddsDisplay(row, 'PTS', row.PTS.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.REB.over.has(i) ? green : grey}`}>O {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.REB.under.has(i) ? green : grey}`}>U {displayHalfLine(row.REB.line)} ({getOddsDisplay(row, 'REB', row.REB.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.AST.over.has(i) ? green : grey}`}>O {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.over)})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.AST.under.has(i) ? green : grey}`}>U {displayHalfLine(row.AST.line)} ({getOddsDisplay(row, 'AST', row.AST.under)})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.over.has(i) ? green : grey}`}>O {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.THREES.under.has(i) ? green : grey}`}>U {displayHalfLine(row.THREES?.line || 'N/A')} ({getOddsDisplay(row, 'THREES', row.THREES?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PRA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PRA?.line || 'N/A')} ({getOddsDisplay(row, 'PRA', row.PRA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PR.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PR.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PR?.line || 'N/A')} ({fmtOdds(row.PR?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.PA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.PA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.PA?.line || 'N/A')} ({fmtOdds(row.PA?.under || 'N/A')})</div>
              </td>
              <td className="py-2 px-3">
<div className={`font-mono whitespace-nowrap ${bestSets.RA.over.has(i) ? green : grey}`}>O {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.over || 'N/A')})</div>
<div className={`font-mono whitespace-nowrap ${bestSets.RA.under.has(i) ? green : grey}`}>U {displayHalfLine(row.RA?.line || 'N/A')} ({fmtOdds(row.RA?.under || 'N/A')})</div>
              </td>
                </>
              )}
            </tr>
          ))}
          </tbody>
        </table>
      </div>
      )}
    </div>
  );
}, (prev, next) => (
  prev.isDark === next.isDark &&
  prev.oddsLoading === next.oddsLoading &&
  prev.oddsError === next.oddsError &&
  prev.realOddsData === next.realOddsData &&
  prev.selectedTeam === next.selectedTeam &&
  prev.gamePropsTeam === next.gamePropsTeam &&
  prev.propsMode === next.propsMode &&
  prev.opponentTeam === next.opponentTeam &&
  prev.oddsFormat === next.oddsFormat &&
  prev.playerId === next.playerId &&
  prev.selectedStat === next.selectedStat
));

