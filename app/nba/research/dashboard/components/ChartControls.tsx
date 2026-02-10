'use client';

import { useState, useMemo, useRef, useEffect, memo, useCallback } from 'react';
import { normalizeAbbr } from '@/lib/nbaAbbr';
import { getBookmakerInfo as getBookmakerInfoFromLib } from '@/lib/bookmakers';
import { HomeAwaySelect, OverRatePill } from './ui';
import { SECOND_AXIS_FILTER_OPTIONS } from '../constants';
import { updateBettingLinePosition } from '../utils/chartUtils';
import { AltLineItem, partitionAltLineItems, getBookRowKey } from '../utils/oddsUtils';
import { ABBR_TO_TEAM_ID, getEspnLogoCandidates } from '../utils/teamUtils';

// Per-button memoized components to prevent unrelated re-renders
const StatPill = memo(function StatPill({ label, value, isSelected, onSelect, isDark }: { label: string; value: string; isSelected: boolean; onSelect: (v: string) => void; isDark: boolean }) {
  const handleInteraction = useCallback((e: React.MouseEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(value);
  }, [onSelect, value]);
  
  return (
    <button
      type="button"
      onClick={handleInteraction}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(value);
      }}
      style={{ position: 'relative', zIndex: 50, pointerEvents: 'auto', touchAction: 'manipulation' }}
      className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {label}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.label === next.label && prev.value === next.value && prev.isDark === next.isDark);

const TimeframeBtn = memo(function TimeframeBtn({ value, isSelected, onSelect }: { value: string; isSelected: boolean; onSelect: (v: string) => void }) {
  const handleInteraction = useCallback((e: React.MouseEvent<HTMLButtonElement> | React.TouchEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    onSelect(value);
  }, [onSelect, value]);
  
  return (
    <button
      type="button"
      onClick={handleInteraction}
      onTouchEnd={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onSelect(value);
      }}
      style={{ position: 'relative', zIndex: 50, pointerEvents: 'auto', touchAction: 'manipulation' }}
      className={`px-2 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer ${
        isSelected ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
      }`}
    >
      {value === 'h2h' ? 'H2H' : value === 'lastseason' ? 'Last Season' : value === 'thisseason' ? 'This Season' : value.replace('last','L')}
    </button>
  );
}, (prev, next) => prev.isSelected === next.isSelected && prev.value === next.value);

// Opponent selector component
const OpponentSelector = memo(function OpponentSelector({ 
  currentOpponent, 
  manualOpponent, 
  onOpponentChange, 
  isDark,
  propsMode,
  currentTeam,
  selectedTimeframe 
}: { 
  currentOpponent: string;
  manualOpponent: string;
  onOpponentChange: (opponent: string) => void;
  isDark: boolean;
  propsMode: string;
  currentTeam: string;
  selectedTimeframe: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [logoAttempts, setLogoAttempts] = useState<Record<string, number>>({});
  const allTeams = Object.keys(ABBR_TO_TEAM_ID).filter(team => team !== normalizeAbbr(currentTeam));
  
  // Determine what to display: ALL by default, or specific opponent when H2H or manually selected
  const displayValue = (() => {
    if (manualOpponent) return manualOpponent;
    if (selectedTimeframe === 'h2h' && currentOpponent) return currentOpponent;
    return 'ALL';
  })();
  
  // Create options list
  const options = [
    { value: 'ALL', label: 'ALL' },
    ...(currentOpponent ? [{ value: currentOpponent, label: currentOpponent }] : []),
    ...allTeams.sort().map(team => ({ value: team, label: team }))
  ].filter((option, index, array) => 
    // Remove duplicates (in case currentOpponent is already in allTeams)
    array.findIndex(o => o.value === option.value) === index
  );
  
  const handleSelect = (value: string) => {
    onOpponentChange(value);
    setIsOpen(false);
  };

  return (
    <div className="flex items-center gap-1 relative">
      <div className="relative">
        {/* Custom dropdown trigger */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-sm sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-600"
        >
          <div className="flex items-center gap-1">
            {displayValue !== 'ALL' && (
              <img 
                src={(() => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const attempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  return candidates[attempt] || candidates[0];
                })()} 
                alt={displayValue}
                className="w-5 h-5 object-contain"
                onError={(e) => {
                  const candidates = getEspnLogoCandidates(displayValue);
                  const currentAttempt = logoAttempts[`trigger-${displayValue}`] || 0;
                  const nextAttempt = currentAttempt + 1;
                  if (nextAttempt < candidates.length) {
                    setLogoAttempts(prev => ({ ...prev, [`trigger-${displayValue}`]: nextAttempt }));
                  } else {
                    e.currentTarget.style.display = 'none';
                  }
                }}
              />
            )}
            <span className="text-sm font-medium">{displayValue}</span>
          </div>
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {/* Custom dropdown menu */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-20 sm:w-24 md:w-28 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto custom-scrollbar">
            {options.map(option => (
              <button
                key={option.value}
                onClick={() => handleSelect(option.value)}
                className="w-full px-2 py-2 text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg flex items-center justify-center gap-1"
              >
                {option.value !== 'ALL' && (
                  <img 
                    src={(() => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const attempt = logoAttempts[`option-${option.value}`] || 0;
                      return candidates[attempt] || candidates[0];
                    })()} 
                    alt={option.value}
                    className="w-5 h-5 object-contain"
                    onError={(e) => {
                      const candidates = getEspnLogoCandidates(option.value);
                      const currentAttempt = logoAttempts[`option-${option.value}`] || 0;
                      const nextAttempt = currentAttempt + 1;
                      if (nextAttempt < candidates.length) {
                        setLogoAttempts(prev => ({ ...prev, [`option-${option.value}`]: nextAttempt }));
                      } else {
                        e.currentTarget.style.display = 'none';
                      }
                    }}
                  />
                )}
                <span className="text-sm font-medium">{option.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      
      {/* Overlay to close dropdown when clicking outside */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40" 
          onClick={() => setIsOpen(false)}
        />
      )}
    </div>
  );
}, (prev, next) => 
  prev.currentOpponent === next.currentOpponent && 
  prev.manualOpponent === next.manualOpponent && 
  prev.isDark === next.isDark &&
  prev.currentTeam === next.currentTeam &&
  prev.selectedTimeframe === next.selectedTimeframe
);

// AltLineItem type and partitionAltLineItems function are now imported from './utils/oddsUtils'

// Chart controls (updates freely with betting line changes)
const ChartControls = function ChartControls({
  isDark,
  currentStatOptions,
  selectedStat,
  onSelectStat,
  bettingLine,
  onChangeBettingLine,
  selectedTimeframe,
  onSelectTimeframe,
  chartData,
  currentOpponent,
  manualOpponent,
  onOpponentChange,
  propsMode,
  currentTeam,
  homeAway,
  onChangeHomeAway,
  yAxisConfig,
  realOddsData,
  oddsLoading,
  fmtOdds,
  minMinutesFilter,
  maxMinutesFilter,
  onMinMinutesChange,
  onMaxMinutesChange,
  excludeBlowouts,
  excludeBackToBack,
  onExcludeBlowoutsChange,
  onExcludeBackToBackChange,
  rosterForSelectedTeam,
  withWithoutMode,
  setWithWithoutMode,
  teammateFilterId,
  teammateFilterName,
  setTeammateFilterId,
  setTeammateFilterName,
  loadingTeammateGames,
  clearTeammateFilter,
  lineMovementEnabled,
  intradayMovements,
  selectedFilterForAxis,
  onSelectFilterForAxis,
  hitRateStats,
  selectedPlayer,
  isLoading,
  showAdvancedFilters,
  setShowAdvancedFilters,
}: any) {
  // Fallback state if props aren't provided
  const [localShowAdvancedFilters, setLocalShowAdvancedFilters] = useState(false);
  const effectiveShowAdvancedFilters = showAdvancedFilters !== undefined ? showAdvancedFilters : localShowAdvancedFilters;
  const effectiveSetShowAdvancedFilters = setShowAdvancedFilters || setLocalShowAdvancedFilters;
  
  const [isAdvancedFiltersOpen, setIsAdvancedFiltersOpen] = useState(false);
  const [isSplitsOpen, setIsSplitsOpen] = useState(false);
  const latestMovement = lineMovementEnabled && intradayMovements && intradayMovements.length > 0
    ? intradayMovements[0]
    : null;
  // Track the latest in-progress line while the user is holding +/-
  const transientLineRef = useRef<number | null>(null);
  const holdDelayRef = useRef<any>(null);
  const holdRepeatRef = useRef<any>(null);
  
  // Alt Lines dropdown state
  const [isAltLinesOpen, setIsAltLinesOpen] = useState(false);
  const altLinesRef = useRef<HTMLDivElement>(null);
  // Track if betting line has been manually set (to avoid auto-updating when user changes it)
  const hasManuallySetLineRef = useRef(false);
  // Track previous odds data length to detect when new player data loads
  const prevOddsDataLengthRef = useRef<number>(0);
  // Track the last auto-set line to prevent infinite loops
  const lastAutoSetLineRef = useRef<number | null>(null);
  const lastAutoSetStatRef = useRef<string | null>(null);
  // Track which bookmaker was selected from the dropdown
  const [selectedBookmaker, setSelectedBookmaker] = useState<string | null>(null);
  // Debounce timer for betting line updates
  const bettingLineDebounceRef = useRef<NodeJS.Timeout | null>(null);
  // Track current line value for immediate bookmaker detection (updates instantly, separate from debounced bettingLine)
  const [displayLine, setDisplayLine] = useState(bettingLine);
  
  // Cache URL line check to avoid expensive URL parsing on every render
  const urlLineCacheRef = useRef<{ line: number | null; stat: string | null; timestamp: number } | null>(null);
  
  // Helper to check if current line came from URL (cached to avoid repeated URL parsing)
  const checkUrlLine = useCallback((currentLine: number, currentStat: string): boolean => {
    if (typeof window === 'undefined') return false;
    
    // Check cache first (only re-check if stat changed or cache is old)
    const now = Date.now();
    const cache = urlLineCacheRef.current;
    if (cache && cache.stat === currentStat && (now - cache.timestamp) < 1000) {
      // Use cached value if stat matches and cache is fresh (< 1 second)
      return cache.line !== null && Math.abs(currentLine - cache.line) < 0.01;
    }
    
    // Parse URL only when needed
    try {
      const url = new URL(window.location.href);
      const urlLine = url.searchParams.get('line');
      const urlStat = url.searchParams.get('stat');
      if (urlLine && urlStat) {
        const lineValue = parseFloat(urlLine);
        const normalizedStat = urlStat.toLowerCase();
        if (!isNaN(lineValue) && normalizedStat === currentStat) {
          // Cache the result
          urlLineCacheRef.current = {
            line: Math.abs(lineValue),
            stat: normalizedStat,
            timestamp: now
          };
          return Math.abs(currentLine - Math.abs(lineValue)) < 0.01;
        }
      }
    } catch {}
    
    // Cache null result to avoid re-parsing
    urlLineCacheRef.current = {
      line: null,
      stat: currentStat,
      timestamp: now
    };
    return false;
  }, []);

  // Helper: resolve teammate ID from name + team using Ball Don't Lie /players endpoint
  const resolveTeammateIdFromNameLocal = async (name: string, teamAbbr?: string): Promise<number | null> => {
    try {
      if (!name) return null;
      const tryFetch = async (searchStr: string) => {
        const q = new URLSearchParams();
        q.set('endpoint', '/players');
        q.set('search', searchStr);
        q.set('per_page', '25');
        const maybeTeamId = teamAbbr ? ABBR_TO_TEAM_ID[normalizeAbbr(teamAbbr)] : undefined;
        if (maybeTeamId) q.append('team_ids[]', String(maybeTeamId));
        const url = `/api/balldontlie?${q.toString()}`;
        const res = await fetch(url, { cache: 'no-store' }).catch(() => null);
        const js = await res?.json().catch(() => ({})) as any;
        const arr = Array.isArray(js?.data) ? js.data : [];
        return arr;
      };
      // 1) full name
      let results = await tryFetch(name);
      // 2) last name only if none
      if (!results.length) {
        const parts = name.split(' ').filter(Boolean);
        const last = parts[parts.length - 1] || name;
        results = await tryFetch(last);
      }
      if (!results.length) return null;
      const lower = name.trim().toLowerCase();
      const exact = results.find((p: any) => `${p.first_name} ${p.last_name}`.trim().toLowerCase() === lower);
      const chosen = exact || results[0];
      return typeof chosen?.id === 'number' ? chosen.id : null;
    } catch {
      return null;
    }
  };

  // Sync input and dashed line to the committed bettingLine value.
  // Only track bettingLine/yAxisConfig to avoid racing with timeframe updates.
  useEffect(() => {
    const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
    if (!input) return;
    const val = Number.isFinite(bettingLine) ? bettingLine : 0;
    input.value = String(val);
    if (yAxisConfig) {
      updateBettingLinePosition(val, yAxisConfig);
    }
  }, [bettingLine, yAxisConfig, selectedFilterForAxis]);

  // Fast recolor (no React) when the transient input value changes while holding +/-
  const recolorBarsFast = (value: number) => {
    // First try to call SimpleChart's recolor function if available
    if (typeof window !== 'undefined' && (window as any).__simpleChartRecolorBars) {
      (window as any).__simpleChartRecolorBars(value);
    }
    
    // Handle fg3m (3PM) bars specially - they have a separate makes rect
    if (selectedStat === 'fg3m') {
      // Query all rects in the chart container and filter for fg3m makes
      const chartContainer = document.querySelector('.recharts-wrapper, [class*="chart"]');
      const allRects = chartContainer ? chartContainer.querySelectorAll('rect') : document.querySelectorAll('svg rect');
      
      allRects.forEach((el: any) => {
        // Check if this is an fg3m makes rect
        if (!el.hasAttribute('data-fg3m-makes')) return;
        
        const makesValueAttr = el.getAttribute('data-makes-value');
        const makesValue = makesValueAttr != null ? parseFloat(makesValueAttr) : NaN;
        if (!Number.isFinite(makesValue)) return;
        
        const isOver = makesValue > value;
        const isPush = makesValue === value;
        const newState = isOver ? 'over' : isPush ? 'push' : 'under';
        const currentState = el.getAttribute('data-state');
        if (currentState === newState) return;
        
        const newColor = newState === 'over' ? '#10b981' : newState === 'push' ? '#9ca3af' : '#ef4444';
        
        // Update in multiple ways to ensure it sticks
        el.setAttribute('data-state', newState);
        el.setAttribute('fill', newColor);
        if (el.style) {
          el.style.setProperty('fill', newColor, 'important');
        }
      });
    } else {
      // Handle regular bars (fallback for old chart if it exists)
      const rects = document.querySelectorAll('[data-bar-index]');
      rects.forEach((el: any) => {
        // Skip fg3m makes rects
        if (el.hasAttribute('data-fg3m-makes')) return;
        const idxAttr = el.getAttribute('data-bar-index');
        const i = idxAttr != null ? parseInt(idxAttr, 10) : NaN;
        if (!Number.isFinite(i) || !chartData[i]) return;
        const barValue = chartData[i].value;
        const isOver = selectedStat === 'spread' ? (barValue < value) : (barValue > value);
        const isPush = barValue === value;
        const newState = isOver ? 'over' : isPush ? 'push' : 'under';
        if (el.getAttribute('data-state') === newState) return;
        el.setAttribute('data-state', newState);
        el.setAttribute('fill', newState === 'over' ? '#10b981' : newState === 'push' ? '#9ca3af' : '#ef4444');
      });
    }
  };

  // Update Over Rate pill instantly for a given line value (no React rerender)
  const updateOverRatePillFast = useCallback((value: number) => {
    const overCount = selectedStat === 'spread'
      ? chartData.filter((d: any) => d.value < value).length
      : chartData.filter((d: any) => d.value > value).length;
    const total = chartData.length;
    const pct = total > 0 ? (overCount / total) * 100 : 0;

    const nodes = document.querySelectorAll('[data-over-rate], [data-over-rate-inline]');
    nodes.forEach((node) => {
      const el = node as HTMLElement;
      el.textContent = `${overCount}/${total} (${pct.toFixed(1)}%)`;
      if (el.hasAttribute('data-over-rate')) {
        const cls = pct >= 60
          ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
          : pct >= 40
          ? 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
          : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';
        el.className = `px-1 sm:px-2 py-1 sm:py-1.5 rounded text-xs sm:text-sm font-bold ${cls} whitespace-nowrap`;
      }
    });
  }, [chartData, selectedStat]);

  // On timeframe change, commit the most recent transient line (if any),
  // otherwise keep the existing bettingLine. Avoid reading stale defaultValue.
  useEffect(() => {
    const commit = transientLineRef.current;
    if (commit != null && commit !== bettingLine) {
      onChangeBettingLine(commit);
    }
    // Always reposition overlay after the chart finishes its layout for new timeframe
    if (typeof window !== 'undefined') {
      requestAnimationFrame(() => {
        if (yAxisConfig) {
          updateBettingLinePosition(commit ?? bettingLine, yAxisConfig);
        }
      });
    }
  }, [selectedTimeframe, selectedFilterForAxis]);
  // Dropdown state for timeframe selector (moved outside useMemo to follow hooks rules)
  const [isTimeframeDropdownOpen, setIsTimeframeDropdownOpen] = useState(false);
  // Local accordion state for minutes filter
  const [isMinutesFilterOpen, setIsMinutesFilterOpen] = useState(false);
  // Close Advanced when clicking outside (desktop or mobile containers)
  const advancedDesktopRef = useRef<HTMLDivElement | null>(null);
  const advancedMobileRef = useRef<HTMLDivElement | null>(null);
  const advancedMobilePortalRef = useRef<HTMLDivElement | null>(null);

  // (With/Without teammate options now come directly from depth chart roster)
  useEffect(() => {
    if (!isAdvancedFiltersOpen) return;
    const handleOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      const inDesktop = advancedDesktopRef.current?.contains(target);
      const inMobile = advancedMobileRef.current?.contains(target);
      const inMobilePortal = advancedMobilePortalRef.current?.contains(target);
      if (inDesktop || inMobile || inMobilePortal) return;
      setIsAdvancedFiltersOpen(false);
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside, { passive: true });
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [isAdvancedFiltersOpen]);

  
  // Update Over Rate when committed line or data changes
  useEffect(() => {
    updateOverRatePillFast(bettingLine);
  }, [updateOverRatePillFast, bettingLine]);
  
  // Reset selectedBookmaker when stat changes
  useEffect(() => {
    setSelectedBookmaker(null);
    setDisplayLine(bettingLine);
  }, [selectedStat]);
  
  // Track last bettingLine to prevent unnecessary updates
  const lastBettingLineRef = useRef(bettingLine);
  
  // Sync displayLine with bettingLine when it changes externally
  useEffect(() => {
    // Skip if bettingLine hasn't actually changed
    if (Math.abs(lastBettingLineRef.current - bettingLine) < 0.01) {
      return;
    }
    lastBettingLineRef.current = bettingLine;
    
    // Check if line came from URL - if so, always update displayLine even if manually set
    const hasUrlLine = checkUrlLine(bettingLine, selectedStat);
    
    // Update displayLine if not manually set, OR if it came from URL (to ensure it displays immediately)
    if (!hasManuallySetLineRef.current || hasUrlLine) {
      // Only update if displayLine is actually different to prevent infinite loops
      setDisplayLine((prev: number) => {
        if (Math.abs(prev - bettingLine) < 0.01) {
          return prev; // No change needed
        }
        return bettingLine;
      });
      
      // Also update the input field if it exists (for URL-based line changes, especially for steals/blocks)
      // Use setTimeout to ensure the input element exists after render
      setTimeout(() => {
        const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
        if (input) {
          const currentValue = parseFloat(input.value || '0');
          if (Math.abs(currentValue - bettingLine) > 0.01) {
            input.value = String(bettingLine);
            transientLineRef.current = bettingLine;
          }
        }
        
        // Update betting line overlay position (important for steals/blocks from URL)
        if (yAxisConfig && Number.isFinite(bettingLine)) {
          updateBettingLinePosition(bettingLine, yAxisConfig);
          recolorBarsFast(bettingLine);
          updateOverRatePillFast(bettingLine);
        }
      }, 0);
    }
  }, [bettingLine, selectedStat]); // Added selectedStat to dependency array for URL line check
  
  // Helper function to get bookmaker info
  const normalizeBookNameForLookup = (name: string) => {
    if (!name) return '';
    return name.replace(/\s+Pick'?em.*$/i, '').trim();
  };

  const isPickemBookmakerName = (name: string | null | undefined): boolean => {
    if (!name) return false;
    return /pick'?em/i.test(name);
  };

  const getPickemVariantFromName = (name: string | null | undefined): string | null => {
    if (!name) return null;
    const match = name.match(/\(([^)]+)\)\s*$/);
    return match ? match[1] : null;
  };

  // Use the centralized bookmaker info from lib/bookmakers.ts
  const getBookmakerInfo = (name: string) => {
    return getBookmakerInfoFromLib(name);
  };

  // Display helper: always show + for positive lines
  const fmtLine = (line: number | string): string => {
    const n = typeof line === 'number' ? line : parseFloat(String(line));
    if (!Number.isFinite(n)) return String(line);
    return n > 0 ? `+${n}` : `${n}`;
  };
  
  // Calculate best bookmaker and line for stat (lowest over line)
  const bestBookmakerForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;

    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    let bestBook: any = null;
    let bestLine = Infinity;
    
    for (const book of realOddsData) {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') continue;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) continue;
      if (lineValue < bestLine) {
        bestLine = lineValue;
        bestBook = book;
      }
    }
    
    return bestBook ? bestBook.name : null;
  }, [realOddsData, selectedStat]);
  
  // Calculate best line for stat (lowest over line) - exclude alternate lines
  const bestLineForStat = useMemo(() => {
    if (!realOddsData || realOddsData.length === 0) return null;

    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return null;
    
    // Collect all lines per bookmaker
    const allLinesByBookmaker = new Map<string, number[]>();
    for (const book of realOddsData) {
      const meta = (book as any)?.meta;
      const baseName = (meta?.baseName || book?.name || '').toLowerCase();
      const statKey: string = meta?.stat || bookRowKey;
      
      if (statKey !== bookRowKey) continue;
      
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') continue;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) continue;
      
      if (!allLinesByBookmaker.has(baseName)) {
        allLinesByBookmaker.set(baseName, []);
      }
      allLinesByBookmaker.get(baseName)!.push(lineValue);
    }
    
    // Calculate consensus line (most common line value across ALL bookmakers)
    const lineCounts = new Map<number, number>();
    for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
      for (const line of lines) {
        lineCounts.set(line, (lineCounts.get(line) || 0) + 1);
      }
    }
    let consensusLine: number | null = null;
    let maxCount = 0;
    for (const [line, count] of lineCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        consensusLine = line;
      }
    }
    
    // Find primary lines (closest to consensus) and get the lowest
    let bestLine = Infinity;
    for (const [baseName, lines] of allLinesByBookmaker.entries()) {
      if (lines.length === 0) continue;
      
      let primaryLine = lines[0];
      if (consensusLine !== null && lines.length > 1) {
        let closestLine = lines[0];
        let minDiff = Math.abs(lines[0] - consensusLine);
        for (const line of lines) {
          const diff = Math.abs(line - consensusLine);
          if (diff < minDiff) {
            minDiff = diff;
            closestLine = line;
          }
        }
        // Always use closest to consensus (no threshold)
        primaryLine = closestLine;
      }
      
      if (primaryLine < bestLine) {
        bestLine = primaryLine;
      }
    }
    
    return bestLine !== Infinity ? bestLine : null;
  }, [realOddsData, selectedStat]);
  
  // Auto-set betting line to best available line when odds data loads (only if user hasn't manually set it)
  useEffect(() => {
    // Don't update betting line if odds are still loading (prevents double refresh on initial load)
    if (oddsLoading) {
      return;
    }
    
    // Check if current line came from URL - if so, don't override it
    const hasUrlLine = checkUrlLine(bettingLine, selectedStat);
    
    // If line came from URL, mark it as manually set to prevent auto-override
    if (hasUrlLine && !hasManuallySetLineRef.current) {
      hasManuallySetLineRef.current = true;
    }
    
    if (bestLineForStat !== null && !hasManuallySetLineRef.current && !hasUrlLine) {
      
      // Only auto-set if:
      // 1. The line hasn't been auto-set for this stat yet, OR
      // 2. The best line has changed from what we last auto-set, OR
      // 3. The current line is the default 0.5 (meaning no line was stored for this stat)
      const currentBettingLine = bettingLine;
      const isDefaultLine = Math.abs(currentBettingLine - 0.5) < 0.01;
      
      const shouldAutoSet = 
        lastAutoSetStatRef.current !== selectedStat ||
        lastAutoSetLineRef.current === null ||
        isDefaultLine ||
        Math.abs((lastAutoSetLineRef.current || 0) - bestLineForStat) > 0.01;
      
      if (shouldAutoSet) {
        // Only update if the current betting line is different from the best line
        if (Math.abs(currentBettingLine - bestLineForStat) > 0.01) {
          // Update immediately - synchronous update for instant feedback when switching stats
          onChangeBettingLine(bestLineForStat);
          setDisplayLine(bestLineForStat);
          lastAutoSetLineRef.current = bestLineForStat;
          lastAutoSetStatRef.current = selectedStat;
          
          // Update input field
          const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
          if (input) {
            input.value = String(bestLineForStat);
            transientLineRef.current = bestLineForStat;
            // Update visual elements
            if (yAxisConfig) {
              updateBettingLinePosition(bestLineForStat, yAxisConfig);
            }
            recolorBarsFast(bestLineForStat);
            updateOverRatePillFast(bestLineForStat);
          }
        } else {
          // Line is already set correctly, just update the refs
          lastAutoSetLineRef.current = bestLineForStat;
          lastAutoSetStatRef.current = selectedStat;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bestLineForStat, selectedStat, oddsLoading, bettingLine]);
  
  // Reset manual flag when stat changes (allow auto-fetch for new stat)
  useEffect(() => {
    hasManuallySetLineRef.current = false;
    lastAutoSetLineRef.current = null;
    lastAutoSetStatRef.current = null;
    // Clear URL line cache when stat changes to force re-check
    urlLineCacheRef.current = null;
  }, [selectedStat]);
  
  // Reset manual flag when odds data loads (new player fetched)
  useEffect(() => {
    const currentLength = realOddsData?.length || 0;
    const prevLength = prevOddsDataLengthRef.current;
    
    // If data changed from empty to having data, reset manual flag to allow auto-fetch
    // BUT preserve it if line came from URL (to prevent overriding URL line)
    if (prevLength === 0 && currentLength > 0) {
      // Check if line came from URL - if so, don't reset manual flag
      const hasUrlLine = checkUrlLine(bettingLine, selectedStat);
      
      if (!hasUrlLine) {
        hasManuallySetLineRef.current = false;
        lastAutoSetLineRef.current = null;
        lastAutoSetStatRef.current = null;
      }
    }
    
    prevOddsDataLengthRef.current = currentLength;
  }, [realOddsData, selectedStat, bettingLine]);
  
  // Auto-update selected bookmaker when line changes and matches a bookmaker (uses displayLine for immediate updates)
  // This includes alternate lines (Goblin/Demon variants) so users see the variant when they set a matching line
  useEffect(() => {
    // Wait for odds to finish loading before trying to match bookmakers
    if (oddsLoading) return;
    if (!realOddsData || realOddsData.length === 0) return;
    
    const bookRowKey = getBookRowKey(selectedStat);
    if (!bookRowKey) return;
    
    // Check if line came from URL - if so, prioritize PRIMARY lines over alt lines
    const hasUrlLine = checkUrlLine(displayLine, selectedStat);
    
    // Find ALL bookmaker entries that have a line matching the current display line
    // This includes alternate lines (Goblin/Demon variants) - prioritize exact matches including variants
    const matchingBooks = realOddsData.filter((book: any) => {
      const statData = (book as any)[bookRowKey];
      if (!statData || statData.line === 'N/A') return false;
      const lineValue = parseFloat(statData.line);
      if (isNaN(lineValue)) return false;
      return Math.abs(lineValue - displayLine) < 0.01;
    });
    
    if (matchingBooks.length > 0) {
      // If user explicitly selected a bookmaker and it still matches this line,
      // keep that bookmaker instead of auto-switching to the first match.
      if (selectedBookmaker) {
        const selectedLower = selectedBookmaker.toLowerCase();
        const selectedMatch = matchingBooks.find((book: any) => {
          const meta = (book as any)?.meta;
          const baseName = (meta?.baseName || book?.name || '').toLowerCase();
          return baseName === selectedLower;
        });
        if (selectedMatch) {
          const selectedName = (selectedMatch as any)?.meta?.baseName || selectedMatch?.name;
          setSelectedBookmaker(prev => prev !== selectedName ? selectedName : prev);
          return;
        }
      }

      let bookToSelect: any;
      
      if (hasUrlLine) {
        // When line comes from URL, prioritize PRIMARY lines (no variantLabel) over alt lines
        // This ensures we show the main market line, not alt lines
        const primaryMatch = matchingBooks.find((book: any) => {
          const meta = (book as any)?.meta;
          return !meta?.variantLabel; // No variant label = primary line
        });
        bookToSelect = primaryMatch || matchingBooks[0];
      } else {
        // For user-selected lines, prioritize variant matches (Goblin/Demon) if they match
        // This way when a user sets a line that matches a Goblin/Demon variant, it shows that variant
        const variantMatch = matchingBooks.find((book: any) => {
          const meta = (book as any)?.meta;
          return meta?.variantLabel && (meta.variantLabel === 'Goblin' || meta.variantLabel === 'Demon');
        });
        bookToSelect = variantMatch || matchingBooks[0];
      }
      
      const bookName = (bookToSelect as any)?.meta?.baseName || bookToSelect?.name;
      
      // Only update if it's different from current selection
      setSelectedBookmaker(prev => prev !== bookName ? bookName : prev);
    } else {
      // Clear selection if no bookmaker matches
      setSelectedBookmaker(prev => prev !== null ? null : prev);
    }
  }, [displayLine, realOddsData, selectedStat, oddsLoading, selectedBookmaker]);
  
   const StatPills = useMemo(() => (
      <div className="mb-4 sm:mb-5 md:mb-4 mt-1 sm:mt-0 w-full max-w-full">
        <div
          className="w-full max-w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
            {currentStatOptions.map((s: any) => (
              <StatPill key={s.key} label={s.label} value={s.key} isSelected={selectedStat === s.key} onSelect={onSelectStat} isDark={isDark} />
            ))}
          </div>
        </div>
      </div>
    ), [isDark, currentStatOptions, selectedStat, onSelectStat]);

    const TimeframeButtons = useMemo(() => {
      const timeframeOptions = [
        { value: 'last5', label: 'L5' },
        { value: 'last10', label: 'L10' },
        { value: 'last15', label: 'L15' },
        { value: 'last20', label: 'L20' },
        { value: 'h2h', label: 'H2H' },
        { value: 'lastseason', label: 'Last Season' },
        { value: 'thisseason', label: 'This Season' }
      ];

      const selectedOption = timeframeOptions.find(opt => opt.value === selectedTimeframe);

      return (
        <div className="relative">
          <button
            onClick={() => setIsTimeframeDropdownOpen(!isTimeframeDropdownOpen)}
            className="w-20 sm:w-24 md:w-28 lg:w-32 px-2 sm:px-2 md:px-3 py-2.5 sm:py-2 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-sm sm:text-sm font-medium text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-center flex items-center justify-center hover:bg-gray-50 dark:hover:bg-gray-600"
          >
            <span className="truncate">{selectedOption?.label || 'Timeframe'}</span>
            <svg className="w-3 h-3 sm:w-4 sm:h-4 flex-shrink-0 ml-0.5 sm:ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          
          {isTimeframeDropdownOpen && (
            <div className="absolute top-full left-0 mt-1 w-20 sm:w-24 md:w-28 lg:w-32 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 max-h-64 overflow-y-auto">
              {timeframeOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onSelectTimeframe(option.value);
                    setIsTimeframeDropdownOpen(false);
                  }}
                  className={`w-full px-2 sm:px-2 md:px-3 py-1.5 sm:py-2 text-xs sm:text-sm font-medium text-left hover:bg-gray-100 dark:hover:bg-gray-600 first:rounded-t-lg last:rounded-b-lg ${
                    selectedTimeframe === option.value
                      ? 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
                      : 'text-gray-900 dark:text-white'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}

          {isTimeframeDropdownOpen && (
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsTimeframeDropdownOpen(false)}
            />
          )}
        </div>
      );
    }, [selectedTimeframe, onSelectTimeframe, isTimeframeDropdownOpen, setIsTimeframeDropdownOpen]);

    const SecondAxisFilterPills = useMemo(() => {
      // Only show in player mode
      if (propsMode !== 'player') return null;

      // Filter out the "None" option and only show the actual filter options
      const filterOptions = SECOND_AXIS_FILTER_OPTIONS.filter(opt => opt.key !== null);

      return (
        <div className="mb-4 sm:mb-5 md:mb-4 mt-1 sm:mt-0">
          <div className="w-full min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain touch-pan-x custom-scrollbar stats-slider-scrollbar">
            <div className="inline-flex flex-nowrap gap-1.5 sm:gap-1.5 md:gap-2 pb-1 pl-2">
              {filterOptions.map((option) => (
                <button
                  key={option.key || 'none'}
                  onClick={() => {
                    // Toggle: if already selected, deselect (set to null), otherwise select
                    onSelectFilterForAxis(selectedFilterForAxis === option.key ? null : option.key);
                  }}
                  className={`px-3 sm:px-3 md:px-4 py-1.5 sm:py-1.5 rounded-lg text-sm sm:text-sm font-medium transition-colors flex-shrink-0 whitespace-nowrap cursor-pointer border ${
                    selectedFilterForAxis === option.key
                      ? 'bg-purple-600 text-white border-purple-400/30'
                      : 'bg-gray-100 dark:bg-[#0a1929] text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 border-gray-300/40 dark:border-gray-600/30'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }, [propsMode, selectedFilterForAxis, onSelectFilterForAxis]);


    // Always show controls, even when no data, so users can adjust filters/timeframes

    return (
      <>
        {StatPills}
        {/* Responsive controls layout */}
        <div className="space-y-2 sm:space-y-3 md:space-y-4 mb-2 sm:mb-3 md:mb-4 lg:mb-6">
          {/* Top row: Line input (left), Over Rate (center-left), Team vs + Timeframes (right) */}
          <div className="flex items-center flex-wrap gap-1 sm:gap-2 md:gap-3 pl-0 sm:pl-0 ml-2 sm:ml-6">
            {/* Alt Lines Dropdown - Desktop only */}
            {(() => {
              const bookRowKey = getBookRowKey(selectedStat);
              const isMoneyline = selectedStat === 'moneyline';
              
              // Get all available lines for dropdown
              const altLines: AltLineItem[] = realOddsData && realOddsData.length > 0 && bookRowKey
                ? (realOddsData
                    .map((book: any) => {
                      const statData = (book as any)[bookRowKey];
                      if (!statData) return null;
                      
                      // For moneyline (H2H), handle home/away odds differently
                      if (isMoneyline) {
                        if (statData.home === 'N/A' && statData.away === 'N/A') return null;
                        const meta = (book as any).meta || {};
                        return {
                          bookmaker: meta.baseName || book.name,
                          line: 0, // Moneyline doesn't have a line value
                          over: statData.home, // Use home as "over"
                          under: statData.away, // Use away as "under"
                          isPickem: meta.isPickem ?? false,
                          variantLabel: meta.variantLabel ?? null,
                        } as AltLineItem;
                      }
                      
                      // For spread/total (has line value)
                      if (statData.line === 'N/A') return null;
                      const lineValue = parseFloat(statData.line);
                      if (isNaN(lineValue)) return null;
                      const meta = (book as any).meta || {};
                      return {
                        bookmaker: meta.baseName || book.name,
                        line: lineValue,
                        over: statData.over,
                        under: statData.under,
                        isPickem: meta.isPickem ?? false,
                        variantLabel: meta.variantLabel ?? null,
                      } as AltLineItem;
                    })
                    .filter((item: AltLineItem | null): item is AltLineItem => item !== null))
                : [];
              
              // Deduplicate: Remove lines with same bookmaker, line value, over odds, and under odds
              const seen = new Set<string>();
              const uniqueAltLines: AltLineItem[] = [];
              for (const line of altLines) {
                // Create a unique key: bookmaker + line + over + under
                const key = `${(line.bookmaker || '').toLowerCase()}|${line.line}|${line.over}|${line.under}`;
                if (!seen.has(key)) {
                  seen.add(key);
                  uniqueAltLines.push(line);
                }
              }
              
              uniqueAltLines.sort((a: AltLineItem, b: AltLineItem) => {
                // First, separate milestones from over/under lines
                const isMilestoneA = a.variantLabel === 'Milestone';
                const isMilestoneB = b.variantLabel === 'Milestone';
                if (isMilestoneA !== isMilestoneB) {
                  // Over/under lines come first (isMilestone = false = 0), milestones come after (true = 1)
                  return (isMilestoneA ? 1 : 0) - (isMilestoneB ? 1 : 0);
                }
                
                // Within same type, sort by pick'em status
                const isPickemA = a.isPickem ? 0 : 1;
                const isPickemB = b.isPickem ? 0 : 1;
                if (isPickemA !== isPickemB) return isPickemA - isPickemB;
                
                // For moneyline, sort by bookmaker name instead of line
                if (isMoneyline) {
                  return (a.bookmaker || '').localeCompare(b.bookmaker || '');
                }
                return a.line - b.line;
              });
              
              // Deduplicate: Remove lines with same bookmaker, line value, over odds, and under odds
              const seenMobile = new Set<string>();
              const uniqueAltLinesMobile: AltLineItem[] = [];
              for (const line of altLines) {
                // Create a unique key: bookmaker + line + over + under
                const key = `${(line.bookmaker || '').toLowerCase()}|${line.line}|${line.over}|${line.under}`;
                if (!seenMobile.has(key)) {
                  seenMobile.add(key);
                  uniqueAltLinesMobile.push(line);
                }
              }
              
              const { primary: primaryAltLines, alternate: alternateAltLines, milestones: milestoneLines } = partitionAltLineItems(uniqueAltLinesMobile);
              const renderAltLineButton = (altLine: AltLineItem, idx: number) => {
                const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                const isPickemAlt = altLine.isPickem ?? false;
                const pickemVariant = altLine.variantLabel ?? null;

                return (
                  <button
                    key={`${altLine.bookmaker}-${altLine.line}-${idx}`}
                    onClick={() => {
                      onChangeBettingLine(altLine.line);
                      setDisplayLine(altLine.line);
                      setSelectedBookmaker(altLine.bookmaker);
                      setIsAltLinesOpen(false);
                      const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
                      if (input) {
                        input.value = String(altLine.line);
                        transientLineRef.current = altLine.line;
                        if (yAxisConfig) {
                          updateBettingLinePosition(altLine.line, yAxisConfig);
                        }
                        recolorBarsFast(altLine.line);
                        updateOverRatePillFast(altLine.line);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Bookmaker Logo */}
                      {bookmakerInfo.logoUrl ? (
                        <img 
                          src={bookmakerInfo.logoUrl} 
                          alt={bookmakerInfo.name}
                          className="w-5 h-5 rounded object-contain flex-shrink-0"
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
                      
                      {/* Line and Bookmaker Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              {fmtLine(altLine.line)}
                            </span>
                          )}
                          {isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              ML
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {bookmakerInfo.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Odds */}
                    {!isPickemAlt ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {altLine.over && altLine.over !== 'N/A' && altLine.over !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          }`}>
                            {isMoneyline ? 'Home' : 'O'} {fmtOdds(altLine.over)}
                          </span>
                        )}
                        {altLine.under && altLine.under !== 'N/A' && altLine.under !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' 
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {isMoneyline ? 'Away' : 'U'} {fmtOdds(altLine.under)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {pickemVariant === 'Goblin' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/goblin.png" 
                            alt="Goblin" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '👹';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : pickemVariant === 'Demon' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/demon.png" 
                            alt="Demon" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '😈';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[10px] font-semibold">
                            Pick&apos;em
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Selected indicator */}
                    {isSelected && (
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              };
              
              // Find the bookmaker to display: find the bookmaker whose PRIMARY line matches displayLine
              const displayBookmaker = (() => {
                if (!realOddsData || realOddsData.length === 0) return null;
                
                // console.log('[DEBUG] Finding displayBookmaker for displayLine:', displayLine, 'selectedStat:', selectedStat, 'bookRowKey:', bookRowKey);
                
                // Track all lines per bookmaker to identify the true primary line
                const allLinesByBookmaker = new Map<string, Array<{line: number; over: string; under: string; isPickem: boolean; variantLabel: string | null}>>();
                
                // First pass: collect ALL lines for each bookmaker
                for (const book of realOddsData) {
                  const meta = (book as any)?.meta;
                  const baseName = (meta?.baseName || book?.name || '');
                  const baseNameLower = baseName.toLowerCase();
                  const statKey: string = meta?.stat || bookRowKey;
                  
                  // Only consider entries matching the selected stat
                  if (statKey !== bookRowKey) continue;
                  
                  const statData = (book as any)[bookRowKey];
                  if (!statData || statData.line === 'N/A') continue;
                  const lineValue = parseFloat(statData.line);
                  if (isNaN(lineValue)) continue;
                  
                  if (!allLinesByBookmaker.has(baseNameLower)) {
                    allLinesByBookmaker.set(baseNameLower, []);
                  }
                  
                  allLinesByBookmaker.get(baseNameLower)!.push({
                    line: lineValue,
                    over: statData.over,
                    under: statData.under,
                    isPickem: meta?.isPickem ?? false,
                    variantLabel: meta?.variantLabel ?? null,
                  });
                }
                
                // Calculate consensus line by finding the most common line value across ALL bookmakers
                // Count all line values, not just first lines
                const lineCounts = new Map<number, number>();
                for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
                  for (const line of lines) {
                    lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
                  }
                }
                
                // Find the most common line (this is our consensus)
                let consensusLine: number | null = null;
                let maxCount = 0;
                for (const [line, count] of lineCounts.entries()) {
                  if (count > maxCount) {
                    maxCount = count;
                    consensusLine = line;
                  }
                }
                
                // console.log('[DEBUG] Consensus line (most common across all):', consensusLine, 'appears', maxCount, 'times');
                
                // Second pass: identify primary line for each bookmaker
                // Primary line is ALWAYS the one closest to consensus (if consensus exists)
                const primaryLinesByBookmaker = new Map<string, any>();
                for (const [baseNameLower, lines] of allLinesByBookmaker.entries()) {
                  if (lines.length === 0) continue;
                  
                  let primaryLine = lines[0]; // Default to first
                  
                  // If we have a consensus line, ALWAYS use the line closest to it
                  if (consensusLine !== null && lines.length > 1) {
                    let closestLine = lines[0];
                    let minDiff = Math.abs(lines[0].line - consensusLine);
                    
                    for (const line of lines) {
                      const diff = Math.abs(line.line - consensusLine);
                      if (diff < minDiff) {
                        minDiff = diff;
                        closestLine = line;
                      }
                    }
                    
                    // Always use the closest line to consensus (no threshold)
                    primaryLine = closestLine;
                    // console.log('[DEBUG] Bookmaker', baseNameLower, '- closest to consensus', consensusLine, 'is', primaryLine.line, '(diff:', minDiff, ')');
                  }
                  
                  // Get the original bookmaker name (preserve case)
                  const firstBook = realOddsData.find((book: any) => {
                    const meta = (book as any)?.meta;
                    const name = (meta?.baseName || book?.name || '').toLowerCase();
                    return name === baseNameLower;
                  });
                  const displayName = firstBook ? ((firstBook as any)?.meta?.baseName || firstBook?.name || baseNameLower) : baseNameLower;
                  
                  primaryLinesByBookmaker.set(baseNameLower, {
                    bookmaker: displayName,
                    line: primaryLine.line,
                    over: primaryLine.over,
                    under: primaryLine.under,
                    isPickem: primaryLine.isPickem,
                    variantLabel: primaryLine.variantLabel,
                  });
                  
                  // console.log('[DEBUG] Found primary line:', displayName, 'line:', primaryLine.line, 'over:', primaryLine.over, 'under:', primaryLine.under, '(from', lines.length, 'total lines)');
                }
                
                // console.log('[DEBUG] Primary lines map:', Array.from(primaryLinesByBookmaker.entries()).map(([name, data]) => `${name}: ${data.line}`));
                
                // Debug: Show all Bovada lines (including alternates)
                const bovadaLines = bookRowKey ? realOddsData
                  .filter((book: any) => {
                    const meta = (book as any)?.meta;
                    const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                    return baseName.includes('bovada');
                  })
                  .map((book: any) => {
                    const meta = (book as any)?.meta;
                    const statData = (book as any)[bookRowKey];
                    return {
                      baseName: meta?.baseName || book?.name,
                      stat: meta?.stat,
                      line: statData ? statData.line : 'N/A',
                      over: statData ? statData.over : 'N/A',
                      under: statData ? statData.under : 'N/A',
                    };
                  }) : [];
                // console.log('[DEBUG] All Bovada lines for', bookRowKey, ':', bovadaLines);
                
                // console.log('[DEBUG] selectedBookmaker:', selectedBookmaker);
                
                // Second pass: find the bookmaker entry that matches displayLine
                // If selectedBookmaker is set, check ALL lines (including alternates/Goblin/Demon) for that bookmaker
                if (selectedBookmaker) {
                  const selectedLower = selectedBookmaker.toLowerCase();
                  
                  // First, try to find an exact match in realOddsData (includes alternate lines with variants)
                  const exactMatch = bookRowKey ? realOddsData.find((book: any) => {
                    const meta = (book as any)?.meta;
                    const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                    if (baseName !== selectedLower) return false;
                    
                    const statData = (book as any)[bookRowKey];
                    if (!statData || statData.line === 'N/A') return false;
                    const lineValue = parseFloat(statData.line);
                    if (isNaN(lineValue)) return false;
                    return Math.abs(lineValue - displayLine) < 0.01;
                  }) : null;
                  
                  if (exactMatch && bookRowKey) {
                    const meta = (exactMatch as any)?.meta;
                    const statData = (exactMatch as any)[bookRowKey];
                    const result = {
                      bookmaker: meta?.baseName || exactMatch?.name || selectedBookmaker,
                      line: parseFloat(statData.line),
                      over: statData.over,
                      under: statData.under,
                      isPickem: meta?.isPickem ?? false,
                      variantLabel: meta?.variantLabel ?? null,
                    };
                    // console.log('[DEBUG] Found exact match (including variant):', result);
                    return result;
                  }
                  
                  // Fallback to primary line if no exact match found
                  const selectedPrimary = primaryLinesByBookmaker.get(selectedLower);
                  // console.log('[DEBUG] Checking selectedBookmaker:', selectedBookmaker, 'lower:', selectedLower, 'found:', selectedPrimary);
                  if (selectedPrimary && Math.abs(selectedPrimary.line - displayLine) < 0.01) {
                    // console.log('[DEBUG] Using selectedBookmaker primary line:', selectedPrimary);
                    return selectedPrimary;
                  } else if (selectedPrimary) {
                    // console.log('[DEBUG] Selected bookmaker line mismatch:', selectedPrimary.line, 'vs displayLine:', displayLine, 'diff:', Math.abs(selectedPrimary.line - displayLine));
                  }
                }
                
                // Otherwise, find the first bookmaker whose primary line matches
                for (const [bookmakerLower, primaryData] of primaryLinesByBookmaker.entries()) {
                  if (Math.abs(primaryData.line - displayLine) < 0.01) {
                    // console.log('[DEBUG] Found matching primary line:', bookmakerLower, primaryData);
                    return primaryData;
                  }
                }
                
                // console.log('[DEBUG] No matching primary line found for displayLine:', displayLine);
                return null;
              })();
              
              // console.log('[DEBUG] Final displayBookmaker result:', displayBookmaker);
              
              const displayIsPickem = displayBookmaker ? (displayBookmaker.isPickem ?? isPickemBookmakerName(displayBookmaker.bookmaker)) : false;
              const displayPickemVariant = displayBookmaker ? (displayBookmaker.variantLabel ?? null) : null;
              const bookmakerInfo = displayBookmaker ? getBookmakerInfo(displayBookmaker.bookmaker) : null;
              const shouldShowBookmaker = displayBookmaker !== null;
              
              // Check if line came from URL - if so, keep loading until we match it to a bookmaker
              const hasUrlLine = checkUrlLine(displayLine, selectedStat);
              
              // Show loading state if:
              // 1. Odds are loading, OR
              // 2. We have odds data but no match yet (still processing), OR
              // 3. We have a URL line but haven't matched it to a bookmaker yet (to prevent showing "Alt Lines")
              const isProcessingOdds = oddsLoading || (realOddsData && realOddsData.length > 0 && !displayBookmaker) || (hasUrlLine && !displayBookmaker);
              
              return (
                <div className="hidden sm:block relative flex-shrink-0 w-[100px] sm:w-[110px] md:w-[120px]" ref={altLinesRef}>
                  <button
                    onClick={() => setIsAltLinesOpen(!isAltLinesOpen)}
                    className="w-full px-1.5 sm:px-2 py-1 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] sm:h-[36px] overflow-hidden"
                  >
                    <div className="flex items-center gap-1 sm:gap-1.5 flex-1 min-w-0 overflow-hidden">
                      {isProcessingOdds ? (
                        <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                      ) : shouldShowBookmaker && bookmakerInfo && displayBookmaker ? (
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
                          {/* Show Goblin/Demon symbol inline with logo for PrizePicks */}
                          {bookmakerInfo.name === 'PrizePicks' && displayIsPickem && displayPickemVariant ? (
                            <img 
                              src={displayPickemVariant === 'Goblin' ? '/images/goblin.png' : '/images/demon.png'} 
                              alt={displayPickemVariant} 
                              className="w-7 h-7 sm:w-8 sm:h-8 object-contain flex-shrink-0 ml-0.5 mt-0.5"
                              onError={(e) => {
                                // Fallback to text if image fails
                                const img = e.target as HTMLImageElement;
                                img.style.display = 'none';
                                const fallback = document.createElement('span');
                                fallback.className = 'text-[11px] sm:text-xs text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap';
                                fallback.textContent = (bookmakerInfo.name === 'Underdog' || bookmakerInfo.name === 'DraftKings Pick6') ? `Pick'em` : `Pick'em • ${displayPickemVariant}`;
                                if (img.parentElement && img.nextSibling) {
                                  img.parentElement.insertBefore(fallback, img.nextSibling);
                                } else if (img.parentElement) {
                                  img.parentElement.appendChild(fallback);
                                }
                              }}
                            />
                          ) : !displayIsPickem ? (
                            <div className="flex flex-col items-start gap-0.5 min-w-0">
                              {isMoneyline ? (
                                <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">
                                  {bookmakerInfo.name}
                                </span>
                              ) : (
                                <>
                                  {displayBookmaker.over && displayBookmaker.over !== 'N/A' && (
                                    <span className="text-[11px] sm:text-xs text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                                      O&nbsp;{fmtOdds(displayBookmaker.over)}
                                    </span>
                                  )}
                                  {displayBookmaker.under && displayBookmaker.under !== 'N/A' && (
                                    <span className="text-[11px] sm:text-xs text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                                      U&nbsp;{fmtOdds(displayBookmaker.under)}
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] sm:text-xs text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap">
                              Pick&apos;em{displayPickemVariant && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? ` • ${displayPickemVariant}` : ''}
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          {/* Placeholder for logo space */}
                          <div className="w-5 h-5 sm:w-6 sm:h-6 flex-shrink-0" />
                          {/* Text in same structure as odds column */}
                          <div className="flex flex-col items-start gap-0.5 min-w-0">
                            <span className="text-[11px] sm:text-xs text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">Alt Lines</span>
                          </div>
                        </>
                      )}
                    </div>
                    <svg 
                      className={`w-4 h-4 transition-transform flex-shrink-0 ml-auto ${isAltLinesOpen ? 'rotate-180' : ''}`}
                      fill="none" 
                      stroke="currentColor" 
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  
                  {isAltLinesOpen && (
                    <>
                      <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
                        <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                          <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
                        </div>
                        <div className="p-2">
                          {altLines.length === 0 ? (
                            <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                              {(!realOddsData || realOddsData.length === 0) && oddsLoading ? (
                                <div className="space-y-2">
                                  {[...Array(3)].map((_, idx) => (
                                    <div key={idx} className={`h-8 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                  ))}
                                </div>
                              ) : 'No alternative lines available'}
                            </div>
                          ) : (
                            <>
                              {primaryAltLines.map(renderAltLineButton)}
                              {alternateAltLines.length > 0 && (
                                <>
                                  <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Alternate Lines
                                  </div>
                                  {alternateAltLines.map((altLine, idx) =>
                                    renderAltLineButton(altLine, idx + primaryAltLines.length)
                                  )}
                                </>
                              )}
                              {milestoneLines.length > 0 && (
                                <>
                                  <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                    Milestones
                                  </div>
                                  {milestoneLines.map((altLine, idx) =>
                                    renderAltLineButton(altLine, idx + primaryAltLines.length + alternateAltLines.length)
                                  )}
                                </>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => setIsAltLinesOpen(false)}
                      />
                    </>
                  )}
                </div>
              );
            })()}
            
            {/* Left: line input */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-0.5 sm:gap-3 -mt-1 sm:mt-0">
              <div className="flex items-center gap-2 w-full sm:w-auto">
                {/* Alt Lines Button - Mobile only */}
                {(() => {
                  const bookRowKey = getBookRowKey(selectedStat);
                  const isMoneyline = selectedStat === 'moneyline';
                  
                  // Get all available lines for dropdown
              const altLines: AltLineItem[] = realOddsData && realOddsData.length > 0 && bookRowKey
                ? (realOddsData
                    .map((book: any) => {
                      const statData = (book as any)[bookRowKey];
                      if (!statData) return null;
                      
                      // For moneyline (H2H), handle home/away odds differently
                      if (isMoneyline) {
                        if (statData.home === 'N/A' && statData.away === 'N/A') return null;
                        const meta = (book as any).meta || {};
                        return {
                          bookmaker: meta.baseName || book.name,
                          line: 0, // Moneyline doesn't have a line value
                          over: statData.home, // Use home as "over"
                          under: statData.away, // Use away as "under"
                          isPickem: meta.isPickem ?? false,
                          variantLabel: meta.variantLabel ?? null,
                        } as AltLineItem;
                      }
                      
                      // For spread/total (has line value)
                      if (statData.line === 'N/A') return null;
                      const lineValue = parseFloat(statData.line);
                      if (isNaN(lineValue)) return null;
                      const meta = (book as any).meta || {};
                      
                      return {
                        bookmaker: meta.baseName || book.name,
                        line: lineValue,
                        over: statData.over,
                        under: statData.under,
                        isPickem: meta.isPickem ?? false,
                        variantLabel: meta.variantLabel ?? null,
                      } as AltLineItem;
                    })
                    .filter((item: AltLineItem | null): item is AltLineItem => item !== null))
                : [];
              
              altLines.sort((a: AltLineItem, b: AltLineItem) => {
                // First, separate milestones from over/under lines
                const isMilestoneA = a.variantLabel === 'Milestone';
                const isMilestoneB = b.variantLabel === 'Milestone';
                if (isMilestoneA !== isMilestoneB) {
                  // Over/under lines come first (isMilestone = false = 0), milestones come after (true = 1)
                  return (isMilestoneA ? 1 : 0) - (isMilestoneB ? 1 : 0);
                }
                
                // Within same type, sort by pick'em status
                const pickA = a.isPickem ? 0 : 1;
                const pickB = b.isPickem ? 0 : 1;
                if (pickA !== pickB) return pickA - pickB;
                return a.line - b.line;
              });
              
              // Deduplicate: Remove lines with same bookmaker, line value, over odds, and under odds
              const seenMobile = new Set<string>();
              const uniqueAltLinesMobile: AltLineItem[] = [];
              for (const line of altLines) {
                // Create a unique key: bookmaker + line + over + under
                const key = `${(line.bookmaker || '').toLowerCase()}|${line.line}|${line.over}|${line.under}`;
                if (!seenMobile.has(key)) {
                  seenMobile.add(key);
                  uniqueAltLinesMobile.push(line);
                }
              }
              
              const { primary: primaryAltLines, alternate: alternateAltLines, milestones: milestoneLines } = partitionAltLineItems(uniqueAltLinesMobile);
              const renderAltLineButton = (altLine: AltLineItem, idx: number) => {
                const bookmakerInfo = getBookmakerInfo(altLine.bookmaker);
                const isSelected = Math.abs(altLine.line - displayLine) < 0.01;
                const isPickemAlt = altLine.isPickem ?? false;
                const pickemVariant = altLine.variantLabel ?? null;
                
                return (
                  <button
                    key={`${altLine.bookmaker}-${altLine.line}-${idx}`}
                    onClick={() => {
                      onChangeBettingLine(altLine.line);
                      setDisplayLine(altLine.line);
                      setSelectedBookmaker(altLine.bookmaker);
                      setIsAltLinesOpen(false);
                      const input = document.getElementById('betting-line-input') as HTMLInputElement | null;
                      if (input) {
                        input.value = String(altLine.line);
                        transientLineRef.current = altLine.line;
                        if (yAxisConfig) {
                          updateBettingLinePosition(altLine.line, yAxisConfig);
                        }
                        recolorBarsFast(altLine.line);
                        updateOverRatePillFast(altLine.line);
                      }
                    }}
                    className={`w-full px-3 py-2.5 rounded-lg mb-1 last:mb-0 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors ${
                      isSelected ? 'bg-purple-100 dark:bg-purple-900/30 border border-purple-300 dark:border-purple-600' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      {/* Bookmaker Logo */}
                      {bookmakerInfo.logoUrl ? (
                        <img 
                          src={bookmakerInfo.logoUrl} 
                          alt={bookmakerInfo.name}
                          className="w-5 h-5 rounded object-contain flex-shrink-0"
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
                      
                      {/* Line and Bookmaker Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {!isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              {fmtLine(altLine.line)}
                            </span>
                          )}
                          {isMoneyline && (
                            <span className="font-semibold text-sm text-gray-900 dark:text-white">
                              ML
                            </span>
                          )}
                          <span className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {bookmakerInfo.name}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    {/* Odds */}
                    {!isPickemAlt ? (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {altLine.over && altLine.over !== 'N/A' && altLine.over !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                              : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                          }`}>
                            {isMoneyline ? 'Home' : 'O'} {fmtOdds(altLine.over)}
                          </span>
                        )}
                        {altLine.under && altLine.under !== 'N/A' && altLine.under !== 'Pick\'em' && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                            isMoneyline 
                              ? 'bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400' 
                              : 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400'
                          }`}>
                            {isMoneyline ? 'Away' : 'U'} {fmtOdds(altLine.under)}
                          </span>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                        {pickemVariant === 'Goblin' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/goblin.png" 
                            alt="Goblin" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '👹';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : pickemVariant === 'Demon' && bookmakerInfo.name !== 'Underdog' && bookmakerInfo.name !== 'DraftKings Pick6' ? (
                          <img 
                            src="/images/demon.png" 
                            alt="Demon" 
                            className="w-6 h-6 object-contain"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              const img = e.target as HTMLImageElement;
                              img.style.display = 'none';
                              const fallback = document.createElement('span');
                              fallback.className = 'text-lg leading-none';
                              fallback.textContent = '😈';
                              if (img.parentElement && img.nextSibling) {
                                img.parentElement.insertBefore(fallback, img.nextSibling);
                              } else if (img.parentElement) {
                                img.parentElement.appendChild(fallback);
                              }
                            }}
                          />
                        ) : (
                          <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 rounded text-[10px] font-semibold">
                            Pick&apos;em
                          </span>
                        )}
                      </div>
                    )}
                    
                    {/* Selected indicator */}
                    {isSelected && (
                      <svg className="w-4 h-4 text-purple-600 dark:text-purple-400 flex-shrink-0 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                );
              };
                  
                  // Find the bookmaker to display: find the bookmaker whose PRIMARY line matches displayLine
                  const displayBookmaker = (() => {
                    if (!realOddsData || realOddsData.length === 0) return null;
                    
                    // console.log('[DEBUG MOBILE] Finding displayBookmaker for displayLine:', displayLine, 'selectedStat:', selectedStat, 'bookRowKey:', bookRowKey);
                    
                    // Track all lines per bookmaker to identify the true primary line
                    const allLinesByBookmaker = new Map<string, Array<{line: number; over: string; under: string; isPickem: boolean; variantLabel: string | null}>>();
                    
                    // First pass: collect ALL lines for each bookmaker (excluding milestones for initial display)
                    for (const book of realOddsData) {
                      const meta = (book as any)?.meta;
                      const baseName = (meta?.baseName || book?.name || '');
                      const baseNameLower = baseName.toLowerCase();
                      const statKey: string = meta?.stat || bookRowKey;
                      
                      // Only consider entries matching the selected stat
                      if (statKey !== bookRowKey) continue;
                      
                      // Exclude milestones - only show actual over/under lines on initial load
                      if (meta?.variantLabel === 'Milestone') continue;
                      
                      const statData = (book as any)[bookRowKey];
                      if (!statData || statData.line === 'N/A') continue;
                      const lineValue = parseFloat(statData.line);
                      if (isNaN(lineValue)) continue;
                      
                      if (!allLinesByBookmaker.has(baseNameLower)) {
                        allLinesByBookmaker.set(baseNameLower, []);
                      }
                      
                      allLinesByBookmaker.get(baseNameLower)!.push({
                        line: lineValue,
                        over: statData.over,
                        under: statData.under,
                        isPickem: meta?.isPickem ?? false,
                        variantLabel: meta?.variantLabel ?? null,
                      });
                    }
                    
                    // Calculate consensus line by finding the most common line value across ALL bookmakers
                    // Count all line values, not just first lines
                    const lineCounts = new Map<number, number>();
                    for (const [bookmaker, lines] of allLinesByBookmaker.entries()) {
                      for (const line of lines) {
                        lineCounts.set(line.line, (lineCounts.get(line.line) || 0) + 1);
                      }
                    }
                    
                    // Find the most common line (this is our consensus)
                    let consensusLine: number | null = null;
                    let maxCount = 0;
                    for (const [line, count] of lineCounts.entries()) {
                      if (count > maxCount) {
                        maxCount = count;
                        consensusLine = line;
                      }
                    }
                    
                    // console.log('[DEBUG MOBILE] Consensus line (most common across all):', consensusLine, 'appears', maxCount, 'times');
                    
                    // Second pass: identify primary line for each bookmaker
                    // Primary line is ALWAYS the one closest to consensus (if consensus exists)
                    const primaryLinesByBookmaker = new Map<string, any>();
                    for (const [baseNameLower, lines] of allLinesByBookmaker.entries()) {
                      if (lines.length === 0) continue;
                      
                      let primaryLine = lines[0]; // Default to first
                      
                      // If we have a consensus line, ALWAYS use the line closest to it
                      if (consensusLine !== null && lines.length > 1) {
                        let closestLine = lines[0];
                        let minDiff = Math.abs(lines[0].line - consensusLine);
                        
                        for (const line of lines) {
                          const diff = Math.abs(line.line - consensusLine);
                          if (diff < minDiff) {
                            minDiff = diff;
                            closestLine = line;
                          }
                        }
                        
                        // Always use the closest line to consensus (no threshold)
                        primaryLine = closestLine;
                        // console.log('[DEBUG MOBILE] Bookmaker', baseNameLower, '- closest to consensus', consensusLine, 'is', primaryLine.line, '(diff:', minDiff, ')');
                      }
                      
                      // Get the original bookmaker name (preserve case)
                      const firstBook = realOddsData.find((book: any) => {
                        const meta = (book as any)?.meta;
                        const name = (meta?.baseName || book?.name || '').toLowerCase();
                        return name === baseNameLower;
                      });
                      const displayName = firstBook ? ((firstBook as any)?.meta?.baseName || firstBook?.name || baseNameLower) : baseNameLower;
                      
                      primaryLinesByBookmaker.set(baseNameLower, {
                        bookmaker: displayName,
                        line: primaryLine.line,
                        over: primaryLine.over,
                        under: primaryLine.under,
                        isPickem: primaryLine.isPickem,
                        variantLabel: primaryLine.variantLabel,
                      });
                      
                      // console.log('[DEBUG MOBILE] Found primary line:', displayName, 'line:', primaryLine.line, 'over:', primaryLine.over, 'under:', primaryLine.under, '(from', lines.length, 'total lines)');
                    }
                    
                    // console.log('[DEBUG MOBILE] Primary lines map:', Array.from(primaryLinesByBookmaker.entries()).map(([name, data]) => `${name}: ${data.line}`));
                    
                    // Debug: Show all Bovada lines (including alternates)
                    const bovadaLines = bookRowKey ? realOddsData
                      .filter((book: any) => {
                        const meta = (book as any)?.meta;
                        const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                        return baseName.includes('bovada');
                      })
                      .map((book: any) => {
                        const meta = (book as any)?.meta;
                        const statData = (book as any)[bookRowKey];
                        return {
                          baseName: meta?.baseName || book?.name,
                          stat: meta?.stat,
                          line: statData ? statData.line : 'N/A',
                          over: statData ? statData.over : 'N/A',
                          under: statData ? statData.under : 'N/A',
                        };
                      }) : [];
                    // console.log('[DEBUG MOBILE] All Bovada lines for', bookRowKey, ':', bovadaLines);
                    
                    // console.log('[DEBUG MOBILE] selectedBookmaker:', selectedBookmaker);
                    
                    // Second pass: find the bookmaker entry that matches displayLine
                    // If selectedBookmaker is set, check ALL lines (including alternates/Goblin/Demon) for that bookmaker
                    if (selectedBookmaker) {
                      const selectedLower = selectedBookmaker.toLowerCase();
                      
                      // First, try to find an exact match in realOddsData (excluding milestones unless explicitly selected)
                      const exactMatch = bookRowKey ? realOddsData.find((book: any) => {
                        const meta = (book as any)?.meta;
                        const baseName = (meta?.baseName || book?.name || '').toLowerCase();
                        if (baseName !== selectedLower) return false;
                        
                        // If no bookmaker is explicitly selected, exclude milestones
                        // Only show milestones if user explicitly selected that bookmaker's milestone line
                        if (!selectedBookmaker && meta?.variantLabel === 'Milestone') return false;
                        
                        const statData = (book as any)[bookRowKey];
                        if (!statData || statData.line === 'N/A') return false;
                        const lineValue = parseFloat(statData.line);
                        if (isNaN(lineValue)) return false;
                        return Math.abs(lineValue - displayLine) < 0.01;
                      }) : null;
                      
                      if (exactMatch && bookRowKey) {
                        const meta = (exactMatch as any)?.meta;
                        const statData = (exactMatch as any)[bookRowKey];
                        const result = {
                          bookmaker: meta?.baseName || exactMatch?.name || selectedBookmaker,
                          line: parseFloat(statData.line),
                          over: statData.over,
                          under: statData.under,
                          isPickem: meta?.isPickem ?? false,
                          variantLabel: meta?.variantLabel ?? null,
                        };
                        // console.log('[DEBUG MOBILE] Found exact match (including variant):', result);
                        return result;
                      }
                      
                      // Fallback to primary line if no exact match found
                      const selectedPrimary = primaryLinesByBookmaker.get(selectedLower);
                      // console.log('[DEBUG MOBILE] Checking selectedBookmaker:', selectedBookmaker, 'lower:', selectedLower, 'found:', selectedPrimary);
                      if (selectedPrimary && Math.abs(selectedPrimary.line - displayLine) < 0.01) {
                        // console.log('[DEBUG MOBILE] Using selectedBookmaker primary line:', selectedPrimary);
                        return selectedPrimary;
                      } else if (selectedPrimary) {
                        // console.log('[DEBUG MOBILE] Selected bookmaker line mismatch:', selectedPrimary.line, 'vs displayLine:', displayLine, 'diff:', Math.abs(selectedPrimary.line - displayLine));
                      }
                    }
                    
                    // Otherwise, find the first bookmaker whose primary line matches
                    for (const [bookmakerLower, primaryData] of primaryLinesByBookmaker.entries()) {
                      if (Math.abs(primaryData.line - displayLine) < 0.01) {
                        // console.log('[DEBUG MOBILE] Found matching primary line:', bookmakerLower, primaryData);
                        return primaryData;
                      }
                    }
                    
                    // console.log('[DEBUG MOBILE] No matching primary line found for displayLine:', displayLine);
                    return null;
                  })();
                  
                  // console.log('[DEBUG MOBILE] Final displayBookmaker result:', displayBookmaker);
                  
                  const displayIsPickemMobile = displayBookmaker ? (displayBookmaker.isPickem ?? isPickemBookmakerName(displayBookmaker.bookmaker)) : false;
                  const displayPickemVariantMobile = displayBookmaker ? (displayBookmaker.variantLabel ?? null) : null;
                  const bookmakerInfo = displayBookmaker ? getBookmakerInfo(displayBookmaker.bookmaker) : null;
                  const shouldShowBookmaker = displayBookmaker !== null;
                  
                  // Check if line came from URL - if so, keep loading until we match it to a bookmaker
                  const hasUrlLineMobile = checkUrlLine(displayLine, selectedStat);
                  
                  // Show loading state if:
                  // 1. Odds are loading, OR
                  // 2. We have odds data but no match yet (still processing), OR
                  // 3. We have a URL line but haven't matched it to a bookmaker yet (to prevent showing "Alt Lines")
                  const isProcessingOddsMobile = oddsLoading || (realOddsData && realOddsData.length > 0 && !displayBookmaker) || (hasUrlLineMobile && !displayBookmaker);
                  
                  return (
                    <div className="sm:hidden relative flex-shrink-0 w-[100px]" ref={altLinesRef}>
                      <button
                        onClick={() => setIsAltLinesOpen(!isAltLinesOpen)}
                        className="w-full px-2 py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center justify-between transition-colors h-[32px] overflow-hidden"
                      >
                        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-hidden">
                          {isProcessingOddsMobile ? (
                            <div className={`h-4 w-16 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                          ) : shouldShowBookmaker && bookmakerInfo && displayBookmaker ? (
                            <>
                              {bookmakerInfo.logoUrl ? (
                                <img 
                                  src={bookmakerInfo.logoUrl} 
                                  alt={bookmakerInfo.name}
                                  className="w-6 h-6 rounded object-contain flex-shrink-0"
                            onError={(e) => {
                            (e.target as HTMLImageElement).style.display = 'none';
                            const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                            if (fallback) fallback.style.display = 'flex';
                          }}
                                />
                              ) : null}
                              <span className={`text-base flex-shrink-0 ${!bookmakerInfo.logoUrl ? '' : 'hidden'}`}>
                                {bookmakerInfo.logo}
                              </span>
                              {/* Show Goblin/Demon symbol inline with logo for PrizePicks */}
                              {bookmakerInfo.name === 'PrizePicks' && displayIsPickemMobile && displayPickemVariantMobile ? (
                                <img 
                                  src={displayPickemVariantMobile === 'Goblin' ? '/images/goblin.png' : '/images/demon.png'} 
                                  alt={displayPickemVariantMobile} 
                                  className="w-7 h-7 object-contain flex-shrink-0 ml-0.5 mt-0.5"
                                  onError={(e) => {
                                    // Fallback to text if image fails
                                    const img = e.target as HTMLImageElement;
                                    img.style.display = 'none';
                                    const fallback = document.createElement('span');
                                    fallback.className = 'text-[11px] text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap';
                                    fallback.textContent = bookmakerInfo.name === 'Underdog' ? `Pick'em` : `Pick'em • ${displayPickemVariantMobile}`;
                                    if (img.parentElement && img.nextSibling) {
                                      img.parentElement.insertBefore(fallback, img.nextSibling);
                                    } else if (img.parentElement) {
                                      img.parentElement.appendChild(fallback);
                                    }
                                  }}
                                />
                              ) : !displayIsPickemMobile ? (
                                <div className="flex flex-col items-start gap-0.5 min-w-0">
                                  {displayBookmaker.over && displayBookmaker.over !== 'N/A' && (
                                    <span className="text-[11px] text-green-600 dark:text-green-400 font-mono whitespace-nowrap">
                                      O{fmtOdds(displayBookmaker.over)}
                                    </span>
                                  )}
                                  {displayBookmaker.under && displayBookmaker.under !== 'N/A' && (
                                    <span className="text-[11px] text-red-600 dark:text-red-400 font-mono whitespace-nowrap">
                                      U{fmtOdds(displayBookmaker.under)}
                                    </span>
                                  )}
                                </div>
                              ) : (
                                <span className="text-[11px] text-purple-600 dark:text-purple-300 font-semibold whitespace-nowrap">
                                  Pick&apos;em{displayPickemVariantMobile && bookmakerInfo.name !== 'Underdog' ? ` • ${displayPickemVariantMobile}` : ''}
                                </span>
                              )}
                            </>
                          ) : (
                            <>
                              <div className="w-5 h-5 flex-shrink-0" />
                              <div className="flex flex-col items-start gap-0.5 min-w-0">
                                <span className="text-[11px] text-gray-700 dark:text-gray-300 font-medium whitespace-nowrap">Alt Lines</span>
                              </div>
                            </>
                          )}
                        </div>
                        <svg 
                          className={`w-4 h-4 transition-transform flex-shrink-0 ml-auto ${isAltLinesOpen ? 'rotate-180' : ''}`}
                          fill="none" 
                          stroke="currentColor" 
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      
                      {isAltLinesOpen && (
                        <>
                          <div className="absolute top-full left-0 mt-1 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg z-50 min-w-[280px] max-w-[320px] max-h-[400px] overflow-y-auto">
                            <div className="p-3 border-b border-gray-200 dark:border-gray-600">
                              <div className="text-xs font-semibold text-gray-700 dark:text-gray-300">Alt Lines</div>
                            </div>
                            <div className="p-2">
                              {altLines.length === 0 ? (
                                <div className="px-3 py-4 text-center text-xs text-gray-500 dark:text-gray-400">
                                  {(!realOddsData || realOddsData.length === 0) && oddsLoading ? (
                                    <div className="space-y-2">
                                      {[...Array(3)].map((_, idx) => (
                                        <div key={idx} className={`h-8 w-full rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`} style={{ animationDelay: `${idx * 0.1}s` }}></div>
                                      ))}
                                    </div>
                                  ) : 'No alternative lines available'}
                                </div>
                              ) : (
                                <>
                                  {primaryAltLines.map(renderAltLineButton)}
                                  {alternateAltLines.length > 0 && (
                                    <>
                                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Alternate Lines
                                      </div>
                                      {alternateAltLines.map((altLine, idx) =>
                                        renderAltLineButton(altLine, idx + primaryAltLines.length)
                                      )}
                                    </>
                                  )}
                                  {milestoneLines.length > 0 && (
                                    <>
                                      <div className="px-3 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                                        Milestones
                                      </div>
                                      {milestoneLines.map((altLine, idx) =>
                                        renderAltLineButton(altLine, idx + primaryAltLines.length + alternateAltLines.length)
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                            </div>
                          </div>
                          <div 
                            className="fixed inset-0 z-40" 
                            onClick={() => setIsAltLinesOpen(false)}
                          />
                        </>
                      )}
                    </div>
                  );
                })()}
                {selectedStat === 'moneyline' ? (
                  // For moneyline, show odds instead of betting line input
                  (() => {
                    // Show loading state if odds are loading
                    if (oddsLoading) {
                      return (
                        <div className="px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg">
                          <div className={`h-5 w-20 rounded animate-pulse ${isDark ? 'bg-gray-800' : 'bg-gray-200'}`}></div>
                        </div>
                      );
                    }
                    
                    const bookRowKey = getBookRowKey(selectedStat);
                    const displayBookmaker = (() => {
                      if (!realOddsData || realOddsData.length === 0 || !bookRowKey) return null;
                      // For moneyline, just get the first available bookmaker
                      for (const book of realOddsData) {
                        const statData = (book as any)[bookRowKey];
                        if (statData && (statData.home !== 'N/A' || statData.away !== 'N/A')) {
                          const meta = (book as any).meta || {};
                          return {
                            bookmaker: meta.baseName || book.name,
                            over: statData.home,
                            under: statData.away,
                          };
                        }
                      }
                      return null;
                    })();
                    
                    if (displayBookmaker) {
                      const bookmakerInfo = getBookmakerInfo(displayBookmaker.bookmaker);
                      return (
                        <div className="flex items-center gap-2 px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg">
                          {bookmakerInfo?.logoUrl ? (
                            <img 
                              src={bookmakerInfo.logoUrl} 
                              alt={bookmakerInfo.name}
                              className="w-5 h-5 rounded object-contain flex-shrink-0"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                if (fallback) fallback.style.display = 'flex';
                              }}
                            />
                          ) : null}
                          <span 
                            className={`text-xs font-semibold text-white px-1.5 py-0.5 rounded flex-shrink-0 items-center justify-center min-w-[1.25rem] h-5 ${!bookmakerInfo?.logoUrl ? 'flex' : 'hidden'}`}
                            style={{ backgroundColor: bookmakerInfo?.color || '#6B7280' }}
                          >
                            {bookmakerInfo?.logo || ''}
                          </span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs sm:text-sm font-mono text-blue-600 dark:text-blue-400">
                              Home {fmtOdds(displayBookmaker.over)}
                            </span>
                            <span className="text-xs sm:text-sm font-mono text-orange-600 dark:text-orange-400">
                              Away {fmtOdds(displayBookmaker.under)}
                            </span>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <div className="px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-xs text-gray-500 dark:text-gray-400">
                        No odds available
                      </div>
                    );
                  })()
                ) : (
                  <input
                    id="betting-line-input"
                    type="number" 
                    step="0.5" 
                    {...((['spread', 'moneyline'].includes(selectedStat)) ? {} : { min: "0" })}
                    key={selectedStat}
                    defaultValue={bettingLine}
                    onChange={(e) => {
                      const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                      if (!Number.isFinite(v)) return;
                      transientLineRef.current = v;
                      hasManuallySetLineRef.current = true; // Mark as manually set to prevent auto-updates
                      
                      // Update displayLine immediately for instant bookmaker detection
                      setDisplayLine(v);
                      
                      // Update visual elements immediately (no lag)
                      if (yAxisConfig) {
                        updateBettingLinePosition(v, yAxisConfig);
                      }
                      recolorBarsFast(v);
                      updateOverRatePillFast(v);
                      try { window.dispatchEvent(new CustomEvent('transient-line', { detail: { value: v } })); } catch {}
                      
                      // Debounce state update to reduce re-renders (bookmaker detection will run after debounce)
                      if (bettingLineDebounceRef.current) {
                        clearTimeout(bettingLineDebounceRef.current);
                      }
                      bettingLineDebounceRef.current = setTimeout(() => {
                        onChangeBettingLine(v);
                        bettingLineDebounceRef.current = null;
                      }, 300);
                    }}
                    onBlur={(e) => {
                      const v = parseFloat((e.currentTarget as HTMLInputElement).value);
                      if (Number.isFinite(v)) {
                        transientLineRef.current = v;
                        hasManuallySetLineRef.current = true; // Mark as manually set
                        
                        // Only update if value actually changed to prevent unnecessary re-renders
                        if (Math.abs(bettingLine - v) < 0.01) {
                          // Value hasn't changed, just update displayLine if needed
                          setDisplayLine((prev: number) => {
                            if (Math.abs(prev - v) < 0.01) return prev;
                            return v;
                          });
                          // Clear any pending debounce
                          if (bettingLineDebounceRef.current) {
                            clearTimeout(bettingLineDebounceRef.current);
                            bettingLineDebounceRef.current = null;
                          }
                          return; // Skip state update since value hasn't changed
                        }
                        
                        // Update displayLine immediately
                        setDisplayLine(v);
                        
                        // Clear any pending debounce and update immediately
                        if (bettingLineDebounceRef.current) {
                          clearTimeout(bettingLineDebounceRef.current);
                          bettingLineDebounceRef.current = null;
                        }
                        onChangeBettingLine(v);
                        // selectedBookmaker will be auto-updated by useEffect if a matching bookmaker is found
                      }
                    }}
                    className="w-20 sm:w-16 md:w-18 lg:w-20 px-2.5 sm:px-2 md:px-3 py-1.5 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg text-sm sm:text-xs md:text-sm font-medium text-gray-900 dark:text-white text-center focus:ring-2 focus:ring-purple-500 focus:border-purple-500"
                  />
                )}
              </div>
              {/* Timeframe filter - Desktop only, positioned next to betting line */}
              <div className="hidden sm:flex flex-shrink-0 gap-2 items-center">
                {TimeframeButtons}
                {/* Splits Container - Desktop */}
                <div className="relative">
                  <button
                    onClick={() => setIsSplitsOpen((v: boolean) => !v)}
                    className="w-20 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center"
                  >
                    Splits
                  </button>
                  {isSplitsOpen && (
                    <div className="absolute right-0 mt-1 w-64 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-lg shadow-lg p-3 z-50">
                      <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">Splits</div>
                      <div className="space-y-2">
                        {/* Home/Away */}
                        <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-2">
                          <div className="mb-1 text-[10px] text-gray-500 dark:text-gray-400">Home/Away</div>
                          <HomeAwaySelect value={homeAway} onChange={onChangeHomeAway} isDark={isDark} />
                        </div>
                        {/* Exclude Blowouts */}
                        <button
                          onClick={() => onExcludeBlowoutsChange(!excludeBlowouts)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Exclude Blowouts (±21)</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBlowouts ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBlowouts ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                        {/* Back-to-Back */}
                        <button
                          onClick={() => onExcludeBackToBackChange(!excludeBackToBack)}
                          className="w-full flex items-center justify-between px-2 py-1.5 border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700/50"
                        >
                          <span className="text-xs text-gray-700 dark:text-gray-300">Back-to-Back</span>
                          <span className={`inline-block h-4 w-7 rounded-full ${excludeBackToBack ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
                            <span className={`block h-3 w-3 bg-white rounded-full transform ${excludeBackToBack ? 'translate-x-4' : 'translate-x-1'}`} />
                          </span>
                        </button>
                      </div>
                    </div>
                  )}
                  {isSplitsOpen && (
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setIsSplitsOpen(false)}
                    />
                  )}
                </div>
              </div>
            </div>
            {/* Mobile: Filters inline with line input */}
            <div className="sm:hidden flex items-center flex-wrap gap-2.5 ml-2 mt-4">
              <div className="mr-1">
                <OpponentSelector
                  currentOpponent={currentOpponent}
                  manualOpponent={manualOpponent}
                  onOpponentChange={onOpponentChange}
                  isDark={isDark}
                  propsMode={propsMode}
                  currentTeam={currentTeam}
                  selectedTimeframe={selectedTimeframe}
                />
              </div>
              <div className="-ml-2"><HomeAwaySelect value={homeAway} onChange={onChangeHomeAway} isDark={isDark} /></div>
              <div className="flex-shrink-0 mr-1">
                {TimeframeButtons}
              </div>
              {propsMode === 'player' && (
                <button
                  onClick={() => effectiveSetShowAdvancedFilters((v: boolean) => !v)}
                  className={`w-20 px-2 py-1.5 h-[32px] bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-xs font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center flex items-center justify-center relative ${effectiveShowAdvancedFilters ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''}`}
                >
                  Advanced
                </button>
              )}
            </div>
            {/* Middle: Over Rate pill in header - Hidden on desktop to use in-chart placement */}
          <div className="hidden">
            <span className="text-xs sm:text-sm font-medium text-gray-700 dark:text-gray-300 hidden sm:inline">Over Rate:</span>
            <span className="text-xs font-medium text-gray-700 dark:text-gray-300 sm:hidden ml-1">Rate:</span>
            <div className="ml-1">
              <OverRatePill 
                overCount={chartData.filter((d: any) => d.value > bettingLine).length} 
                total={chartData.length} 
                isDark={isDark} 
              />
            </div>
          </div>
            {/* Right: VS (opponent), H/A, and Timeframe inline - Desktop only */}
            <div className="hidden sm:flex items-center flex-wrap gap-2 sm:gap-3 ml-auto">
              <div className="mr-1 sm:mr-0">
                <OpponentSelector
                  currentOpponent={currentOpponent}
                  manualOpponent={manualOpponent}
                  onOpponentChange={onOpponentChange}
                  isDark={isDark}
                  propsMode={propsMode}
                  currentTeam={currentTeam}
                  selectedTimeframe={selectedTimeframe}
                />
              </div>
              {propsMode === 'player' && (
                <button
                  onClick={() => effectiveSetShowAdvancedFilters((v: boolean) => !v)}
                  className={`w-16 sm:w-24 md:w-28 px-2 sm:px-2 md:px-3 py-2 sm:py-1.5 bg-white dark:bg-[#0a1929] border border-gray-300 dark:border-gray-600 rounded-xl text-sm font-medium text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-600 text-center relative ${effectiveShowAdvancedFilters ? 'bg-purple-100 dark:bg-purple-900/30 border-purple-300 dark:border-purple-600 shadow-[0_0_15px_rgba(139,92,246,0.5)] dark:shadow-[0_0_15px_rgba(139,92,246,0.7)]' : ''}`}
                >
                  Advanced
                </button>
              )}
            </div>
          </div>

          {/* Subtle divider under timeframe controls */}
          <div className="w-full h-px bg-gray-300 dark:bg-gray-600/50 opacity-30 mt-1 sm:mt-2" />
          
          {/* Bottom row cleared - controls moved higher */}
        </div>
      </>
    );
};

export default ChartControls;
