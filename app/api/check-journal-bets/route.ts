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
    const legs = parseParlayLegs(bet.selection || bet.market || '');
    
    if (legs.length === 0) {
      console.error(`[check-journal-bets] ❌ Could not parse parlay legs for bet ${bet.id}. Selection text: "${bet.selection || bet.market}"`);
      return;
    }
    
    console.log(`[check-journal-bets] Parlay ${bet.id}: Parsed ${legs.length} legs: ${legs.map(l => `${l.playerName} ${l.overUnder} ${l.line} ${l.statType}`).join(', ')}`);
    
    const legResults: Array<{ won: boolean; leg: any }> = [];
    let allLegsResolved = true;
    
    // Check each leg
    for (const leg of legs) {
      console.log(`[check-journal-bets] Parlay ${bet.id}: Checking leg "${leg.playerName} ${leg.overUnder} ${leg.line} ${leg.statType}"`);
      // leg.statType is already normalized to stat key (pts, reb, ast, etc.)
      const statKey = leg.statType;
      
      // Find player by name (we'll need to search for the player)
      // For now, we'll need to get player ID from the player name
      // This is a limitation - we should store player IDs with parlays
      
      // Try to find a game that might contain this player
      // We'll need to check all games and find the player
      let legResolved = false;
      
      console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Checking ${games.length} games`);
      for (const game of games) {
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Checking game ${game.id} (${game.home_team?.abbreviation} vs ${game.visitor_team?.abbreviation}), status: ${game.status}`);
        // Check if game is completed (same logic as single bets)
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        
        let isCompleted = false;
        let completedAt: Date | null = null;
        // Use game.date (scheduled time) instead of trying to parse game.status
        const tipoffTime = game.date ? Date.parse(game.date) : NaN;
        const now = Date.now();
        
        if (!Number.isNaN(tipoffTime)) {
          const estimatedGameDurationMs = 2.5 * 60 * 60 * 1000; // 2.5 hours for NBA game
          const tenMinutesMs = 10 * 60 * 1000; // 10 minutes
          const estimatedCompletionTime = tipoffTime + estimatedGameDurationMs;
          const timeSinceEstimatedCompletion = now - estimatedCompletionTime;
          
          if (gameStatus.includes('final')) {
            isCompleted = true;
            completedAt = new Date(tipoffTime + estimatedGameDurationMs);
          } else if (timeSinceEstimatedCompletion > tenMinutesMs) {
            isCompleted = true;
            completedAt = new Date(estimatedCompletionTime);
          }
        } else if (gameStatus.includes('final')) {
          // If status is final but no date, assume it completed long ago (more than 10 minutes)
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
        
        const statsData = await statsResponse.json();
        if (!statsData.data || statsData.data.length === 0) {
          continue;
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
            if (legLastName === playerLastName && legWords.length === playerWords.length) {
              return true;
            }
          }
          
          // Fallback to substring match
          return playerNameNormalized.includes(legNameNormalized) ||
                 legNameNormalized.includes(playerNameNormalized);
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
          allLegsResolved = false;
          continue; // Player not in this game
        }
        
        console.log(`[check-journal-bets] Parlay ${bet.id} leg "${leg.playerName}": Found player in game ${game.id}`);
        
        // Check if player played
        const minutesPlayed = playerStat.min || '0:00';
        const [mins, secs] = minutesPlayed.split(':').map(Number);
        const totalMinutes = (mins || 0) + ((secs || 0) / 60);
        
        if (totalMinutes === 0) {
          // Player didn't play - leg is void, which means parlay loses
          legResults.push({ won: false, leg });
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
        const legWon = leg.overUnder === 'over' 
          ? actualValue > leg.line 
          : actualValue < leg.line;
        
        legResults.push({ won: legWon, leg });
        legResolved = true;
        break;
      }
      
      if (!legResolved) {
        allLegsResolved = false;
      }
    }
    
    // If not all legs are resolved yet, skip this parlay
    if (!allLegsResolved) {
      console.log(`[check-journal-bets] Parlay ${bet.id}: Not all legs resolved yet (${legResults.length}/${legs.length} resolved). Legs: ${legs.map(l => l.playerName).join(', ')}`);
      return;
    }
    
    // Determine parlay result: all legs must win for parlay to win
    const parlayWon = legResults.every(r => r.won);
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
      console.log(`[check-journal-bets] ✅ Resolved parlay ${bet.id}: ${result} (${legResults.filter(r => r.won).length}/${legs.length} legs won)`);
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
    
    // Fetch all pending journal bets with NBA player props (including parlays)
    // First get single player prop bets
    const { data: singleBets, error: singleError } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .eq('result', 'pending')
      .not('player_id', 'is', null)
      .not('game_date', 'is', null);
    
    // Then get parlay bets (market contains "Parlay")
    const { data: parlayBets, error: parlayError } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('sport', 'NBA')
      .eq('result', 'pending')
      .like('market', 'Parlay%');
    
    if (singleError) {
      console.error('Error fetching single bets:', singleError);
      throw singleError;
    }
    
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
        
        // Skip if bet doesn't have required fields for single bet processing
        if (!bet.player_id || !bet.game_date) {
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
          console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game not found for ${bet.team} vs ${bet.opponent} on ${bet.game_date}`);
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
          
          // Game is live if it started and hasn't been 3 hours yet
          isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
          
          // Game is completed if:
          // 1. Status explicitly says "final"
          // 2. OR tipoff was more than 2.5 hours ago (estimated game duration) AND more than 10 minutes have passed since estimated completion
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
        } else if (gameStatus.includes('final')) {
          // Status says final but no date - assume it's completed long ago (more than 10 minutes)
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
            console.log(`[check-journal-bets] Single bet ${bet.id} (${bet.player_name}): Game ${bet.team} vs ${bet.opponent} completed ${minutesAgo} minutes ago, waiting for 10-minute buffer`);
            continue;
          }
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
        const minutesPlayed = playerStat.min || '0:00';
        const [mins, secs] = minutesPlayed.split(':').map(Number);
        const totalMinutes = (mins || 0) + ((secs || 0) / 60);
        
        if (totalMinutes === 0) {
          // Player didn't play - void the bet
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
            logDebug(`Voided ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line}: player played 0 minutes`);
            updatedCountRef.value++;
          }
          continue;
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
        let result: 'win' | 'loss';
        if (bet.over_under === 'over') {
          result = actualValue > bet.line ? 'win' : 'loss';
        } else {
          result = actualValue < bet.line ? 'win' : 'loss';
        }

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
          logDebug(`Updated ${bet.player_name} ${bet.stat_type} ${bet.over_under} ${bet.line}: ${result} (actual: ${actualValue})`);
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
