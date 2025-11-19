import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL environment variable is required');
}
if (!supabaseServiceKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY environment variable is required');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

export async function POST(request: NextRequest) {
  try {
    const { userId } = await request.json();
    
    if (!userId) {
      return NextResponse.json(
        { error: 'User ID is required' },
        { status: 400 }
      );
    }

    // Get all bets without a bookmaker for this user
    const { data: betsWithoutBookmaker, error: betsError } = await supabaseAdmin
      .from('bets')
      .select('*')
      .eq('user_id', userId)
      .is('bookmaker', null)
      .not('player_name', 'is', null)
      .not('line', 'is', null)
      .not('game_date', 'is', null);

    if (betsError) {
      throw betsError;
    }

    if (!betsWithoutBookmaker || betsWithoutBookmaker.length === 0) {
      return NextResponse.json({
        message: 'No bets found that need bookmaker backfill',
        updated: 0,
        total: 0
      });
    }

    let updatedCount = 0;
    const marketKeyMap: Record<string, string> = {
      'Player PTS': 'player_points',
      'Player REB': 'player_rebounds',
      'Player AST': 'player_assists',
      'Player STL': 'player_steals',
      'Player BLK': 'player_blocks',
      'Player THREES': 'player_threes',
      'Player PRA': 'player_points_rebounds_assists',
      'Player PR': 'player_points_rebounds',
      'Player RA': 'player_rebounds_assists',
    };

    for (const bet of betsWithoutBookmaker) {
      // Map market to odds snapshot market key
      const marketKey = marketKeyMap[bet.market || ''] || 'player_points';
      
      // Get game date range (same day)
      const gameDate = new Date(bet.game_date);
      const startDate = new Date(gameDate);
      startDate.setUTCHours(0, 0, 0, 0);
      const endDate = new Date(gameDate);
      endDate.setUTCHours(23, 59, 59, 999);

      // Try to find matching odds snapshot
      // Match by: player_name, line (within 0.5), market, and date
      const { data: snapshots, error: snapshotError } = await supabaseAdmin
        .from('odds_snapshots')
        .select('bookmaker, line, over_odds, under_odds')
        .eq('player_name', bet.player_name)
        .eq('market', marketKey)
        .gte('snapshot_at', startDate.toISOString())
        .lte('snapshot_at', endDate.toISOString())
        .order('snapshot_at', { ascending: false })
        .limit(50);

      if (snapshotError || !snapshots || snapshots.length === 0) {
        continue;
      }

      // Find the best matching snapshot based on line and odds
      let bestMatch: { bookmaker: string } | null = null;
      const betLine = Number(bet.line);
      const betOdds = Number(bet.odds);

      for (const snapshot of snapshots) {
        const snapshotLine = Number(snapshot.line);
        const lineDiff = Math.abs(snapshotLine - betLine);
        
        // Check if line matches (within 0.5) and odds are close
        if (lineDiff <= 0.5) {
          const overOdds = snapshot.over_odds;
          const underOdds = snapshot.under_odds;
          
          // Convert American odds to decimal for comparison
          const overDecimal = overOdds ? (overOdds > 0 ? (overOdds / 100) + 1 : (100 / Math.abs(overOdds)) + 1) : null;
          const underDecimal = underOdds ? (underOdds > 0 ? (underOdds / 100) + 1 : (100 / Math.abs(underOdds)) + 1) : null;
          
          // Check if odds are close (within 0.1 decimal odds)
          const oddsMatch = (overDecimal && Math.abs(overDecimal - betOdds) < 0.1) ||
                           (underDecimal && Math.abs(underDecimal - betOdds) < 0.1);
          
          if (oddsMatch || lineDiff === 0) {
            bestMatch = { bookmaker: snapshot.bookmaker };
            break;
          }
        }
      }

      // If no exact match, use the first snapshot with matching line
      if (!bestMatch) {
        for (const snapshot of snapshots) {
          const snapshotLine = Number(snapshot.line);
          if (Math.abs(snapshotLine - betLine) <= 0.5) {
            bestMatch = { bookmaker: snapshot.bookmaker };
            break;
          }
        }
      }

      // Update bet with bookmaker if found
      if (bestMatch) {
        const { error: updateError } = await supabaseAdmin
          .from('bets')
          .update({ bookmaker: bestMatch.bookmaker })
          .eq('id', bet.id);

        if (!updateError) {
          updatedCount++;
        }
      }
    }

    return NextResponse.json({
      message: `Backfilled bookmakers for ${updatedCount} out of ${betsWithoutBookmaker.length} bets`,
      updated: updatedCount,
      total: betsWithoutBookmaker.length
    });

  } catch (error: any) {
    console.error('Error backfilling bookmakers:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to backfill bookmakers' },
      { status: 500 }
    );
  }
}

