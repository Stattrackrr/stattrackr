"use client";

import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabaseClient";
import { X, Loader2, ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { getBookmakerInfo } from "@/lib/bookmakers";
import { formatOdds, getCurrencySymbol, americanToDecimal } from "@/lib/currencyUtils";

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
  isGameProp?: boolean; // Flag to indicate if this is a game prop vs player prop
  isPickem?: boolean; // Flag to indicate if this is a pick'em line
  variantLabel?: string | null; // Variant label (e.g., 'Goblin', 'Demon' for PrizePicks)
  multiplier?: number; // For PrizePicks pick'em, the actual multiplier (e.g., 2.0, 2.5, 3.0)
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
  // Parlay mode (declare first so it can be used in currentIsGameProp)
  const [isParlayMode, setIsParlayMode] = useState(false);
  const [parlaySelections, setParlaySelections] = useState<ParlaySelection[]>([]);
  const [showBetSlipMobile, setShowBetSlipMobile] = useState(false);
  
  // In parlay mode, allow switching between game prop and player prop
  const [parlayModeType, setParlayModeType] = useState<'game' | 'player'>(isGameProp ? 'game' : 'player');
  const currentIsGameProp = isParlayMode ? (parlayModeType === 'game') : isGameProp;
  const STAT_OPTIONS = currentIsGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
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
  
  // Side-by-side parlay mode states
  // Left side (Game Props)
  const [gameSearchQuery, setGameSearchQuery] = useState('');
  const [gameSearchResults, setGameSearchResults] = useState<Array<{ homeTeam: string; awayTeam: string; gameDate: string }>>([]);
  const [selectedGame, setSelectedGame] = useState<{ homeTeam: string; awayTeam: string; gameDate: string } | null>(null);
  const [gameStatType, setGameStatType] = useState('moneyline');
  const [gameSelectedOdds, setGameSelectedOdds] = useState<BookmakerOdds | null>(null);
  const [gameOverUnder, setGameOverUnder] = useState<'over' | 'under'>('over');
  const [gameOddsLoading, setGameOddsLoading] = useState(false);
  const [gameAvailableOdds, setGameAvailableOdds] = useState<BookmakerOdds[]>([]);
  const [gameOddsError, setGameOddsError] = useState('');
  const [gameBookmakerExpanded, setGameBookmakerExpanded] = useState(false);
  const [gameManualExpanded, setGameManualExpanded] = useState(false);
  const [gameManualLine, setGameManualLine] = useState('');
  const [gameManualOdds, setGameManualOdds] = useState('');
  const [gameIsManualMode, setGameIsManualMode] = useState(false);

  // Right side (Player Props)
  type BdlSearchResult = { id: number; full: string; team?: string; pos?: string };
  const [playerSearchQuery, setPlayerSearchQuery] = useState('');
  const [playerSearchResults, setPlayerSearchResults] = useState<BdlSearchResult[]>([]);
  const [playerSearchBusy, setPlayerSearchBusy] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState<BdlSearchResult | null>(null);
  const [playerStatType, setPlayerStatType] = useState('pts');
  const [playerSelectedOdds, setPlayerSelectedOdds] = useState<BookmakerOdds | null>(null);
  const [playerOverUnder, setPlayerOverUnder] = useState<'over' | 'under'>('over');
  const [playerOddsLoading, setPlayerOddsLoading] = useState(false);
  const [playerAvailableOdds, setPlayerAvailableOdds] = useState<BookmakerOdds[]>([]);
  const [playerOddsError, setPlayerOddsError] = useState('');
  const [playerBookmakerExpanded, setPlayerBookmakerExpanded] = useState(false);
  const [playerManualExpanded, setPlayerManualExpanded] = useState(false);
  const [playerManualLine, setPlayerManualLine] = useState('');
  const [playerManualOdds, setPlayerManualOdds] = useState('');
  const [playerIsManualMode, setPlayerIsManualMode] = useState(false);

  // Helper to check if bookmaker is PrizePicks
  const isPrizePicks = (bookmaker: string | null): boolean => {
    if (!bookmaker) return false;
    return bookmaker.toLowerCase().includes('prizepicks');
  };

  // Set data attribute on body when parlay is active (for button positioning)
  useEffect(() => {
    if (typeof document === 'undefined') return;
    
    if (isParlayMode && parlaySelections.length > 0) {
      document.body.setAttribute('data-parlay-active', 'true');
    } else {
      document.body.removeAttribute('data-parlay-active');
    }
    
    // Cleanup on unmount
    return () => {
      if (typeof document !== 'undefined') {
        document.body.removeAttribute('data-parlay-active');
      }
    };
  }, [isParlayMode, parlaySelections.length]);

  // Fetch odds when modal opens or stat type changes
  useEffect(() => {
    if (!isOpen || !statType) return;
    // For game props, we need team. For player props, we need playerName
    if (currentIsGameProp && !team) return;
    if (!currentIsGameProp && !playerName) return;

    const fetchOdds = async () => {
      setOddsLoading(true);
      setOddsError('');
      setAvailableOdds([]);
      setSelectedOdds(null);
      // Reset manual mode and manual line when switching stats/players
      setIsManualMode(false);
      setManualLine('');
      setManualOdds('');

      try {
        let data: any;
        let props: BookmakerOdds[] = [];

        if (currentIsGameProp) {
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
            'home_total': 'Total', // These might need special handling
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
                  homeTeam: actualHomeTeam,
                  awayTeam: actualAwayTeam,
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

          // Filter out PrizePicks from journal modal (keep it in dashboard)
          props = (data.props || []).filter((odds: BookmakerOdds) => {
            return !isPrizePicks(odds.bookmaker);
          });
        }

        // Debug: Log bookmaker line counts
        if (process.env.NODE_ENV !== 'production') {
          const byBookmaker = new Map<string, number>();
          props.forEach((odds: BookmakerOdds) => {
            byBookmaker.set(odds.bookmaker, (byBookmaker.get(odds.bookmaker) || 0) + 1);
          });
          console.log('[Alt Lines Debug] Lines per bookmaker:', Object.fromEntries(byBookmaker));
          console.log('[Alt Lines Debug] Total lines:', props.length);
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
  }, [isOpen, playerName, statType, currentIsGameProp, team]);

  // Game search (left side) - fetch games from odds API
  useEffect(() => {
    if (!isParlayMode || !isOpen) return;
    
    let timeout: NodeJS.Timeout;
    const searchGames = async () => {
      const query = gameSearchQuery.trim();
      if (query.length < 2) {
        setGameSearchResults([]);
        return;
      }

      try {
        const response = await fetch('/api/odds');
        if (!response.ok) return;
        
        const data = await response.json();
        if (!data.data || !Array.isArray(data.data)) return;

        // Get unique games from odds data
        const games = new Map<string, { homeTeam: string; awayTeam: string; gameDate: string }>();
        
        // Try to find games that match the search query
        const queryLower = query.toLowerCase();
        for (const bookmaker of data.data) {
          // Check if bookmaker has game info
          if (bookmaker.homeTeam && bookmaker.awayTeam) {
            const homeTeam = bookmaker.homeTeam.toLowerCase();
            const awayTeam = bookmaker.awayTeam.toLowerCase();
            const gameKey = `${bookmaker.homeTeam}-${bookmaker.awayTeam}`;
            
            if (!games.has(gameKey) && 
                (homeTeam.includes(queryLower) || awayTeam.includes(queryLower))) {
              games.set(gameKey, {
                homeTeam: bookmaker.homeTeam,
                awayTeam: bookmaker.awayTeam,
                gameDate: bookmaker.gameDate || gameDate,
              });
            }
          }
        }
        
        setGameSearchResults(Array.from(games.values()).slice(0, 10));
      } catch (err) {
        console.error('Game search error:', err);
        setGameSearchResults([]);
      }
    };

    timeout = setTimeout(searchGames, 300);
    return () => clearTimeout(timeout);
  }, [gameSearchQuery, isParlayMode, isOpen, gameDate]);

  // Player search (right side) - fetch players from BDL API
  useEffect(() => {
    if (!isParlayMode || !isOpen) return;
    
    let timeout: NodeJS.Timeout;
    const searchPlayers = async () => {
      const q = playerSearchQuery.trim();
      setPlayerSearchBusy(true);
      setPlayerSearchResults([]);
      
      if (q.length < 2) {
        setPlayerSearchBusy(false);
        return;
      }

      try {
        const isFullNameSearch = q.includes(' ') || q.length < 3;
        const searchQuery = isFullNameSearch ? q.split(' ')[0] : q;
        
        const res = await fetch(`/api/bdl/players?q=${encodeURIComponent(searchQuery)}`);
        const json = await res.json().catch(() => ({}));
        
        let arr: BdlSearchResult[] = Array.isArray(json?.results)
          ? json.results.map((r: any) => ({ id: r.id, full: r.full, team: r.team, pos: r.pos }))
          : [];
        
        // Client-side fuzzy filtering for full name searches
        if (isFullNameSearch && q.includes(' ')) {
          const queryWords = q.toLowerCase().split(' ').filter(word => word.length > 0);
          arr = arr.filter(player => {
            const playerName = player.full.toLowerCase();
            return queryWords.every(word => 
              playerName.includes(word) || 
              playerName.split(' ').some(nameWord => nameWord.startsWith(word))
            );
          });
        }
        
        // Dedupe & cap
        const seen = new Set<string>();
        const dedup = arr.filter(r => {
          if (seen.has(r.full)) return false;
          seen.add(r.full);
          return true;
        }).slice(0, 20);
        
        setPlayerSearchResults(dedup);
      } catch (e: any) {
        console.error('Player search error:', e);
        setPlayerSearchResults([]);
      } finally {
        setPlayerSearchBusy(false);
      }
    };

    timeout = setTimeout(searchPlayers, 300);
    return () => clearTimeout(timeout);
  }, [playerSearchQuery, isParlayMode, isOpen]);

  // Fetch odds for game props (left side)
  useEffect(() => {
    if (!isParlayMode || !isOpen || !selectedGame || !gameStatType) return;

    const fetchGameOdds = async () => {
      setGameOddsLoading(true);
      setGameOddsError('');
      setGameAvailableOdds([]);
      setGameSelectedOdds(null);
      setGameIsManualMode(false);
      setGameManualLine('');
      setGameManualOdds('');

      try {
        const response = await fetch(
          `/api/odds?team=${encodeURIComponent(selectedGame.homeTeam)}`
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorData.error || `Failed to fetch odds: HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const actualHomeTeam = data.homeTeam || selectedGame.homeTeam;
        const actualAwayTeam = data.awayTeam || selectedGame.awayTeam;
        
        // Update search query with correct team names from API if available
        if (data.homeTeam && data.awayTeam) {
          setGameSearchQuery(`${getTeamNameOnly(data.homeTeam)} vs ${getTeamNameOnly(data.awayTeam)}`);
        }

        const statToKey: Record<string, string> = {
          'moneyline': 'H2H',
          'spread': 'Spread',
          'total_pts': 'Total',
        };

        const apiKey = statToKey[gameStatType] || 'H2H';
        const props: BookmakerOdds[] = [];

        if (data.data && Array.isArray(data.data)) {
          for (const bookmaker of data.data) {
            const gameData = bookmaker[apiKey];
            if (!gameData || gameData.line === 'N/A') continue;

            if (gameStatType === 'moneyline') {
              const homeLine = parseFloat(String(gameData.home || '0').replace(/[^+\-\d]/g, ''));
              const awayLine = parseFloat(String(gameData.away || '0').replace(/[^+\-\d]/g, ''));
              
              if (!isNaN(homeLine) && homeLine !== 0) {
                props.push({
                  bookmaker: bookmaker.name,
                  line: 0,
                  overPrice: americanToDecimal(homeLine),
                  underPrice: americanToDecimal(awayLine),
                  homeTeam: actualHomeTeam,
                  awayTeam: actualAwayTeam,
                  homeOdds: americanToDecimal(homeLine),
                  awayOdds: americanToDecimal(awayLine),
                });
              }
            } else if (gameStatType === 'spread') {
              const lineValue = parseFloat(String(gameData.line).replace(/[^0-9.+-]/g, ''));
              if (isNaN(lineValue)) continue;

              const overOdds = typeof gameData.over === 'string'
                ? parseFloat(gameData.over.replace(/[^+\-\d]/g, ''))
                : gameData.over;
              const underOdds = typeof gameData.under === 'string'
                ? parseFloat(gameData.under.replace(/[^+\-\d]/g, ''))
                : gameData.under;

              if (isNaN(overOdds) || isNaN(underOdds)) continue;

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
            } else if (gameStatType === 'total_pts') {
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
                homeTeam: actualHomeTeam,
                awayTeam: actualAwayTeam,
              });
            }
          }
        }

        // Filter out PrizePicks
        const filteredProps = props.filter(prop => !isPrizePicks(prop.bookmaker));

        setGameAvailableOdds(filteredProps);
        if (filteredProps.length > 0) {
          const primaryLine = filteredProps.find(odds => !odds.variantLabel && !odds.isPickem) || filteredProps[0];
          setGameSelectedOdds(primaryLine);
        }
      } catch (err: any) {
        setGameOddsError(err.message || 'Failed to load odds');
      } finally {
        setGameOddsLoading(false);
      }
    };

    fetchGameOdds();
  }, [isParlayMode, isOpen, selectedGame, gameStatType]);

  // Fetch odds for player props (right side)
  useEffect(() => {
    if (!isParlayMode || !isOpen || !selectedPlayer || !playerStatType) return;
    
    // Ensure selectedPlayer has a valid full name
    if (!selectedPlayer.full || !selectedPlayer.full.trim()) {
      return;
    }

    const fetchPlayerOdds = async () => {
      setPlayerOddsLoading(true);
      setPlayerOddsError('');
      setPlayerAvailableOdds([]);
      setPlayerSelectedOdds(null);
      setPlayerIsManualMode(false);
      setPlayerManualLine('');
      setPlayerManualOdds('');

      try {
        const playerName = selectedPlayer.full.trim();
        const stat = playerStatType.trim();
        
        const response = await fetch(
          `/api/player-props?player=${encodeURIComponent(playerName)}&stat=${encodeURIComponent(stat)}`
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          throw new Error(errorData.error || `Failed to fetch odds: HTTP ${response.status}`);
        }
        
        const data = await response.json();
        const props: BookmakerOdds[] = [];

        // The API returns data.props, not data.odds
        if (data.props && Array.isArray(data.props)) {
          for (const prop of data.props) {
            // Filter out PrizePicks
            if (isPrizePicks(prop.bookmaker)) continue;
            
            props.push({
              bookmaker: prop.bookmaker,
              line: prop.line,
              overPrice: prop.overPrice,
              underPrice: prop.underPrice,
              isPickem: prop.isPickem,
              variantLabel: prop.variantLabel,
              multiplier: prop.multiplier,
            });
          }
        }

        setPlayerAvailableOdds(props);
        if (props.length > 0) {
          const primaryLine = props.find(odds => !odds.variantLabel && !odds.isPickem) || props[0];
          setPlayerSelectedOdds(primaryLine);
        } else {
          setPlayerOddsError('No odds available for this player and stat');
        }
      } catch (err: any) {
        setPlayerOddsError(err.message || 'Failed to load odds');
      } finally {
        setPlayerOddsLoading(false);
      }
    };

    fetchPlayerOdds();
  }, [isParlayMode, isOpen, selectedPlayer, playerStatType]);

  // Convert odds to decimal for parlay calculation
  const toDecimalOdds = (odds: number, format: 'american' | 'decimal'): number => {
    if (format === 'decimal') return odds;
    return americanToDecimal(odds);
  };

  // Calculate combined parlay odds
  const calculateParlayOdds = (selections: ParlaySelection[], format: 'american' | 'decimal'): number => {
    if (selections.length === 0) return 1;
    
    // Check if this is a PrizePicks pick'em parlay (all selections are PrizePicks pick'em)
    const allPrizePicksPickem = selections.every(sel => {
      const selIsPrizePicks = isPrizePicks(sel.bookmaker);
      return selIsPrizePicks && sel.isPickem;
    });
    
    if (allPrizePicksPickem) {
      // For PrizePicks pick'em parlays, multiply the multipliers (e.g., 2x * 3x = 6x)
      const totalMultiplier = selections.reduce((acc, sel) => {
        // Use stored multiplier if available, otherwise estimate from variant
        const multiplier = sel.multiplier ?? getPrizePicksMultiplier(null, sel.variantLabel);
        return acc * multiplier;
      }, 1);
      
      // Convert multiplier to decimal odds (2x = 2.0, 3x = 3.0, etc.)
      if (format === 'decimal') return totalMultiplier;
      
      // Convert to American odds
      if (totalMultiplier >= 2.0) {
        return Math.round((totalMultiplier - 1) * 100);
      } else {
        return -Math.round(100 / (totalMultiplier - 1));
      }
    }
    
    // Regular parlay calculation
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

  // Helper to get PrizePicks pick'em multiplier
  // Formula: multiplier = 1 + (0.10 * count)
  // Uses goblin_count or demon_count if available, otherwise uses stored multiplier
  const getPrizePicksMultiplier = (odds: BookmakerOdds | null, variantLabel: string | null | undefined): number => {
    if (!odds) return 1;
    
    // Calculate from counts if available (most accurate)
    if (odds.goblinCount !== undefined) {
      return 1 + (0.10 * odds.goblinCount);
    }
    if (odds.demonCount !== undefined) {
      return 1 + (0.10 * odds.demonCount);
    }
    
    // Use stored multiplier if available
    if (odds.multiplier !== undefined && odds.multiplier > 0) {
      return odds.multiplier;
    }
    
    // Fallback: estimate from variant (least accurate)
    if (variantLabel === 'Demon') return 1.20; // Default: 2 demons = 1.20x
    if (variantLabel === 'Goblin') return 1.10; // Default: 1 goblin = 1.10x
    return 1; // Default for non-pick'em or unknown
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
    const bookmakerName = !isManualMode && selectedOdds ? selectedOdds.bookmaker : null;
    const isPickemLine = !isManualMode && selectedOdds ? (selectedOdds.isPickem || false) : false;
    const variantLabel = !isManualMode && selectedOdds ? (selectedOdds.variantLabel || null) : null;
    const isPrizePicksLine = isPrizePicks(bookmakerName);
    
    // For PrizePicks pick'em, use multiplier as "odds"
    let finalOdds: number;
    let multiplier: number | undefined = undefined;
    if (isPrizePicksLine && isPickemLine) {
      multiplier = getPrizePicksMultiplier(selectedOdds, variantLabel);
      finalOdds = multiplier;
    } else {
      finalOdds = isManualMode ? parseFloat(manualOdds) : (overUnder === 'over' ? selectedOdds!.overPrice : selectedOdds!.underPrice);
    }

    // Validate: PrizePicks pick'em can only be combined with other PrizePicks props
    if (isPrizePicksLine && isPickemLine && parlaySelections.length > 0) {
      const hasNonPrizePicks = parlaySelections.some(sel => {
        const selIsPrizePicks = isPrizePicks(sel.bookmaker);
        return !selIsPrizePicks;
      });
      
      if (hasNonPrizePicks) {
        setError('PrizePicks pick\'em lines can only be combined with other PrizePicks props');
        return;
      }
    }
    
    // Validate: Non-PrizePicks props cannot be combined with PrizePicks pick'em
    if (!isPrizePicksLine && parlaySelections.length > 0) {
      const hasPrizePicksPickem = parlaySelections.some(sel => {
        const selIsPrizePicks = isPrizePicks(sel.bookmaker);
        return selIsPrizePicks && sel.isPickem;
      });
      
      if (hasPrizePicksPickem) {
        setError('Regular props cannot be combined with PrizePicks pick\'em lines. PrizePicks pick\'em can only be combined with other PrizePicks props.');
        return;
      }
    }

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
      isGameProp: currentIsGameProp, // Store whether this is a game prop (use current mode in parlay)
      isPickem: isPickemLine,
      variantLabel: variantLabel,
      multiplier: multiplier, // Store the actual multiplier for PrizePicks pick'em
    };

    setParlaySelections([...parlaySelections, newSelection]);
    
    // Reset form for next selection (but keep stake if parlay is ready)
    // In parlay mode, keep the current mode type; otherwise use the original isGameProp
    setStatType(currentIsGameProp ? 'moneyline' : 'pts');
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

  // Add game prop to parlay (left side)
  const addGamePropToParlay = () => {
    if (!selectedGame || !gameStatType) {
      setError('Please select a game and stat type');
      return;
    }

    const finalOdds = gameIsManualMode && gameManualOdds
      ? (oddsFormat === 'american' ? americanToDecimal(parseFloat(gameManualOdds)) : parseFloat(gameManualOdds))
      : gameSelectedOdds
        ? (gameOverUnder === 'over' ? gameSelectedOdds.overPrice : gameSelectedOdds.underPrice)
        : null;

    if (!finalOdds) {
      setError('Please select odds or enter manual odds');
      return;
    }

    // Use team names from API response if available, otherwise fall back to selectedGame
    const actualHomeTeam = gameSelectedOdds?.homeTeam || selectedGame.homeTeam;
    const actualAwayTeam = gameSelectedOdds?.awayTeam || selectedGame.awayTeam;

    // For moneylines, store the actual team that was bet on (not just home team)
    // For spreads, store the team that was bet on (favorite or underdog) and the spread from their perspective
    // For other props, use home team as default
    let betTeam = actualHomeTeam;
    let finalLine = gameIsManualMode && gameManualLine
      ? parseFloat(gameManualLine)
      : gameSelectedOdds?.line ?? 0;
    
    if (gameStatType === 'moneyline') {
      // For moneylines: 'over' = home team, 'under' = away team
      betTeam = gameOverUnder === 'over' ? actualHomeTeam : actualAwayTeam;
    } else if (gameStatType === 'spread' && gameSelectedOdds) {
      // For spreads: 'over' = favorite, 'under' = underdog
      // Store the spread from the team's perspective (negative for favorite, positive for underdog)
      if (gameOverUnder === 'over') {
        betTeam = gameSelectedOdds.favoriteTeam || actualHomeTeam;
        finalLine = gameSelectedOdds.favoriteSpread ?? finalLine;
      } else {
        betTeam = gameSelectedOdds.underdogTeam || actualAwayTeam;
        finalLine = gameSelectedOdds.underdogSpread ?? finalLine;
      }
    }

    const newSelection: ParlaySelection = {
      id: `game-${Date.now()}-${Math.random()}`,
      playerName: '', // Not used for game props
      playerId: '', // Not used for game props
      team: betTeam, // Store the actual team that was bet on
      opponent: betTeam === actualHomeTeam ? actualAwayTeam : actualHomeTeam, // Store the opponent
      gameDate: selectedGame.gameDate,
      statType: gameStatType,
      line: finalLine,
      overUnder: gameOverUnder,
      odds: finalOdds,
      bookmaker: gameIsManualMode ? null : (gameSelectedOdds?.bookmaker || null),
      isManual: gameIsManualMode,
      isGameProp: true,
      isPickem: gameSelectedOdds?.isPickem || false,
      variantLabel: gameSelectedOdds?.variantLabel || null,
      multiplier: gameSelectedOdds?.multiplier,
    };

    setParlaySelections([...parlaySelections, newSelection]);
    
    // Reset game form
    setGameSelectedOdds(null);
    setGameOverUnder('over');
    setGameIsManualMode(false);
    setGameManualLine('');
    setGameManualOdds('');
    setGameBookmakerExpanded(false);
    setGameManualExpanded(false);
  };

  // Add player prop to parlay (right side)
  const addPlayerPropToParlay = () => {
    if (!selectedPlayer || !playerStatType) {
      setError('Please select a player and stat type');
      return;
    }

    const finalOdds = playerIsManualMode && playerManualOdds
      ? (oddsFormat === 'american' ? americanToDecimal(parseFloat(playerManualOdds)) : parseFloat(playerManualOdds))
      : playerSelectedOdds
        ? (playerOverUnder === 'over' ? playerSelectedOdds.overPrice : playerSelectedOdds.underPrice)
        : null;

    if (!finalOdds) {
      setError('Please select odds or enter manual odds');
      return;
    }

    const finalLine = playerIsManualMode && playerManualLine
      ? parseFloat(playerManualLine)
      : playerSelectedOdds?.line ?? 0;

    // Get player's team from search result or use default
    const playerTeam = selectedPlayer.team || team;

    const newSelection: ParlaySelection = {
      id: `player-${Date.now()}-${Math.random()}`,
      playerName: selectedPlayer.full,
      playerId: String(selectedPlayer.id),
      team: playerTeam,
      opponent: opponent,
      gameDate: gameDate,
      statType: playerStatType,
      line: finalLine,
      overUnder: playerOverUnder,
      odds: finalOdds,
      bookmaker: playerIsManualMode ? null : (playerSelectedOdds?.bookmaker || null),
      isManual: playerIsManualMode,
      isGameProp: false,
      isPickem: playerSelectedOdds?.isPickem || false,
      variantLabel: playerSelectedOdds?.variantLabel || null,
      multiplier: playerSelectedOdds?.multiplier,
    };

    setParlaySelections([...parlaySelections, newSelection]);
    
    // Reset player form
    setPlayerSelectedOdds(null);
    setPlayerOverUnder('over');
    setPlayerIsManualMode(false);
    setPlayerManualLine('');
    setPlayerManualOdds('');
    setPlayerBookmakerExpanded(false);
    setPlayerManualExpanded(false);
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
          const statOptions = sel.isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
          const statLabel = statOptions.find(opt => opt.value === sel.statType)?.label || sel.statType.toUpperCase();
          // For game props, use team name or "Game" instead of player name
          const displayName = sel.isGameProp 
            ? (sel.team ? `${getTeamNameOnly(sel.team)} vs ${getTeamNameOnly(sel.opponent)}` : 'Game')
            : sel.playerName;
          const selIsPrizePicks = isPrizePicks(sel.bookmaker);
          const multiplier = selIsPrizePicks && sel.isPickem ? (sel.multiplier ?? getPrizePicksMultiplier(null, sel.variantLabel)) : null;
          const variantInfo = sel.variantLabel ? ` (${sel.variantLabel}${multiplier ? ` ${multiplier}x` : ''})` : '';
          
          // Format the selection text based on stat type
          if (sel.isGameProp && sel.statType === 'moneyline') {
            // For moneylines, show the selected team name
            const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
            return `${selectedTeam} ML vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}${variantInfo}`;
          } else if (sel.isGameProp && sel.statType === 'spread') {
            // For spreads, show team and spread
            const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
            return `${selectedTeam} ${sel.line > 0 ? '+' : ''}${sel.line} vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}${variantInfo}`;
          } else {
            // For other stats, use the standard format
            return `${displayName} ${sel.overUnder} ${sel.line} ${statLabel}${variantInfo}`;
          }
        });
        const selection = `Parlay: ${selectionTexts.join(' + ')}`;
        const market = `Parlay (${parlaySelections.length} legs)`;

        // Collect all bookmakers from parlay legs
        const bookmakers = parlaySelections
          .map(sel => sel.bookmaker)
          .filter((name): name is string => Boolean(name && name.trim()));

        // Store structured parlay leg data for efficient resolution
        const parlayLegs = parlaySelections.map(sel => ({
          playerId: sel.playerId,
          playerName: sel.playerName,
          team: sel.team,
          opponent: sel.opponent,
          gameDate: sel.gameDate,
          statType: sel.statType,
          line: sel.line,
          overUnder: sel.overUnder,
          isGameProp: sel.isGameProp || false, // Include game prop flag
          isPickem: sel.isPickem || false, // Include pick'em flag
          variantLabel: sel.variantLabel || null, // Include variant label for PrizePicks
        }));

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
            parlay_legs: parlayLegs, // Store structured leg data for efficient resolution
          });

        if (insertError) throw insertError;
      } else {
        // Handle single bet submission
        const statOptions = isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
        const statLabel = statOptions.find(opt => opt.value === statType)?.label || statType.toUpperCase();
        
        // Determine line and odds based on mode
        const finalLine = isManualMode ? parseFloat(manualLine) : selectedOdds!.line;
        const finalOdds = isManualMode ? parseFloat(manualOdds) : (overUnder === 'over' ? selectedOdds!.overPrice : selectedOdds!.underPrice);
        
        const selection = isGameProp 
          ? `${team} vs ${opponent} ${overUnder} ${finalLine} ${statLabel}`
          : `${playerName} ${overUnder} ${finalLine} ${statLabel}`;
        const market = isGameProp ? `Game ${statLabel}` : `Player ${statLabel}`;
        
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm overflow-y-auto py-4">
      <div className={`flex gap-4 w-full max-w-7xl mx-4 items-start ${
        isParlayMode ? 'flex-col lg:flex-row lg:items-stretch' : ''
      }`}>
      <div className={`bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full flex flex-col ${
        isParlayMode 
          ? 'lg:max-w-5xl lg:min-h-0 max-h-[90vh]' 
          : 'max-w-md h-[90vh]'
      }`} style={isParlayMode ? { height: 'calc(100vh - 2rem)', maxHeight: 'calc(100vh - 2rem)' } : undefined}>
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 flex-shrink-0">
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

        {/* Scrollable Content */}
        <div className={`flex-1 overflow-y-auto custom-scrollbar min-h-0 px-6 ${
          isParlayMode ? 'pb-6' : 'pb-6'
        }`}>
          {/* Error */}
          {error && (
            <div className="mb-4 p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-700 rounded-lg text-red-700 dark:text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Form */}
          <form id="journal-form" onSubmit={handleSubmit} className="space-y-4">
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
                  // Reset side-by-side states
                  setSelectedGame(null);
                  setGameSearchQuery('');
                  // Auto-fill player info from props if not a game prop
                  if (!isGameProp && playerName && playerId) {
                    const playerInfo: BdlSearchResult = {
                      id: parseInt(playerId) || 0,
                      full: playerName,
                      team: team || undefined,
                    };
                    setSelectedPlayer(playerInfo);
                    setPlayerSearchQuery(playerName);
                    // Set playerStatType to match current statType to ensure odds fetch
                    if (statType && PLAYER_STAT_OPTIONS.some(opt => opt.value === statType)) {
                      setPlayerStatType(statType);
                    }
                    // Auto-fill game for player's team - construct directly from props
                    // The odds fetch useEffect will get the correct homeTeam/awayTeam from API
                    if (team && opponent) {
                      const game = {
                        homeTeam: team, // Will be corrected by API response
                        awayTeam: opponent, // Will be corrected by API response
                        gameDate: gameDate,
                      };
                      setSelectedGame(game);
                      setGameSearchQuery(`${getTeamNameOnly(team)} vs ${getTeamNameOnly(opponent)}`);
                    }
                  } else {
                    setSelectedPlayer(null);
                    setPlayerSearchQuery('');
                  }
                  // Auto-fill game info if it's a game prop - construct directly from props
                  // The odds fetch useEffect will get the correct homeTeam/awayTeam from API
                  if (isGameProp && team && opponent) {
                    const game = {
                      homeTeam: team, // Will be corrected by API response
                      awayTeam: opponent, // Will be corrected by API response
                      gameDate: gameDate,
                    };
                    setSelectedGame(game);
                    setGameSearchQuery(`${getTeamNameOnly(team)} vs ${getTeamNameOnly(opponent)}`);
                  }
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

          {/* Side-by-side parlay mode - Desktop only, single column on mobile */}
          {isParlayMode ? (
            <div className="flex flex-col lg:grid lg:grid-cols-2 gap-4">
              {/* Left Side - Game Props */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 flex flex-col max-h-[70vh]">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Game Props</h3>
                <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
                {/* Game Search */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Search Game
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={gameSearchQuery}
                      onChange={(e) => setGameSearchQuery(e.target.value)}
                      placeholder="Search by team name..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    {gameSearchQuery && gameSearchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {gameSearchResults.map((game, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => {
                              setSelectedGame(game);
                              setGameSearchQuery(`${getTeamNameOnly(game.homeTeam)} vs ${getTeamNameOnly(game.awayTeam)}`);
                              setGameSearchResults([]);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-white"
                          >
                            {getTeamNameOnly(game.homeTeam)} vs {getTeamNameOnly(game.awayTeam)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  {selectedGame && (
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Selected: {getTeamNameOnly(selectedGame.homeTeam)} vs {getTeamNameOnly(selectedGame.awayTeam)}
                    </div>
                  )}
                </div>

                {/* Game Stat Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Stat Type
                  </label>
                  <select
                    value={gameStatType}
                    onChange={(e) => setGameStatType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={!selectedGame}
                  >
                    {GAME_PROP_STAT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* Game Odds Section - Always visible in parlay mode */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Live Bookmaker Odds
                    {!gameOddsLoading && gameAvailableOdds.length > 0 && (
                      <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                        ({gameAvailableOdds.length} bookmaker{gameAvailableOdds.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </label>
                  <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                          {gameOddsLoading ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                              <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading odds...</span>
                            </div>
                          ) : gameOddsError ? (
                            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm">
                              {gameOddsError}
                            </div>
                          ) : gameAvailableOdds.length === 0 ? (
                            <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 text-sm">
                              No live odds available for this prop
                            </div>
                          ) : (
                            <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar">
                              {gameAvailableOdds.map((odds, idx) => {
                                const isSelected = !gameIsManualMode && gameSelectedOdds?.bookmaker === odds.bookmaker && gameSelectedOdds?.line === odds.line;
                                const bookmaker = getBookmakerInfo(odds.bookmaker);
                                return (
                                  <button
                                    key={`${odds.bookmaker}-${odds.line}-${idx}`}
                                    type="button"
                                    onClick={() => {
                                      setGameSelectedOdds(odds);
                                      setGameIsManualMode(false);
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
                                          {gameStatType !== 'moneyline' && (
                                            <div className="text-xs text-gray-500 dark:text-gray-400">
                                              Line: {odds.line}
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                      <div className="flex gap-2">
                                        {gameStatType === 'moneyline' && odds.homeTeam && odds.awayTeam ? (
                                          <>
                                            <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.homeTeam)}</span> {formatOdds(odds.homeOdds || odds.overPrice, oddsFormat)}
                                            </span>
                                            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.awayTeam)}</span> {formatOdds(odds.awayOdds || odds.underPrice, oddsFormat)}
                                            </span>
                                          </>
                                        ) : gameStatType === 'spread' && odds.favoriteTeam && odds.underdogTeam ? (
                                          <>
                                            <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.favoriteTeam)}</span> {odds.favoriteSpread} {formatOdds(odds.favoriteOdds || odds.overPrice, oddsFormat)}
                                            </span>
                                            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.underdogTeam)}</span> {odds.underdogSpread} {formatOdds(odds.underdogOdds || odds.underPrice, oddsFormat)}
                                            </span>
                                          </>
                                        ) : (
                                          <>
                                            <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                              O {formatOdds(odds.overPrice, oddsFormat)}
                                            </span>
                                            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                              U {formatOdds(odds.underPrice, oddsFormat)}
                                            </span>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                      </div>
                    </div>

                    {/* Game Manual Entry Section */}
                    <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setGameManualExpanded(!gameManualExpanded);
                          if (!gameManualExpanded) {
                            setGameIsManualMode(true);
                            setGameSelectedOdds(null);
                          }
                        }}
                        className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          {gameManualExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                          <span className="font-medium text-gray-900 dark:text-white">Manual Entry</span>
                        </div>
                      </button>
                      
                      {gameManualExpanded && (
                        <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Line
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={gameManualLine}
                              onChange={(e) => setGameManualLine(e.target.value)}
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
                              value={gameManualOdds}
                              onChange={(e) => setGameManualOdds(e.target.value)}
                              placeholder={oddsFormat === 'decimal' ? 'e.g., 1.91' : 'e.g., -110'}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Game Direction / Team Selection */}
                    {gameStatType === 'moneyline' && gameSelectedOdds?.homeTeam && gameSelectedOdds?.awayTeam ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Select Team
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('over')} // Use 'over' for home team
                            disabled={!selectedGame || !gameSelectedOdds}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'over'
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {getTeamNameOnly(gameSelectedOdds.homeTeam)} {formatOdds(gameSelectedOdds.homeOdds || gameSelectedOdds.overPrice, oddsFormat)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('under')} // Use 'under' for away team
                            disabled={!selectedGame || !gameSelectedOdds}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'under'
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {getTeamNameOnly(gameSelectedOdds.awayTeam)} {formatOdds(gameSelectedOdds.awayOdds || gameSelectedOdds.underPrice, oddsFormat)}
                          </button>
                        </div>
                      </div>
                    ) : gameStatType === 'spread' && gameSelectedOdds?.favoriteTeam && gameSelectedOdds?.underdogTeam ? (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Select Team
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('over')} // Use 'over' for favorite
                            disabled={!selectedGame || !gameSelectedOdds}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'over'
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {getTeamNameOnly(gameSelectedOdds.favoriteTeam)} {gameSelectedOdds.favoriteSpread} {formatOdds(gameSelectedOdds.favoriteOdds || gameSelectedOdds.overPrice, oddsFormat)}
                          </button>
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('under')} // Use 'under' for underdog
                            disabled={!selectedGame || !gameSelectedOdds}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'under'
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            {getTeamNameOnly(gameSelectedOdds.underdogTeam)} {gameSelectedOdds.underdogSpread > 0 ? '+' : ''}{gameSelectedOdds.underdogSpread} {formatOdds(gameSelectedOdds.underdogOdds || gameSelectedOdds.underPrice, oddsFormat)}
                          </button>
                        </div>
                      </div>
                    ) : gameStatType !== 'moneyline' && (
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Direction
                        </label>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('over')}
                            disabled={!selectedGame}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'over'
                                ? 'bg-green-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            Over
                          </button>
                          <button
                            type="button"
                            onClick={() => setGameOverUnder('under')}
                            disabled={!selectedGame}
                            className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                              gameOverUnder === 'under'
                                ? 'bg-red-600 text-white'
                                : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                            }`}
                          >
                            Under
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Add Game Prop to Parlay Button */}
                    <button
                      type="button"
                      onClick={addGamePropToParlay}
                      className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      disabled={!selectedGame || !gameStatType || (!gameSelectedOdds && !gameIsManualMode)}
                    >
                      <Plus className="w-4 h-4" />
                      Add to Parlay
                    </button>
                </div>
              </div>

              {/* Right Side - Player Props */}
              <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-4 flex flex-col max-h-[70vh]">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">Player Props</h3>
                <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
                {/* Player Search */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Search Player
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={playerSearchQuery}
                      onChange={(e) => setPlayerSearchQuery(e.target.value)}
                      placeholder="Search by player name..."
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    />
                    {playerSearchQuery && playerSearchResults.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {playerSearchResults.map((player) => (
                          <button
                            key={player.id}
                            type="button"
                            onClick={() => {
                              setSelectedPlayer(player);
                              setPlayerSearchQuery(player.full);
                              setPlayerSearchResults([]);
                            }}
                            className="w-full px-3 py-2 text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-900 dark:text-white"
                          >
                            {player.full} {player.team ? `(${player.team})` : ''}
                          </button>
                        ))}
                      </div>
                    )}
                    {playerSearchBusy && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
                      </div>
                    )}
                  </div>
                  {selectedPlayer && (
                    <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">
                      Selected: {selectedPlayer.full} {selectedPlayer.team ? `(${selectedPlayer.team})` : ''}
                    </div>
                  )}
                </div>

                {/* Player Stat Type */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Stat Type
                  </label>
                  <select
                    value={playerStatType}
                    onChange={(e) => setPlayerStatType(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                    disabled={!selectedPlayer}
                  >
                    {PLAYER_STAT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                    {/* Player Odds Section - Always visible in parlay mode */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Live Bookmaker Odds
                        {!playerOddsLoading && playerAvailableOdds.length > 0 && (
                          <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                            ({playerAvailableOdds.length} bookmaker{playerAvailableOdds.length !== 1 ? 's' : ''})
                          </span>
                        )}
                      </label>
                      <div className="border border-gray-200 dark:border-gray-600 rounded-lg p-3">
                          {playerOddsLoading ? (
                            <div className="flex items-center justify-center py-8">
                              <Loader2 className="w-6 h-6 animate-spin text-purple-600" />
                              <span className="ml-2 text-sm text-gray-600 dark:text-gray-400">Loading odds...</span>
                            </div>
                          ) : playerOddsError ? (
                            <div className="p-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-lg text-yellow-700 dark:text-yellow-400 text-sm">
                              {playerOddsError}
                            </div>
                          ) : playerAvailableOdds.length === 0 && !playerOddsLoading ? (
                            <div className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-400 text-sm">
                              {selectedPlayer ? 'No live odds available for this prop' : 'Please select a player to see odds'}
                            </div>
                          ) : playerAvailableOdds.length > 0 ? (
                            <div className="max-h-64 overflow-y-auto space-y-2 custom-scrollbar">
                              {playerAvailableOdds.map((odds, idx) => {
                                const isSelected = !playerIsManualMode && playerSelectedOdds?.bookmaker === odds.bookmaker && playerSelectedOdds?.line === odds.line;
                                const bookmaker = getBookmakerInfo(odds.bookmaker);
                                return (
                                  <button
                                    key={`${odds.bookmaker}-${odds.line}-${idx}`}
                                    type="button"
                                    onClick={() => {
                                      setPlayerSelectedOdds(odds);
                                      setPlayerIsManualMode(false);
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
                                        <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                          O {formatOdds(odds.overPrice, oddsFormat)}
                                        </span>
                                        <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                          U {formatOdds(odds.underPrice, oddsFormat)}
                                        </span>
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          ) : null}
                      </div>
                    </div>

                    {/* Player Manual Entry Section */}
                    <div className="border border-gray-200 dark:border-gray-600 rounded-lg">
                      <button
                        type="button"
                        onClick={() => {
                          setPlayerManualExpanded(!playerManualExpanded);
                          if (!playerManualExpanded) {
                            setPlayerIsManualMode(true);
                            setPlayerSelectedOdds(null);
                          }
                        }}
                        className="w-full p-3 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg"
                      >
                        <div className="flex items-center gap-2">
                          {playerManualExpanded ? <ChevronDown className="w-5 h-5" /> : <ChevronRight className="w-5 h-5" />}
                          <span className="font-medium text-gray-900 dark:text-white">Manual Entry</span>
                        </div>
                      </button>
                      
                      {playerManualExpanded && (
                        <div className="p-3 border-t border-gray-200 dark:border-gray-600 space-y-3">
                          <div>
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                              Line
                            </label>
                            <input
                              type="number"
                              step="0.5"
                              value={playerManualLine}
                              onChange={(e) => setPlayerManualLine(e.target.value)}
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
                              value={playerManualOdds}
                              onChange={(e) => setPlayerManualOdds(e.target.value)}
                              placeholder={oddsFormat === 'decimal' ? 'e.g., 1.91' : 'e.g., -110'}
                              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Player Direction */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                        Direction
                      </label>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPlayerOverUnder('over')}
                          disabled={!selectedPlayer}
                          className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            playerOverUnder === 'over'
                              ? 'bg-green-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          Over
                        </button>
                        <button
                          type="button"
                          onClick={() => setPlayerOverUnder('under')}
                          disabled={!selectedPlayer}
                          className={`flex-1 py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                            playerOverUnder === 'under'
                              ? 'bg-red-600 text-white'
                              : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                          }`}
                        >
                          Under
                        </button>
                      </div>
                    </div>

                    {/* Add Player Prop to Parlay Button */}
                    <button
                      type="button"
                      onClick={addPlayerPropToParlay}
                      className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      disabled={!selectedPlayer || !playerStatType || (!playerSelectedOdds && !playerIsManualMode)}
                    >
                      <Plus className="w-4 h-4" />
                      Add to Parlay
                    </button>
                </div>
              </div>

            </div>
          ) : (
            <>
              {/* Single Bet Mode - Original Form */}
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
                        
                        // Debug logging (remove in production)
                        if (process.env.NODE_ENV !== 'production' && group.primary.length > 1) {
                          console.log(`[Alt Lines Debug] ${bookmakerName}: ${group.primary.length} total lines, ${primary.length} primary, ${alt.length} alt`);
                        }
                        
                        // Update the group
                        group.primary = primary;
                        group.alt = alt;
                        
                        // Sort alt lines by line (descending)
                        group.alt.sort((a, b) => b.line - a.line);
                      });
                      
                      // Render odds grouped by bookmaker - primary first, then alt lines below
                      const renderedOdds: JSX.Element[] = [];
                      oddsByBookmaker.forEach((group, bookmakerName) => {
                        const bookmaker = getBookmakerInfo(bookmakerName);
                        
                        // Render primary lines first
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
                                      <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                        <span className="text-sm font-semibold">{getTeamNameOnly(odds.homeTeam)}</span> {formatOdds(odds.homeOdds || odds.overPrice, oddsFormat)}
                                      </span>
                                      <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                        <span className="text-sm font-semibold">{getTeamNameOnly(odds.awayTeam)}</span> {formatOdds(odds.awayOdds || odds.underPrice, oddsFormat)}
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
                                    const oddsIsPrizePicks = isPrizePicks(odds.bookmaker);
                                    const showVariantLogo = oddsIsPrizePicks && odds.isPickem && odds.variantLabel;
                                    
                                    return (
                                      <>
                                        {/* PrizePicks logo */}
                                        {bookmaker.logoUrl ? (
                                          <div className="relative flex-shrink-0">
                                            <BookmakerLogo 
                                              logoUrl={bookmaker.logoUrl}
                                              name={bookmaker.name}
                                              fallbackEmoji={bookmaker.logo}
                                            />
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
                                          const oddsIsPrizePicks = isPrizePicks(odds.bookmaker);
                                          if (oddsIsPrizePicks && odds.isPickem) {
                                            const multiplier = getPrizePicksMultiplier(odds, odds.variantLabel);
                                            return `${odds.variantLabel || 'Pick\'em'} Line: ${odds.line} • ${multiplier}x multiplier`;
                                          }
                                          return `Alt Line: ${odds.line}`;
                                        })()}
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex gap-2">
                                  {(() => {
                                    const oddsIsPrizePicks = isPrizePicks(odds.bookmaker);
                                    if (oddsIsPrizePicks && odds.isPickem) {
                                      const multiplier = getPrizePicksMultiplier(odds, odds.variantLabel);
                                      return (
                                        <span className="px-2 py-1 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-xs font-semibold">
                                          {multiplier}x
                                        </span>
                                      );
                                    }
                                    return (
                                      <>
                                        {statType === 'moneyline' && odds.homeTeam && odds.awayTeam ? (
                                          <>
                                            <span className="px-2 py-1 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                              {odds.homeTeam} {formatOdds(odds.homeOdds || odds.overPrice, oddsFormat)}
                                            </span>
                                            <span className="px-2 py-1 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                              {odds.awayTeam} {formatOdds(odds.awayOdds || odds.underPrice, oddsFormat)}
                                            </span>
                                          </>
                                        ) : statType === 'spread' && odds.favoriteTeam && odds.underdogTeam ? (
                                          <>
                                            <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.favoriteTeam)}</span> {odds.favoriteSpread && odds.favoriteSpread < 0 ? odds.favoriteSpread : `-${Math.abs(odds.favoriteSpread || 0)}`} {formatOdds(odds.favoriteOdds || odds.overPrice, oddsFormat)}
                                            </span>
                                            <span className="px-1.5 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded text-xs font-mono">
                                              <span className="text-sm font-semibold">{getTeamNameOnly(odds.underdogTeam)}</span> +{Math.abs(odds.underdogSpread || 0)} {formatOdds(odds.underdogOdds || odds.underPrice, oddsFormat)}
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

              {/* Over/Under Toggle or Team Selection for Moneylines/Spreads */}
              {((statType === 'moneyline' && isGameProp && selectedOdds?.homeTeam && selectedOdds?.awayTeam) ||
            (statType === 'spread' && isGameProp && selectedOdds?.favoriteTeam && selectedOdds?.underdogTeam)) ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                Select Team
              </label>
              <div className="flex gap-2">
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

          {/* Stake with Currency - Only show in single bet mode */}
          {!isParlayMode && (
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
                  <span className="absolute left-3 font-medium pointer-events-none text-base text-gray-500 dark:text-gray-400" style={{ 
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
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-slate-700 text-gray-900 dark:text-white focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                    required
                  />
                </div>
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
              {loading ? 'Adding...' : 'Add to Journal'}
            </button>
          </div>
            </>
          )}
          </form>
        </div>
      </div>

      {/* Bet Slip Button - Mobile only */}
      {isParlayMode && (
        <>
          <button
            type="button"
            onClick={() => setShowBetSlipMobile(true)}
            className="lg:hidden fixed bottom-20 left-4 right-4 bg-purple-600 hover:bg-purple-700 text-white rounded-lg shadow-lg px-4 py-3 flex items-center justify-between z-40 transition-colors safe-bottom"
            style={{ bottom: 'calc(4rem + env(safe-area-inset-bottom))' }}
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">Bet Slip</span>
              {parlaySelections.length > 0 && (
                <span className="bg-white/20 rounded-full px-2 py-0.5 text-sm font-medium">
                  {parlaySelections.length}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {parlaySelections.length > 0 && (
                <span className="text-sm">
                  {(() => {
                    const allPrizePicksPickem = parlaySelections.every(sel => {
                      const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                      return selIsPrizePicks && sel.isPickem;
                    });
                    if (allPrizePicksPickem) {
                      const totalMultiplier = parlaySelections.reduce((acc, sel) => {
                        const multiplier = sel.multiplier ?? getPrizePicksMultiplier(null, sel.variantLabel);
                        return acc * multiplier;
                      }, 1);
                      return `${totalMultiplier}x`;
                    }
                    return formatOdds(calculateParlayOdds(parlaySelections, oddsFormat), oddsFormat);
                  })()}
                </span>
              )}
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </button>

          {/* Bet Slip - Full screen on mobile, side panel on desktop */}
          {showBetSlipMobile && (
            <div className="lg:hidden fixed inset-0 z-50 bg-black/50 backdrop-blur-sm">
              <div className="bg-white dark:bg-slate-800 w-full h-full flex flex-col shadow-xl">
                <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-600">
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bet Slip</h3>
                  <button
                    type="button"
                    onClick={() => setShowBetSlipMobile(false)}
                    className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                  {/* Bet Slip Content - Same as desktop */}
                  {parlaySelections.length > 0 ? (
                    <>
                      {(() => {
                        const hasPrizePicksPickem = parlaySelections.some(sel => {
                          const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                          return selIsPrizePicks && sel.isPickem;
                        });
                        if (hasPrizePicksPickem) {
                          return (
                            <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded text-xs text-blue-700 dark:text-blue-400">
                              <strong>Note:</strong> PrizePicks pick'em lines can only be combined with other PrizePicks props. All selections in this parlay must be from PrizePicks.
                            </div>
                          );
                        }
                        return null;
                      })()}
                      <div className="flex items-center justify-between mb-2">
                        <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                          Selections ({parlaySelections.length})
                        </h4>
                        <div className="text-sm font-medium text-purple-600 dark:text-purple-400">
                          {(() => {
                            const allPrizePicksPickem = parlaySelections.every(sel => {
                              const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                              return selIsPrizePicks && sel.isPickem;
                            });
                            if (allPrizePicksPickem) {
                              const totalMultiplier = parlaySelections.reduce((acc, sel) => {
                                const multiplier = sel.multiplier ?? getPrizePicksMultiplier(null, sel.variantLabel);
                                return acc * multiplier;
                              }, 1);
                              return `${totalMultiplier}x`;
                            }
                            return formatOdds(calculateParlayOdds(parlaySelections, oddsFormat), oddsFormat);
                          })()}
                        </div>
                      </div>
                      <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                        {parlaySelections.map((sel) => {
                          const statOptions = sel.isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
                          const statLabel = statOptions.find(opt => opt.value === sel.statType)?.label || sel.statType.toUpperCase();
                          const displayName = sel.isGameProp 
                            ? (sel.team ? `${getTeamNameOnly(sel.team)} vs ${getTeamNameOnly(sel.opponent)}` : 'Game')
                            : sel.playerName;
                          const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                          const showMultiplier = selIsPrizePicks && sel.isPickem;
                          const multiplier = showMultiplier ? getPrizePicksMultiplier(sel.variantLabel) : null;
                          
                          // Format the selection text based on stat type
                          let selectionText = '';
                          if (sel.isGameProp && sel.statType === 'moneyline') {
                            const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
                            selectionText = `${selectedTeam} ML vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}`;
                          } else if (sel.isGameProp && sel.statType === 'spread') {
                            const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
                            selectionText = `${selectedTeam} ${sel.line > 0 ? '+' : ''}${sel.line} vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}`;
                          } else {
                            selectionText = `${displayName} ${sel.overUnder} ${sel.line} ${statLabel}`;
                          }
                          
                          return (
                            <div
                              key={sel.id}
                              className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600"
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                    {selectionText}
                                  </span>
                                  {sel.variantLabel && (
                                    <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[10px] font-semibold uppercase">
                                      {sel.variantLabel}
                                    </span>
                                  )}
                                  {showMultiplier && multiplier && (
                                    <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-[10px] font-semibold">
                                      {multiplier}x
                                    </span>
                                  )}
                                </div>
                                <div className="text-xs text-gray-500 dark:text-gray-400">
                                  {showMultiplier && multiplier 
                                    ? `${sel.variantLabel || 'Pick\'em'} Line ${sel.line} • ${multiplier}x multiplier • ${sel.bookmaker}`
                                    : `${formatOdds(sel.odds, oddsFormat)} ${sel.bookmaker ? `• ${sel.bookmaker}` : '• Manual'}`}
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
                    </>
                  ) : (
                    <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                      No selections yet. Add props from the left to build your parlay.
                    </div>
                  )}
                </div>

                {/* Stake and Currency - Mobile */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-600 space-y-4 bg-white dark:bg-slate-800">
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
                        disabled={parlaySelections.length < 2}
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
                          parlaySelections.length < 2
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
                          disabled={parlaySelections.length < 2}
                        />
                      </div>
                      {parlaySelections.length < 2 && (
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          Add at least 2 selections
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    form="journal-form"
                    onClick={() => setShowBetSlipMobile(false)}
                    className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={loading || parlaySelections.length < 2}
                  >
                    {loading ? 'Adding...' : `Submit Parlay (${parlaySelections.length})`}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Bet Slip - Desktop: Separate container on the right */}
          <div className="hidden lg:flex bg-white dark:bg-slate-800 rounded-lg shadow-xl w-96 p-6 flex flex-col overflow-hidden" style={{ height: 'calc(100vh - 2rem)', maxHeight: 'calc(100vh - 2rem)' }}>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4 flex-shrink-0">Bet Slip</h3>
            <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2 min-h-0">
            {/* Parlay Selections List */}
            {parlaySelections.length > 0 ? (
              <>
                {(() => {
                  const hasPrizePicksPickem = parlaySelections.some(sel => {
                    const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                    return selIsPrizePicks && sel.isPickem;
                  });
                  if (hasPrizePicksPickem) {
                    return (
                      <div className="mb-2 p-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded text-xs text-blue-700 dark:text-blue-400">
                        <strong>Note:</strong> PrizePicks pick'em lines can only be combined with other PrizePicks props. All selections in this parlay must be from PrizePicks.
                      </div>
                    );
                  }
                  return null;
                })()}
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-gray-900 dark:text-white">
                    Selections ({parlaySelections.length})
                  </h4>
                  <div className="text-sm font-medium text-purple-600 dark:text-purple-400">
                    {(() => {
                      const allPrizePicksPickem = parlaySelections.every(sel => {
                        const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                        return selIsPrizePicks && sel.isPickem;
                      });
                      if (allPrizePicksPickem) {
                        const totalMultiplier = parlaySelections.reduce((acc, sel) => {
                          const multiplier = sel.multiplier ?? getPrizePicksMultiplier(null, sel.variantLabel);
                          return acc * multiplier;
                        }, 1);
                        return `${totalMultiplier}x`;
                      }
                      return formatOdds(calculateParlayOdds(parlaySelections, oddsFormat), oddsFormat);
                    })()}
                  </div>
                </div>
                <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar">
                  {parlaySelections.map((sel) => {
                    const statOptions = sel.isGameProp ? GAME_PROP_STAT_OPTIONS : PLAYER_STAT_OPTIONS;
                    const statLabel = statOptions.find(opt => opt.value === sel.statType)?.label || sel.statType.toUpperCase();
                    const displayName = sel.isGameProp 
                      ? (sel.team ? `${getTeamNameOnly(sel.team)} vs ${getTeamNameOnly(sel.opponent)}` : 'Game')
                      : sel.playerName;
                    const selIsPrizePicks = isPrizePicks(sel.bookmaker);
                    const showMultiplier = selIsPrizePicks && sel.isPickem;
                    const multiplier = showMultiplier ? getPrizePicksMultiplier(sel.variantLabel) : null;
                    
                    // Format the selection text based on stat type
                    let selectionText = '';
                    if (sel.isGameProp && sel.statType === 'moneyline') {
                      // For moneylines, show the selected team name
                      const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
                      selectionText = `${selectedTeam} ML vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}`;
                    } else if (sel.isGameProp && sel.statType === 'spread') {
                      // For spreads, show team and spread
                      const selectedTeam = sel.overUnder === 'over' ? getTeamNameOnly(sel.team) : getTeamNameOnly(sel.opponent);
                      selectionText = `${selectedTeam} ${sel.line > 0 ? '+' : ''}${sel.line} vs ${sel.overUnder === 'over' ? getTeamNameOnly(sel.opponent) : getTeamNameOnly(sel.team)}`;
                    } else {
                      // For other stats, use the standard format
                      selectionText = `${displayName} ${sel.overUnder} ${sel.line} ${statLabel}`;
                    }
                    
                    return (
                      <div
                        key={sel.id}
                        className="flex items-center justify-between p-2 bg-white dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-600"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-medium text-gray-900 dark:text-white truncate">
                              {selectionText}
                            </span>
                            {sel.variantLabel && (
                              <span className="px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 rounded text-[10px] font-semibold uppercase">
                                {sel.variantLabel}
                              </span>
                            )}
                            {showMultiplier && multiplier && (
                              <span className="px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400 rounded text-[10px] font-semibold">
                                {multiplier}x
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">
                            {showMultiplier && multiplier 
                              ? `${sel.variantLabel || 'Pick\'em'} Line ${sel.line} • ${multiplier}x multiplier • ${sel.bookmaker}`
                              : `${formatOdds(sel.odds, oddsFormat)} ${sel.bookmaker ? `• ${sel.bookmaker}` : '• Manual'}`}
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
              </>
            ) : (
              <div className="p-4 text-center text-sm text-gray-500 dark:text-gray-400">
                No selections yet. Add props from the left to build your parlay.
              </div>
            )}
          </div>

          {/* Stake and Currency - Desktop: Always visible */}
          <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-600 space-y-4 flex-shrink-0">
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
                  disabled={parlaySelections.length < 2}
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
                    parlaySelections.length < 2
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
                    disabled={parlaySelections.length < 2}
                  />
                </div>
                {parlaySelections.length < 2 && (
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    Add at least 2 selections
                  </p>
                )}
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              form="journal-form"
              className="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={loading || parlaySelections.length < 2}
            >
              {loading ? 'Adding...' : `Submit Parlay (${parlaySelections.length})`}
            </button>
          </div>
        </div>
        </>
      )}
      </div>
    </div>
  );
}
