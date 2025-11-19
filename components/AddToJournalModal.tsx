"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X, Loader2, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { getBookmakerInfo } from "@/lib/bookmakers";
import { formatOdds, getCurrencySymbol, americanToDecimal } from "@/lib/currencyUtils";

// Component to handle bookmaker logo with fallback
function BookmakerLogo({ logoUrl, name, fallbackEmoji }: { logoUrl: string; name: string; fallbackEmoji: string }) {
  const [imgError, setImgError] = useState(false);

  if (imgError || !logoUrl) {
    return <span className="text-2xl">{fallbackEmoji}</span>;
  }

  return (
    <img 
      src={logoUrl} 
      alt={name}
      className="w-8 h-8 object-contain flex-shrink-0"
      onError={() => {
        console.warn(`Failed to load logo for ${name} from ${logoUrl}`);
        setImgError(true);
      }}
      onLoad={() => {
        console.log(`Successfully loaded logo for ${name}`);
      }}
    />
  );
}

interface AddToJournalModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  gameDate: string;
  oddsFormat: 'american' | 'decimal';
  isGameProp?: boolean;
}

const PLAYER_STAT_OPTIONS = [
  { value: 'pts', label: 'Points' },
  { value: 'reb', label: 'Rebounds' },
  { value: 'ast', label: 'Assists' },
  { value: 'pr', label: 'Points + Rebounds' },
  { value: 'pra', label: 'Points + Rebounds + Assists' },
  { value: 'ra', label: 'Rebounds + Assists' },
  { value: 'stl', label: 'Steals' },
  { value: 'blk', label: 'Blocks' },
  { value: 'fg3m', label: '3-Pointers Made' },
];

const GAME_PROP_STAT_OPTIONS = [
  { value: 'moneyline', label: 'Moneyline' },
  { value: 'spread', label: 'Spread' },
  { value: 'total_pts', label: 'Total Points' },
  { value: 'home_total', label: 'Home Total' },
  { value: 'away_total', label: 'Away Total' },
  { value: 'first_half_total', label: '1st Half Total' },
  { value: 'second_half_total', label: '2nd Half Total' },
  { value: 'q1_total', label: 'Q1 Total' },
  { value: 'q2_total', label: 'Q2 Total' },
  { value: 'q3_total', label: 'Q3 Total' },
  { value: 'q4_total', label: 'Q4 Total' },
  { value: 'q1_moneyline', label: 'Q1 Moneyline' },
  { value: 'q2_moneyline', label: 'Q2 Moneyline' },
  { value: 'q3_moneyline', label: 'Q3 Moneyline' },
  { value: 'q4_moneyline', label: 'Q4 Moneyline' },
];

const CURRENCIES = ['USD', 'AUD', 'GBP', 'EUR'] as const;

interface BookmakerOdds {
  bookmaker: string;
  line: number;
  overPrice: number;
  underPrice: number;
}

interface ParlaySelection {
  id: string;
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  gameDate: string;
  statType: string;
  line: number;
  overUnder: 'over' | 'under';
  odds: number;
  bookmaker: string | null;
  isManual: boolean;
}

export default function AddToJournalModal({
  isOpen,
  onClose,
  playerName,
  playerId,
  team,
  opponent,
  gameDate,
  oddsFormat,
  isGameProp = false,
}: AddToJournalModalProps) {
  const STAT_OPTIONS = isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
  const [statType, setStatType] = useState(isGameProp ? 'moneyline' : 'pts');
  const [selectedOdds, setSelectedOdds] = useState<BookmakerOdds | null>(null);
  const [overUnder, setOverUnder] = useState<'over' | 'under'>('over');
  const [stake, setStake] = useState('');
  const [currency, setCurrency] = useState<typeof CURRENCIES[number]>('USD');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  
  // Odds fetching
  const [oddsLoading, setOddsLoading] = useState(false);
  const [availableOdds, setAvailableOdds] = useState<BookmakerOdds[]>([]);
  const [oddsError, setOddsError] = useState('');
  
  // Section expansion states
  const [bookmakerExpanded, setBookmakerExpanded] = useState(false);
  const [manualExpanded, setManualExpanded] = useState(false);
  
  // Manual entry fields
  const [manualLine, setManualLine] = useState('');
  const [manualOdds, setManualOdds] = useState('');
  const [isManualMode, setIsManualMode] = useState(false);
  
  // Parlay mode
  const [isParlayMode, setIsParlayMode] = useState(false);
  const [parlaySelections, setParlaySelections] = useState<ParlaySelection[]>([]);

  // Fetch odds when modal opens or stat type changes
  useEffect(() => {
    if (!isOpen || !playerName) return;

    const fetchOdds = async () => {
      setOddsLoading(true);
      setOddsError('');
      setAvailableOdds([]);
      setSelectedOdds(null);

      try {
        const response = await fetch(
          `/api/player-props?player=${encodeURIComponent(playerName)}&stat=${statType}`
        );
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || 'Failed to fetch odds');

        setAvailableOdds(data.props || []);
        // Auto-select first option if available
        if (data.props && data.props.length > 0) {
          setSelectedOdds(data.props[0]);
        }
      } catch (err: any) {
        setOddsError(err.message || 'Failed to load odds');
      } finally {
        setOddsLoading(false);
      }
    };

    fetchOdds();
  }, [isOpen, playerName, statType]);

  // Convert odds to decimal for parlay calculation
  const toDecimalOdds = (odds: number, format: 'american' | 'decimal'): number => {
    if (format === 'decimal') return odds;
    return americanToDecimal(odds);
  };

  // Calculate combined parlay odds
  const calculateParlayOdds = (selections: ParlaySelection[], format: 'american' | 'decimal'): number => {
    if (selections.length === 0) return 1;
    
    // Convert all to decimal, multiply, then convert back if needed
    const decimalOdds = selections.reduce((acc, sel) => {
      const dec = toDecimalOdds(sel.odds, format);
      return acc * dec;
    }, 1);
    
    if (format === 'decimal') return decimalOdds;
    
    // Convert back to American
    if (decimalOdds >= 2.0) {
      return Math.round((decimalOdds - 1) * 100);
    } else {
      return -Math.round(100 / (decimalOdds - 1));
    }
  };

  // Add current selection to parlay
  const addToParlay = () => {
    if (isManualMode) {
      if (!manualLine || !manualOdds) {
        setError('Please enter both line and odds');
        return;
      }
    } else {
      if (!selectedOdds) {
        setError('Please select a bookmaker line or use manual entry');
        return;
      }
    }

    const statLabel = STAT_OPTIONS.find(opt => opt.value === statType)?.label || statType.toUpperCase();
    const finalLine = isManualMode ? parseFloat(manualLine) : selectedOdds!.line;
    const finalOdds = isManualMode ? parseFloat(manualOdds) : (overUnder === 'over' ? selectedOdds!.overPrice : selectedOdds!.underPrice);
    const bookmakerName = !isManualMode && selectedOdds ? selectedOdds.bookmaker : null;

    const newSelection: ParlaySelection = {
      id: `${Date.now()}-${Math.random()}`,
      playerName,
      playerId,
      team,
      opponent,
      gameDate,
      statType,
      line: finalLine,
      overUnder,
      odds: finalOdds,
      bookmaker: bookmakerName,
      isManual: isManualMode,
    };

    setParlaySelections([...parlaySelections, newSelection]);
    
    // Reset form for next selection (but keep stake if parlay is ready)
    setStatType(isGameProp ? 'moneyline' : 'pts');
    setSelectedOdds(null);
    setOverUnder('over');
    setManualLine('');
    setManualOdds('');
    setIsManualMode(false);
    setBookmakerExpanded(false);
    setManualExpanded(false);
    setError('');
    
    // Clear stake when adding first selection (will be enabled after 2nd selection)
    if (parlaySelections.length === 0) {
      setStake('');
    }
  };

  // Remove selection from parlay
  const removeFromParlay = (id: string) => {
    const newSelections = parlaySelections.filter(sel => sel.id !== id);
    setParlaySelections(newSelections);
    // Clear stake if we go below 2 selections
    if (newSelections.length < 2) {
      setStake('');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isParlayMode) {
      // Parlay mode validation
      if (parlaySelections.length < 2) {
        setError('Parlay must have at least 2 selections');
        return;
      }
      if (!stake) {
        setError('Please enter a stake');
        return;
      }
    } else {
      // Single bet validation
      if (isManualMode) {
        if (!manualLine || !manualOdds) {
          setError('Please enter both line and odds');
          return;
        }
      } else {
        if (!selectedOdds) {
          setError('Please select a bookmaker line or use manual entry');
          return;
        }
      }
    }
    
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      if (isParlayMode) {
        // Handle parlay submission
        const combinedOdds = calculateParlayOdds(parlaySelections, oddsFormat);
        const selectionTexts = parlaySelections.map(sel => {
          const statLabel = STAT_OPTIONS.find(opt => opt.value === sel.statType)?.label || sel.statType.toUpperCase();
          return `${sel.playerName} ${sel.overUnder} ${sel.line} ${statLabel}`;
        });
        const selection = `Parlay: ${selectionTexts.join(' + ')}`;
        const market = `Parlay (${parlaySelections.length} legs)`;

        // Collect all bookmakers from parlay legs
        const bookmakers = parlaySelections
          .map(sel => sel.bookmaker)
          .filter((name): name is string => Boolean(name && name.trim()));

        const { error: insertError } = await (supabase
          .from('bets') as any)
          .insert({
            user_id: user.id,
            date: parlaySelections[0].gameDate, // Use first selection's date
            sport: 'NBA',
            market,
            selection,
            stake: parseFloat(stake),
            currency,
            odds: combinedOdds,
            result: 'pending',
            status: 'pending',
            bookmaker: bookmakers.length > 0 ? JSON.stringify(bookmakers) : null,
            // Store parlay selections as JSON in a text field (we'll use selection field for now, or add a new column)
            // For now, we'll store the JSON in a way that can be parsed later
            // We can add a parlay_selections JSONB column later if needed
          });

        if (insertError) throw insertError;
      } else {
        // Handle single bet submission
        const statLabel = STAT_OPTIONS.find(opt => opt.value === statType)?.label || statType.toUpperCase();
        
        // Determine line and odds based on mode
        const finalLine = isManualMode ? parseFloat(manualLine) : selectedOdds!.line;
        const finalOdds = isManualMode ? parseFloat(manualOdds) : (overUnder === 'over' ? selectedOdds!.overPrice : selectedOdds!.underPrice);
        
        const selection = `${playerName} ${overUnder} ${finalLine} ${statLabel}`;
        const market = `Player ${statLabel}`;
        
        // Get bookmaker name if odds were selected from a bookmaker
        const bookmakerName = !isManualMode && selectedOdds ? selectedOdds.bookmaker : null;

        const { error: insertError } = await (supabase
          .from('bets') as any)
          .insert({
            user_id: user.id,
            date: gameDate,
            sport: 'NBA',
            market,
            selection,
            stake: parseFloat(stake),
            currency,
            odds: finalOdds,
            result: 'pending',
            player_id: playerId,
            player_name: playerName,
            team,
            opponent,
            stat_type: statType,
            line: finalLine,
            over_under: overUnder,
            game_date: gameDate,
            status: 'pending',
            bookmaker: bookmakerName,
          });

        if (insertError) throw insertError;
      }

      // Success!
      onClose();
      // Reset form
      setStatType(isGameProp ? 'moneyline' : 'pts');
      setSelectedOdds(null);
      setOverUnder('over');
      setStake('');
      setManualLine('');
      setManualOdds('');
      setIsManualMode(false);
      setBookmakerExpanded(false);
      setManualExpanded(false);
      setIsParlayMode(false);
      setParlaySelections([]);
    } catch (err: any) {
      setError(err.message || 'Failed to add to journal');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6 max-h-[90vh] overflow-y-auto custom-scrollbar">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Add to Journal</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {playerName} vs {opponent}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Parlay Mode Toggle */}
          <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg border border-gray-200 dark:border-gray-600">
            <div>
              <label className="text-sm font-medium text-gray-900 dark:text-white">Bet Type</label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                {isParlayMode ? 'Parlay (multiple selections)' : 'Single Bet'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setIsParlayMode(!isParlayMode);
                if (!isParlayMode) {
                  // Switching to parlay mode - clear current selection and stake
                  setParlaySelections([]);
                  setStake('');
                } else {
                  // Switching to single bet mode - clear parlay
                  setParlaySelections([]);
                }
              }}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isParlayMode ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isParlayMode ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Parlay Selections List */}
          {isParlayMode && parlaySelections.length > 0 && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3 bg-gray-50 dark:bg-gray-700/30">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                  Parlay Selections ({parlaySelections.length})
                </h3>
                <div className="text-sm font-medium text-purple-600 dark:text-purple-400">
                  Combined Odds: {formatOdds(calculateParlayOdds(parlaySelections, oddsFormat), oddsFormat)}
                </div>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar">
                {parlaySelections.map((sel) => {
                  const statLabel = STAT_OPTIONS.find(opt => opt.value === sel.statType)?.label || sel.statType.toUpperCase();
                  return (
                    <div
                      key={sel.id}
                      className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                          {sel.playerName} {sel.overUnder} {sel.line} {statLabel}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {formatOdds(sel.odds, oddsFormat)} {sel.bookmaker ? `• ${sel.bookmaker}` : '• Manual'}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFromParlay(sel.id)}
                        className="ml-2 p-1 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Stat Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Stat Type
            </label>
            <select
              value={statType}
              onChange={(e) => setStatType(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              required
            >
              {STAT_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* Live Bookmaker Odds Section */}
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setBookmakerExpanded(!bookmakerExpanded);
                if (!bookmakerExpanded) {
                  setManualExpanded(false);
                  setIsManualMode(false);
                }
              }}
              className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-2">
                {bookmakerExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                <span className="font-medium text-gray-900 dark:text-white">Live Bookmaker Odds</span>
              </div>
              {!oddsLoading && availableOdds.length > 0 && (
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {availableOdds.length} bookmaker{availableOdds.length !== 1 ? 's' : ''}
                </span>
              )}
            </button>
            
            {bookmakerExpanded && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-600">
                {oddsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                    <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading odds...</span>
                  </div>
                ) : oddsError ? (
                  <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm">
                    {oddsError}
                  </div>
                ) : availableOdds.length === 0 ? (
                  <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 text-sm">
                    No live odds available for this prop
                  </div>
                ) : (
                  <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar">
                    {availableOdds.map((odds, idx) => {
                      const bookmaker = getBookmakerInfo(odds.bookmaker);
                      // Debug: log bookmaker info
                      if (!bookmaker.logoUrl) {
                        console.log(`No logo URL for bookmaker: ${odds.bookmaker}, got:`, bookmaker);
                      }
                      const isSelected = !isManualMode && selectedOdds?.bookmaker === odds.bookmaker && selectedOdds?.line === odds.line;
                      
                      return (
                        <button
                          key={`${odds.bookmaker}-${odds.line}-${idx}`}
                          type="button"
                          onClick={() => {
                            setSelectedOdds(odds);
                            setIsManualMode(false);
                          }}
                          className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                            isSelected
                              ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                              : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 bg-white dark:bg-slate-700'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              {bookmaker.logoUrl ? (
                                <BookmakerLogo 
                                  logoUrl={bookmaker.logoUrl}
                                  name={bookmaker.name}
                                  fallbackEmoji={bookmaker.logo}
                                />
                              ) : (
                                <span className="text-2xl">{bookmaker.logo}</span>
                              )}
                              <div>
                                <div className="font-semibold text-sm text-gray-900 dark:text-white">
                                  {bookmaker.name}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  Line: {odds.line}
                                </div>
                              </div>
                            </div>
                          <div className="flex gap-2">
                            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                              O {formatOdds(odds.overPrice, oddsFormat)}
                            </span>
                            <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                              U {formatOdds(odds.underPrice, oddsFormat)}
                            </span>
                          </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual Entry Section */}
          <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setManualExpanded(!manualExpanded);
                if (!manualExpanded) {
                  setBookmakerExpanded(false);
                  setIsManualMode(true);
                  setSelectedOdds(null);
                }
              }}
              className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
            >
              <div className="flex items-center gap-2">
                {manualExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                <span className="font-medium text-gray-900 dark:text-white">Manual Entry</span>
              </div>
            </button>
            
            {manualExpanded && (
              <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Line
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={manualLine}
                    onChange={(e) => setManualLine(e.target.value)}
                    placeholder="e.g., 25.5"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Odds ({oddsFormat === 'decimal' ? 'Decimal' : 'American'})
                  </label>
                  <input
                    type="number"
                    step={oddsFormat === 'decimal' ? '0.01' : '1'}
                    value={manualOdds}
                    onChange={(e) => setManualOdds(e.target.value)}
                    placeholder={oddsFormat === 'decimal' ? 'e.g., 1.91' : 'e.g., -110'}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Over/Under Toggle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Direction
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOverUnder('over')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                  overUnder === 'over'
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Over
              </button>
              <button
                type="button"
                onClick={() => setOverUnder('under')}
                className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors ${
                  overUnder === 'under'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                }`}
              >
                Under
              </button>
            </div>
          </div>

          {/* Stake with Currency */}
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Currency
              </label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as typeof CURRENCIES[number])}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                required
                disabled={isParlayMode && parlaySelections.length < 2}
              >
                {CURRENCIES.map(curr => (
                  <option key={curr} value={curr}>{curr}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Stake
              </label>
              <div className="relative">
                <span className={`absolute left-3 font-medium pointer-events-none text-base ${
                  isParlayMode && parlaySelections.length < 2
                    ? 'text-gray-400 dark:text-gray-600'
                    : 'text-gray-500 dark:text-gray-400'
                }`} style={{ 
                  top: '0.5rem',
                  lineHeight: '1.5rem'
                }}>
                  {getCurrencySymbol(currency)}
                </span>
                <input
                  type="number"
                  step="0.01"
                  value={stake}
                  onChange={(e) => setStake(e.target.value)}
                  placeholder="100"
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-100 dark:disabled:bg-gray-800 text-base"
                  required
                  disabled={isParlayMode && parlaySelections.length < 2}
                />
                {isParlayMode && parlaySelections.length < 2 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Add at least 2 selections to enable stake
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-4">
            {isParlayMode ? (
              <>
                <button
                  type="button"
                  onClick={addToParlay}
                  className="flex-1 px-4 py-2 border-2 border-purple-600 text-purple-600 dark:text-purple-400 rounded-lg font-medium hover:bg-purple-50 dark:hover:bg-purple-900/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  disabled={loading || oddsLoading}
                >
                  <Plus className="w-4 h-4" />
                  Add to Parlay
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading || parlaySelections.length < 2}
                >
                  {loading ? 'Adding...' : `Submit Parlay (${parlaySelections.length})`}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 font-medium transition-colors"
                  disabled={loading}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={loading}
                >
                  {loading ? 'Adding...' : 'Add to Journal'}
                </button>
              </>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
