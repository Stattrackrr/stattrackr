import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';
import { calculateUniversalBetResult } from '@/lib/betResultUtils';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const BALLDONTLIE_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BALLDONTLIE_API_KEY) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is required');
}

// SECURITY: Validate API key format (should not be empty or just whitespace)
if (!BALLDONTLIE_API_KEY.trim()) {
  throw new Error('BALLDONTLIE_API_KEY environment variable is invalid');
}

interface PlayerStats {
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  fg3m: number;
  pra?: number;  // Pre-calculated Points + Rebounds + Assists
  pr?: number;   // Pre-calculated Points + Rebounds
  pa?: number;   // Pre-calculated Points + Assists
  ra?: number;   // Pre-calculated Rebounds + Assists
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
      // Return point difference: positive if team won, negative if team lost
      // For home team: homeScore - visitorScore
      // For away team: visitorScore - homeScore
      return isHome ? homeScore - visitorScore : visitorScore - homeScore;
    
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
  globalStatsCache?: Map<string, any>,
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
    
    // SPORTSBOOK-STANDARD: Skip parlays that are already fully resolved
    // A parlay is resolved if it has a final result (win/loss/void) AND status is completed
    // This prevents unnecessary re-processing of resolved parlays
    if (!recalculate) {
      const hasFinalResult = bet.result === 'win' || bet.result === 'loss' || bet.result === 'void';
      const isCompleted = bet.status === 'completed';
      
      if (hasFinalResult && isCompleted) {
        // Silently skip - bet is fully resolved, no need to process again
        return;
      }
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
      legs = bet.parlay_legs.map((leg: any) => {
        // Auto-detect game props: if statType is a game prop type, mark it as such
        const isGamePropType = GAME_PROP_STAT_TYPES.includes(leg.statType);
        return {
          playerName: leg.playerName,
          playerId: leg.playerId,
          team: leg.team,
          opponent: leg.opponent,
          gameDate: leg.gameDate,
          overUnder: leg.overUnder,
          line: leg.line,
          statType: leg.statType,
          isGameProp: leg.isGameProp !== undefined ? leg.isGameProp : isGamePropType, // Auto-detect if not set
        };
      });
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
      
      // OPTIMIZATION: If we have structured data (team and gameDate), use direct lookup
      // For player props: need playerId, team, gameDate
      // For game props: need team, gameDate (no playerId needed)
      const hasStructuredData = leg.team && leg.gameDate && (leg.isGameProp || leg.playerId);
      
      if (hasStructuredData) {
        const dataType = leg.isGameProp ? 'game prop' : 'player prop';
        const playerInfo = leg.playerId ? `playerId: ${leg.playerId}, ` : '';
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Using structured data - direct lookup (${dataType}, ${playerInfo}team: ${leg.team}, gameDate: ${leg.gameDate})`);
        
        // Find the specific game for this leg
        const legGameDate = leg.gameDate?.split('T')[0];
        if (!legGameDate) {
          console.error(`[check-journal-bets] ❌ Parlay leg "${leg.playerName}": Missing gameDate`);
          allLegsResolved = false;
          continue;
        }
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
              
              // SPORTSBOOK-STANDARD: Check global stats cache first (batch-fetched)
              // Only fallback to individual fetch if not in cache
              let foundStats: any = null;
              
              if (globalStatsCache) {
                const cacheKey = `${game.id}_${leg.playerId}`;
                foundStats = globalStatsCache.get(cacheKey);
              }
              
              if (foundStats) {
                // Found in global cache - use it
                foundGame = game;
                cachedPlayerStats = foundStats;
                targetGame = foundGame;
                break;
              } else {
                // Not in cache - try individual fetch (fallback for game matching)
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
        
        // SPORTSBOOK-STANDARD RESOLUTION: Check if game is final
        // Sportsbooks use two indicators:
        // 1. Final scores exist (home_team_score and visitor_team_score are populated) - PRIMARY
        // 2. Status says "Final" - SECONDARY (for confirmation)
        // If scores exist, game is final regardless of status field
        const hasFinalScores = targetGame.home_team_score != null && targetGame.visitor_team_score != null;
        const rawStatus = String(targetGame.status || '');
        const gameStatus = rawStatus.toLowerCase();
        const statusSaysFinal = gameStatus.includes('final') || targetGame.status === 'Final';
        const isGameFinal = hasFinalScores || statusSaysFinal;
        
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
          
          if (!hasTimeComponent && !isGameFinal) {
            // Date-only game and not final - skip
            allLegsResolved = false;
            continue;
          }
          
          if (gameHasStarted) {
            // SPORTSBOOK RULE: Game is completed if final scores exist OR status says final
            if (isGameFinal) {
              isCompleted = true;
              const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000;
              completedAt = new Date(tipoffTime + estimatedGameDurationMs);
              const reason = hasFinalScores ? 'final scores exist' : 'status says final';
              console.log(`[check-journal-bets] ✅ Parlay leg "${leg.playerName}": Game is FINAL (${reason}) - sportsbook-standard resolution`);
            } else {
              // Game has started but not final - wait for scores or final status
              console.log(`[check-journal-bets] ⏳ Parlay leg "${leg.playerName}": Game started but no final scores yet (status: "${targetGame.status}", home_score: ${targetGame.home_team_score}, visitor_score: ${targetGame.visitor_team_score}) - waiting for completion`);
              allLegsResolved = false;
              continue;
            }
          } else {
            // Game hasn't started - silently skip (will be checked again later)
            allLegsResolved = false;
            continue;
          }
        } else if (isGameFinal) {
          // No tipoff time but game is final (scores exist or status says final)
          isCompleted = true;
          completedAt = new Date(now - (60 * 60 * 1000));
          const reason = hasFinalScores ? 'final scores exist' : 'status says final';
          console.log(`[check-journal-bets] ✅ Parlay leg "${leg.playerName}": Game is FINAL (${reason}) but no tipoff time available`);
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
            // For spreads: use calculateSpreadResult to properly compare against line
            const spreadResult = calculateUniversalBetResult(actualValue, legLine, leg.overUnder, 'spread');
            legWon = spreadResult === 'win';
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
        // Use pre-calculated composite stats if available (from cache), otherwise calculate
        const stats: PlayerStats = {
          pts: playerStat.pts || 0,
          reb: playerStat.reb || 0,
          ast: playerStat.ast || 0,
          stl: playerStat.stl || 0,
          blk: playerStat.blk || 0,
          fg3m: playerStat.fg3m || 0,
          pra: playerStat.pra ?? ((playerStat.pts || 0) + (playerStat.reb || 0) + (playerStat.ast || 0)),
          pr: playerStat.pr ?? ((playerStat.pts || 0) + (playerStat.reb || 0)),
          pa: playerStat.pa ?? ((playerStat.pts || 0) + (playerStat.ast || 0)),
          ra: playerStat.ra ?? ((playerStat.reb || 0) + (playerStat.ast || 0)),
        };
        
        let actualValue = 0;
        switch (statKey) {
          case 'pts': actualValue = stats.pts; break;
          case 'reb': actualValue = stats.reb; break;
          case 'ast': actualValue = stats.ast; break;
          case 'pa': actualValue = stats.pa ?? (stats.pts + stats.ast); break;
          case 'pr': actualValue = stats.pr ?? (stats.pts + stats.reb); break;
          case 'pra': actualValue = stats.pra ?? (stats.pts + stats.reb + stats.ast); break;
          case 'ra': actualValue = stats.ra ?? (stats.reb + stats.ast); break;
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
        // SPORTSBOOK-STANDARD RESOLUTION: Check if game is final
        // Sportsbooks use two indicators:
        // 1. Final scores exist (home_team_score and visitor_team_score are populated) - PRIMARY
        // 2. Status says "Final" - SECONDARY (for confirmation)
        // If scores exist, game is final regardless of status field
        const hasFinalScores = game.home_team_score != null && game.visitor_team_score != null;
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        const statusSaysFinal = gameStatus.includes('final') || game.status === 'Final';
        const isGameFinal = hasFinalScores || statusSaysFinal;
        
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
          
          // CRITICAL: Game must have actually started (tipoffTime is in the past) before we can mark it as completed
          const gameHasStarted = timeSinceTipoff > 0;
          
          // If game.date only has date (no time), be extra conservative
          // NBA games are typically scheduled for evening (7-10 PM local time)
          // If we only have a date, we can't know the actual tipoff time
          // CRITICAL: For date-only games, ONLY mark as started if game is final (scores exist or status says final)
          // We cannot trust time-based checks when we don't have the actual tipoff time
          if (!hasTimeComponent && !isGameFinal) {
            // Date-only and not final: skip this leg - we can't verify the game actually started
            allLegsResolved = false;
            continue;
          }
          
          // For date-only games without final status, we already skipped them above
          // So if we reach here with date-only, it means game is final
          if (gameHasStarted) {
            // SPORTSBOOK RULE: Game is completed if final scores exist OR status says final
            if (isGameFinal) {
              isCompleted = true;
              const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
              completedAt = new Date(estimatedCompletionTime);
              const reason = hasFinalScores ? 'final scores exist' : 'status says final';
              console.log(`[check-journal-bets] ✅ Parlay leg "${leg.playerName}": Game is FINAL (${reason}) - sportsbook-standard resolution`);
            } else {
              // Game has started but not final - wait for scores or final status
              console.log(`[check-journal-bets] ⏳ Parlay leg "${leg.playerName}": Game started but no final scores yet (status: "${game.status}", home_score: ${game.home_team_score}, visitor_score: ${game.visitor_team_score}) - waiting for completion`);
              allLegsResolved = false;
              continue;
            }
          } else {
            // Game hasn't started yet - silently skip (will be checked again later)
            allLegsResolved = false;
            continue; // Game not started yet, can't resolve this leg
          }
        } else if (isGameFinal) {
          // No tipoff time but game is final (scores exist or status says final)
          isCompleted = true;
          // Set completedAt to 1 hour ago to ensure it passes the 10-minute check
          completedAt = new Date(now - (60 * 60 * 1000));
          const reason = hasFinalScores ? 'final scores exist' : 'status says final';
          console.log(`[check-journal-bets] ✅ Parlay leg "${leg.playerName}": Game is FINAL (${reason}) but no tipoff time available`);
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
        
        // Check if this is a game prop (moneyline, spread, etc.) - these don't use player stats
        if (GAME_PROP_STAT_TYPES.includes(statKey)) {
          // This should have been handled earlier as a game prop
          // If we reach here, it means the leg wasn't marked as isGameProp
          console.error(`[check-journal-bets] ⚠️  Parlay leg "${leg.playerName}" has game prop stat type "${statKey}" but wasn't marked as isGameProp. This is a data issue.`);
          allLegsResolved = false;
          continue;
        }
        
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
            console.error(`[check-journal-bets] ❌ Unknown stat type for parlay leg: ${statKey} (player: ${leg.playerName})`);
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
  // SECURITY: Only allow bypass in development AND with explicit environment variable
  // This prevents accidental bypass if NODE_ENV is misconfigured
  const isDevelopment = process.env.NODE_ENV === 'development';
  const allowDevBypass = process.env.ALLOW_DEV_BYPASS === 'true';
  const bypassAuth = isDevelopment && allowDevBypass && request.headers.get('x-bypass-auth') === 'true';
  
  // For local development: allow localhost requests (makes testing easier)
  // This bypasses auth for local development regardless of CRON_SECRET
  const host = request.headers.get('host') || '';
  const urlObj = new URL(request.url);
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1') || urlObj.hostname === 'localhost' || urlObj.hostname === '127.0.0.1';
  const allowLocalDev = isDevelopment && isLocalhost;
  
  console.log('[check-journal-bets] 🔍 Auth check:', {
    isDevelopment,
    isLocalhost,
    allowLocalDev,
    host,
    urlHostname: urlObj.hostname,
    nodeEnv: process.env.NODE_ENV,
    bypassAuth
  });
  
  // LOCAL DEV BYPASS: If running locally, allow unauthenticated requests
  // This makes local testing easier
  if (allowLocalDev) {
    console.log('[check-journal-bets] ✅ Local development mode: Allowing request without authentication');
    // Skip all auth checks - proceed directly to processing
  } else if (!bypassAuth) {
    let isAuthorized = false;
    
    // Check if this is a cron request (Vercel cron or manual with secret)
    const querySecret = urlObj.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;
    
    console.log('[check-journal-bets] Secret check:', {
      hasQuerySecret: !!querySecret,
      hasCronSecret: !!cronSecret,
      querySecretLength: querySecret?.length || 0,
      cronSecretLength: cronSecret?.length || 0,
      secretsMatch: querySecret === cronSecret
    });
    
    // Check for cron secret in query parameter
    if (querySecret && cronSecret && querySecret === cronSecret) {
      isAuthorized = true;
      console.log('[check-journal-bets] ✅ Authenticated via CRON_SECRET');
    } else if (querySecret && cronSecret) {
      console.error('[check-journal-bets] ❌ CRON_SECRET mismatch - query secret does not match environment secret');
    } else {
      // Check for cron authorization (Vercel cron or header-based)
      const authResult = authorizeCronRequest(request);
      if (authResult.authorized) {
        isAuthorized = true;
        console.log('[check-journal-bets] ✅ Authenticated via cron headers');
      } else {
        console.log('[check-journal-bets] ⚠️  No cron authorization found');
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
      console.error('[check-journal-bets] ❌ Unauthorized - returning 401');
      console.error('[check-journal-bets]    Auth details:', {
        allowLocalDev,
        isDevelopment,
        isLocalhost,
        host,
        hasQuerySecret: !!urlObj.searchParams.get('secret'),
        hasCronSecret: !!process.env.CRON_SECRET
      });
      return NextResponse.json(
        { error: 'Unauthorized - Must be a cron request or authenticated user' },
        { status: 401 }
      );
    }
  }

  const rateResult = checkRateLimit(request, strictRateLimiter);
  if (!rateResult.allowed && rateResult.response) {
    return rateResult.response;
  }

  try {
    console.log('[check-journal-bets] Starting journal bet check...');
    console.log('[check-journal-bets] ========================================');
    
    // Check if we should also re-check completed bets (for recalculation)
    const url = new URL(request.url);
    let recalculate = url.searchParams.get('recalculate') === 'true';
    const betIdParam = url.searchParams.get('bet_id') || url.searchParams.get('id');
    
    // OPTIMIZATION: Determine if this is a cron request or user request
    // Cron requests process all users, user requests only process the authenticated user
    const querySecret = url.searchParams.get('secret');
    const cronSecret = process.env.CRON_SECRET;
    const isCronRequest = (querySecret && cronSecret && querySecret === cronSecret) || 
                          authorizeCronRequest(request).authorized;
    
    // Get user_id if this is a user request (not cron)
    let userId: string | null = null;
    if (!isCronRequest) {
      try {
        const supabase = await createClient();
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          userId = session.user.id;
          console.log(`[check-journal-bets] User request: filtering by user_id ${userId}`);
        }
      } catch (error) {
        console.error('[check-journal-bets] Failed to get user session:', error);
      }
    } else {
      console.log('[check-journal-bets] Cron request: processing all users');
    }
    
    // Fetch all pending journal bets with NBA player props OR game props (including parlays)
    // If recalculate=true, also fetch completed bets that have actual_value set
    // Game props: have game_date and stat_type but no player_id
    // Player props: have game_date, stat_type, and player_id
    
    // Fetch player props (have player_id) OR game props (have game prop stat type)
    // We'll fetch both and filter in memory to avoid complex OR queries
    // Helper function to fetch bets in batches (pagination)
    // EGRESS OPTIMIZATION: Added maxBets limit to prevent excessive data transfer
    const fetchBetsInBatches = async (baseQuery: any, batchSize = 100, maxBets = 2000): Promise<any[]> => {
      const allBets: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore && allBets.length < maxBets) {
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

      if (allBets.length >= maxBets) {
        console.log(`[check-journal-bets] ⚠️  Reached max limit of ${maxBets} bets - stopping fetch to prevent excessive egress`);
      }

      return allBets;
    };

    // IMPORTANT: Always include 'live' status bets so we can maintain their live status
    // OPTIMIZATION: Filter by user_id if this is a user request (not cron)
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
    
    // OPTIMIZATION: Add user_id filter for user requests (not cron)
    if (userId) {
      playerPropsQuery = playerPropsQuery.eq('user_id', userId);
      gamePropsQuery = gamePropsQuery.eq('user_id', userId);
    }
    
    if (recalculate) {
      playerPropsQuery = playerPropsQuery.in('result', ['pending', 'win', 'loss']);
      gamePropsQuery = gamePropsQuery.in('result', ['pending', 'win', 'loss']);
      console.log('[check-journal-bets] Recalculation mode: will re-check completed bets');
    } else {
      // EGRESS: Only fetch pending/live bets in normal mode so we don't transfer completed bets
      playerPropsQuery = playerPropsQuery.in('status', ['pending', 'live']);
      gamePropsQuery = gamePropsQuery.in('status', ['pending', 'live']);
      console.log('[check-journal-bets] Normal mode: fetching only pending/live NBA bets');
    }
    
    let singleBets: any[];
    
    // Single-bet re-run: only process one bet by id (e.g. to fix wrong actual_value)
    if (betIdParam && betIdParam.trim()) {
      const betId = betIdParam.trim();
      // In production require login so users can only re-run their own bet; on localhost dev allow by id only
      if (!userId && !allowLocalDev) {
        return NextResponse.json(
          { error: 'Must be logged in to re-run a single bet. Open the journal while signed in and call the API from the same origin, or use recalculate=true with cron.' },
          { status: 401 }
        );
      }
      let singleBetQuery = supabaseAdmin
        .from('bets')
        .select('*')
        .eq('id', betId)
        .eq('sport', 'NBA');
      if (userId) singleBetQuery = singleBetQuery.eq('user_id', userId);
      const { data: singleBet, error: singleError } = await singleBetQuery.maybeSingle();
      if (singleError) {
        console.error('[check-journal-bets] Single bet fetch error:', singleError);
        return NextResponse.json({ error: 'Failed to fetch bet' }, { status: 500 });
      }
      if (!singleBet) {
        return NextResponse.json(
          { error: 'Bet not found or not yours. Use the bet ID from the journal (e.g. from the URL or API).' },
          { status: 404 }
        );
      }
      singleBets = [singleBet];
      recalculate = true; // Force re-evaluation so actual_value/result get updated
      console.log(`[check-journal-bets] Single-bet mode: re-running bet ${betId} (${singleBet.player_name || singleBet.stat_type})`);
    } else {
      // Fetch bets in batches to avoid loading all into memory
      const [playerProps, gameProps] = await Promise.all([
        fetchBetsInBatches(playerPropsQuery),
        fetchBetsInBatches(gamePropsQuery),
      ]);
      singleBets = [...(playerProps || []), ...(gameProps || [])];
    }
    if (!recalculate) {
      singleBets = singleBets.filter((bet: any) => {
        // SPORTSBOOK-STANDARD: Skip bets that are already fully resolved
        // A bet is resolved if it has a final result (win/loss/void) AND status is completed
        // This prevents unnecessary re-processing of resolved bets
        const hasFinalResult = bet.result === 'win' || bet.result === 'loss' || bet.result === 'void';
        const isCompleted = bet.status === 'completed';
        
        if (hasFinalResult && isCompleted) {
          return false; // Skip - bet is fully resolved
        }
        
        // Include all other bets (pending, live, or any that need checking)
        return true;
      });
    }
    
    console.log(`[check-journal-bets] After filtering: ${singleBets.length} single bets to process${betIdParam ? ' (single-bet mode)' : ''}`);
    
    // Then get parlay bets (market contains "Parlay") in batches — skip when re-running a single bet
    let parlayBetsQuery = supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .like('market', 'Parlay%');
    
    // OPTIMIZATION: Add user_id filter for user requests (not cron)
    if (userId) {
      parlayBetsQuery = parlayBetsQuery.eq('user_id', userId);
    }
    
    if (!betIdParam) {
      if (recalculate) {
        parlayBetsQuery = parlayBetsQuery.in('result', ['pending', 'win', 'loss']);
      } else {
        // EGRESS: Only fetch pending/live parlays in normal mode
        parlayBetsQuery = parlayBetsQuery.in('status', ['pending', 'live']);
      }
    }
    
    const parlayBets = betIdParam ? [] : await fetchBetsInBatches(parlayBetsQuery);
    
    // Filter out completed parlay bets in normal mode
    let filteredParlayBets = parlayBets || [];
    if (!recalculate) {
      filteredParlayBets = filteredParlayBets.filter((bet: any) => {
        // SPORTSBOOK-STANDARD: Skip parlays that are already fully resolved
        // A parlay is resolved if it has a final result (win/loss/void) AND status is completed
        // This prevents unnecessary re-processing of resolved parlays
        const hasFinalResult = bet.result === 'win' || bet.result === 'loss' || bet.result === 'void';
        const isCompleted = bet.status === 'completed';
        
        if (hasFinalResult && isCompleted) {
          return false; // Skip - parlay is fully resolved
        }
        
        // Include all other parlays (pending, live, or any that need checking)
        return true;
      });
    }
    
    console.log(`[check-journal-bets] After filtering: ${filteredParlayBets.length} parlay bets to process (from ${(parlayBets || []).length} total)`);
    
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
    
    // SPORTSBOOK-STANDARD: Collect ALL parlay leg stats needs upfront for batch fetching
    // This matches how sportsbooks operate - they batch all requests together
    const parlayStatsNeeded = new Map<string, { gameId: number; playerId: number; gameDate: string }>();
    const parlayGamesCache = new Map<string, any[]>(); // Cache games by date for parlay processing
    
    // First, fetch all games needed for parlays
    for (const [parlayDate, parlays] of Object.entries(parlaysByDate)) {
      const gamesResponse = await fetch(
        `https://api.balldontlie.io/v1/games?dates[]=${parlayDate}`,
        {
          headers: {
            'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
          },
        }
      );
      
      if (gamesResponse.ok) {
        const gamesData = await gamesResponse.json();
        const games = gamesData.data || [];
        parlayGamesCache.set(parlayDate, games);
        
        // Extract all player prop legs from parlays and collect stats needs
        for (const parlayBet of parlays as any[]) {
          if (!parlayBet.parlay_legs || !Array.isArray(parlayBet.parlay_legs)) continue;
          
          for (const leg of parlayBet.parlay_legs) {
            // Skip game props (they don't need player stats)
            if (leg.isGameProp || GAME_PROP_STAT_TYPES.includes(leg.statType)) continue;
            if (!leg.playerId || !leg.gameDate) continue;
            
            // Find the game for this leg
            const legGameDate = leg.gameDate.split('T')[0];
            const legGames = parlayGamesCache.get(legGameDate) || [];
            
            const targetGame = legGames.find((g: any) => {
              const gameDate = g.date ? g.date.split('T')[0] : null;
              if (gameDate !== legGameDate) return false;
              
              const homeMatch = g.home_team?.abbreviation === leg.team || g.home_team?.full_name === leg.team;
              const visitorMatch = g.visitor_team?.abbreviation === leg.team || g.visitor_team?.full_name === leg.team;
              const opponentMatch = leg.opponent && (
                g.home_team?.abbreviation === leg.opponent || g.home_team?.full_name === leg.opponent ||
                g.visitor_team?.abbreviation === leg.opponent || g.visitor_team?.full_name === leg.opponent
              );
              
              return (homeMatch || visitorMatch) && (!leg.opponent || opponentMatch);
            });
            
            if (targetGame && targetGame.id) {
              const key = `${targetGame.id}_${leg.playerId}`;
              if (!parlayStatsNeeded.has(key)) {
                parlayStatsNeeded.set(key, { gameId: targetGame.id, playerId: leg.playerId, gameDate: legGameDate });
              }
            }
          }
        }
      }
    }
    
    // Batch fetch all parlay leg stats (sportsbook-style)
    const globalParlayStatsCache = new Map<string, any>();
    if (parlayStatsNeeded.size > 0) {
      console.log(`[check-journal-bets] 📦 Batch fetching ${parlayStatsNeeded.size} parlay leg stats (sportsbook-style batching)`);
      
      // Check database cache first
      const parlayGameIds = Array.from(parlayStatsNeeded.values()).map(v => v.gameId);
      const parlayPlayerIds = Array.from(parlayStatsNeeded.values()).map(v => v.playerId);
      
      try {
        const { data: cachedStats } = await supabaseAdmin
          .from('player_game_stats')
          .select('*')
          .in('game_id', parlayGameIds)
          .in('player_id', parlayPlayerIds);
        
        if (cachedStats && cachedStats.length > 0) {
          for (const cached of cachedStats) {
            const key = `${cached.game_id}_${cached.player_id}`;
            // Include composite stats from cache (pre-calculated for accuracy)
            globalParlayStatsCache.set(key, {
              pts: cached.pts || 0,
              reb: cached.reb || 0,
              ast: cached.ast || 0,
              stl: cached.stl || 0,
              blk: cached.blk || 0,
              fg3m: cached.fg3m || 0,
              pra: cached.pra ?? ((cached.pts || 0) + (cached.reb || 0) + (cached.ast || 0)),
              pr: cached.pr ?? ((cached.pts || 0) + (cached.reb || 0)),
              pa: cached.pa ?? ((cached.pts || 0) + (cached.ast || 0)),
              ra: cached.ra ?? ((cached.reb || 0) + (cached.ast || 0)),
              min: cached.min || '0:00',
            });
          }
          console.log(`[check-journal-bets] ✅ Found ${cachedStats.length} cached parlay stats in database`);
        }
      } catch (error) {
        // Cache query failed - will fetch from API
      }
      
      // Determine which stats need to be fetched from API
      const parlayStatsToFetch: Array<{ gameId: number; playerId: number; key: string; gameDate: string }> = [];
      for (const [key, { gameId, playerId, gameDate }] of parlayStatsNeeded) {
        if (!globalParlayStatsCache.has(key)) {
          parlayStatsToFetch.push({ gameId, playerId, key, gameDate });
        }
      }
      
      // Batch fetch missing stats
      if (parlayStatsToFetch.length > 0) {
        const uniqueGameIds = [...new Set(parlayStatsToFetch.map(s => s.gameId))];
        const uniquePlayerIds = [...new Set(parlayStatsToFetch.map(s => s.playerId))];
        
        const batchUrl = new URL('https://api.balldontlie.io/v1/stats');
        uniqueGameIds.forEach(id => batchUrl.searchParams.append('game_ids[]', String(id)));
        uniquePlayerIds.forEach(id => batchUrl.searchParams.append('player_ids[]', String(id)));
        
        try {
          const statsResponse = await fetch(batchUrl.toString(), {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          });
          
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            
            if (statsData.data && statsData.data.length > 0) {
              const fetchedStatsMap = new Map<string, any>();
              for (const stat of statsData.data) {
                const gid = stat.game?.id ?? (stat as any).game_id;
                const pid = stat.player?.id ?? (stat as any).player_id;
                if (gid == null || pid == null) continue;
                const statKey = `${gid}_${pid}`;
                if (!fetchedStatsMap.has(statKey)) {
                  fetchedStatsMap.set(statKey, stat);
                }
              }
              
              // Store fetched stats in cache and database
              const statsToCache: any[] = [];
              for (const { gameId, playerId, key, gameDate } of parlayStatsToFetch) {
                const stat = fetchedStatsMap.get(`${gameId}_${playerId}`);
                if (stat) {
                  // Normalize stats structure for consistent access (same format as database cache)
                  const normalizedStat = {
                    pts: stat.pts || 0,
                    reb: stat.reb || 0,
                    ast: stat.ast || 0,
                    stl: stat.stl || 0,
                    blk: stat.blk || 0,
                    fg3m: stat.fg3m || 0,
                    pra: (stat.pts || 0) + (stat.reb || 0) + (stat.ast || 0),
                    pr: (stat.pts || 0) + (stat.reb || 0),
                    pa: (stat.pts || 0) + (stat.ast || 0),
                    ra: (stat.reb || 0) + (stat.ast || 0),
                    min: stat.min || '0:00',
                  };
                  globalParlayStatsCache.set(key, normalizedStat);
                  
                  statsToCache.push({
                    game_id: gameId,
                    player_id: playerId,
                    pts: normalizedStat.pts,
                    reb: normalizedStat.reb,
                    ast: normalizedStat.ast,
                    stl: normalizedStat.stl,
                    blk: normalizedStat.blk,
                    fg3m: normalizedStat.fg3m,
                    pra: normalizedStat.pra,
                    pr: normalizedStat.pr,
                    pa: normalizedStat.pa,
                    ra: normalizedStat.ra,
                    min: normalizedStat.min,
                    team_id: stat.team?.id,
                    team_abbreviation: stat.team?.abbreviation,
                    opponent_id: stat.game?.home_team?.id === stat.team?.id 
                      ? stat.game?.visitor_team?.id 
                      : stat.game?.home_team?.id,
                    opponent_abbreviation: stat.game?.home_team?.abbreviation === stat.team?.abbreviation
                      ? stat.game?.visitor_team?.abbreviation
                      : stat.game?.home_team?.abbreviation,
                    game_date: gameDate,
                    updated_at: new Date().toISOString(),
                  });
                }
              }
              
              // Batch insert/update all stats in database cache
              if (statsToCache.length > 0) {
                try {
                  await supabaseAdmin
                    .from('player_game_stats')
                    .upsert(statsToCache, {
                      onConflict: 'game_id,player_id'
                    });
                  console.log(`[check-journal-bets] 💾 Batch cached ${statsToCache.length} parlay stats in database`);
                } catch (error) {
                  console.error(`[check-journal-bets] Failed to batch cache parlay stats:`, error);
                }
              }
              
              console.log(`[check-journal-bets] ✅ Batch fetched ${fetchedStatsMap.size} parlay stats from API`);
            }
          }
        } catch (error) {
          console.error(`[check-journal-bets] ❌ Batch parlay stats fetch error:`, error);
        }
      }
    }

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

      // OPTIMIZATION: Group bets by unique (game_id, player_id) to deduplicate stats fetches
      // First, match bets to games
      const betsWithGames: Array<{ bet: any; game: any; isGameProp: boolean }> = [];
      
      for (const bet of bets as any[]) {
        if (!bet.game_date) continue;
        
        // CRITICAL FIX: Detect game props by stat_type, not just by missing player_id
        // Some moneyline bets incorrectly have player_id set to team abbreviation (e.g., "DAL", "ORL")
        // So we check stat_type first, then fall back to checking if player_id is missing
        const isGameProp = bet.stat_type && GAME_PROP_STAT_TYPES.includes(bet.stat_type);
        
        // Skip if it's not a game prop and has no player_id (invalid bet)
        if (!isGameProp && !bet.player_id) continue;
        
        // Find the game with matching teams
        const game = games.find((g: any) => {
          const homeMatch = g.home_team.full_name === bet.team || g.home_team.abbreviation === bet.team;
          const visitorMatch = g.visitor_team.full_name === bet.team || g.visitor_team.abbreviation === bet.team;
          const homeOppMatch = g.home_team.full_name === bet.opponent || g.home_team.abbreviation === bet.opponent;
          const visitorOppMatch = g.visitor_team.full_name === bet.opponent || g.visitor_team.abbreviation === bet.opponent;
          
          return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
        });
        
        if (game) {
          betsWithGames.push({ bet, game, isGameProp });
        } else {
          const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name;
          console.error(`[check-journal-bets] ❌ Single bet ${bet.id} (${betDescription}): Game not found for ${bet.team} vs ${bet.opponent} on ${bet.game_date}`);
          console.error(`[check-journal-bets]    Available games on ${bet.game_date}:`, games.map((g: any) => `${g.home_team?.abbreviation || g.home_team?.full_name} vs ${g.visitor_team?.abbreviation || g.visitor_team?.full_name}`).join(', '));
          
          // CRITICAL FIX: For game props (moneylines), try to find game by checking all games
          // The team matching might be failing due to abbreviation/full name mismatches
          if (isGameProp && games.length > 0) {
            // Try more flexible matching - check if either team name/abbr matches
            const flexibleMatch = games.find((g: any) => {
              const homeAbbr = g.home_team?.abbreviation?.toUpperCase() || '';
              const homeFull = g.home_team?.full_name?.toUpperCase() || '';
              const visitorAbbr = g.visitor_team?.abbreviation?.toUpperCase() || '';
              const visitorFull = g.visitor_team?.full_name?.toUpperCase() || '';
              const betTeam = (bet.team || '').toUpperCase();
              const betOpp = (bet.opponent || '').toUpperCase();
              
              // Check if bet.team matches either home or visitor (and bet.opponent matches the other)
              const teamMatches = betTeam === homeAbbr || betTeam === homeFull || betTeam === visitorAbbr || betTeam === visitorFull;
              const oppMatches = !betOpp || betOpp === homeAbbr || betOpp === homeFull || betOpp === visitorAbbr || betOpp === visitorFull;
              
              return teamMatches && oppMatches;
            });
            
            if (flexibleMatch) {
              console.log(`[check-journal-bets] ✅ Found game using flexible matching for bet ${bet.id}`);
              betsWithGames.push({ bet, game: flexibleMatch, isGameProp });
            } else {
              console.error(`[check-journal-bets] ❌ Still couldn't find game for bet ${bet.id} even with flexible matching`);
            }
          }
        }
      }
      
      // Group player prop bets by unique (game_id, player_id) for deduplication
      const statsNeeded = new Map<string, { gameId: number; playerId: number; bets: Array<{ bet: any; game: any }> }>();
      
      for (const { bet, game, isGameProp } of betsWithGames) {
        // Skip game props (they don't need player stats)
        if (isGameProp) continue;
        
        // Skip if no player_id
        if (!bet.player_id) continue;
        
        const key = `${game.id}_${bet.player_id}`;
        if (!statsNeeded.has(key)) {
          statsNeeded.set(key, { gameId: game.id, playerId: bet.player_id, bets: [] });
        }
        statsNeeded.get(key)!.bets.push({ bet, game });
      }
      
      // SPORTSBOOK-STANDARD BATCH FETCHING: Collect all stats needs and fetch in batches
      // This matches how sportsbooks operate - they batch all requests together
      const statsCache = new Map<string, any>();
      
      // First, check database cache for all needed stats
      const cacheKeys = Array.from(statsNeeded.keys());
      const cacheResults = new Map<string, any>();
      
      if (cacheKeys.length > 0) {
        const gameIds = Array.from(statsNeeded.values()).map(v => v.gameId);
        const playerIds = Array.from(statsNeeded.values()).map(v => v.playerId);
        
        try {
          const { data: cachedStats } = await supabaseAdmin
            .from('player_game_stats')
            .select('*')
            .in('game_id', gameIds)
            .in('player_id', playerIds);
          
          if (cachedStats && cachedStats.length > 0) {
            for (const cached of cachedStats) {
              const key = `${cached.game_id}_${cached.player_id}`;
              // Include composite stats from cache (pre-calculated for accuracy)
              cacheResults.set(key, {
                pts: cached.pts || 0,
                reb: cached.reb || 0,
                ast: cached.ast || 0,
                stl: cached.stl || 0,
                blk: cached.blk || 0,
                fg3m: cached.fg3m || 0,
                pra: cached.pra ?? ((cached.pts || 0) + (cached.reb || 0) + (cached.ast || 0)),
                pr: cached.pr ?? ((cached.pts || 0) + (cached.reb || 0)),
                pa: cached.pa ?? ((cached.pts || 0) + (cached.ast || 0)),
                ra: cached.ra ?? ((cached.reb || 0) + (cached.ast || 0)),
                min: cached.min || '0:00',
              });
            }
            console.log(`[check-journal-bets] ✅ Found ${cachedStats.length} cached stats in database`);
          }
        } catch (error) {
          // Cache query failed - will fetch from API
        }
      }
      
      // Determine which stats need to be fetched from API
      const statsToFetch: Array<{ gameId: number; playerId: number; key: string }> = [];
      for (const [key, { gameId, playerId }] of statsNeeded) {
        if (!cacheResults.has(key)) {
          statsToFetch.push({ gameId, playerId, key });
        } else {
          statsCache.set(key, cacheResults.get(key));
        }
      }
      
      // BATCH FETCH: Fetch all missing stats in a single API call (sportsbook-style)
      if (statsToFetch.length > 0) {
        console.log(`[check-journal-bets] 📦 Batch fetching ${statsToFetch.length} stats from API (sportsbook-style batching)`);
        
        // Build batch request URL with all game_ids and player_ids
        const uniqueGameIds = [...new Set(statsToFetch.map(s => s.gameId))];
        const uniquePlayerIds = [...new Set(statsToFetch.map(s => s.playerId))];
        
        const batchUrl = new URL('https://api.balldontlie.io/v1/stats');
        uniqueGameIds.forEach(id => batchUrl.searchParams.append('game_ids[]', String(id)));
        uniquePlayerIds.forEach(id => batchUrl.searchParams.append('player_ids[]', String(id)));
        
        try {
          const statsResponse = await fetch(batchUrl.toString(), {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          });
          
          if (statsResponse.ok) {
            const statsData = await statsResponse.json();
            
            if (statsData.data && statsData.data.length > 0) {
              // Index stats by game_id + player_id for fast lookup (support nested game.id/player.id or top-level game_id/player_id)
              const fetchedStatsMap = new Map<string, any>();
              for (const stat of statsData.data) {
                const gid = stat.game?.id ?? (stat as any).game_id;
                const pid = stat.player?.id ?? (stat as any).player_id;
                if (gid == null || pid == null) continue;
                const statKey = `${gid}_${pid}`;
                if (!fetchedStatsMap.has(statKey)) {
                  fetchedStatsMap.set(statKey, stat);
                }
              }
              
              // Store fetched stats in cache and database
              const statsToCache: any[] = [];
              for (const { gameId, playerId, key } of statsToFetch) {
                const stat = fetchedStatsMap.get(`${gameId}_${playerId}`);
                if (stat) {
                  // Normalize stats structure for consistent access (same format as database cache)
                  const normalizedStat = {
                    pts: stat.pts || 0,
                    reb: stat.reb || 0,
                    ast: stat.ast || 0,
                    stl: stat.stl || 0,
                    blk: stat.blk || 0,
                    fg3m: stat.fg3m || 0,
                    pra: (stat.pts || 0) + (stat.reb || 0) + (stat.ast || 0),
                    pr: (stat.pts || 0) + (stat.reb || 0),
                    pa: (stat.pts || 0) + (stat.ast || 0),
                    ra: (stat.reb || 0) + (stat.ast || 0),
                    min: stat.min || '0:00',
                  };
                  statsCache.set(key, normalizedStat);
                  
                  // Calculate composite stats for storage
                  const pra = normalizedStat.pts + normalizedStat.reb + normalizedStat.ast;
                  const pr = normalizedStat.pts + normalizedStat.reb;
                  const pa = normalizedStat.pts + normalizedStat.ast;
                  const ra = normalizedStat.reb + normalizedStat.ast;
                  
                  // Prepare for database cache
                  statsToCache.push({
                    game_id: gameId,
                    player_id: playerId,
                    pts: normalizedStat.pts,
                    reb: normalizedStat.reb,
                    ast: normalizedStat.ast,
                    stl: normalizedStat.stl,
                    blk: normalizedStat.blk,
                    fg3m: normalizedStat.fg3m,
                    pra: pra,
                    pr: pr,
                    pa: pa,
                    ra: ra,
                    min: normalizedStat.min,
                    team_id: stat.team?.id,
                    team_abbreviation: stat.team?.abbreviation,
                    opponent_id: stat.game?.home_team?.id === stat.team?.id 
                      ? stat.game?.visitor_team?.id 
                      : stat.game?.home_team?.id,
                    opponent_abbreviation: stat.game?.home_team?.abbreviation === stat.team?.abbreviation
                      ? stat.game?.visitor_team?.abbreviation
                      : stat.game?.home_team?.abbreviation,
                    game_date: gameDate,
                    updated_at: new Date().toISOString(),
                  });
                }
              }
              
              // Batch insert/update all stats in database cache
              if (statsToCache.length > 0) {
                try {
                  await supabaseAdmin
                    .from('player_game_stats')
                    .upsert(statsToCache, {
                      onConflict: 'game_id,player_id'
                    });
                  console.log(`[check-journal-bets] 💾 Batch cached ${statsToCache.length} stats in database`);
                } catch (error) {
                  console.error(`[check-journal-bets] Failed to batch cache stats:`, error);
                }
              }
              
              console.log(`[check-journal-bets] ✅ Batch fetched ${fetchedStatsMap.size} stats from API`);
            }
          } else {
            console.error(`[check-journal-bets] ❌ Batch stats fetch failed: ${statsResponse.status}`);
          }
        } catch (error) {
          console.error(`[check-journal-bets] ❌ Batch stats fetch error:`, error);
        }
      }
      
      // Now process all bets (both game props and player props)
      for (const { bet, game, isGameProp: initialIsGameProp } of betsWithGames) {
        // SPORTSBOOK-STANDARD: Skip bets that are already fully resolved
        // A bet is resolved if it has a final result (win/loss/void) AND status is completed
        // This prevents unnecessary re-processing of resolved bets
        if (!recalculate) {
          const hasFinalResult = bet.result === 'win' || bet.result === 'loss' || bet.result === 'void';
          const isCompleted = bet.status === 'completed';
          
          if (hasFinalResult && isCompleted) {
            continue; // Skip - bet is fully resolved, no need to process again
          }
        }
        
        // CRITICAL FIX: Re-detect game prop by stat_type (some bets have player_id incorrectly set to team abbreviation)
        // This ensures moneyline/spread bets are always treated as game props, not player props
        const isGameProp = bet.stat_type && GAME_PROP_STAT_TYPES.includes(bet.stat_type);
        
        // Check if this is a parlay bet
        const isParlay = bet.market && bet.market.startsWith('Parlay');
        
        if (isParlay) {
          // Handle parlay resolution (using pre-fetched stats cache if available)
          await resolveParlayBet(bet, games, updatedCountRef, globalParlayStatsCache || undefined, request);
          continue;
        }
        
        // bet and game are already matched and passed in from betsWithGames

        // SPORTSBOOK-STANDARD RESOLUTION: Check if game is final
        // Sportsbooks use two indicators:
        // 1. Final scores exist (home_team_score and visitor_team_score are populated) - PRIMARY
        // 2. Status says "Final" - SECONDARY (for confirmation)
        // If scores exist, game is final regardless of status field
        const hasFinalScores = game.home_team_score != null && game.visitor_team_score != null;
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        const statusSaysFinal = gameStatus.includes('final') || game.status === 'Final';
        
        // Game is final if scores exist (sportsbook standard) OR status explicitly says final
        const isGameFinal = hasFinalScores || statusSaysFinal;
        
        // Check if game is live by looking at tipoff time and game status
        let isLive = false;
        let isCompleted = false;
        let completedAt: Date | null = null;
        // Use game.date (scheduled time) instead of trying to parse game.status
        const tipoffTime = game.date ? Date.parse(game.date) : NaN;
        const now = Date.now();
        
        // Check if game status indicates it's in progress (e.g., "1st Qtr", "2nd Qtr", "3rd Qtr", "4th Qtr", "Halftime", etc.)
        const liveStatusIndicators = ['qtr', 'quarter', 'half', 'ot', 'overtime'];
        const gameIsInProgress = liveStatusIndicators.some(indicator => gameStatus.includes(indicator)) && !isGameFinal;
        
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          const threeHoursMs = 3 * 60 * 60 * 1000;
          const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000; // 2.5 hours for NBA game
          
          // CRITICAL: Game must have actually started (tipoffTime is in the past) before we can mark it as completed
          const gameHasStarted = timeSinceTipoff > 0;
          
          // Game is live if: (1) it started and hasn't been 3 hours yet, OR (2) status indicates it's in progress
          isLive = (gameHasStarted && timeSinceTipoff < threeHoursMs) || gameIsInProgress;
          
          // SPORTSBOOK RULE: Game is completed if:
          // 1. Final scores exist (primary indicator - this is how sportsbooks determine completion)
          // 2. OR status explicitly says "final" AND game has started
          if (gameHasStarted && isGameFinal) {
            isCompleted = true;
            const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
            completedAt = new Date(estimatedCompletionTime);
            const reason = hasFinalScores ? 'final scores exist' : 'status says final';
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] ✅ Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is FINAL (${reason}) - sportsbook-standard resolution`);
          } else if (gameHasStarted && !isGameFinal) {
            // Game has started but not final - wait for scores or final status
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] ⏳ Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} started but no final scores yet (status: "${game.status}", home_score: ${game.home_team_score}, visitor_score: ${game.visitor_team_score}) - waiting for completion`);
          } else {
            // Game hasn't started yet - cannot be completed
            const hoursUntilTipoff = (tipoffTime - now) / (1000 * 60 * 60);
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] ⏳ Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} hasn't started yet (tipoff: ${new Date(tipoffTime).toISOString()}, ${hoursUntilTipoff.toFixed(2)} hours from now)`);
            continue;
          }
        } else if (isGameFinal) {
          // No tipoff time but game is final (scores exist or status says final)
          const reason = hasFinalScores ? 'final scores exist' : 'status says final';
          const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
          console.log(`[check-journal-bets] ✅ Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is FINAL (${reason}) but no tipoff time available`);
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
          
          // Handle live game props - they can't be determined early, just mark as live
          if (isGameProp) {
            await supabaseAdmin
              .from('bets')
              .update({ status: 'live' })
              .eq('id', bet.id);
            console.log(`[check-journal-bets] Single bet ${bet.id} (Game prop ${bet.stat_type}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
            updatedCountRef.value++;
            continue;
          }
          
          // If bet can't be determined early, just update status to 'live'
          const updateData: any = { status: 'live' };
          
          // If bet is already marked as win/loss but can't be determined yet, reset it
          if (bet.result && bet.result !== 'pending' && bet.result !== 'void') {
            updateData.result = 'pending';
            updateData.actual_value = null;
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name;
            console.log(`[check-journal-bets] ⚠️  Single bet ${bet.id} (${betDescription}): Game is live but bet was marked as ${bet.result}. Resetting to pending/live.`);
          }
          
          await supabaseAdmin
            .from('bets')
            .update(updateData)
            .eq('id', bet.id);
          
          const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name;
          console.log(`[check-journal-bets] Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
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
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] ⚠️  Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is ${game.status} (not final), but bet is marked as ${bet.result}. Resetting to ${newStatus}.`);
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
            
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
          } else {
            const betDescription = isGameProp ? `Game prop ${bet.stat_type}` : bet.player_name || 'Unknown';
            console.log(`[check-journal-bets] Single bet ${bet.id} (${betDescription}): Game ${bet.team} vs ${bet.opponent} is ${game.status}, not completed yet`);
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
        // CRITICAL: Re-check isGameProp here (some bets have player_id incorrectly set to team abbreviation)
        const finalIsGameProp = bet.stat_type && GAME_PROP_STAT_TYPES.includes(bet.stat_type);
        if (finalIsGameProp) {
          console.log(`[check-journal-bets] Evaluating game prop bet ${bet.id}: ${bet.stat_type} for game ${game.id}`);
          
          // Evaluate game prop using game data
          const actualValue = evaluateGameProp(game, bet.stat_type, bet.team || '');
          
          // Determine result using shared utility function
          const line = Number(bet.line);
          let result: 'win' | 'loss';
          
          // For moneyline bets, over_under might be null or invalid - that's okay, we'll use a default
          // Moneyline bets don't really need over_under, but the function requires it
          if (!bet.over_under || (bet.over_under !== 'over' && bet.over_under !== 'under')) {
            if (bet.stat_type === 'moneyline') {
              // For moneyline, default to 'over' (doesn't matter since calculateUniversalBetResult ignores it for moneyline)
              bet.over_under = 'over';
            } else {
              console.error(`[check-journal-bets] Invalid over_under value for bet ${bet.id}: "${bet.over_under}"`);
              continue;
            }
          }
          
          result = calculateUniversalBetResult(
            actualValue,
            line,
            bet.over_under,
            bet.stat_type || ''
          );

          // Log the evaluation for debugging
          const isWholeNumber = line % 1 === 0;
          console.log(`[check-journal-bets] Evaluating bet ${bet.id}: Game prop ${bet.over_under} ${line} ${bet.stat_type}`);
          console.log(`[check-journal-bets]   Actual value: ${actualValue}, Line: ${line}, Is whole number: ${isWholeNumber}`);
          console.log(`[check-journal-bets]   Comparison: ${actualValue} ${bet.over_under === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${result}`);

          // Update the journal bet with result
          const { data: updateData, error: updateError } = await supabaseAdmin
            .from('bets')
            .update({
              status: 'completed',
              result,
              actual_value: actualValue,
            })
            .eq('id', bet.id)
            .select();

          if (updateError) {
            console.error(`[check-journal-bets] ❌ Failed to update bet ${bet.id}:`, updateError);
            console.error(`[check-journal-bets]    Bet details:`, { team: bet.team, opponent: bet.opponent, game_date: bet.game_date, stat_type: bet.stat_type });
          } else {
            console.log(`[check-journal-bets] ✅ Updated game prop bet ${bet.id}: ${bet.stat_type} ${bet.over_under} ${line}: ${result} (actual: ${actualValue})`);
            if (updateData && updateData.length === 0) {
              console.error(`[check-journal-bets] ⚠️  Update returned no rows for bet ${bet.id} - bet may not exist or RLS is blocking`);
            }
            updatedCountRef.value++;
          }
          continue; // Skip player stats fetching for game props
        }

        // Get player stats from cache (already fetched and cached above)
        const statsKey = `${game.id}_${bet.player_id}`;
        const playerStat = statsCache.get(statsKey);
        
        if (!playerStat) {
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): No stats found for player ${bet.player_id} in game ${game.id}`);
          continue;
        }
        
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

        // Normalize stat_type so "PTS"/"Pts" etc. always match (points bet must use pts, not ast)
        const statType = String(bet.stat_type ?? '').trim().toLowerCase();
        const statTypeNorm = statType === 'points' ? 'pts' : statType;

        // Calculate actual value from the correct stat (pts for points, ast for assists, etc.)
        // CRITICAL: Use pre-calculated composite stats when available for accuracy
        let actualValue = 0;
        switch (statTypeNorm) {
          case 'pts':
            actualValue = stats.pts;
            console.log(`[check-journal-bets] Bet ${bet.id}: Reading POINTS - stats.pts = ${stats.pts}, actualValue = ${actualValue}`);
            break;
          case 'reb':
            actualValue = stats.reb;
            break;
          case 'ast':
            actualValue = stats.ast;
            break;
          case 'pa':
            // Use pre-calculated PA if available, otherwise calculate
            actualValue = stats.pa ?? (stats.pts + stats.ast);
            break;
          case 'pr':
            // Use pre-calculated PR if available, otherwise calculate
            actualValue = stats.pr ?? (stats.pts + stats.reb);
            break;
          case 'pra':
            // Use pre-calculated PRA if available, otherwise calculate
            actualValue = stats.pra ?? (stats.pts + stats.reb + stats.ast);
            break;
          case 'ra':
            // Use pre-calculated RA if available, otherwise calculate
            actualValue = stats.ra ?? (stats.reb + stats.ast);
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
            logDebug(`Unknown stat type: ${bet.stat_type} (normalized: ${statTypeNorm})`);
            continue;
        }
        
        // Validate actualValue is reasonable (sanity check)
        if (statTypeNorm === 'pts' && (actualValue < 0 || actualValue > 150)) {
          console.error(`[check-journal-bets] ⚠️  WARNING: Bet ${bet.id} (${bet.player_name}) has suspicious points value: ${actualValue}. Stats object:`, stats);
        }

        // Determine result using shared utility function
        const line = Number(bet.line);
        
        if (!bet.over_under || (bet.over_under !== 'over' && bet.over_under !== 'under')) {
          console.error(`[check-journal-bets] Invalid over_under value for bet ${bet.id}: "${bet.over_under}"`);
          continue;
        }
        
        const result = calculateUniversalBetResult(
          actualValue,
          line,
          bet.over_under,
          statTypeNorm || bet.stat_type || ''
        );

        // Log the evaluation for debugging
        const isWholeNumber = line % 1 === 0;
        console.log(`[check-journal-bets] Evaluating bet ${bet.id}: ${bet.player_name} ${bet.over_under} ${line} ${bet.stat_type}`);
        console.log(`[check-journal-bets]   Actual value: ${actualValue}, Line: ${line}, Is whole number: ${isWholeNumber}`);
        console.log(`[check-journal-bets]   Comparison: ${actualValue} ${bet.over_under === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${result}`);

        // Update the journal bet with result
        const { data: updateData, error: updateError } = await supabaseAdmin
          .from('bets')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
          })
          .eq('id', bet.id)
          .select();

        if (updateError) {
          console.error(`[check-journal-bets] ❌ Failed to update bet ${bet.id}:`, updateError);
          console.error(`[check-journal-bets]    Bet details:`, { player_name: bet.player_name, team: bet.team, opponent: bet.opponent, game_date: bet.game_date, stat_type: bet.stat_type });
        } else {
          console.log(`[check-journal-bets] ✅ Updated ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${line}: ${result} (actual: ${actualValue})`);
          if (updateData && updateData.length === 0) {
            console.error(`[check-journal-bets] ⚠️  Update returned no rows for bet ${bet.id} - bet may not exist or RLS is blocking`);
          }
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
      
      // Process parlays for this date (using pre-fetched stats cache)
      const parlaysList = parlays as any[];
      for (const parlayBet of parlaysList) {
        await resolveParlayBet(parlayBet, allGames, updatedCountRef, globalParlayStatsCache, request);
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
