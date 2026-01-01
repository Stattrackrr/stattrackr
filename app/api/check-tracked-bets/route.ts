import { NextResponse } from 'next/server';
import { authorizeCronRequest } from '@/lib/cronAuth';
import { checkRateLimit, strictRateLimiter } from '@/lib/rateLimit';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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
          console.log('[check-tracked-bets] ✅ User authenticated via session');
        }
      } catch (error: any) {
        // Auth check failed - do not authorize
        console.error('[check-tracked-bets] Auth check failed:', error?.message);
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
    // Process tracked props in batches to avoid loading all into memory
    const BATCH_SIZE = 100;
    let allTrackedProps: any[] = [];
    let offset = 0;
    let hasMore = true;

    // Fetch tracked props in batches
    while (hasMore) {
      const { data: batch, error } = await supabaseAdmin
        .from('tracked_props')
        .select('*')
        .or('status.in.(pending,live),and(status.eq.completed,actual_pts.is.null)')
        .order('game_date', { ascending: false })
        .range(offset, offset + BATCH_SIZE - 1);

      if (error) {
        console.error('Error fetching tracked props:', error);
        throw error;
      }

      if (batch && batch.length > 0) {
        allTrackedProps.push(...batch);
        hasMore = batch.length === BATCH_SIZE;
        offset += BATCH_SIZE;
      } else {
        hasMore = false;
      }
    }

    logDebug('Fetched tracked props:', allTrackedProps.length);
    
    if (allTrackedProps.length === 0) {
      logDebug('No tracked props found with pending or live status');
      return NextResponse.json({ message: 'No pending tracked bets', updated: 0 });
    }

    let updatedCount = 0;

    // Group by game date to minimize API calls
    const gamesByDate = allTrackedProps.reduce((acc: any, prop) => {
      const date = prop.game_date;
      if (!acc[date]) acc[date] = [];
      acc[date].push(prop);
      return acc;
    }, {});

    for (const [gameDate, props] of Object.entries(gamesByDate)) {
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

      // Process each prop for this date
      for (const prop of props as any[]) {
        // Find the game with matching teams (try both full name and abbreviation)
        const game = games.find((g: any) => {
          const homeMatch = g.home_team.full_name === prop.team || g.home_team.abbreviation === prop.team;
          const visitorMatch = g.visitor_team.full_name === prop.team || g.visitor_team.abbreviation === prop.team;
          const homeOppMatch = g.home_team.full_name === prop.opponent || g.home_team.abbreviation === prop.opponent;
          const visitorOppMatch = g.visitor_team.full_name === prop.opponent || g.visitor_team.abbreviation === prop.opponent;
          
          return (homeMatch && visitorOppMatch) || (visitorMatch && homeOppMatch);
        });

        if (!game) {
          logDebug(`Game not found for ${prop.team} vs ${prop.opponent}`);
          continue;
        }

        // Check game status
        const rawStatus = String(game.status || '');
        const gameStatus = rawStatus.toLowerCase();
        
        // Check if game is live by looking at tipoff time
        let isLive = false;
        const tipoffTime = Date.parse(rawStatus);
        if (!Number.isNaN(tipoffTime)) {
          const now = Date.now();
          const timeSinceTipoff = now - tipoffTime;
          const threeHoursMs = 3 * 60 * 60 * 1000;
          // Game is live if it started and hasn't been 3 hours yet
          isLive = timeSinceTipoff > 0 && timeSinceTipoff < threeHoursMs;
        }
        
        // If game is live, update to 'live' status
        if (isLive && !gameStatus.includes('final')) {
          await supabaseAdmin
            .from('tracked_props')
            .update({ status: 'live' })
            .eq('id', prop.id)
            .in('status', ['pending', 'live']); // Update if pending or already live
          
          logDebug(`Game ${prop.team} vs ${prop.opponent} is live, updated status`);
          continue;
        }
        
        // Check if game is final
        if (!gameStatus.includes('final')) {
          logDebug(`Game ${prop.team} vs ${prop.opponent} is ${game.status}, not final yet`);
          continue;
        }

        // Fetch player stats for this game
        const statsResponse = await fetch(
          `https://api.balldontlie.io/v1/stats?game_ids[]=${game.id}&player_ids[]=${prop.player_id}`,
          {
            headers: {
              'Authorization': `Bearer ${BALLDONTLIE_API_KEY}`,
            },
          }
        );

        if (!statsResponse.ok) {
          console.error(`Failed to fetch stats for player ${prop.player_id}`);
          continue;
        }

        const statsData = await statsResponse.json();
        
        if (!statsData.data || statsData.data.length === 0) {
          logDebug(`No stats found for player ${prop.player_name}`);
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
            .from('tracked_props')
            .update({
              status: 'void',
              result: null,
              actual_value: 0,
              actual_pts: 0,
              actual_reb: 0,
              actual_ast: 0,
              actual_stl: 0,
              actual_blk: 0,
              actual_fg3m: 0,
            })
            .eq('id', prop.id);

          if (updateError) {
            console.error(`Failed to update prop ${prop.id}:`, updateError);
          } else {
            logDebug(`Voided ${prop.player_name} ${prop.stat_type} ${prop.over_under} ${prop.line}: player played 0 minutes`);
            updatedCount++;
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
        switch (prop.stat_type) {
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
            logDebug(`Unknown stat type: ${prop.stat_type}`);
            continue;
        }

        // Determine result
        // For whole number lines (e.g., "4"): "over 4" means >= 4, "under 4" means <= 4
        // For decimal lines (e.g., "3.5"): "over 3.5" means > 3.5, "under 4.5" means < 4.5
        // Ensure line is a number (handle string/decimal types from database)
        const line = Number(prop.line);
        const isWholeNumber = line % 1 === 0;
        let result: 'win' | 'loss';
        if (prop.over_under === 'over') {
          result = (isWholeNumber ? actualValue >= line : actualValue > line) ? 'win' : 'loss';
        } else if (prop.over_under === 'under') {
          result = (isWholeNumber ? actualValue <= line : actualValue < line) ? 'win' : 'loss';
        } else {
          console.error(`[check-tracked-bets] Invalid over_under value for prop ${prop.id}: "${prop.over_under}"`);
          continue;
        }

        // Log the evaluation for debugging
        console.log(`[check-tracked-bets] Evaluating prop ${prop.id}: ${prop.player_name} ${prop.over_under} ${line} ${prop.stat_type}`);
        console.log(`[check-tracked-bets]   Actual value: ${actualValue}, Line: ${line}, Is whole number: ${isWholeNumber}`);
        console.log(`[check-tracked-bets]   Comparison: ${actualValue} ${prop.over_under === 'over' ? (isWholeNumber ? '>=' : '>') : (isWholeNumber ? '<=' : '<')} ${line} = ${result}`);

        // Update the tracked prop with individual stat breakdown
        const { error: updateError } = await supabaseAdmin
          .from('tracked_props')
          .update({
            status: 'completed',
            result,
            actual_value: actualValue,
            actual_pts: stats.pts,
            actual_reb: stats.reb,
            actual_ast: stats.ast,
            actual_stl: stats.stl,
            actual_blk: stats.blk,
            actual_fg3m: stats.fg3m,
          })
          .eq('id', prop.id);

        if (updateError) {
          console.error(`Failed to update prop ${prop.id}:`, updateError);
        } else {
          logDebug(`Updated ${prop.player_name} ${prop.stat_type} ${prop.over_under} ${prop.line}: ${result} (actual: ${actualValue})`);
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      message: `Checked ${trackedProps.length} tracked bets, updated ${updatedCount}`,
      updated: updatedCount,
      total: trackedProps.length,
    });

  } catch (error: any) {
    console.error('Error checking tracked bets:', error);
    const isProduction = process.env.NODE_ENV === 'production';
    return NextResponse.json(
      { 
        error: isProduction 
          ? 'An error occurred while checking tracked bets' 
          : error.message || 'Failed to check tracked bets' 
      },
      { status: 500 }
    );
  }
}
