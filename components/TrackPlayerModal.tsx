"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X, Loader2, ChevronDown, ChevronRight } from "lucide-react";
import { getBookmakerInfo } from "@/lib/bookmakers";
import { formatOdds, americanToDecimal } from "@/lib/currencyUtils";
import { useTrackedBets } from "@/contexts/TrackedBetsContext";

// Helper function to extract team name without location (e.g., "Milwaukee Bucks" -> "Bucks")
function getTeamNameOnly(fullName: string): string {
  if (!fullName) return fullName;
  const parts = fullName.trim().split(/\s+/);
  // Handle special cases with multi-word team names
  const multiWordTeams = ['Trail Blazers', 'Golden State'];
  for (const team of multiWordTeams) {
    if (fullName.includes(team)) {
      return team === 'Golden State' ? 'Warriors' : team;
    }
  }
  // For most teams, take the last word (e.g., "Milwaukee Bucks" -> "Bucks")
  // For teams like "New York Knicks", take last word
  // For teams like "Los Angeles Lakers", take last word
  return parts[parts.length - 1] || fullName;
}

interface TrackPlayerModalProps {
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
  isPickem?: boolean;
  variantLabel?: string | null; // 'Goblin' or 'Demon' - indicates the type of line
  multiplier?: number; // For PrizePicks pick'em, the actual multiplier calculated from counts
  goblinCount?: number; // Number of goblin boosts on this line
  demonCount?: number; // Number of demon discounts on this line
  // For game props (moneylines and spreads)
  homeTeam?: string; // Home team name for moneylines/spreads
  awayTeam?: string; // Away team name for moneylines/spreads
  homeOdds?: number; // Home team odds for moneylines
  awayOdds?: number; // Away team odds for moneylines
  favoriteTeam?: string; // Team with negative spread (favorite)
  underdogTeam?: string; // Team with positive spread (underdog)
  favoriteSpread?: number; // Spread value for favorite (negative)
  underdogSpread?: number; // Spread value for underdog (positive)
  favoriteOdds?: number; // Odds for favorite team spread
  underdogOdds?: number; // Odds for underdog team spread
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
  isGameProp = false,
}: TrackPlayerModalProps) {
  const STAT_OPTIONS = isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
  const { addTrackedBet } = useTrackedBets();
  const [statType, setStatType] = useState(isGameProp ? 'moneyline' : 'pts');
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
    if (!isOpen || !statType) return;
    // For game props, we need team. For player props, we need playerName
    if (isGameProp && !team) return;
    if (!isGameProp && !playerName) return;

    const fetchOdds = async () => {
      setOddsLoading(true);
      setOddsError('');
      setAvailableOdds([]);
      setSelectedOdds(null);
      // Reset manual mode and manual line when switching stats/players
      setIsManualMode(false);
      setManualLine('');

      try {
        let data: any;
        let props: BookmakerOdds[] = [];

        if (isGameProp) {
          // Fetch game props odds (moneyline, spread, total, etc.)
          if (!team.trim() || !statType.trim()) {
            throw new Error('Team and stat type are required for game props');
          }

          const response = await fetch(
            `/api/odds?team=${encodeURIComponent(team.trim())}`
          );
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(errorData.error || `Failed to fetch odds: HTTP ${response.status} ${response.statusText}`);
          }
          
          data = await response.json();

          // Get actual home and away teams from API response
          const actualHomeTeam = data.homeTeam || team;
          const actualAwayTeam = data.awayTeam || opponent;

          // Map game stat types to API keys
          const statToKey: Record<string, string> = {
            'moneyline': 'H2H',
            'spread': 'Spread',
            'total_pts': 'Total',
            'home_total': 'Total',
            'away_total': 'Total',
            'first_half_total': 'Total',
            'second_half_total': 'Total',
            'q1_total': 'Total',
            'q2_total': 'Total',
            'q3_total': 'Total',
            'q4_total': 'Total',
            'q1_moneyline': 'H2H',
            'q2_moneyline': 'H2H',
            'q3_moneyline': 'H2H',
            'q4_moneyline': 'H2H',
          };

          const apiKey = statToKey[statType] || 'H2H';
          
          // Convert game odds to BookmakerOdds format
          if (data.data && Array.isArray(data.data)) {
            for (const bookmaker of data.data) {
              const gameData = bookmaker[apiKey];
              if (!gameData || gameData.line === 'N/A') continue;

              if (statType === 'moneyline') {
                // Moneyline: home and away are separate options
                const homeLine = parseFloat(String(gameData.home || '0').replace(/[^+\-\d]/g, ''));
                const awayLine = parseFloat(String(gameData.away || '0').replace(/[^+\-\d]/g, ''));
                
                if (!isNaN(homeLine) && homeLine !== 0) {
                  // Use actual home and away teams from API response
                  props.push({
                    bookmaker: bookmaker.name,
                    line: 0, // Moneylines don't have a line value
                    overPrice: americanToDecimal(homeLine),
                    underPrice: americanToDecimal(awayLine),
                    homeTeam: actualHomeTeam,
                    awayTeam: actualAwayTeam,
                    homeOdds: americanToDecimal(homeLine),
                    awayOdds: americanToDecimal(awayLine),
                  });
                }
              } else if (statType === 'spread') {
                // Spread: have line, over, under
                // Line is from home team's perspective: negative = home favored, positive = away favored
                const lineValue = parseFloat(String(gameData.line).replace(/[^0-9.+-]/g, ''));
                if (isNaN(lineValue)) continue;

                const overOdds = typeof gameData.over === 'string'
                  ? parseFloat(gameData.over.replace(/[^+\-\d]/g, ''))
                  : gameData.over;
                const underOdds = typeof gameData.under === 'string'
                  ? parseFloat(gameData.under.replace(/[^+\-\d]/g, ''))
                  : gameData.under;

                if (isNaN(overOdds) || isNaN(underOdds)) continue;

                // Determine favorite and underdog based on line sign and actual home/away teams
                // Negative line = home team is favorite, positive line = away team is favorite
                const favoriteTeam = lineValue < 0 ? actualHomeTeam : actualAwayTeam;
                const underdogTeam = lineValue < 0 ? actualAwayTeam : actualHomeTeam;
                const favoriteSpread = lineValue < 0 ? lineValue : -Math.abs(lineValue);
                const underdogSpread = lineValue < 0 ? Math.abs(lineValue) : lineValue;
                const favoriteOdds = lineValue < 0 ? overOdds : underOdds;
                const underdogOdds = lineValue < 0 ? underOdds : overOdds;

                props.push({
                  bookmaker: bookmaker.name,
                  line: lineValue,
                  overPrice: americanToDecimal(overOdds),
                  underPrice: americanToDecimal(underOdds),
                  homeTeam: actualHomeTeam,
                  awayTeam: actualAwayTeam,
                  favoriteTeam,
                  underdogTeam,
                  favoriteSpread,
                  underdogSpread,
                  favoriteOdds: americanToDecimal(favoriteOdds),
                  underdogOdds: americanToDecimal(underdogOdds),
                });
              } else if (statType === 'total_pts') {
                // Total: have line, over, under
                const lineValue = parseFloat(String(gameData.line).replace(/[^0-9.+-]/g, ''));
                if (isNaN(lineValue)) continue;

                const overOdds = typeof gameData.over === 'string'
                  ? parseFloat(gameData.over.replace(/[^+\-\d]/g, ''))
                  : gameData.over;
                const underOdds = typeof gameData.under === 'string'
                  ? parseFloat(gameData.under.replace(/[^+\-\d]/g, ''))
                  : gameData.under;

                if (isNaN(overOdds) || isNaN(underOdds)) continue;

                props.push({
                  bookmaker: bookmaker.name,
                  line: lineValue,
                  overPrice: americanToDecimal(overOdds),
                  underPrice: americanToDecimal(underOdds),
                });
              }
            }
          }
        } else {
          // Fetch player props odds (existing logic)
          if (!playerName.trim() || !statType.trim()) {
            throw new Error('Player name and stat type are required');
          }

          const response = await fetch(
            `/api/player-props?player=${encodeURIComponent(playerName.trim())}&stat=${encodeURIComponent(statType.trim())}`
          );
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: response.statusText }));
            throw new Error(errorData.error || `Failed to fetch odds: HTTP ${response.status} ${response.statusText}`);
          }
          
          data = await response.json();

          props = data.props || [];
        }

        setAvailableOdds(props);
        // Auto-select first option if available (always select primary line, not alt)
        if (props && props.length > 0) {
          // Find the first primary line (not an alt line)
          const primaryLine = props.find((odds: BookmakerOdds) => 
            !odds.variantLabel && !odds.isPickem
          ) || props[0]; // Fallback to first if no primary found
          setSelectedOdds(primaryLine);
        }
      } catch (err: any) {
        setOddsError(err.message || 'Failed to load odds');
      } finally {
        setOddsLoading(false);
      }
    };

    fetchOdds();
  }, [isOpen, playerName, statType, isGameProp, team]);
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
      
      // Determine bookmaker info
      const bookmakerName = !isManualMode && selectedOdds ? getBookmakerInfo(selectedOdds.bookmaker).name : null;
      
      // Insert into tracked_props
      const { data: insertedProp, error: insertError } = await (supabase
        .from('tracked_props') as any)
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
          bookmaker: bookmakerName,
          odds: finalOdds,
        })
        .select()
        .single();

      if (insertError) throw insertError;
      
      // Add to tracked bets context for RightSidebar
      if (insertedProp) {
        const statLabel = STAT_OPTIONS.find(opt => opt.value === statType)?.label || statType;
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
          gameDate,
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
            <h2 className="text-xl font-bold text-gray-900 dark:text-white">{isGameProp ? 'Track Game Prop' : 'Track Player'}</h2>
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
                    {(() => {
                      // Group odds by bookmaker and separate primary from alt lines
                      const oddsByBookmaker = new Map<string, { primary: BookmakerOdds[]; alt: BookmakerOdds[] }>();
                      
                      // First pass: group all odds by bookmaker
                      for (const odds of availableOdds) {
                        if (!oddsByBookmaker.has(odds.bookmaker)) {
                          oddsByBookmaker.set(odds.bookmaker, { primary: [], alt: [] });
                        }
                        const group = oddsByBookmaker.get(odds.bookmaker)!;
                        // Temporarily store all odds, we'll separate them next
                        group.primary.push(odds);
                      }
                      
                      // Second pass: for each bookmaker, identify primary vs alt lines
                      oddsByBookmaker.forEach((group, bookmakerName) => {
                        // Sort all lines by line value (descending)
                        group.primary.sort((a, b) => b.line - a.line);
                        
                        // Separate primary from alt lines
                        const primary: BookmakerOdds[] = [];
                        const alt: BookmakerOdds[] = [];
                        
                        for (const odds of group.primary) {
                          // Lines with variantLabel or isPickem are always alt lines
                          const isExplicitAlt = odds.variantLabel || odds.isPickem;
                          
                          if (isExplicitAlt) {
                            alt.push(odds);
                          } else if (primary.length === 0) {
                            // First line for this bookmaker is primary
                            primary.push(odds);
                          } else {
                            // Additional lines from same bookmaker are alt lines
                            alt.push(odds);
                          }
                        }
                        
                        // Update the group
                        group.primary = primary;
                        group.alt = alt;
                        
                        // Sort alt lines by line (descending)
                        group.alt.sort((a, b) => b.line - a.line);
                      });
                      
                      // Render odds grouped by bookmaker
                      const renderedOdds: JSX.Element[] = [];
                      oddsByBookmaker.forEach((group, bookmakerName) => {
                        const bookmaker = getBookmakerInfo(bookmakerName);
                        
                        // Render primary lines
                        group.primary.forEach((odds, idx) => {
                          const isSelected = !isManualMode && selectedOdds?.bookmaker === odds.bookmaker && selectedOdds?.line === odds.line;
                          renderedOdds.push(
                            <button
                              key={`${odds.bookmaker}-${odds.line}-primary-${idx}`}
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
                                    {statType !== 'moneyline' && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        Line: {odds.line}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {statType === 'moneyline' && odds.homeTeam && odds.awayTeam ? (
                                    <>
                                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-[10px] font-mono">
                                        {getTeamNameOnly(odds.homeTeam)} {formatOdds(odds.homeOdds || odds.overPrice, oddsFormat)}
                                      </span>
                                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-[10px] font-mono">
                                        {getTeamNameOnly(odds.awayTeam)} {formatOdds(odds.awayOdds || odds.underPrice, oddsFormat)}
                                      </span>
                                    </>
                                  ) : statType === 'spread' && odds.favoriteTeam && odds.underdogTeam ? (
                                    <>
                                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-[10px] font-mono">
                                        {getTeamNameOnly(odds.favoriteTeam)} {odds.favoriteSpread && odds.favoriteSpread < 0 ? odds.favoriteSpread : `-${Math.abs(odds.favoriteSpread || 0)}`} {formatOdds(odds.favoriteOdds || odds.overPrice, oddsFormat)}
                                      </span>
                                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-[10px] font-mono">
                                        {getTeamNameOnly(odds.underdogTeam)} +{Math.abs(odds.underdogSpread || 0)} {formatOdds(odds.underdogOdds || odds.underPrice, oddsFormat)}
                                      </span>
                                    </>
                                  ) : (
                                    <>
                                      <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                        O {formatOdds(odds.overPrice, oddsFormat)}
                                      </span>
                                      <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                        U {formatOdds(odds.underPrice, oddsFormat)}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                            </button>
                          );
                        });
                        
                        // Render alt lines with indicator
                        group.alt.forEach((odds, idx) => {
                          const isSelected = !isManualMode && selectedOdds?.bookmaker === odds.bookmaker && selectedOdds?.line === odds.line;
                          renderedOdds.push(
                            <button
                              key={`${odds.bookmaker}-${odds.line}-alt-${idx}`}
                              type="button"
                              onClick={() => {
                                setSelectedOdds(odds);
                                setIsManualMode(false);
                              }}
                              className={`w-full p-3 rounded-lg border-2 transition-all text-left ${
                                isSelected
                                  ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
                                  : 'border-blue-200 dark:border-blue-600 hover:border-blue-300 dark:hover:border-blue-500 bg-blue-50/50 dark:bg-blue-900/10'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {(() => {
                                    const oddsIsPrizePicks = odds.bookmaker.toLowerCase().includes('prizepicks');
                                    const showVariantLogo = oddsIsPrizePicks && odds.isPickem && odds.variantLabel;
                                    
                                    return (
                                      <>
                                        {/* PrizePicks logo */}
                                        {bookmaker.logoUrl ? (
                                          <div className="relative flex-shrink-0">
                                            <img
                                              src={bookmaker.logoUrl}
                                              alt={bookmaker.name}
                                              className="w-8 h-8 object-contain flex-shrink-0"
                                              onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                                const fallback = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                                if (fallback) fallback.style.display = 'block';
                                              }}
                                            />
                                            <span className="text-2xl hidden">{bookmaker.logo}</span>
                                            {/* Goblin/Demon logo overlay for PrizePicks pick'em */}
                                            {showVariantLogo && (
                                              <img
                                                src={odds.variantLabel === 'Goblin' ? '/images/goblin.png' : '/images/demon.png'}
                                                alt={odds.variantLabel}
                                                className="absolute -bottom-1 -right-1 w-5 h-5 object-contain"
                                                onError={(e) => {
                                                  (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                              />
                                            )}
                                          </div>
                                        ) : (
                                          <span className="text-2xl">{bookmaker.logo}</span>
                                        )}
                                      </>
                                    );
                                  })()}
                                  <div>
                                    <div className="flex items-center gap-1.5">
                                      <span className="font-semibold text-sm text-gray-900 dark:text-white">
                                        {bookmaker.name}
                                      </span>
                                      {odds.variantLabel && (
                                        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[10px] font-semibold uppercase">
                                          {odds.variantLabel}
                                        </span>
                                      )}
                                      {odds.isPickem && !odds.variantLabel && (
                                        <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[10px] font-semibold">
                                          Pick'em
                                        </span>
                                      )}
                                    </div>
                                    {statType !== 'moneyline' && (
                                      <div className="text-xs text-gray-500 dark:text-gray-400">
                                        {(() => {
                                          const oddsIsPrizePicks = odds.bookmaker.toLowerCase().includes('prizepicks');
                                          if (oddsIsPrizePicks && odds.isPickem) {
                                            // Calculate multiplier from counts: multiplier = 1 + (0.10 * count)
                                            let multiplier = 1;
                                            if (odds.goblinCount !== undefined) {
                                              multiplier = 1 + (0.10 * odds.goblinCount);
                                            } else if (odds.demonCount !== undefined) {
                                              multiplier = 1 + (0.10 * odds.demonCount);
                                            } else if (odds.multiplier !== undefined) {
                                              multiplier = odds.multiplier;
                                            } else {
                                              // Fallback estimate
                                              multiplier = odds.variantLabel === 'Demon' ? 1.20 : 1.10;
                                            }
                                            return `${odds.variantLabel || 'Pick\'em'} Line: ${odds.line} • ${multiplier.toFixed(2)}x multiplier`;
                                          }
                                          return `Alt Line: ${odds.line}`;
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {(() => {
                                    const oddsIsPrizePicks = odds.bookmaker.toLowerCase().includes('prizepicks');
                                    if (oddsIsPrizePicks && odds.isPickem) {
                                      // Calculate multiplier from counts: multiplier = 1 + (0.10 * count)
                                      let multiplier = 1;
                                      if (odds.goblinCount !== undefined) {
                                        multiplier = 1 + (0.10 * odds.goblinCount);
                                      } else if (odds.demonCount !== undefined) {
                                        multiplier = 1 + (0.10 * odds.demonCount);
                                      } else if (odds.multiplier !== undefined) {
                                        multiplier = odds.multiplier;
                                      } else {
                                        // Fallback estimate
                                        multiplier = odds.variantLabel === 'Demon' ? 1.20 : 1.10;
                                      }
                                      return (
                                        <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-xs font-semibold">
                                          {multiplier.toFixed(2)}x
                                        </span>
                                      );
                                    }
                                    if (statType === 'moneyline' && odds.homeTeam && odds.awayTeam) {
                                      return (
                                        <>
                                          <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                            {odds.homeTeam} {formatOdds(odds.homeOdds || odds.overPrice, oddsFormat)}
                                          </span>
                                          <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                            {odds.awayTeam} {formatOdds(odds.awayOdds || odds.underPrice, oddsFormat)}
                                          </span>
                                        </>
                                      );
                                    }
                                    if (statType === 'spread' && odds.favoriteTeam && odds.underdogTeam) {
                                      return (
                                        <>
                                          <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                            {odds.favoriteTeam} {odds.favoriteSpread && odds.favoriteSpread < 0 ? odds.favoriteSpread : `-${Math.abs(odds.favoriteSpread || 0)}`} {formatOdds(odds.favoriteOdds || odds.overPrice, oddsFormat)}
                                          </span>
                                          <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                            {odds.underdogTeam} +{Math.abs(odds.underdogSpread || 0)} {formatOdds(odds.underdogOdds || odds.underPrice, oddsFormat)}
                                          </span>
                                        </>
                                      );
                                    }
                                    return (
                                      <>
                                        <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                          O {formatOdds(odds.overPrice, oddsFormat)}
                                        </span>
                                        <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                          U {formatOdds(odds.underPrice, oddsFormat)}
                                        </span>
                                      </>
                                    );
                                  })()}
                                </div>
                              </div>
                            </button>
                          );
                        });
                      });
                      
                      return renderedOdds;
                    })()}
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

          {/* Over/Under Toggle or Team Selection for Moneylines/Spreads */}
          {((statType === 'moneyline' && isGameProp && selectedOdds?.homeTeam && selectedOdds?.awayTeam) ||
            (statType === 'spread' && isGameProp && selectedOdds?.favoriteTeam && selectedOdds?.underdogTeam)) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                {statType === 'moneyline' ? 'Select Team' : 'Select Team Spread'}
              </label>
              <div className="flex gap-2">
                {statType === 'moneyline' ? (
                  <>
                    <button
                      type="button"
                      onClick={() => setOverUnder('over')} // Use 'over' for home team
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                        overUnder === 'over'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getTeamNameOnly(selectedOdds.homeTeam)} {formatOdds(selectedOdds.homeOdds || selectedOdds.overPrice, oddsFormat)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverUnder('under')} // Use 'under' for away team
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                        overUnder === 'under'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getTeamNameOnly(selectedOdds.awayTeam)} {formatOdds(selectedOdds.awayOdds || selectedOdds.underPrice, oddsFormat)}
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={() => setOverUnder('over')} // Use 'over' for favorite team
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                        overUnder === 'over'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getTeamNameOnly(selectedOdds.favoriteTeam)} {selectedOdds.favoriteSpread && selectedOdds.favoriteSpread < 0 ? selectedOdds.favoriteSpread : `-${Math.abs(selectedOdds.favoriteSpread || 0)}`} {formatOdds(selectedOdds.favoriteOdds || selectedOdds.overPrice, oddsFormat)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setOverUnder('under')} // Use 'under' for underdog team
                      className={`flex-1 py-1.5 px-3 rounded-lg text-sm font-medium transition-colors ${
                        overUnder === 'under'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      {getTeamNameOnly(selectedOdds.underdogTeam)} +{Math.abs(selectedOdds.underdogSpread || 0)} {formatOdds(selectedOdds.underdogOdds || selectedOdds.underPrice, oddsFormat)}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
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
          )}

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
              {loading ? 'Tracking...' : (isGameProp ? 'Track Game Prop' : 'Track Player')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
