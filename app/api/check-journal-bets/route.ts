import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is required');
}

interface PlayerStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
}

const logDebug = (...args: Parameters<typeof console.log>) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(...args);
  }
};

// Game prop stat types that don't require a player_id
const GAME_PROP_STAT_TYPES = ['total_pts', 'home_total', 'away_total', 'first_half_total', 'second_half_total', 
                               'q1_total', 'q2_total', 'q3_total', 'q4_total', 
                               'q1_moneyline', 'q2_moneyline', 'q3_moneyline', 'q4_moneyline',
                               'moneyline', 'spread'];

/**
 * Evaluate a game prop based on game data
 * Returns the actual value for the game prop stat type
 */
function evaluateGameProp(game: any, statType: string, teamAbbr: string): number {
  if (!game) return 0;
  
  const homeScore = game.home_team_score || 0;
  const visitorScore = game.visitor_team_score || 0;
  const homeTeam = game.home_team?.abbreviation;
  const visitorTeam = game.visitor_team?.abbreviation;
  
  // Normalize team abbreviation for comparison
  const normalizeAbbr = (abbr: string) => abbr?.toUpperCase().trim() || '';
  const normalizedTeam = normalizeAbbr(teamAbbr);
  const isHome = normalizeAbbr(homeTeam || '') === normalizedTeam;
  
  switch (statType) {
    case 'total_pts':
      return homeScore + visitorScore;
    
    case 'spread':
      // Positive = team lost (failed to cover), negative = team won (covered spread)
      return isHome ? visitorScore - homeScore : homeScore - visitorScore;
    
    case 'moneyline':
      // 1 = win, 0 = loss
      return isHome ? (homeScore > visitorScore ? 1 : 0) : (visitorScore > homeScore ? 1 : 0);
    
    case 'home_total':
      return homeScore;
    
    case 'away_total':
      return visitorScore;
    
    case 'first_half_total':
      return (game.home_q1 || 0) + (game.home_q2 || 0) + (game.visitor_q1 || 0) + (game.visitor_q2 || 0);
    
    case 'second_half_total':
      return (game.home_q3 || 0) + (game.home_q4 || 0) + (game.visitor_q3 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_total':
      return (game.home_q1 || 0) + (game.visitor_q1 || 0);
    
    case 'q2_total':
      return (game.home_q2 || 0) + (game.visitor_q2 || 0);
    
    case 'q3_total':
      return (game.home_q3 || 0) + (game.visitor_q3 || 0);
    
    case 'q4_total':
      return (game.home_q4 || 0) + (game.visitor_q4 || 0);
    
    case 'q1_moneyline':
      // 1 = won quarter, 0 = lost quarter
      const homeQ1 = game.home_q1 || 0;
      const visitorQ1 = game.visitor_q1 || 0;
      return isHome ? (homeQ1 > visitorQ1 ? 1 : 0) : (visitorQ1 > homeQ1 ? 1 : 0);
    
    case 'q2_moneyline':
      const homeQ2 = game.home_q2 || 0;
      const visitorQ2 = game.visitor_q2 || 0;
      return isHome ? (homeQ2 > visitorQ2 ? 1 : 0) : (visitorQ2 > homeQ2 ? 1 : 0);
    
    case 'q3_moneyline':
      const homeQ3 = game.home_q3 || 0;
      const visitorQ3 = game.visitor_q3 || 0;
      return isHome ? (homeQ3 > visitorQ3 ? 1 : 0) : (visitorQ3 > homeQ3 ? 1 : 0);
    
    case 'q4_moneyline':
      const homeQ4 = game.home_q4 || 0;
      const visitorQ4 = game.visitor_q4 || 0;
      return isHome ? (homeQ4 > visitorQ4 ? 1 : 0) : (visitorQ4 > homeQ4 ? 1 : 0);
    
    default:
      console.error(`[check-journal-bets] Unknown game prop stat type: ${statType}`);
      return 0;
  }
}

/**
 * Parse parlay selection text to extract individual legs
 * Format: "Parlay: Player1 over 25 Points + Player2 under 10 Rebounds + ..."
 */
function parseParlayLegs(selectionText: string): Array<{
  playerName: string;
  overUnder: 'over' | 'under';
  line: number;
  statType: string;
}> {
  if (!selectionText || !selectionText.startsWith('Parlay:')) {
    return [];
  }
  
  // Remove "Parlay: " prefix
  const legsText = selectionText.replace(/^Parlay:\s*/, '');
  const legs = legsText.split(' + ').map(leg => leg.trim()).filter(leg => leg);
  
  // Map full stat names to stat keys
  const statNameMap: Record<string, string> = {
    'points': 'pts',
    'rebounds': 'reb',
    'assists': 'ast',
    'steals': 'stl',
    'blocks': 'blk',
    '3-pointers made': 'fg3m',
    '3-pointers': 'fg3m',
    'threes': 'fg3m',
    'points + rebounds': 'pr',
    'points + rebounds + assists': 'pra',
    'rebounds + assists': 'ra',
  };
  
  const parsedLegs: Array<{
    playerName: string;
    overUnder: 'over' | 'under';
    line: number;
    statType: string;
  }> = [];
  
  for (const leg of legs) {
    // Pattern: "PlayerName over/under Line StatName"
    // Examples: "Nikola Jokic over 11.5 Rebounds", "Anthony Edwards under 26.5 Points"
    // Need to match: player name (can have spaces), over/under, number (can be decimal), stat name (can have spaces and +)
    const match = leg.match(/^(.+?)\s+(over|under)\s+([\d.]+)\s+(.+)$/i);
    if (match) {
      const [, playerName, overUnder, lineStr, statName] = match;
      const line = parseFloat(lineStr);
      if (!isNaN(line)) {
        // Normalize stat name: lowercase and map to stat key
        const normalizedStatName = statName.trim().toLowerCase();
        const statKey = statNameMap[normalizedStatName] || normalizedStatName;
        
        parsedLegs.push({
          playerName: playerName.trim(),
          overUnder: (overUnder.toLowerCase() as 'over' | 'under'),
          line,
          statType: statKey,
        });
      }
    }
  }
  
  return parsedLegs;
}

/**
 * Resolve a parlay bet by checking each leg
 */
async function resolveParlayBet(
  bet: any,
  games: any[],
  updatedCountRef: { value: number },
  request?: Request
): Promise<void> {
  try {
    // SAFEGUARD: Only update if bet is still pending, or if recalculate mode is enabled
    // This prevents already-resolved bets from being incorrectly re-resolved
    let recalculate = false;
    if (request) {
      try {
        const url = new URL(request.url);
        recalculate = url.searchParams.get('recalculate') === 'true';
      } catch (e) {
        // If URL parsing fails, assume not in recalculate mode
      }
    }
    
    // If bet is already resolved and we're not in recalculate mode, skip update
    if (!recalculate && bet.result && bet.result !== 'pending') {
      // Silently skip - no need to log every time
      return;
    }
    
    // OPTIMIZATION: Use structured parlay_legs data if available (new parlays)
    // Fallback to parsing text for legacy parlays
    let legs: Array<{
      playerName: string;
      playerId?: string;
      team?: string;
      opponent?: string;
      gameDate?: string;
      overUnder: 'over' | 'under';
      line: number;
      statType: string;
      isGameProp?: boolean; // Flag to indicate if this is a game prop
    }> = [];
    
    if (bet.parlay_legs && Array.isArray(bet.parlay_legs) && bet.parlay_legs.length > 0) {
      // Use structured data (new parlays)
      legs = bet.parlay_legs.map((leg: any) => ({
        playerName: leg.playerName,
        playerId: leg.playerId,
        team: leg.team,
        opponent: leg.opponent,
        gameDate: leg.gameDate,
        overUnder: leg.overUnder,
        line: leg.line,
        statType: leg.statType,
        isGameProp: leg.isGameProp || false, // Include game prop flag
      }));
    } else {
      // Fallback: Parse text for legacy parlays
      const parsedLegs = parseParlayLegs(bet.selection || bet.market || '');
      if (parsedLegs.length === 0) {
        console.error(`[check-journal-bets] ❌ Could not parse parlay legs for bet ${bet.id}. Selection text: "${bet.selection || bet.market}"`);
        return;
      }
      legs = parsedLegs;
    }
    
    const legResults: Array<{ won: boolean; void: boolean; leg: any }> = [];
    let allLegsResolved = true;
    
    // Get the parlay date to filter games
    const parlayDate = bet.date || bet.game_date;
    
    // Check each leg
    // IMPORTANT: Each leg must be resolved (game final, player found, stats calculated) before the parlay can be resolved.
    // If any leg's game hasn't started or isn't final, that leg won't be resolved, and the parlay will stay pending.
    // This ensures parlays with legs on different dates/times wait for ALL games to complete.
    for (const leg of legs) {
      const statKey = leg.statType;
      let legResolved = false;
      
      // OPTIMIZATION: If we have structured data (playerId, team, opponent, gameDate), use direct lookup
      if (leg.playerId && leg.team && leg.gameDate) {
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Using structured data - direct lookup (playerId: ${leg.playerId}, team: ${leg.team}, gameDate: ${leg.gameDate})`);
        
        // Find the specific game for this leg
        const legGameDate = leg.gameDate.split('T')[0];
        let targetGame = games.find((g: any) => {
          const gameDate = g.date ? g.date.split('T')[0] : null;
          if (gameDate !== legGameDate) return false;
          
          // Match by team (home or visitor)
          const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
          const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
          const opponentMatch = leg.opponent && (
            g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
            g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
          );
          
          return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
        });
        
        // Store stats if we fetch them in the fallback (to avoid duplicate API calls)
        let cachedPlayerStats: any = null;
        
        if (!targetGame) {
          // FALLBACK: If team matching failed, try to find game by searching for player in all games from that date
          if (!leg.isGameProp && leg.playerId) {
            // For player props, search all games from that date and check if player played
            const gamesOnDate = games.filter(g => {
              const gameDate = g.date ? g.date.split('T')[0] : null;
              return gameDate === legGameDate;
            });
            
            let foundGame = null;
            // OPTIMIZATION: Add timeout to prevent hanging on slow API calls
            const FALLBACK_TIMEOUT_MS = 5000; // 5 seconds per game search
            const startTime = Date.now();
            
            for (const game of gamesOnDate) {
              // Check if we've exceeded timeout (prevent hanging on too many games)
              if (Date.now() - startTime > FALLBACK_TIMEOUT_MS * gamesOnDate.length) {
                console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Fallback search timeout after ${gamesOnDate.length} games`);
                break;
              }
              
              // Check if player played in this game by fetching stats
              try {
                // Add timeout to individual fetch request
                const controller = new AbortController();
                const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout per request
                
                const statsResponse = await fetch(
                  `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${leg.playerId}`,
                  {
                    headers: {
                      'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
                    },
                    signal: controller.signal,
                  }
                );
                
                clearTimeout(timeoutId);
                
                  if (statsResponse.ok) {
                    const statsData = await statsResponse.json();
                    if (statsData.data && statsData.data.length > 0) {
                      foundGame = game;
                      cachedPlayerStats = statsData.data[0]; // Cache the stats we just fetched
                      // Set targetGame to the found game so the rest of the logic can use it
                      targetGame = foundGame;
                      break;
                    }
                  }
              } catch (e: any) {
                // Continue searching silently
              }
            }
            
            if (!targetGame) {
              allLegsResolved = false;
              continue;
            }
          } else {
            allLegsResolved = false;
            continue;
          }
        }
        
        // Check if game is completed (same logic as before)
        const rawStatus = String(targetGame.status || '');
        const gameStatus = rawStatus.toLowerCase();
        let isCompleted = false;
        let completedAt: Date | null = null;
        const now = Date.now();
        
        let tipoffTime = NaN;
        if (rawStatus && rawStatus.length > 10) {
          const statusParsed = Date.parse(rawStatus);
          if (!Number.isNaN(statusParsed)) {
            tipoffTime = statusParsed;
          }
        }
        if (Number.isNaN(tipoffTime) && targetGame.date) {
          tipoffTime = Date.parse(targetGame.date);
        }
        
        const dateStr = targetGame.date || '';
        const hasTimeComponent = dateStr.includes('T') && dateStr.length > 10;
        
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          const gameHasStarted = timeSinceTipoff > 0;
          
          if (!hasTimeComponent && !gameStatus.includes('final')) {
            allLegsResolved = false;
            continue;
          }
          
          if (gameHasStarted) {
            // CRITICAL: Only mark as completed when status explicitly says "final"
            // This prevents premature bet resolution during live games
            if (gameStatus.includes('final')) {
              isCompleted = true;
              const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000;
              completedAt = new Date(tipoffTime + estimatedGameDurationMs);
            }
            // REMOVED: Time-based completion check - this was causing premature bet resolution
          } else {
            // Game hasn't started - silently skip (will be checked again later)
            allLegsResolved = false;
            continue;
          }
        } else if (gameStatus.includes('final')) {
          isCompleted = true;
          completedAt = new Date(now - (60 * 60 * 1000));
        }
        
        if (!isCompleted) {
          allLegsResolved = false;
          continue;
        }
        
        if (completedAt) {
          const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
          if (completedAt > tenMinutesAgo) {
            // Game just finished - wait for buffer, silently skip
            allLegsResolved = false;
            continue;
          }
        }
        
        // Handle game props differently from player props
        if (leg.isGameProp) {
          // Evaluate game prop using game data
          const actualValue = evaluateGameProp(targetGame, leg.statType, leg.team || '');
          
          // Determine if leg won
          const legLine = Number(leg.line);
          const isWholeNumber = legLine % 1 === 0;
          let legWon: boolean;
          
          // Special handling for different bet types
          if (leg.statType === 'moneyline') {
            // For moneyline: evaluateGameProp returns 1 if team won, 0 if lost
            legWon = actualValue === 1;
          } else if (leg.statType === 'spread') {
            // For spreads: actualValue < 0 means team covered, actualValue > 0 means didn't cover
            // The line is just for reference - the key is whether actualValue is negative
            legWon = actualValue < 0;
          } else {
            // For other props (totals, etc.), use standard over/under logic
            legWon = leg.overUnder === 'over' 
              ? (isWholeNumber ? actualValue >= legLine : actualValue > legLine)
              : (isWholeNumber ? actualValue <= legLine : actualValue < legLine);
          }
          
          legResults.push({ won: legWon, void: false, leg });
          legResolved = true;
          continue; // Move to next leg
        }
        
        // DIRECT LOOKUP: Fetch stats for this specific game and find player by playerId
        // Use cached stats if we already fetched them in the fallback
        let playerStat: any = null;
        
        if (cachedPlayerStats) {
          // Use the stats we already fetched in the fallback
          playerStat = cachedPlayerStats;
        } else {
          // Fetch stats if we didn't get them from the fallback
          const statsResponse = await fetch(
            `https://api.balldontlie.io/v1/stats?game_ids[]=${targetGame.id}&player_ids[]=${leg.playerId}`,
            {
              headers: {
                'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
              },
            }
          );
          
          if (!statsResponse.ok) {
            allLegsResolved = false;
            continue;
          }
          
          const statsData = await statsResponse.json();
          if (!statsData.data || statsData.data.length === 0) {
            allLegsResolved = false;
            continue;
          }
          
          playerStat = statsData.data[0]; // Should only be one result since we filtered by playerId
        }
        
        // Check if player played (void if < 0.01 minutes)
        const minutesPlayed = String(playerStat.min || '0:00').trim();
        let totalMinutes = 0;
        if (minutesPlayed.includes(':')) {
          const parts = minutesPlayed.split(':');
          totalMinutes = (Number(parts[0]) || 0) + ((Number(parts[1]) || 0) / 60);
        } else {
          totalMinutes = Number(minutesPlayed) || 0;
        }
        
        if (totalMinutes < 0.01) {
          // Player didn't play - leg is void
          legResults.push({ won: false, void: true, leg });
          legResolved = true;
          continue;
        }
        
        // Calculate actual value and determine win/loss
        const stats: PlayerStats = {
          pts: playerStat.pts || 0,
          reb: playerStat.reb || 0,
          ast: playerStat.ast || 0,
          stl: playerStat.stl || 0,
          blk: playerStat.blk || 0,
          fg3m: playerStat.fg3m || 0,
        };
        
        let actualValue = 0;
        switch (statKey) {
          case 'pts': actualValue = stats.pts; break;
          case 'reb': actualValue = stats.reb; break;
          case 'ast': actualValue = stats.ast; break;
          case 'pa': actualValue = stats.pts + stats.ast; break;
          case 'pr': actualValue = stats.pts + stats.reb; break;
          case 'pra': actualValue = stats.pts + stats.reb + stats.ast; break;
          case 'ra': actualValue = stats.reb + stats.ast; break;
          case 'stl': actualValue = stats.stl; break;
          case 'blk': actualValue = stats.blk; break;
          case 'fg3m': actualValue = stats.fg3m; break;
        }
        
        // Ensure line is a number (handle string/decimal types)
        const legLine = Number(leg.line);
        const isWholeNumber = legLine % 1 === 0;
        const legWon = leg.overUnder === 'over' 
          ? (isWholeNumber ? actualValue >= legLine : actualValue > legLine)
          : (isWholeNumber ? actualValue <= legLine : actualValue < legLine);
        
        legResults.push({ won: legWon, void: false, leg });
        legResolved = true;
        continue; // Move to next leg
      }
      
      // FALLBACK: Legacy parlay resolution (no structured data) - use old method
      let gamesCheckedFromParlayDate = 0;
      let totalGamesFromParlayDate = 0;
      const gameStatsCache = new Map<number, any[]>();
      
      if (parlayDate) {
        totalGamesFromParlayDate = games.filter((g: any) => {
          const gameDate = g.date ? g.date.split('T')[0] : null;
          return gameDate === parlayDate;
        }).length;
      }
      
      const sortedGames = [...games].sort((a: any, b: any) => {
        const aDate = a.date ? a.date.split('T')[0] : null;
        const bDate = b.date ? b.date.split('T')[0] : null;
        const aIsParlayDate = parlayDate && aDate === parlayDate;
        const bIsParlayDate = parlayDate && bDate === parlayDate;
        if (aIsParlayDate && !bIsParlayDate) return -1;
        if (!aIsParlayDate && bIsParlayDate) return 1;
        return 0;
      });
      
      for (const game of sortedGames) {
        const gameDate = game.date ? game.date.split('T')[0] : null;
        const isFromParlayDate = parlayDate && gameDate === parlayDate;
        if (isFromParlayDate) {
          gamesCheckedFromParlayDate++;
        }
        
        // Check if game is completed (same logic as single bets)
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        
        let isCompleted = false;
        let completedAt: Date | null = null;
        const now = Date.now();
        
        // Try to get tipoff time from game.date or game.status
        // game.status might contain the actual tipoff time as ISO string
        let tipoffTime = NaN;
        
        // First try parsing game.status as it might contain the actual tipoff time
        if (rawStatus && rawStatus.length > 10) {
          const statusParsed = Date.parse(rawStatus);
          if (!Number.isNaN(statusParsed)) {
            tipoffTime = statusParsed;
          }
        }
        
        // If status parsing failed, try game.date
        if (Number.isNaN(tipoffTime) && game.date) {
          tipoffTime = Date.parse(game.date);
        }
        
        // Check if game.date only contains a date (no time) - if so, be more conservative
        const dateStr = game.date || '';
        const hasTimeComponent = dateStr.includes('T') && dateStr.length > 10;
        
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000; // 2.5 hours for NBA game
          const tenMinutesMs = 10 * 60 * 1000; // 10 minutes
          
          // CRITICAL: Game must have actually started (tipoffTime is in the past) before we can mark it as completed
          const gameHasStarted = timeSinceTipoff > 0;
          
          // If game.date only has date (no time), be extra conservative
          // NBA games are typically scheduled for evening (7-10 PM local time)
          // If we only have a date, we can't know the actual tipoff time
          // CRITICAL: For date-only games, ONLY mark as started if status is "final"
          // We cannot trust time-based checks when we don't have the actual tipoff time
          if (!hasTimeComponent) {
            if (!gameStatus.includes('final')) {
              // Date-only and not final: skip this leg - we can't verify the game actually started
              allLegsResolved = false;
              continue;
            }
            // If status is "final", proceed with normal logic
          }
          
          // For date-only games without "final" status, we already skipped them above
          // So if we reach here with date-only, it means status is "final"
          if (gameHasStarted) {
            // CRITICAL: Only mark as completed when status explicitly says "final"
            // This prevents premature bet resolution during live games
            if (gameStatus.includes('final')) {
              isCompleted = true;
              const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
              completedAt = new Date(estimatedCompletionTime);
            }
            // REMOVED: Time-based completion check - this was causing premature bet resolution
          } else {
            // Game hasn't started yet - silently skip (will be checked again later)
            allLegsResolved = false;
            continue; // Game not started yet, can't resolve this leg
          }
        } else if (gameStatus.includes('final')) {
          // Status says final but no date - only mark as completed if we can verify it's actually finished
          // Be more cautious: if we don't have a tipoff time, we can't verify the game started
          isCompleted = true;
          // Set completedAt to 1 hour ago to ensure it passes the 10-minute check
          completedAt = new Date(now - (60 * 60 * 1000));
        }
        
        // Only process if game is completed AND completed at least 10 minutes ago
        if (!isCompleted) {
          allLegsResolved = false;
          continue; // Game not completed yet, can't resolve this leg
        }
        
        if (completedAt) {
          const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
          if (completedAt > tenMinutesAgo) {
            // Game just finished - wait for buffer, silently skip
            allLegsResolved = false;
            continue; // Game completed less than 10 minutes ago, wait
          }
        }
        
        // OPTIMIZATION: Check cache first to avoid fetching the same game stats multiple times
        let statsData: any;
        if (gameStatsCache.has(game.id)) {
          statsData = { data: gameStatsCache.get(game.id) };
        } else {
          // Try to find player in this game by searching stats
          // We'll need to fetch all stats for this game and find the player
          const statsResponse = await fetch(
            `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}`,
            {
              headers: {
                'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
              },
            }
          );
          
          if (!statsResponse.ok) {
            continue;
          }
          
          statsData = await statsResponse.json();
          if (!statsData.data || statsData.data.length === 0) {
            continue;
          }
          
          // Cache the stats for this game
          gameStatsCache.set(game.id, statsData.data);
        }
        
        // Find player by name (case-insensitive partial match)
        // Normalize names for better matching
        const normalizeName = (name: string) => {
          return name.toLowerCase()
            .replace(/\./g, '') // Remove periods (C.J. -> CJ)
            .replace(/[^\w\s]/g, '') // Remove other special characters
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
        };
        
        const legNameNormalized = normalizeName(leg.playerName);
        
        const playerStat = statsData.data.find((stat: any) => {
          const playerName = stat.player?.full_name || 
                            (stat.player?.first_name + ' ' + stat.player?.last_name) || '';
          const playerNameNormalized = normalizeName(playerName);
          
          // Try exact match first
          if (playerNameNormalized === legNameNormalized) {
            return true;
          }
          
          // Try partial match - check if leg name contains player name or vice versa
          const legWords = legNameNormalized.split(' ');
          const playerWords = playerNameNormalized.split(' ');
          
          // If both have at least 2 words, check if last name matches
          if (legWords.length >= 2 && playerWords.length >= 2) {
            const legLastName = legWords[legWords.length - 1];
            const playerLastName = playerWords[playerWords.length - 1];
            // Match if last names match and first name/initial matches
            if (legLastName === playerLastName) {
              // Check if first name or initial matches
              const legFirstName = legWords[0];
              const playerFirstName = playerWords[0];
              // Match if first names match, or if one is a single letter (initial)
              if (legFirstName === playerFirstName || 
                  legFirstName.length === 1 && playerFirstName.startsWith(legFirstName) ||
                  playerFirstName.length === 1 && legFirstName.startsWith(playerFirstName)) {
                return true;
              }
            }
          }
          
          // Fallback to substring match (check if either name contains the other)
          if (playerNameNormalized.includes(legNameNormalized) ||
              legNameNormalized.includes(playerNameNormalized)) {
            return true;
          }
          
          // Additional fallback: check if last name matches and first name/initial is similar
          if (legWords.length >= 2 && playerWords.length >= 2) {
            const legLastName = legWords[legWords.length - 1];
            const playerLastName = playerWords[playerWords.length - 1];
            if (legLastName === playerLastName) {
              // Last name matches, accept it (might be a nickname vs full name issue)
              return true;
            }
          }
          
          return false;
        });
        
        if (!playerStat) {
          // If we've checked all games from the parlay date and player still not found, mark as void
          if (parlayDate && isFromParlayDate && gamesCheckedFromParlayDate === totalGamesFromParlayDate && totalGamesFromParlayDate > 0) {
            legResults.push({ won: false, void: true, leg });
            legResolved = true;
            break;
          }
          
          allLegsResolved = false;
          continue; // Player not in this game
        }
        
        // Check if player played
        // Handle various minute formats: "15:30", "15", "0:00", "0", etc.
        const minutesPlayed = String(playerStat.min || '0:00').trim();
        let totalMinutes = 0;
        
        if (minutesPlayed.includes(':')) {
          // Format: "MM:SS" or "M:SS"
          const parts = minutesPlayed.split(':');
          const mins = Number(parts[0]) || 0;
          const secs = Number(parts[1]) || 0;
          totalMinutes = mins + (secs / 60);
        } else {
          // Format: just a number (total minutes as decimal or whole number)
          totalMinutes = Number(minutesPlayed) || 0;
        }
        
        // Only void if player truly played 0 minutes (accounting for floating point precision)
        if (totalMinutes < 0.01) {
          // Player didn't play - leg is void (excluded from parlay calculation)
          legResults.push({ won: false, void: true, leg });
          legResolved = true;
          break;
        }
        
        // Calculate actual value for this stat
        const stats: PlayerStats = {
          pts: playerStat.pts || 0,
          reb: playerStat.reb || 0,
          ast: playerStat.ast || 0,
          stl: playerStat.stl || 0,
          blk: playerStat.blk || 0,
          fg3m: playerStat.fg3m || 0,
        };
        
        let actualValue = 0;
        switch (statKey) {
          case 'pts':
            actualValue = stats.pts;
            break;
          case 'reb':
            actualValue = stats.reb;
            break;
          case 'ast':
            actualValue = stats.ast;
            break;
          case 'pa':
            actualValue = stats.pts + stats.ast;
            break;
          case 'pr':
            actualValue = stats.pts + stats.reb;
            break;
          case 'pra':
            actualValue = stats.pts + stats.reb + stats.ast;
            break;
          case 'ra':
            actualValue = stats.reb + stats.ast;
            break;
          case 'stl':
            actualValue = stats.stl;
            break;
          case 'blk':
            actualValue = stats.blk;
            break;
          case 'fg3m':
            actualValue = stats.fg3m;
            break;
          default:
            logDebug(`Unknown stat type for parlay leg: ${statKey}`);
            allLegsResolved = false;
            continue;
        }
        
        // Determine if leg won
        // For whole number lines (e.g., "4"): "over 4" means >= 4, "under 4" means <= 4
        // For decimal lines (e.g., "3.5"): "over 3.5" means > 3.5, "under 4.5" means < 4.5
        // Ensure line is a number (handle string/decimal types)
        const legLine = Number(leg.line);
        const isWholeNumber = legLine % 1 === 0;
        const legWon = leg.overUnder === 'over' 
          ? (isWholeNumber ? actualValue >= legLine : actualValue > legLine)
          : (isWholeNumber ? actualValue <= legLine : actualValue < legLine);
        
        legResults.push({ won: legWon, void: false, leg });
        legResolved = true;
        break;
      }
      
      if (!legResolved) {
        allLegsResolved = false;
      }
    }
    
    // Check if all legs are resolved by comparing legResults length to legs length
    const allLegsActuallyResolved = legResults.length === legs.length;
    
    // If not all legs are resolved yet, skip this parlay
    if (!allLegsActuallyResolved) {
      // Silently skip - games aren't final yet, will be checked again later
      return;
    }
    
    // Determine parlay result: exclude void legs, all non-void legs must win for parlay to win
    const nonVoidLegs = legResults.filter(r => !r.void);
    const voidLegs = legResults.filter(r => r.void);
    const parlayWon = nonVoidLegs.length > 0 && nonVoidLegs.every(r => r.won);
    const result: 'win' | 'loss' = parlayWon ? 'win' : 'loss';
    
    
    // Update parlay_legs with individual leg results
    let updatedParlayLegs = bet.parlay_legs;
    if (bet.parlay_legs && Array.isArray(bet.parlay_legs)) {
      // Map leg results back to parlay_legs structure
      updatedParlayLegs = bet.parlay_legs.map((leg: any, index: number) => {
        const legResult = legResults[index];
        if (legResult) {
          return {
            ...leg,
            won: legResult.won,
            void: legResult.void,
          };
        }
        return leg;
      });
    } else if (legs.length > 0 && legResults.length === legs.length) {
      // For legacy parlays without structured data, create parlay_legs with results
      updatedParlayLegs = legs.map((leg, index) => {
        const legResult = legResults[index];
        return {
          playerName: leg.playerName,
          playerId: leg.playerId,
          team: leg.team,
          opponent: leg.opponent,
          gameDate: leg.gameDate,
          overUnder: leg.overUnder,
          line: leg.line,
          statType: leg.statType,
          isGameProp: leg.isGameProp || false,
          won: legResult ? legResult.won : null,
          void: legResult ? legResult.void : false,
        };
      });
    }
    
    // Update parlay bet
    const { error: updateError } = await supabaseAdmin
      .from('bets')
      .update({
        status: 'completed',
        result,
        actual_value: parlayWon ? 1 : 0, // 1 for win, 0 for loss
        parlay_legs: updatedParlayLegs, // Store leg results
      })
      .eq('id', bet.id);
    
    if (updateError) {
      console.error(`Failed to update parlay bet ${bet.id}:`, updateError);
    } else {
      const voidCount = voidLegs.length;
      const wonCount = nonVoidLegs.filter(r => r.won).length;
      const totalNonVoid = nonVoidLegs.length;
      console.log(`[check-journal-bets] ✅ Resolved parlay ${bet.id}: ${result} (${wonCount}/${totalNonVoid} non-void legs won${voidCount > 0 ? `, ${voidCount} void leg${voidCount > 1 ? 's' : ''} excluded` : ''})`);
      updatedCountRef.value++;
    }
  } catch (error: any) {
    console.error(`Error resolving parlay bet ${bet.id}:`, error);
  }
}

export async function GET(request: Request) {
  // Allow bypass in development for testing
  const isDevelopment = process.env.NODE_ENV === 'development';
  const bypassAuth = isDevelopment && request.headers.get('x-bypass-auth') === 'true';
  
  if (!bypassAuth) {
    let isAuthorized = false;
    
    // Check if this is a cron request (Vercel cron or manual with secret)
    const url = new URL(request.url);
    const querySecret = url.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;
    
    // Check for cron secret in query parameter
    if (querySecret && cronSecret && querySecret === cronSecret) {
      isAuthorized = true;
    } else {
      // Check for cron authorization (Vercel cron or header-based)
      const authResult = authorizeCronRequest(request);
      if (authResult.authorized) {
        isAuthorized = true;
      }
    }
    
    // If not a cron request, try to authenticate user
    // This endpoint requires authentication (cron secret OR user session) for security
    if (!isAuthorized) {
      try {
        const supabase = await createClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user && !error) {
          // User is authenticated via cookies
          isAuthorized = true;
          console.log('[check-journal-bets] ✅ User authenticated via session');
        }
      } catch (error: any) {
        // Auth check failed - do not authorize
        console.error('[check-journal-bets] Auth check failed:', error?.message);
        // isAuthorized remains false - will return 401 below
      }
    }
    
    if (!isAuthorized) {
      return NextResponse.json(
        { error: 'Unauthorized - Must be a cron request or authenticated user' },
        { status: 401 }
      );
    }

    const rateResult = checkRateLimit(request, strictRateLimiter);
    if (!rateResult.allowed && rateResult.response) {
      return rateResult.response;
    }
  }

  try {
    console.log('[check-journal-bets] Starting journal bet check...');
    console.log('[check-journal-bets] ========================================');
    
    // Check if we should also re-check completed bets (for recalculation)
    const url = new URL(request.url);
    const recalculate = url.searchParams.get('recalculate') === 'true';
    
    // Fetch all pending journal bets with NBA player props OR game props (including parlays)
    // If recalculate=true, also fetch completed bets that have actual_value set
    // Game props: have game_date and stat_type but no player_id
    // Player props: have game_date, stat_type, and player_id
    
    // Fetch player props (have player_id) OR game props (have game prop stat type)
    // We'll fetch both and filter in memory to avoid complex OR queries
    // Helper function to fetch bets in batches (pagination)
    const fetchBetsInBatches = async (baseQuery: any, batchSize = 100): Promise<any[]> => {
      const allBets: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: batch, error } = await baseQuery
          .order('game_date', { ascending: false })
          .order('created_at', { ascending: false })
          .range(offset, offset + batchSize - 1);

        if (error) {
          throw error;
        }

        if (batch && batch.length > 0) {
          allBets.push(...batch);
          hasMore = batch.length === batchSize;
          offset += batchSize;
        } else {
          hasMore = false;
        }
      }

      return allBets;
    };

    // IMPORTANT: Always include 'live' status bets so we can maintain their live status
    let playerPropsQuery = supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .not('player_id', 'is', null)
      .not('game_date', 'is', null);
    
    let gamePropsQuery = supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .is('player_id', null)
      .not('game_date', 'is', null)
      .in('stat_type', GAME_PROP_STAT_TYPES);
    
    if (recalculate) {
      playerPropsQuery = playerPropsQuery.in('result', ['pending', 'win', 'loss']);
      gamePropsQuery = gamePropsQuery.in('result', ['pending', 'win', 'loss']);
      console.log('[check-journal-bets] Recalculation mode: will re-check completed bets');
    } else {
      // In normal mode, include:
      // 1. Pending bets (to check if games have started/finished)
      // 2. Live bets (to maintain live status and check for early determination)
      // Note: We'll filter out completed bets in code to avoid complex queries
      playerPropsQuery = playerPropsQuery.or('result.eq.pending,status.eq.live');
      gamePropsQuery = gamePropsQuery.or('result.eq.pending,status.eq.live');
    }
    
    // Fetch bets in batches to avoid loading all into memory
    const [playerProps, gameProps] = await Promise.all([
      fetchBetsInBatches(playerPropsQuery),
      fetchBetsInBatches(gamePropsQuery),
    ]);
    
    // Filter out completed bets in normal mode (optimization: skip already resolved bets)
    let singleBets = [...(playerProps || []), ...(gameProps || [])];
    if (!recalculate) {
      singleBets = singleBets.filter((bet: any) => {
        // Skip bets that are already completed (status='completed' with win/loss)
        // These are done and don't need re-checking
        if (bet.status === 'completed' && (bet.result === 'win' || bet.result === 'loss')) {
          return false;
        }
        return true;
      });
    }
    
    // Then get parlay bets (market contains "Parlay") in batches
    let parlayBetsQuery = supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .like('market', 'Parlay%');
    
    if (recalculate) {
      parlayBetsQuery = parlayBetsQuery.in('result', ['pending', 'win', 'loss']);
    } else {
      // Include pending and live parlays
      // Note: We'll filter out completed bets in code to avoid complex queries
      parlayBetsQuery = parlayBetsQuery.or('result.eq.pending,status.eq.live');
    }
    
    const parlayBets = await fetchBetsInBatches(parlayBetsQuery);
    
    // Filter out completed parlay bets in normal mode
    let filteredParlayBets = parlayBets || [];
    if (!recalculate) {
      filteredParlayBets = filteredParlayBets.filter((bet: any) => {
        // Skip parlays that are already completed
        if (bet.status === 'completed' && (bet.result === 'win' || bet.result === 'loss')) {
          return false;
        }
        return true;
      });
    }
    
    const journalBets = [...(singleBets || []), ...(filteredParlayBets || [])];

    console.log(`[check-journal-bets] Fetched ${journalBets?.length || 0} journal bets (${singleBets?.length || 0} single, ${parlayBets?.length || 0} parlays)`);

    if (!journalBets || journalBets.length === 0) {
      console.log('[check-journal-bets] No pending journal bets found');
      return NextResponse.json({ message: 'No pending journal bets', updated: 0 });
    }
    
    console.log(`[check-journal-bets] Processing ${journalBets.length} journal bets...`);

    const updatedCountRef = { value: 0 };

    // Separate parlays from single bets
    const singleBetsList = journalBets.filter((bet: any) => !bet.market || !bet.market.startsWith('Parlay'));
    const parlayBetsList = journalBets.filter((bet: any) => bet.market && bet.market.startsWith('Parlay'));
    
    console.log(`[check-journal-bets] Found ${singleBetsList.length} single bets and ${parlayBetsList.length} parlay bets`);
    
    // Log parlay bet details for debugging
    if (parlayBetsList.length > 0) {
      console.log(`[check-journal-bets] Parlay bet details:`);
      parlayBetsList.forEach((bet: any, idx: number) => {
        console.log(`[check-journal-bets]   Parlay ${idx + 1} (ID: ${bet.id}):`);
        console.log(`[check-journal-bets]     - market: "${bet.market}"`);
        console.log(`[check-journal-bets]     - selection: "${bet.selection}"`);
        console.log(`[check-journal-bets]     - date: "${bet.date}"`);
        console.log(`[check-journal-bets]     - game_date: "${bet.game_date}"`);
        console.log(`[check-journal-bets]     - result: "${bet.result}"`);
        console.log(`[check-journal-bets]     - status: "${bet.status}"`);
      });
    }
    
    // Group single bets by game date to minimize API calls
    const gamesByDate = singleBetsList.reduce((acc: any, bet: any) => {
      const date = bet.game_date;
      if (!date) return acc;
      if (!acc[date]) acc[date] = [];
      acc[date].push(bet);
      return acc;
    }, {});
    
    // Group parlays by date (use the date field from the bet)
    const parlaysByDate = parlayBetsList.reduce((acc: any, bet: any) => {
      // Try multiple date fields: date, game_date, created_at
      const date = bet.date ? bet.date.split('T')[0] : 
                   bet.game_date ? bet.game_date.split('T')[0] :
                   bet.created_at ? bet.created_at.split('T')[0] : null;
      
      if (!date) {
        console.log(`[check-journal-bets] ⚠️  Parlay bet ${bet.id} has no date field (date: ${bet.date}, game_date: ${bet.game_date}, created_at: ${bet.created_at}), skipping`);
        return acc;
      }
      if (!acc[date]) acc[date] = [];
      acc[date].push(bet);
      return acc;
    }, {});

    for (const [gameDate, bets] of Object.entries(gamesByDate)) {
      // Fetch games for this date
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
        {
          headers: {
            'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
          },
        }
      );

      if (!gamesResponse.ok) {
        console.error(`Failed to fetch games for ${gameDate}`);
        continue;
      }

      const gamesData = await gamesResponse.json();
      const games = gamesData.data;

      // Process each bet for this date
      for (const bet of bets as any[]) {
        // OPTIMIZATION: Skip bets that are already completed (status='completed' and result is win/loss)
        // These bets are done and don't need to be re-checked unless in recalculate mode
        if (!recalculate && bet.status === 'completed' && (bet.result === 'win' || bet.result === 'loss')) {
          continue; // Skip already completed bets to improve performance
        }
        
        // Check if this is a parlay bet
        const isParlay = bet.market && bet.market.startsWith('Parlay');
        
        if (isParlay) {
          // Handle parlay resolution
          await resolveParlayBet(bet, games, updatedCountRef, request);
          continue;
        }
        
        // Skip if bet doesn't have required fields
        if (!bet.game_date) {
          continue;
        }
        
        // Check if this is a game prop (no player_id but has game prop stat type)
        const isGameProp = !bet.player_id && bet.stat_type && GAME_PROP_STAT_TYPES.includes(bet.stat_type);
        
        // For player props, require player_id
        if (!isGameProp && !bet.player_id) {
          continue;
        }
        
        // Find the game with matching teams
        const game = games.find((g: any) => {
          const homeMatch = g.home_team.full_name === bet.team || g.home_team.abbreviation === bet.team;
          const visitorMatch = g.visitor_team.full_name === bet.team || g.visitor_team.abbreviation === bet.team;
          const homeOppMatch = g.home_team.full_name === bet.opponent || g.home_team.abbreviation === bet.opponent;
          const visitorOppMatch = g.visitor_team.full_name === bet.opponent || g.visitor_team.abbreviation === bet.opponent;
          
          return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
        });

        if (!game) {
          const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name;
          console.log(`[check-journal-bets] Single bet ${bet.id} (${betDescription}): Game not found for ${bet.team} vs ${bet.opponent} on ${bet.game_date}`);
          continue;
        }

        // Check game status using same logic as tracked bets
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        
        // Check if game is live by looking at tipoff time and game status
        let isLive = false;
        let isCompleted = false;
        let completedAt: Date | null = null;
        // Use game.date (scheduled time) instead of trying to parse game.status
        const tipoffTime = game.date ? Date.parse(game.date) : NaN;
        const now = Date.now();
        
        // Check if game status indicates it's in progress (e.g., "1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr", "Halftime", etc.)
        const liveStatusIndicators = ['qtr', 'quarter', 'half', 'ot', 'overtime'];
        const gameIsInProgress = liveStatusIndicators.some(indicator => gameStatus.includes(indicator)) && !gameStatus.includes('final');
        
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          const threeHoursMs = 3 * 60 * 60 * 1000;
          const tenMinutesMs = 10 * 60 * 1000;
          const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000; // 2.5 hours for NBA game
          
          // CRITICAL: Game must have actually started (tipoffTime is in the past) before we can mark it as completed
          const gameHasStarted = timeSinceTipoff > 0;
          
          // Game is live if: (1) it started and hasn't been 3 hours yet, OR (2) status indicates it's in progress
          isLive = (gameHasStarted && timeSinceTipoff < threeHoursMs) || gameIsInProgress;
          
          // Game is completed ONLY if:
          // 1. Game has actually started (tipoffTime is in the past)
          // 2. AND Status explicitly says "final"
          // CRITICAL: We ONLY mark as completed when status is "final" to prevent premature resolution
          if (gameHasStarted) {
            if (gameStatus.includes('final')) {
              isCompleted = true;
              const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
              completedAt = new Date(estimatedCompletionTime);
            }
            // REMOVED: Time-based completion check - this was causing premature bet resolution
            // Games must explicitly have "final" status before we resolve bets
          } else {
            // Game hasn't started yet - cannot be completed
            const hoursUntilTipoff = (tipoffTime - now) / (1000 * 60 * 60);
            console.log(`[check-journal-bets] ✅ FIX VERIFIED: Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} hasn't started yet (tipoff: ${new Date(tipoffTime).toISOString()}, ${hoursUntilTipoff.toFixed(2)} hours from now). Skipping to prevent premature loss marking.`);
            continue;
          }
        } else if (gameStatus.includes('final')) {
          // Status says final but no date - only mark as completed if we can verify it's actually finished
          // Be more cautious: if we don't have a tipoff time, we can't verify the game started
          // Only mark as completed if status explicitly contains "final" and we have some confidence
          // For safety, we'll still mark it but log a warning
          console.log(`[check-journal-bets] ⚠️  Single bet ${bet.id} (${bet.player_name}): Game status is "final" but no tipoff time available. Proceeding with caution.`);
          isCompleted = true;
          // Set completedAt to 1 hour ago to ensure it passes the 10-minute check
          completedAt = new Date(now - (60 * 60 * 1000));
        }
        
        // If game is live but not completed, check if bet can be determined early
        if (isLive && !isCompleted) {
          // Fetch live stats to check if bet can be determined
          if (!isGameProp && bet.player_id) {
            const liveStatsResponse = await fetch(
              `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
              {
                headers: {
                  'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
                },
              }
            );

            if (liveStatsResponse.ok) {
              const liveStatsData = await liveStatsResponse.json();
              if (liveStatsData.data && liveStatsData.data.length > 0) {
                const livePlayerStat = liveStatsData.data[0];
                
                // Calculate current stat value
                const liveStats: PlayerStats = {
                  pts: livePlayerStat.pts || 0,
                  reb: livePlayerStat.reb || 0,
                  ast: livePlayerStat.ast || 0,
                  stl: livePlayerStat.stl || 0,
                  blk: livePlayerStat.blk || 0,
                  fg3m: livePlayerStat.fg3m || 0,
                };

                let currentValue = 0;
                switch (bet.stat_type) {
                  case 'pts': currentValue = liveStats.pts; break;
                  case 'reb': currentValue = liveStats.reb; break;
                  case 'ast': currentValue = liveStats.ast; break;
                  case 'pa': currentValue = liveStats.pts + liveStats.ast; break;
                  case 'pr': currentValue = liveStats.pts + liveStats.reb; break;
                  case 'pra': currentValue = liveStats.pts + liveStats.reb + liveStats.ast; break;
                  case 'ra': currentValue = liveStats.reb + liveStats.ast; break;
                  case 'stl': currentValue = liveStats.stl; break;
                  case 'blk': currentValue = liveStats.blk; break;
                  case 'fg3m': currentValue = liveStats.fg3m; break;
                }

                // Check if bet can be determined early
                const line = Number(bet.line);
                const isWholeNumber = line % 1 === 0;
                let canDetermineEarly = false;
                let earlyResult: 'win' | 'loss' | null = null;

                if (bet.over_under === 'over') {
                  // For "over" bets: can determine win if player has reached/exceeded the line
                  if (isWholeNumber ? currentValue >= line : currentValue > line) {
                    canDetermineEarly = true;
                    earlyResult = 'win';
                  }
                } else if (bet.over_under === 'under') {
                  // For "under" bets: can determine loss if player has exceeded the line
                  // For whole numbers: if current > line, it's a loss
                  // For decimals: if current >= line, it's a loss
                  if (isWholeNumber ? currentValue > line : currentValue >= line) {
                    canDetermineEarly = true;
                    earlyResult = 'loss';
                  }
                }

                if (canDetermineEarly && earlyResult) {
                  // Mark bet as win/loss immediately, but keep status as 'live' since game is still ongoing
                  console.log(`[check-journal-bets] 🎯 Early determination: Bet ${bet.id} (${bet.player_name}) ${bet.over_under} ${line} ${bet.stat_type} - Current: ${currentValue}, Result: ${earlyResult}`);
                  await supabaseAdmin
                    .from('bets')
                    .update({
                      status: 'live', // Keep as live since game is still ongoing
                      result: earlyResult,
                      actual_value: currentValue,
                    })
                    .eq('id', bet.id);
                  updatedCountRef.value++;
                  continue;
                }
              }
            }
          }

          // If bet can't be determined early, just update status to 'live'
          const updateData: any = { status: 'live' };
          
          // If bet is already marked as win/loss but can't be determined yet, reset it
          if (bet.result && bet.result !== 'pending' && bet.result !== 'void') {
            updateData.result = 'pending';
            updateData.actual_value = null;
            console.log(`[check-journal-bets] ⚠️  Single bet ${bet.id} (${bet.player_name}): Game is live but bet was marked as ${bet.result}. Resetting to pending/live.`);
          }
          
          await supabaseAdmin
            .from('bets')
            .update(updateData)
            .eq('id', bet.id);
          
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
          updatedCountRef.value++;
          continue;
        }
        
        // Only process if game is completed AND completed at least 10 minutes ago
        if (!isCompleted) {
          // CRITICAL: If bet is already marked as win/loss but game isn't final, reset it back to pending/live
          // This fixes bets that were resolved prematurely before our fix
          if (bet.result && bet.result !== 'pending' && bet.result !== 'void') {
            // Determine if game is live (started but not final)
            const gameIsLive = isLive && !isCompleted;
            const newStatus = gameIsLive ? 'live' : 'pending';
            console.log(`[check-journal-bets] ⚠️  Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is ${game.status} (not final), but bet is marked as ${bet.result}. Resetting to ${newStatus}.`);
            await supabaseAdmin
              .from('bets')
              .update({
                result: 'pending',
                status: newStatus,
                actual_value: null,
              })
              .eq('id', bet.id);
            updatedCountRef.value++;
          } else if (isLive && !isCompleted) {
            // Game is live and bet is still pending - update status to 'live'
            await supabaseAdmin
              .from('bets')
              .update({ status: 'live' })
              .eq('id', bet.id)
              .eq('result', 'pending'); // Only update if still pending
            
            console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
          } else {
            console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is ${game.status}, not completed yet`);
          }
          continue;
        }
        
        // Check if game completed at least 10 minutes ago
        if (completedAt) {
          const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
          if (completedAt > tenMinutesAgo) {
            const minutesAgo = Math.round((now - completedAt.getTime()) / 60000);
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name;
            console.log(`[check-journal-bets] Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} completed ${minutesAgo} minutes ago, waiting for 10-minute buffer`);
            continue;
          }
        }

        // Handle game props differently from player props
        if (isGameProp) {
          console.log(`[check-journal-bets] Evaluating game prop bet ${bet.id}: ${bet.stat_type} for game ${game.id}`);
          
          // Evaluate game prop using game data
          const actualValue = evaluateGameProp(game, bet.stat_type, bet.team || '');
          
          // Determine result
          const line = Number(bet.line);
          const isWholeNumber = line % 1 === 0;
          let result: 'win' | 'loss';
          
          // Special handling for different bet types
          if (bet.stat_type === 'moneyline') {
            // For moneyline: evaluateGameProp returns 1 if team won, 0 if lost
            result = actualValue === 1 ? 'win' : 'loss';
          } else if (bet.stat_type === 'spread') {
            // For spreads: actualValue < 0 means team covered, actualValue > 0 means didn't cover
            // The line is just for reference - the key is whether actualValue is negative
            result = actualValue < 0 ? 'win' : 'loss';
          } else {
            // For other props (totals, etc.), use standard over/under logic
            if (bet.over_under === 'over') {
              result = (isWholeNumber ? actualValue >= line : actualValue > line) ? 'win' : 'loss';
            } else if (bet.over_under === 'under') {
              result = (isWholeNumber ? actualValue <= line : actualValue < line) ? 'win' : 'loss';
            } else {
              console.error(`[check-journal-bets] Invalid over_under value for bet ${bet.id}: "${bet.over_under}"`);
              continue;
            }
          }

          // Log the evaluation for debugging
          console.log(`[check-journal-bets] Evaluating bet ${bet.id}: Game prop ${bet.over_under} ${line} ${bet.stat_type}`);
          console.log(`[check-journal-bets]   Actual value: ${actualValue}, Line: ${line}, Is whole number: ${isWholeNumber}`);
          console.log(`[check-journal-bets]   Comparison: ${actualValue} ${bet.over_under === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${result}`);

          // Update the journal bet with result
          const { error: updateError } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result,
              actual_value: actualValue,
            })
            .eq('id', bet.id);

          if (updateError) {
            console.error(`Failed to update bet ${bet.id}:`, updateError);
          } else {
            console.log(`[check-journal-bets] ✅ Updated game prop bet ${bet.id}: ${bet.stat_type} ${bet.over_under} ${line}: ${result} (actual: ${actualValue})`);
            updatedCountRef.value++;
          }
          continue; // Skip player stats fetching for game props
        }

        // Fetch player stats for this game
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${bet.player_id}`,
          {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          }
        );

        if (!statsResponse.ok) {
          console.error(`Failed to fetch stats for player ${bet.player_id}`);
          continue;
        }

        const statsData = await statsResponse.json();
        
        if (!statsData.data || statsData.data.length === 0) {
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): No stats found for player in game ${game.id}`);
          continue;
        }

        const playerStat = statsData.data[0];
        
        // Check if player played 0 minutes - if so, mark as void
        // Handle various minute formats: "15:30", "15", "0:00", "0", etc.
        const minutesPlayed = String(playerStat.min || '0:00').trim();
        let totalMinutes = 0;
        
        if (minutesPlayed.includes(':')) {
          // Format: "MM:SS" or "M:SS"
          const parts = minutesPlayed.split(':');
          const mins = Number(parts[0]) || 0;
          const secs = Number(parts[1]) || 0;
          totalMinutes = mins + (secs / 60);
        } else {
          // Format: just a number (total minutes as decimal or whole number)
          totalMinutes = Number(minutesPlayed) || 0;
        }
        
        // Only void if player truly played 0 minutes (accounting for floating point precision)
        if (totalMinutes < 0.01) {
          // Player didn't play - void the bet
          console.log(`[check-journal-bets] ✅ Voiding bet ${bet.id} (${bet.player_name}): Player played ${totalMinutes.toFixed(3)} minutes (formatted as "${minutesPlayed}")`);
          const { error: updateError } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result: 'void',
              actual_value: 0,
            })
            .eq('id', bet.id);

          if (updateError) {
            console.error(`Failed to update bet ${bet.id}:`, updateError);
          } else {
            console.log(`[check-journal-bets] ✅ Voided ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line}: player played ${totalMinutes.toFixed(3)} minutes`);
            updatedCountRef.value++;
          }
          continue;
        } else {
          console.log(`[check-journal-bets] ✅ FIX VERIFIED: Bet ${bet.id} (${bet.player_name}): Player played ${totalMinutes.toFixed(2)} minutes (formatted as "${minutesPlayed}"), will NOT void - proceeding to win/loss calculation`);
        }
        
        const stats: PlayerStats = {
          pts: playerStat.pts || 0,
          reb: playerStat.reb || 0,
          ast: playerStat.ast || 0,
          stl: playerStat.stl || 0,
          blk: playerStat.blk || 0,
          fg3m: playerStat.fg3m || 0,
        };

        // Calculate combined stats if needed
        let actualValue = 0;
        switch (bet.stat_type) {
          case 'pts':
            actualValue = stats.pts;
            break;
          case 'reb':
            actualValue = stats.reb;
            break;
          case 'ast':
            actualValue = stats.ast;
            break;
          case 'pa':
            actualValue = stats.pts + stats.ast;
            break;
          case 'pr':
            actualValue = stats.pts + stats.reb;
            break;
          case 'pra':
            actualValue = stats.pts + stats.reb + stats.ast;
            break;
          case 'ra':
            actualValue = stats.reb + stats.ast;
            break;
          case 'stl':
            actualValue = stats.stl;
            break;
          case 'blk':
            actualValue = stats.blk;
            break;
          case 'fg3m':
            actualValue = stats.fg3m;
            break;
          default:
            logDebug(`Unknown stat type: ${bet.stat_type}`);
            continue;
        }

        // Determine result
        // For whole number lines (e.g., "4"): "over 4" means >= 4, "under 4" means <= 4
        // For decimal lines (e.g., "3.5"): "over 3.5" means > 3.5, "under 4.5" means < 4.5
        // Ensure line is a number (handle string/decimal types from database)
        const line = Number(bet.line);
        const isWholeNumber = line % 1 === 0;
        let result: 'win' | 'loss';
        
        if (bet.over_under === 'over') {
          result = (isWholeNumber ? actualValue >= line : actualValue > line) ? 'win' : 'loss';
        } else if (bet.over_under === 'under') {
          result = (isWholeNumber ? actualValue <= line : actualValue < line) ? 'win' : 'loss';
        } else {
          console.error(`[check-journal-bets] Invalid over_under value for bet ${bet.id}: "${bet.over_under}"`);
          continue;
        }

        // Log the evaluation for debugging
        console.log(`[check-journal-bets] Evaluating bet ${bet.id}: ${bet.player_name} ${bet.over_under} ${line} ${bet.stat_type}`);
        console.log(`[check-journal-bets]   Actual value: ${actualValue}, Line: ${line}, Is whole number: ${isWholeNumber}`);
        console.log(`[check-journal-bets]   Comparison: ${actualValue} ${bet.over_under === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${result}`);

        // Update the journal bet with result
        const { error: updateError } = await supabaseAdmin
          .from('bets')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
          })
          .eq('id', bet.id);

        if (updateError) {
          console.error(`Failed to update bet ${bet.id}:`, updateError);
        } else {
          console.log(`[check-journal-bets] ✅ Updated ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${line}: ${result} (actual: ${actualValue})`);
          updatedCountRef.value++;
        }
      }
    }
    
    // Process parlays - need to check all dates that might have parlay legs
    // Parlays can have legs on different dates, so we'll check the parlay's date and nearby dates
    const allParlayDates = Object.keys(parlaysByDate);
    const dateCache = new Map<string, any[]>();
    
    // Cache games we've already fetched
    for (const [gameDate, bets] of Object.entries(gamesByDate)) {
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${gameDate}`,
        {
          headers: {
            'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
          },
        }
      );
      
      if (gamesResponse.ok) {
        const gamesData = await gamesResponse.json();
        dateCache.set(gameDate, gamesData.data || []);
      }
    }
    
    console.log(`[check-journal-bets] Grouped ${parlayBetsList.length} parlays into ${Object.keys(parlaysByDate).length} date groups: ${Object.keys(parlaysByDate).join(', ')}`);
    
    // Process each parlay
    for (const [date, parlays] of Object.entries(parlaysByDate)) {
        // Get games for this date (or fetch if not cached)
      let games = dateCache.get(date) || [];
      
      if (games.length === 0) {
        const gamesResponse = await fetch(
          `https://api.balldontlie.io/v1/games?dates[]=${date}`,
          {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          }
        );
        
        if (gamesResponse.ok) {
          const gamesData = await gamesResponse.json();
          games = gamesData.data || [];
          dateCache.set(date, games);
        } else {
          console.error(`Failed to fetch games for parlay date ${date}`);
          continue;
        }
      }
      
      // Also check nearby dates (parlay legs might be on different days)
      const parlayDate = new Date(date);
      const nearbyDates: string[] = [date];
      for (let i = -2; i <= 2; i++) {
        if (i === 0) continue;
        const nearbyDate = new Date(parlayDate);
        nearbyDate.setDate(nearbyDate.getDate() + i);
        const nearbyDateStr = nearbyDate.toISOString().split('T')[0];
        nearbyDates.push(nearbyDateStr);
      }
      
      // Fetch games for nearby dates
      const allGames: any[] = [...games];
      for (const nearbyDate of nearbyDates) {
        const cachedGames = dateCache.get(nearbyDate);
        if (cachedGames) {
          allGames.push(...cachedGames);
        } else {
          const gamesResponse = await fetch(
            `https://api.balldontlie.io/v1/games?dates[]=${nearbyDate}`,
            {
              headers: {
                'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
              },
            }
          );
          
          if (gamesResponse.ok) {
            const gamesData = await gamesResponse.json();
            const nearbyGames = gamesData.data || [];
            dateCache.set(nearbyDate, nearbyGames);
            allGames.push(...nearbyGames);
          }
        }
      }
      
      // Process parlays for this date
      const parlaysList = parlays as any[];
      for (const parlayBet of parlaysList) {
        await resolveParlayBet(parlayBet, allGames, updatedCountRef, request);
      }
    }

    const result = {
      message: `Checked ${journalBets.length} journal bets (${singleBetsList.length} single, ${parlayBetsList.length} parlays), updated ${updatedCountRef.value}`,
      updated: updatedCountRef.value,
      total: journalBets.length,
    };
    
    console.log(`[check-journal-bets] Completed: ${result.message}`);
    
    if (updatedCountRef.value === 0 && journalBets.length > 0) {
      console.log(`[check-journal-bets] ⚠️  No bets were updated. Check the logs above for details on why each bet wasn't resolved.`);
    }
    
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Error checking journal bets:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred while checking journal bets' 
          : error.message || 'Failed to check journal bets' 
      },
      { status: 500 }
    );
  }
}
