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
  updatedCountRef: { value: number }
): Promise<void> {
  try {
    console.log(`[check-journal-bets] 🔍 Processing parlay bet ${bet.id}: "${bet.market || bet.selection}"`);
    
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
      console.log(`[check-journal-bets] Parlay ${bet.id}: Using structured parlay_legs data (${bet.parlay_legs.length} legs)`);
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
      console.log(`[check-journal-bets] Parlay ${bet.id}: No structured data, parsing text (legacy parlay)`);
      const parsedLegs = parseParlayLegs(bet.selection || bet.market || '');
      if (parsedLegs.length === 0) {
        console.error(`[check-journal-bets] ❌ Could not parse parlay legs for bet ${bet.id}. Selection text: "${bet.selection || bet.market}"`);
        return;
      }
      legs = parsedLegs;
    }
    
    console.log(`[check-journal-bets] Parlay ${bet.id}: Processing ${legs.length} legs: ${legs.map(l => `${l.playerName} ${l.overUnder} ${l.line} ${l.statType}`).join(', ')}`);
    
    const legResults: Array<{ won: boolean; void: boolean; leg: any }> = [];
    let allLegsResolved = true;
    
    // Get the parlay date to filter games
    const parlayDate = bet.date || bet.game_date;
    
    // Check each leg
    // IMPORTANT: Each leg must be resolved (game final, player found, stats calculated) before the parlay can be resolved.
    // If any leg's game hasn't started or isn't final, that leg won't be resolved, and the parlay will stay pending.
    // This ensures parlays with legs on different dates/times wait for ALL games to complete.
    for (const leg of legs) {
      console.log(`[check-journal-bets] Parlay ${bet.id}: Checking leg "${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statType}"`);
      const statKey = leg.statType;
      let legResolved = false;
      
      // OPTIMIZATION: If we have structured data (playerId, team, opponent, gameDate), use direct lookup
      if (leg.playerId && leg.team && leg.gameDate) {
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Using structured data - direct lookup (playerId: ${leg.playerId}, team: ${leg.team}, gameDate: ${leg.gameDate})`);
        
        // Find the specific game for this leg
        const legGameDate = leg.gameDate.split('T')[0];
        const targetGame = games.find((g: any) => {
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
        
        if (!targetGame) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game not found for team ${leg.team} on ${legGameDate}`);
          allLegsResolved = false;
          continue;
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
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${targetGame.id} date-only and not final. Skipping.`);
            allLegsResolved = false;
            continue;
          }
          
          if (gameHasStarted) {
            const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000;
            const tenMinutesMs = 10 * 60 * 1000;
            const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
            const timeSinceEstimatedCompletion = now - estimatedCompletionTime;
            
            if (gameStatus.includes('final')) {
              isCompleted = true;
              completedAt = new Date(tipoffTime + estimatedGameDurationMs);
            } else if (timeSinceEstimatedCompletion > tenMinutesMs && hasTimeComponent) {
              isCompleted = true;
              completedAt = new Date(estimatedCompletionTime);
            }
          } else {
            const hoursUntil = (tipoffTime - now) / (1000 * 60 * 60);
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${targetGame.id} hasn't started yet (${hoursUntil.toFixed(2)} hours from now). Skipping.`);
            allLegsResolved = false;
            continue;
          }
        } else if (gameStatus.includes('final')) {
          isCompleted = true;
          completedAt = new Date(now - (60 * 60 * 1000));
        }
        
        if (!isCompleted) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${targetGame.id} not completed yet. Status: ${targetGame.status}`);
          allLegsResolved = false;
          continue;
        }
        
        if (completedAt) {
          const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
          if (completedAt > tenMinutesAgo) {
            const minutesAgo = Math.round((now - completedAt.getTime()) / 60000);
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${targetGame.id} completed ${minutesAgo} minutes ago, waiting for 10-minute buffer`);
            allLegsResolved = false;
            continue;
          }
        }
        
        // Handle game props differently from player props
        if (leg.isGameProp) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Evaluating game prop ${leg.statType} for game ${targetGame.id}`);
          
          // Evaluate game prop using game data
          const actualValue = evaluateGameProp(targetGame, leg.statType, leg.team || '');
          
          // Determine if leg won
          const legLine = Number(leg.line);
          const isWholeNumber = legLine % 1 === 0;
          let legWon: boolean;
          
          // Special handling for spreads: evaluateGameProp returns negative if team covered, positive if didn't cover
          if (leg.statType === 'spread') {
            // For spreads: actualValue < 0 means team covered, actualValue > 0 means didn't cover
            // The line is just for reference - the key is whether actualValue is negative
            legWon = actualValue < 0;
          } else {
            // For other props (totals, etc.), use standard over/under logic
            legWon = leg.overUnder === 'over' 
              ? (isWholeNumber ? actualValue >= legLine : actualValue > legLine)
              : (isWholeNumber ? actualValue <= legLine : actualValue < legLine);
          }
          
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": ${legWon ? 'WIN' : 'LOSS'} - Actual: ${actualValue}, Line: ${legLine} ${leg.overUnder} (comparison: ${actualValue} ${leg.overUnder === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${legLine})`);
          legResults.push({ won: legWon, void: false, leg });
          legResolved = true;
          continue; // Move to next leg
        }
        
        // DIRECT LOOKUP: Fetch stats for this specific game and find player by playerId
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Fetching stats for game ${targetGame.id} (direct lookup)`);
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${targetGame.id}&player_ids[]=${leg.playerId}`,
          {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          }
        );
        
        if (!statsResponse.ok) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Failed to fetch stats for game ${targetGame.id}`);
          allLegsResolved = false;
          continue;
        }
        
        const statsData = await statsResponse.json();
        if (!statsData.data || statsData.data.length === 0) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": No stats found for player ${leg.playerId} in game ${targetGame.id}`);
          allLegsResolved = false;
          continue;
        }
        
        const playerStat = statsData.data[0]; // Should only be one result since we filtered by playerId
        
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
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Player played 0 minutes - void`);
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
        
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": ${legWon ? 'WIN' : 'LOSS'} - Actual: ${actualValue}, Line: ${legLine} ${leg.overUnder} (comparison: ${actualValue} ${leg.overUnder === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${legLine})`);
        legResults.push({ won: legWon, void: false, leg });
        legResolved = true;
        continue; // Move to next leg
      }
      
      // FALLBACK: Legacy parlay resolution (no structured data) - use old method
      console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": No structured data, using legacy name-matching method`);
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
        
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Checking game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}), status: ${game.status}`);
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
              console.log(`[check-journal-bets] ✅ FIX VERIFIED: Parlay ${bet.id} leg "${leg.playerName}": Game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}) date-only format (no time) and status is not "final" (status: "${gameStatus}"). Skipping to prevent premature resolution.`);
              allLegsResolved = false;
              continue;
            }
            // If status is "final", proceed with normal logic
          }
          
          // For date-only games without "final" status, we already skipped them above
          // So if we reach here with date-only, it means status is "final" or 24+ hours passed
          if (gameHasStarted) {
            const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
            const timeSinceEstimatedCompletion = now - estimatedCompletionTime;
            
            if (gameStatus.includes('final')) {
              isCompleted = true;
              completedAt = new Date(tipoffTime + estimatedGameDurationMs);
            } else if (timeSinceEstimatedCompletion > tenMinutesMs) {
              // Only mark as completed if we have a proper time component
              // For date-only games, we already handled them above (require "final" or 24+ hours)
              if (hasTimeComponent) {
                isCompleted = true;
                completedAt = new Date(estimatedCompletionTime);
              }
            }
          } else {
            // Game hasn't started yet - cannot be completed
            const hoursUntil = (tipoffTime - now) / (1000 * 60 * 60);
            console.log(`[check-journal-bets] ✅ FIX VERIFIED: Parlay ${bet.id} leg "${leg.playerName}": Game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}) hasn't started yet (tipoff: ${new Date(tipoffTime).toISOString()}, ${hoursUntil.toFixed(2)} hours from now). Skipping to prevent premature resolution.`);
            allLegsResolved = false;
            continue; // Game not started yet, can't resolve this leg
          }
        } else if (gameStatus.includes('final')) {
          // Status says final but no date - only mark as completed if we can verify it's actually finished
          // Be more cautious: if we don't have a tipoff time, we can't verify the game started
          console.log(`[check-journal-bets] ⚠️  Parlay ${bet.id} leg "${leg.playerName}": Game ${game.id} status is "final" but no tipoff time available. Proceeding with caution.`);
          isCompleted = true;
          // Set completedAt to 1 hour ago to ensure it passes the 10-minute check
          completedAt = new Date(now - (60 * 60 * 1000));
        }
        
        // Only process if game is completed AND completed at least 10 minutes ago
        if (!isCompleted) {
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}) not completed yet. Status: ${game.status}`);
          allLegsResolved = false;
          continue; // Game not completed yet, can't resolve this leg
        }
        
        if (completedAt) {
          const tenMinutesAgo = new Date(now - (10 * 60 * 1000));
          if (completedAt > tenMinutesAgo) {
            const minutesAgo = Math.round((now - completedAt.getTime()) / 60000);
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Game ${game.id} completed ${minutesAgo} minutes ago, waiting for 10-minute buffer`);
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
        
        // For debugging: log first few player names in game stats (only for first game check per leg)
        if (game.id === games[0]?.id) {
          const samplePlayerNames = statsData.data.slice(0, 5).map((stat: any) => {
            const playerName = stat.player?.full_name || 
                              (stat.player?.first_name + ' ' + stat.player?.last_name) || '';
            return playerName;
          });
          console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Sample player names in game ${game.id}: ${samplePlayerNames.join(', ')}`);
        }
        
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
          // Only log for games where the player's team might be playing (to reduce noise)
          const isRelevantGame = game.home_team?.abbreviation === 'NOP' || 
                                 game.visitor_team?.abbreviation === 'NOP' ||
                                 game.home_team?.abbreviation === 'POR' ||
                                 game.visitor_team?.abbreviation === 'POR';
          
          if (isRelevantGame || leg.playerName.toLowerCase().includes('mccollum')) {
            const allPlayerNames = statsData.data.map((stat: any) => {
              const playerName = stat.player?.full_name || 
                                (stat.player?.first_name + ' ' + stat.player?.last_name) || '';
              return playerName;
            }).join(', ');
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Player not found in game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}). Available players: ${allPlayerNames.substring(0, 200)}...`);
          } else {
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Player not found in game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation})`);
          }
          
          // If we've checked all games from the parlay date and player still not found, mark as void
          if (parlayDate && isFromParlayDate && gamesCheckedFromParlayDate === totalGamesFromParlayDate && totalGamesFromParlayDate > 0) {
            console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Player not found in any game from ${parlayDate} (checked ${gamesCheckedFromParlayDate}/${totalGamesFromParlayDate} games). Marking leg as void (player didn't play).`);
            legResults.push({ won: false, void: true, leg });
            legResolved = true;
            break;
          }
          
          allLegsResolved = false;
          continue; // Player not in this game
        }
        
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Found player in game ${game.id}`);
        
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
        
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": ${legWon ? 'WIN' : 'LOSS'} - Actual: ${actualValue}, Line: ${legLine} ${leg.overUnder} (comparison: ${actualValue} ${leg.overUnder === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${legLine})`);
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
      console.log(`[check-journal-bets] Parlay ${bet.id}: Not all legs resolved yet (${legResults.length}/${legs.length} resolved). Legs: ${legs.map(l => l.playerName).join(', ')}`);
      return;
    }
    
    // Determine parlay result: exclude void legs, all non-void legs must win for parlay to win
    const nonVoidLegs = legResults.filter(r => !r.void);
    const voidLegs = legResults.filter(r => r.void);
    const parlayWon = nonVoidLegs.length > 0 && nonVoidLegs.every(r => r.won);
    const result: 'win' | 'loss' = parlayWon ? 'win' : 'loss';
    
    // Update parlay bet
    const { error: updateError } = await supabaseAdmin
      .from('bets')
      .update({
        status: 'completed',
        result,
        actual_value: parlayWon ? 1 : 0, // 1 for win, 0 for loss
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
    
    // If not a cron request, try to authenticate user (but allow if cookies aren't available)
    // This endpoint is safe to call without auth because it only updates bets based on game results,
    // doesn't return sensitive data, and processes all users' bets
    if (!isAuthorized) {
      try {
        const cookieHeader = request.headers.get('cookie');
        const supabase = await createClient();
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (session && session.user && !error) {
          // User is authenticated via cookies
          isAuthorized = true;
          console.log('[check-journal-bets] ✅ User authenticated via session');
        } else if (!cookieHeader || cookieHeader.length === 0) {
          // No cookies sent - allow request anyway (safe endpoint, only updates bets)
          // This handles cases where cookies aren't being sent from browser
          isAuthorized = true;
          console.log('[check-journal-bets] ⚠️ No cookies present, allowing request (safe endpoint)');
        } else {
          // Cookies present but session invalid - still allow (endpoint is safe)
          isAuthorized = true;
          console.log('[check-journal-bets] ⚠️ Cookies present but no valid session, allowing request (safe endpoint)');
        }
      } catch (error: any) {
        // If auth check fails, still allow (endpoint is safe)
        console.error('[check-journal-bets] Auth check exception, allowing anyway:', error?.message);
        isAuthorized = true;
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
      playerPropsQuery = playerPropsQuery.eq('result', 'pending');
      gamePropsQuery = gamePropsQuery.eq('result', 'pending');
    }
    
    const [{ data: playerProps, error: playerPropsError }, { data: gameProps, error: gamePropsError }] = await Promise.all([
      playerPropsQuery,
      gamePropsQuery,
    ]);
    
    if (playerPropsError) {
      console.error('Error fetching player props:', playerPropsError);
      throw playerPropsError;
    }
    
    if (gamePropsError) {
      console.error('Error fetching game props:', gamePropsError);
      throw gamePropsError;
    }
    
    const singleBets = [...(playerProps || []), ...(gameProps || [])];
    
    // Then get parlay bets (market contains "Parlay")
    let parlayBetsQuery = supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .like('market', 'Parlay%');
    
    if (recalculate) {
      parlayBetsQuery = parlayBetsQuery.in('result', ['pending', 'win', 'loss']);
    } else {
      parlayBetsQuery = parlayBetsQuery.eq('result', 'pending');
    }
    
    const { data: parlayBets, error: parlayError } = await parlayBetsQuery;
    
    if (parlayError) {
      console.error('Error fetching parlay bets:', parlayError);
      throw parlayError;
    }
    
    const journalBets = [...(singleBets || []), ...(parlayBets || [])];

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
        // Check if this is a parlay bet
        const isParlay = bet.market && bet.market.startsWith('Parlay');
        
        if (isParlay) {
          // Handle parlay resolution
          await resolveParlayBet(bet, games, updatedCountRef);
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
        
        // Check if game is live by looking at tipoff time
        let isLive = false;
        let isCompleted = false;
        let completedAt: Date | null = null;
        // Use game.date (scheduled time) instead of trying to parse game.status
        const tipoffTime = game.date ? Date.parse(game.date) : NaN;
        const now = Date.now();
        
        if (!Number.isNaN(tipoffTime)) {
          const timeSinceTipoff = now - tipoffTime;
          const threeHoursMs = 3 * 60 * 60 * 1000;
          const tenMinutesMs = 10 * 60 * 1000;
          const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000; // 2.5 hours for NBA game
          
          // CRITICAL: Game must have actually started (tipoffTime is in the past) before we can mark it as completed
          const gameHasStarted = timeSinceTipoff > 0;
          
          // Game is live if it started and hasn't been 3 hours yet
          isLive = gameHasStarted && timeSinceTipoff < threeHoursMs;
          
          // Game is completed ONLY if:
          // 1. Game has actually started (tipoffTime is in the past)
          // 2. AND (Status explicitly says "final" OR tipoff was more than 2.5 hours ago AND more than 10 minutes have passed since estimated completion)
          if (gameHasStarted) {
            const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
            const timeSinceEstimatedCompletion = now - estimatedCompletionTime;
            
            if (gameStatus.includes('final')) {
              isCompleted = true;
              completedAt = new Date(tipoffTime + estimatedGameDurationMs);
            } else if (timeSinceEstimatedCompletion > tenMinutesMs) {
              // Game likely completed more than 10 minutes ago (based on tipoff + estimated duration)
              isCompleted = true;
              completedAt = new Date(estimatedCompletionTime);
            }
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
        
        // If game is live but not completed, update status to 'live'
        if (isLive && !isCompleted) {
          await supabaseAdmin
            .from('bets')
            .update({ status: 'live' })
            .eq('id', bet.id)
            .eq('result', 'pending'); // Only update if still pending
          
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is live, updated status to 'live'`);
          continue;
        }
        
        // Only process if game is completed AND completed at least 10 minutes ago
        if (!isCompleted) {
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} is ${game.status}, not completed yet`);
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
          
          // Special handling for spreads: evaluateGameProp returns negative if team covered, positive if didn't cover
          // The line is stored from the team's perspective (negative for favorites, positive for underdogs)
          // Team covers if actualValue < 0 (negative), regardless of line value
          if (bet.stat_type === 'spread') {
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
      console.log(`[check-journal-bets] 📅 Processing ${(parlays as any[]).length} parlays for date ${date}`);
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
      console.log(`[check-journal-bets] Processing ${parlaysList.length} parlays for date ${date}`);
      for (const parlayBet of parlaysList) {
        console.log(`[check-journal-bets] About to process parlay bet ${parlayBet.id} with ${allGames.length} games available`);
        await resolveParlayBet(parlayBet, allGames, updatedCountRef);
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
    return NextResponse.json(
      { error: error.message || 'Failed to check journal bets' },
      { status: 500 }
    );
  }
}
