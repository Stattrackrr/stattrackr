"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { getBookmakerInfo } from "@/lib/bookmakers";
import { formatOdds } from "@/lib/currencyUtils";
import { useTrackedBets } from "@/contexts/TrackedBetsContext";

interface TrackPlayerModalProps {
  isOpen: boolean;
  onClose: () => void;
  playerName: string;
  playerId: string;
  team: string;
  opponent: string;
  gameDate: string;
  oddsFormat: 'american' | 'decimal';
}

const STAT_OPTIONS = [
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

// Common bookmaker lines for NBA props
const COMMON_LINES = [
  '0.5', '1.5', '2.5', '3.5', '4.5', '5.5', '6.5', '7.5', '8.5', '9.5',
  '10.5', '11.5', '12.5', '13.5', '14.5', '15.5', '16.5', '17.5', '18.5', '19.5',
  '20.5', '21.5', '22.5', '23.5', '24.5', '25.5', '26.5', '27.5', '28.5', '29.5',
  '30.5', '31.5', '32.5', '33.5', '34.5', '35.5', '36.5', '37.5', '38.5', '39.5',
  '40.5', '42.5', '44.5', '46.5', '48.5', '50.5'
];

interface BookmakerOdds {
  bookmaker: string;
  line: number;
  overPrice: number;
  underPrice: number;
}

export default function TrackPlayerModal({
  isOpen,
  onClose,
  playerName,
  playerId,
  team,
  opponent,
  gameDate,
  oddsFormat,
}: TrackPlayerModalProps) {
  const { addTrackedBet } = useTrackedBets();
  const [statType, setStatType] = useState('pts');
  const [selectedOdds, setSelectedOdds] = useState<BookmakerOdds | null>(null);
  const [overUnder, setOverUnder] = useState<'over' | 'under'>('over');
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
  const [isManualMode, setIsManualMode] = useState(false);

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
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate based on mode
    if (isManualMode) {
      if (!manualLine) {
        setError('Please enter a line');
        return;
      }
    } else {
      if (!selectedOdds) {
        setError('Please select a bookmaker line or use manual entry');
        return;
      }
    }
    
    setLoading(true);
    setError('');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Determine line and odds based on mode
      const finalLine = isManualMode ? parseFloat(manualLine) : selectedOdds!.line;
      const finalOdds = isManualMode ? null : (overUnder === 'over' ? selectedOdds!.overPrice : selectedOdds!.underPrice);
      
      // Insert into tracked_props
      const { data: insertedProp, error: insertError } = await supabase
        .from('tracked_props')
        .insert({
          user_id: user.id,
          player_id: playerId,
          player_name: playerName,
          team,
          opponent,
          stat_type: statType,
          line: finalLine,
          over_under: overUnder,
          game_date: gameDate,
          status: 'pending',
        })
        .select()
        .single();

      if (insertError) throw insertError;
      
      // Add to tracked bets context for RightSidebar
      if (insertedProp) {
        const statLabel = STAT_OPTIONS.find(opt => opt.value === statType)?.label || statType;
        const bookmakerName = !isManualMode && selectedOdds ? getBookmakerInfo(selectedOdds.bookmaker).name : null;
        const newBet = {
          id: insertedProp.id,
          selection: `${playerName} ${statLabel} ${overUnder === 'over' ? 'Over' : 'Under'} ${finalLine}`,
          stake: 0,
          odds: finalOdds || 0, // Use 0 for manual entries without odds
          sport: 'NBA',
          playerName,
          stat: statType,
          line: finalLine,
          bookmaker: bookmakerName,
          isCustom: isManualMode,
          gameStatus: 'scheduled' as const,
          result: 'pending' as const,
        };
        console.log('Adding tracked bet:', newBet);
        addTrackedBet(newBet);
      }

      // Success!
      onClose();
      // Reset form
      setStatType('pts');
      setSelectedOdds(null);
      setOverUnder('over');
      setManualLine('');
      setIsManualMode(false);
      setBookmakerExpanded(false);
      setManualExpanded(false);
    } catch (err: any) {
      setError(err.message || 'Failed to track player');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-md mx-4 p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">Track Player</h2>
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
                  <div className="max-h-64 overflow-y-auto space-y-2">
                    {availableOdds.map((odds, idx) => {
                      const bookmaker = getBookmakerInfo(odds.bookmaker);
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
                              <span className="text-2xl">{bookmaker.logo}</span>
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
                    placeholder={`e.g., 25.5`}
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

          {/* Actions */}
          <div className="flex gap-3 pt-4">
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
              {loading ? 'Tracking...' : 'Track Player'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
